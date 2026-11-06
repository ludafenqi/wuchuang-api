package model

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// The real SQLite WAL fixture permits an independent inner transaction to
// commit while the outer refund-record transaction is still reading.
func refundDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB, previousType := DB, common.MainDatabaseType()
	dsn := os.Getenv("SUBSCRIPTION_TEST_SQL_DSN")
	var driver gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "refund.sqlite"))
	engine := common.DatabaseTypeSQLite
	if strings.HasPrefix(dsn, "postgres://") {
		driver, engine = postgres.Open(dsn), common.DatabaseTypePostgreSQL
	} else if dsn != "" {
		driver, engine = mysql.Open(dsn), common.DatabaseTypeMySQL
	}
	database, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	if engine == common.DatabaseTypeSQLite {
		require.NoError(t, database.Exec("PRAGMA journal_mode=WAL").Error)
	}
	require.NoError(t, database.AutoMigrate(&UserSubscription{}, &SubscriptionPreConsumeRecord{}, &User{}, &Token{}))
	DB = database
	common.SetMainDatabaseType(engine)
	initCol()
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		require.NoError(t, sqlDB.Close())
	})
	t.Cleanup(func() {
		require.NoError(t, database.Where("request_id IN ?", []string{"refund-a", "refund-b"}).Delete(&SubscriptionPreConsumeRecord{}).Error)
		require.NoError(t, database.Where("id = ?", 81).Delete(&UserSubscription{}).Error)
		require.NoError(t, database.Where("id = ?", 81).Delete(&Token{}).Error)
		require.NoError(t, database.Unscoped().Where("id = ?", 81).Delete(&User{}).Error)
	})
	require.NoError(t, database.Create(&User{Id: 81, Username: "refund-owner", Quota: 10000, UsedQuota: 3000, RequestCount: 3}).Error)
	require.NoError(t, database.Create(&Token{Id: 81, UserId: 81, Key: "ROUND8_UNUSED_TOKEN", RemainQuota: 7000, UsedQuota: 3000}).Error)
	require.NoError(t, database.Create(&UserSubscription{Id: 81, UserId: 81, AmountTotal: 10000, AmountUsed: 3000, Status: "active"}).Error)
	require.NoError(t, database.Create(&SubscriptionPreConsumeRecord{RequestId: "refund-a", UserId: 81, UserSubscriptionId: 81, PreConsumed: 1000, Status: "consumed"}).Error)
	var version string
	query := "select version()"
	if engine == common.DatabaseTypeSQLite {
		query = "select sqlite_version()"
	}
	require.NoError(t, database.Raw(query).Scan(&version).Error)
	t.Logf("real %s %s, 4 connections, isolated refund fixture", engine, version)
	return database
}

type refundCommitPool struct {
	*sql.DB
	begins atomic.Int32
}
type refundCommitTx struct {
	*sql.Tx
	fail bool
}

func (p *refundCommitPool) BeginTx(ctx context.Context, options *sql.TxOptions) (gorm.ConnPool, error) {
	tx, err := p.DB.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &refundCommitTx{Tx: tx, fail: p.begins.Add(1) == 1}, nil
}

func (tx *refundCommitTx) Commit() error {
	if tx.fail {
		_ = tx.Tx.Rollback()
		return errors.New("injected outer commit failure before commit")
	}
	return tx.Tx.Commit()
}

func TestSubscriptionRefundRollsBackFundingAndMarker(t *testing.T) {
	for _, failure := range []string{"record save", "outer commit"} {
		t.Run(failure, func(t *testing.T) {
			database := refundDatabase(t)
			if failure == "record save" {
				var fail atomic.Bool
				fail.Store(true)
				require.NoError(t, database.Callback().Update().Before("gorm:update").Register("round8:refund-failure", func(tx *gorm.DB) {
					if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "SubscriptionPreConsumeRecord" && fail.Swap(false) {
						tx.AddError(errors.New("injected refund marker save failure"))
					}
				}))
			} else {
				sqlDB, err := database.DB()
				require.NoError(t, err)
				pool := &refundCommitPool{DB: sqlDB}
				database.Config.ConnPool, database.Statement.ConnPool = pool, pool
			}
			assert.Error(t, RefundSubscriptionPreConsume("refund-a"))
			var sub UserSubscription
			var record SubscriptionPreConsumeRecord
			require.NoError(t, database.First(&sub, 81).Error)
			require.NoError(t, database.Where("request_id = ?", "refund-a").First(&record).Error)
			assert.EqualValues(t, 3000, sub.AmountUsed, "a failed refund must not release another request's quota on retry")
			assert.Equal(t, "consumed", record.Status)
			t.Logf("after failure: used=%d marker=%s", sub.AmountUsed, record.Status)
			for range 2 {
				require.NoError(t, RefundSubscriptionPreConsume("refund-a"))
			}
			require.NoError(t, database.First(&sub, 81).Error)
			require.NoError(t, database.First(&record, record.Id).Error)
			assert.EqualValues(t, 2000, sub.AmountUsed)
			assert.Equal(t, "refunded", record.Status)
			var user User
			var token Token
			var records int64
			require.NoError(t, database.First(&user, 81).Error)
			require.NoError(t, database.First(&token, 81).Error)
			require.NoError(t, database.Model(&SubscriptionPreConsumeRecord{}).Count(&records).Error)
			assert.Equal(t, 10000, user.Quota)
			assert.Equal(t, 3000, user.UsedQuota)
			assert.Equal(t, 3, user.RequestCount)
			assert.Equal(t, 7000, token.RemainQuota)
			assert.Equal(t, 3000, token.UsedQuota)
			assert.EqualValues(t, 1, records)
			t.Logf("after retry twice: used=%d marker=%s wallet=%d token=%d records=%d", sub.AmountUsed, record.Status, user.Quota, token.RemainQuota, records)
		})
	}
}

func TestSubscriptionRefundConcurrentRequests(t *testing.T) {
	for _, same := range []bool{true, false} {
		name := "same request"
		if !same {
			name = "shared subscription"
		}
		t.Run(name, func(t *testing.T) {
			database := refundDatabase(t)
			ids, want := []string{"refund-a", "refund-a"}, int64(2000)
			if !same {
				require.NoError(t, database.Create(&SubscriptionPreConsumeRecord{RequestId: "refund-b", UserId: 81, UserSubscriptionId: 81, PreConsumed: 500, Status: "consumed"}).Error)
				ids[1], want = "refund-b", 1500
			}
			start := make(chan struct{})
			results := make(chan error, len(ids))
			var workers sync.WaitGroup
			for _, id := range ids {
				workers.Go(func() { <-start; results <- RefundSubscriptionPreConsume(id) })
			}
			close(start)
			workers.Wait()
			close(results)
			for err := range results {
				if err != nil {
					require.Empty(t, os.Getenv("SUBSCRIPTION_TEST_SQL_DSN"), "Server databases must serialize both refunds successfully")
					assert.Contains(t, strings.ToLower(err.Error()), "locked", "SQLite may reject a concurrent writer; it must not partially commit")
				}
			}
			// Retry transient SQLite writer conflicts only after both workers finish.
			for _, id := range ids {
				require.NoError(t, RefundSubscriptionPreConsume(id))
			}
			var sub UserSubscription
			var refunded int64
			require.NoError(t, database.First(&sub, 81).Error)
			require.NoError(t, database.Model(&SubscriptionPreConsumeRecord{}).Where("status = ?", "refunded").Count(&refunded).Error)
			assert.Equal(t, want, sub.AmountUsed)
			wantRecords := int64(1)
			if !same {
				wantRecords = 2
			}
			assert.Equal(t, wantRecords, refunded)
			t.Logf("workers=2 used=%d refunded-records=%d", sub.AmountUsed, refunded)
		})
	}
}

func TestSubscriptionDeltaValidationDoesNotOpenTransaction(t *testing.T) {
	previous := DB
	DB = nil
	t.Cleanup(func() { DB = previous })
	require.NoError(t, PostConsumeUserSubscriptionDelta(81, 0))
	require.EqualError(t, PostConsumeUserSubscriptionDelta(0, 100), "invalid userSubscriptionId")
}

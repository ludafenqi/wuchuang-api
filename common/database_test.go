package common

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/glebarez/go-sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSQLiteDSNKeepsConcurrencyParamsForBarePaths(t *testing.T) {
	const params = "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "default file name", path: "one-api.db", want: "one-api.db" + params},
		{name: "bare absolute path", path: "/data/new-api.db", want: "/data/new-api.db" + params},
		{name: "bare file URI", path: "file:/data/new-api.db", want: "file:/data/new-api.db" + params},
		{name: "in-memory database", path: ":memory:", want: ":memory:" + params},
		{name: "own query string", path: "/data/new-api.db?_pragma=busy_timeout(5000)", want: "/data/new-api.db?_pragma=busy_timeout(5000)"},
		{name: "file URI with query", path: "file:test?mode=memory&cache=shared", want: "file:test?mode=memory&cache=shared"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, sqliteDSN(tc.path))
		})
	}
}

func TestSQLiteBarePathEnforcesConcurrencyDefaults(t *testing.T) {
	db, err := sql.Open("sqlite", sqliteDSN(filepath.Join(t.TempDir(), "bare.db")))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()
	first, err := db.Conn(ctx)
	require.NoError(t, err)
	defer first.Close()
	var journal, version string
	var timeout int
	require.NoError(t, first.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version))
	require.NoError(t, first.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journal))
	require.NoError(t, first.QueryRowContext(ctx, "PRAGMA busy_timeout").Scan(&timeout))
	t.Logf("SQLite %s journal=%s busy_timeout=%d", version, journal, timeout)
	assert.Equal(t, "wal", journal)
	assert.Equal(t, 30000, timeout)
	_, err = first.ExecContext(ctx, "CREATE TABLE concurrency_test (value INTEGER)")
	require.NoError(t, err)
	_, err = first.ExecContext(ctx, "INSERT INTO concurrency_test VALUES (1)")
	require.NoError(t, err)
	second, err := db.Conn(ctx)
	require.NoError(t, err)
	defer second.Close()
	// Fail immediately instead of sleeping through the production busy timeout.
	_, err = second.ExecContext(ctx, "PRAGMA busy_timeout=0")
	require.NoError(t, err)
	tx, err := first.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer tx.Rollback()
	// BEGIN must acquire the write reservation before its first read or write.
	other, err := second.BeginTx(ctx, nil)
	if other != nil {
		require.NoError(t, other.Rollback())
	}
	require.ErrorContains(t, err, "SQLITE_BUSY")
	_, err = tx.ExecContext(ctx, "UPDATE concurrency_test SET value=2")
	require.NoError(t, err)
	var value int
	require.NoError(t, second.QueryRowContext(ctx, "SELECT value FROM concurrency_test").Scan(&value))
	assert.Equal(t, 1, value, "WAL readers retain the committed value while a writer is active")
	require.NoError(t, tx.Commit())
	require.NoError(t, second.QueryRowContext(ctx, "SELECT value FROM concurrency_test").Scan(&value))
	assert.Equal(t, 2, value)
}

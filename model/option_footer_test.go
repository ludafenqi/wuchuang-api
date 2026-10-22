package model

import (
	"errors"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestFooterOptionStorageFailureKeepsPublishedValue(t *testing.T) {
	previousDB, previousMap, previousFooter := DB, common.OptionMap, common.Footer
	t.Cleanup(func() { DB, common.OptionMap, common.Footer = previousDB, previousMap, previousFooter })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	DB = db
	common.OptionMap = map[string]string{"Footer": "saved"}
	common.Footer = "saved"
	// No options table: a real database failure must not publish an unsaved value.
	assert.Error(t, UpdateOption("Footer", "unsaved"))
	assert.Equal(t, "saved", common.Footer)
	assert.Equal(t, "saved", common.OptionMap["Footer"])
}

const validFooterConfig = `{"version":1,"enabled":true,"layout":"brand","description":"AI services","copyright":"All rights reserved.","autoYear":true,"year":"","background":"theme","legacyMode":"replace","links":[]}`

func TestFooterConfigurationValidation(t *testing.T) {
	for _, value := range []string{"", validFooterConfig} {
		require.NoError(t, validateOptionValue(system_setting.FooterConfigKey, value))
	}
	for _, value := range []string{"null", "{}", `{"version":2}`, "{broken"} {
		assert.Error(t, validateOptionValue(system_setting.FooterConfigKey, value))
	}
	for _, address := range []string{"javascript:alert(1)", "//evil.test", "/\\evil.test", "/%2fevil.test", "/%255cevil.test", "https://user:pass@example.com", "https://example.com\n/x"} {
		assert.False(t, system_setting.SafeFooterURL(address, false), address)
	}
	for _, address := range []string{"javascript:alert(1)", "data:text/html,x", "//evil.test", "https://user:pass@example.com", "https://example.com\n/x"} {
		assert.False(t, system_setting.SafeFooterURL(address, true), address)
	}
	assert.True(t, system_setting.SafeFooterURL("/about", false))
	assert.True(t, system_setting.SafeFooterURL("https://example.com/docs?q=api#start", true))
	var config system_setting.FooterConfig
	require.NoError(t, common.UnmarshalJsonStr(validFooterConfig, &config))
	config.Links = []system_setting.FooterLink{{ID: "docs", Label: "Docs", URL: "javascript:alert(1)", External: true, Source: "custom"}}
	encoded, err := common.Marshal(config)
	require.NoError(t, err)
	assert.Error(t, validateOptionValue(system_setting.FooterConfigKey, string(encoded)))
}

// Optional DSNs point only to disposable test databases; the SQLite case always runs.
func TestFooterOptionDatabaseMatrix(t *testing.T) {
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var dialect gorm.Dialector
			switch engine {
			case "sqlite":
				dialect = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("FOOTER_TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("FOOTER_TEST_MYSQL_DSN is not configured")
				}
				dialect = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("FOOTER_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("FOOTER_TEST_POSTGRES_DSN is not configured")
				}
				dialect = postgres.Open(dsn)
			}
			db, err := gorm.Open(dialect, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			previousDB, previousMap, previousFooter := DB, common.OptionMap, common.Footer
			t.Cleanup(func() { DB, common.OptionMap, common.Footer = previousDB, previousMap, previousFooter })
			DB, common.OptionMap = db, map[string]string{}
			require.NoError(t, db.AutoMigrate(&Option{}))
			var version string
			if engine == "sqlite" {
				require.NoError(t, db.Raw("select sqlite_version()").Scan(&version).Error)
			} else {
				require.NoError(t, db.Raw("select version()").Scan(&version).Error)
			}
			t.Logf("%s version: %s", engine, version)
			// Seed legacy content using the existing Option schema, then add structured data.
			require.NoError(t, UpdateOption("Footer", "<p>Existing HTML</p>"))
			require.NoError(t, UpdateOption("About", "Original about content"))
			for range 2 {
				require.NoError(t, UpdateOption(system_setting.FooterConfigKey, validFooterConfig))
			}
			options, err := AllOption()
			require.NoError(t, err)
			stored := map[string]string{}
			for _, option := range options {
				stored[option.Key] = option.Value
			}
			assert.Equal(t, validFooterConfig, stored[system_setting.FooterConfigKey])
			assert.Equal(t, "<p>Existing HTML</p>", stored["Footer"])
			assert.Equal(t, "Original about content", stored["About"])
			assert.Equal(t, stored[system_setting.FooterConfigKey], common.OptionMap[system_setting.FooterConfigKey])
			require.NoError(t, db.Callback().Update().Before("gorm:update").Register("footer:storage_failure", func(tx *gorm.DB) { tx.AddError(errors.New("test storage failure")) }))
			assert.Error(t, UpdateOption("Footer", "unsaved HTML"))
			assert.Equal(t, "<p>Existing HTML</p>", common.Footer)
			var saved Option
			require.NoError(t, db.Where(&Option{Key: "Footer"}).First(&saved).Error)
			assert.Equal(t, "<p>Existing HTML</p>", saved.Value)
			require.NoError(t, db.Callback().Update().Remove("footer:storage_failure"))
			require.NoError(t, UpdateOption(system_setting.FooterConfigKey, ""))
			assert.Empty(t, common.OptionMap[system_setting.FooterConfigKey])
			assert.Equal(t, "<p>Existing HTML</p>", common.Footer)
		})
	}
}

package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateFooterOptionsIsOneValidatedOperation(t *testing.T) {
	previousDB, previousMap, previousName := model.DB, common.OptionMap, common.SystemName
	previousLogDB, previousRedisEnabled := model.LOG_DB, common.RedisEnabled
	t.Cleanup(func() {
		model.DB, common.OptionMap, common.SystemName = previousDB, previousMap, previousName
		model.LOG_DB, common.RedisEnabled = previousLogDB, previousRedisEnabled
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	model.DB, common.OptionMap = db, map[string]string{}
	model.LOG_DB, common.RedisEnabled = db, false
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.AuditLog{}))
	require.NoError(t, db.Create(&model.User{Id: 931521, Username: "footer-review-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}).Error)
	const config = `{"version":1,"enabled":true,"layout":"brand","description":"","copyright":"","autoYear":true,"year":"","background":"theme","legacyMode":"ignore","links":[]}`
	for _, test := range []struct {
		name        string
		body        map[string]any
		failStorage bool
		success     bool
	}{
		{"missing field", map[string]any{"SystemName": "Changed"}, false, false},
		{"invalid name", map[string]any{"SystemName": " ", "FooterConfig": config}, false, false},
		{"invalid config", map[string]any{"SystemName": "Changed", "FooterConfig": "{broken"}, false, false},
		{"database failure", map[string]any{"SystemName": "Changed", "FooterConfig": config}, true, false},
		{"success", map[string]any{"SystemName": "Changed", "FooterConfig": config}, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.failStorage {
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register("footer:failure", func(tx *gorm.DB) { tx.AddError(errors.New("storage unavailable")) }))
				t.Cleanup(func() { require.NoError(t, db.Callback().Create().Remove("footer:failure")) })
			}
			body, err := common.Marshal(test.body)
			require.NoError(t, err)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/footer", strings.NewReader(string(body)))
			context.Set("id", 931521)
			context.Set("role", common.RoleRootUser)
			UpdateFooterOptions(context)
			var payload struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.Equal(t, test.success, payload.Success)
		})
	}
}

func TestUpdateOptionRejectsInvalidGeminiSafetyThreshold(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"gemini.safety_settings","value":"{\"default\":\"BLOCK_SOME\"}"}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
	assert.Contains(t, payload.Message, "BLOCK_SOME")
}

func TestUpdateFooterOptionReportsStorageAndValidationFailures(t *testing.T) {
	previousDB, previousMap, previousFooter := model.DB, common.OptionMap, common.Footer
	t.Cleanup(func() { model.DB, common.OptionMap, common.Footer = previousDB, previousMap, previousFooter })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	model.DB, common.OptionMap, common.Footer = db, map[string]string{"Footer": "saved"}, "saved"
	for _, body := range []string{`{"key":"Footer","value":"unsaved"}`, `{"key":"FooterConfig","value":"{broken"}`} {
		response := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(response)
		context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(body))
		UpdateOption(context)
		var payload struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
		assert.False(t, payload.Success)
		assert.NotEmpty(t, payload.Message)
		assert.Equal(t, "saved", common.Footer)
	}
}

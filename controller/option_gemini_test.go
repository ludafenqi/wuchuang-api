package controller

import (
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

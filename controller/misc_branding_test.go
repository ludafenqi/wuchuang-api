package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStatusSiteBrandAndSourceBuild(t *testing.T) {
	originalName, originalLogo := common.SystemName, common.Logo
	originalVersion, originalRevision := common.Version, common.SourceRevision
	originalOptions := common.OptionMap
	t.Cleanup(func() {
		common.SystemName, common.Logo = originalName, originalLogo
		common.Version, common.SourceRevision = originalVersion, originalRevision
		common.OptionMap = originalOptions
	})
	common.OptionMap = map[string]string{}
	common.Version = ""
	common.SourceRevision = "5ce47e8883c5ca51382699d2e60bbc6db6daadb7"

	for _, tc := range []struct {
		name     string
		logo     string
		wantName string
		wantLogo string
	}{
		{originalName, originalLogo, "WuCora", "/wucora-logo.png"},
		{"Custom gateway", "https://example.test/logo.png", "Custom gateway", "https://example.test/logo.png"},
		{"New API", "/logo.png", "New API", "/logo.png"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			common.SystemName, common.Logo = tc.name, tc.logo
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(context)
			require.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Success bool           `json:"success"`
				Data    map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.Equal(t, tc.wantName, payload.Data["system_name"])
			assert.Equal(t, tc.wantLogo, payload.Data["logo"])
			assert.Empty(t, payload.Data["version"], "source builds must not invent a release")
			assert.Equal(t, common.SourceRevision, payload.Data["source_revision"])
		})
	}
}

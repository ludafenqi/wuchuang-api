package controller

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/baidu"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/dify"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	"github.com/QuantumNous/new-api/relay/channel/xai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	kitdto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type panicRoundTripper func(*http.Request) (*http.Response, error)

func (f panicRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type relaySecretPanic struct{ formatted *atomic.Bool }

func (e relaySecretPanic) Error() string { e.formatted.Store(true); return "ROUND8_PANIC_SECRET" }

func relayPanicDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn, engine := os.Getenv("TEST_RELAY_PANIC_SQL_DSN"), "sqlite"
	if strings.HasPrefix(dsn, "postgres://") {
		engine = "postgres"
	} else if dsn != "" {
		engine = "mysql"
	}
	database := modelManagementDB(t, engine, dsn)
	logDatabase, _ := newAuditTestDatabase(t, engine, dsn)
	model.LOG_DB = logDatabase
	previousBatch, previousConsume, previousExport := common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Token{}, &model.Channel{}, &model.Ability{}))
	require.NoError(t, logDatabase.AutoMigrate(&model.Log{}))
	versionQuery := "SELECT version()"
	if engine == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	var logVersion string
	require.NoError(t, logDatabase.Raw(versionQuery).Scan(&logVersion).Error)
	t.Logf("independent %s consume-log database: %s", engine, logVersion)
	common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = false, true, false
	t.Cleanup(func() {
		common.BatchUpdateEnabled, common.LogConsumeEnabled, common.DataExportEnabled = previousBatch, previousConsume, previousExport
	})
	require.NoError(t, database.Create(&model.User{Id: 82, Username: "round8-panic", Quota: 10000, Group: "default"}).Error)
	require.NoError(t, database.Create(&model.Token{Id: 82, UserId: 82, Key: "ROUND8_TOKEN_SECRET", RemainQuota: 10000, Status: common.TokenStatusEnabled}).Error)
	channel := &model.Channel{Id: 82, Name: "round8 fixture", Key: "ROUND8_CHANNEL_SECRET", Type: constant.ChannelTypeOpenAI, Models: "round8-panic-model", Group: "default", Status: common.ChannelStatusEnabled, BaseURL: common.GetPointer("http://fixture.invalid"), AutoBan: common.GetPointer(0)}
	require.NoError(t, database.Create(channel).Error)
	require.NoError(t, channel.AddAbilities(database))
	return database
}

func TestRelayPanicPreservesAccounting(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, scenario := range []string{"first attempt", "retry", "settled", "zero pre-consume"} {
		t.Run(scenario, func(t *testing.T) {
			database := relayPanicDatabase(t)
			oldPrices, oldRatios := ratio_setting.ModelPrice2JSONString(), ratio_setting.GroupRatio2JSONString()
			oldRetry, oldMode := common.RetryTimes, gin.Mode()
			quotaSetting := operation_setting.GetQuotaSetting()
			oldQuota := *quotaSetting
			quotaSetting.TrustQuotaUSD = 0
			quotaSetting.EnableFreeModelPreConsume = true
			common.RetryTimes = 1
			gin.SetMode(gin.ReleaseMode)
			price := `{"round8-panic-model":0.001}`
			if scenario == "zero pre-consume" {
				price = `{"round8-panic-model":0}`
			}
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(price))
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
			t.Cleanup(func() {
				require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
				*quotaSetting = oldQuota
				common.RetryTimes = oldRetry
				gin.SetMode(oldMode)
			})
			var logs bytes.Buffer
			common.LogWriterMu.Lock()
			oldWriter := gin.DefaultErrorWriter
			gin.DefaultErrorWriter = &logs
			common.LogWriterMu.Unlock()
			t.Cleanup(func() { common.LogWriterMu.Lock(); gin.DefaultErrorWriter = oldWriter; common.LogWriterMu.Unlock() })
			var formatted atomic.Bool
			var userRefunds, tokenRefunds atomic.Int32
			refundDone := make(chan struct{}, 2)
			require.NoError(t, database.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("round8:refund-count", func(tx *gorm.DB) {
				values, ok := tx.Statement.Dest.(map[string]any)
				if !ok || tx.Error != nil {
					return
				}
				for _, field := range []string{"quota", "remain_quota"} {
					expression, ok := values[field].(clause.Expr)
					if !ok || !strings.Contains(expression.SQL, "+") {
						continue
					}
					if field == "quota" {
						userRefunds.Add(1)
					} else {
						tokenRefunds.Add(1)
						refundDone <- struct{}{}
					}
				}
			}))
			if scenario == "settled" {
				require.NoError(t, model.LOG_DB.Callback().Create().After("gorm:commit_or_rollback_transaction").Register("round8:after-settle", func(tx *gorm.DB) {
					if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "Log" {
						panic(relaySecretPanic{formatted: &formatted})
					}
				}))
			}
			service.InitHttpClient()
			client := service.GetHttpClient()
			previousTransport := client.Transport
			t.Cleanup(func() { client.Transport = previousTransport })
			var attempts int
			client.Transport = panicRoundTripper(func(r *http.Request) (*http.Response, error) {
				attempts++
				if scenario == "settled" {
					return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"model":"round8-panic-model","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`)), Request: r}, nil
				}
				if scenario == "retry" && attempts == 1 {
					return &http.Response{StatusCode: 500, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"fixture failure","type":"server_error"}}`)), Request: r}, nil
				}
				panic(relaySecretPanic{formatted: &formatted})
			})
			router := gin.New()
			router.Use(middleware.RelayPanicRecover(), middleware.RequestId())
			router.POST("/v1/chat/completions", func(c *gin.Context) {
				for key, value := range map[string]any{"id": 82, "token_id": 82, "token_key": "ROUND8_TOKEN_SECRET", "group": "default", "user_group": "default", "original_model": "round8-panic-model", "channel_id": 82, "channel_type": constant.ChannelTypeOpenAI, "channel_name": "round8 fixture", "base_url": "http://fixture.invalid", "channel_key": "ROUND8_CHANNEL_SECRET", "token_quota": 10000, "user_setting": kitdto.UserSetting{BillingPreference: "wallet_only"}} {
					c.Set(key, value)
				}
				service.GetChannelConstraints(c).AddPin(dto.ChannelPin{ChannelId: 82, Source: dto.PinSourceOriginTask, Rank: dto.PinRankOriginTask, RetryMode: dto.PinRetrySameChannel})
				Relay(c, types.RelayFormatOpenAI)
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"round8-panic-model","messages":[{"role":"user","content":"hello"}]}`))
			request.Header.Set("Content-Type", "application/json")
			if scenario == "settled" {
				assert.PanicsWithValue(t, http.ErrAbortHandler, func() { router.ServeHTTP(response, request) })
			} else {
				router.ServeHTTP(response, request)
			}
			if scenario == "first attempt" || scenario == "retry" {
				select {
				case <-refundDone:
				case <-time.After(3 * time.Second):
					assert.Fail(t, "panic must complete wallet and token refund")
				}
			}
			var user model.User
			var token model.Token
			var channel model.Channel
			var logCount int64
			require.NoError(t, database.First(&user, 82).Error)
			require.NoError(t, database.First(&token, 82).Error)
			require.NoError(t, database.First(&channel, 82).Error)
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume).Count(&logCount).Error)
			wantQuota, wantUsed, wantRequests, wantRefunds, wantLogs := 10000, 0, 0, int32(1), int64(0)
			if scenario == "zero pre-consume" {
				wantRefunds = 0
			}
			if scenario == "settled" {
				wantQuota, wantUsed, wantRequests, wantRefunds, wantLogs = 9500, 500, 1, 0, 1
			}
			assert.Equal(t, wantQuota, user.Quota)
			assert.Equal(t, wantQuota, token.RemainQuota)
			assert.Equal(t, wantUsed, user.UsedQuota)
			assert.Equal(t, wantUsed, token.UsedQuota)
			assert.EqualValues(t, wantUsed, channel.UsedQuota)
			assert.Equal(t, wantRequests, user.RequestCount)
			assert.Equal(t, wantLogs, logCount)
			assert.Equal(t, wantRefunds, userRefunds.Load())
			assert.Equal(t, wantRefunds, tokenRefunds.Load())
			wantAttempts := 1
			if scenario == "retry" {
				wantAttempts = 2
			}
			assert.Equal(t, wantAttempts, attempts)
			if scenario != "settled" {
				assert.Equal(t, 500, response.Code)
				assert.Contains(t, response.Body.String(), `"type":"new_api_panic"`)
			}
			assert.False(t, formatted.Load(), "panic diagnostics must never call Error")
			for _, secret := range []string{"ROUND8_PANIC_SECRET", "ROUND8_TOKEN_SECRET", "ROUND8_CHANNEL_SECRET"} {
				assert.NotContains(t, response.Body.String(), secret)
				assert.NotContains(t, logs.String(), secret)
			}
			t.Logf("attempts=%d wallet=%d token=%d used=%d requests=%d refund-operations=%d/%d consume-logs=%d", attempts, user.Quota, token.RemainQuota, user.UsedQuota, user.RequestCount, userRefunds.Load(), tokenRefunds.Load(), logCount)
		})
	}
}

type relayStreamPanicWriter struct {
	gin.ResponseWriter
	value any
	fired bool
}

func (w *relayStreamPanicWriter) Write(p []byte) (int, error) {
	if !w.fired && strings.Contains(string(p), "partial") {
		w.fired = true
		_, _ = w.ResponseWriter.Write(p)
		panic(w.value)
	}
	return w.ResponseWriter.Write(p)
}
func (w *relayStreamPanicWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }

func TestRelayStreamPanicPreservesUsageSettlement(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "normal", true: "internal panic"}[failure], func(t *testing.T) {
			database := relayPanicDatabase(t)
			oldPrices, oldRatios := ratio_setting.ModelPrice2JSONString(), ratio_setting.GroupRatio2JSONString()
			settings := operation_setting.GetQuotaSetting()
			oldQuota := *settings
			settings.TrustQuotaUSD = 0
			previousTimeout := constant.StreamingTimeout
			constant.StreamingTimeout = 3
			t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
			oldRetry := common.RetryTimes
			common.RetryTimes = 2
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"round8-panic-model":0.001}`))
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
			t.Cleanup(func() {
				require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
				*settings = oldQuota
				common.RetryTimes = oldRetry
			})
			var logs bytes.Buffer
			common.LogWriterMu.Lock()
			oldWriter := gin.DefaultErrorWriter
			gin.DefaultErrorWriter = &logs
			common.LogWriterMu.Unlock()
			t.Cleanup(func() { common.LogWriterMu.Lock(); gin.DefaultErrorWriter = oldWriter; common.LogWriterMu.Unlock() })
			var attempts, refunds atomic.Int32
			var formatted atomic.Bool
			require.NoError(t, database.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("round10:refunds", func(tx *gorm.DB) {
				if values, ok := tx.Statement.Dest.(map[string]any); ok {
					if expr, ok := values["remain_quota"].(clause.Expr); ok && strings.Contains(expr.SQL, "+") {
						refunds.Add(1)
					}
				}
			}))
			service.InitHttpClient()
			client := service.GetHttpClient()
			oldTransport := client.Transport
			t.Cleanup(func() { client.Transport = oldTransport })
			client.Transport = panicRoundTripper(func(r *http.Request) (*http.Response, error) {
				attempts.Add(1)
				body := "data: " + `{"model":"round8-panic-model","choices":[{"index":0,"delta":{"content":"partial"}}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}` + "\n\ndata: " + `{"model":"round8-panic-model","choices":[{"index":0,"delta":{"content":"tail"}}]}` + "\n\ndata: [DONE]\n\n"
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
			})
			router := gin.New()
			router.Use(middleware.RelayPanicRecover(), middleware.RequestId())
			router.POST("/v1/chat/completions", func(c *gin.Context) {
				for key, value := range map[string]any{"id": 82, "token_id": 82, "token_key": "ROUND8_TOKEN_SECRET", "group": "default", "user_group": "default", "original_model": "round8-panic-model", "channel_id": 82, "channel_type": constant.ChannelTypeOpenAI, "channel_name": "round8 fixture", "base_url": "http://fixture.invalid", "channel_key": "ROUND8_CHANNEL_SECRET", "token_quota": 10000, "user_setting": kitdto.UserSetting{BillingPreference: "wallet_only"}} {
					c.Set(key, value)
				}
				if failure {
					c.Writer = &relayStreamPanicWriter{ResponseWriter: c.Writer, value: relaySecretPanic{&formatted}}
				}
				Relay(c, types.RelayFormatOpenAI)
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"round8-panic-model","stream":true,"messages":[{"role":"user","content":"hello"}]}`))
			request.Header.Set("Content-Type", "application/json")
			if failure {
				assert.PanicsWithValue(t, http.ErrAbortHandler, func() { router.ServeHTTP(response, request) })
				assert.NotContains(t, response.Body.String(), "[DONE]")
			} else {
				router.ServeHTTP(response, request)
				assert.Contains(t, response.Body.String(), "[DONE]")
			}
			var user model.User
			var token model.Token
			var channel model.Channel
			var records []model.Log
			require.NoError(t, database.First(&user, 82).Error)
			require.NoError(t, database.First(&token, 82).Error)
			require.NoError(t, database.First(&channel, 82).Error)
			require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeConsume).Find(&records).Error)
			assert.Equal(t, 9500, user.Quota)
			assert.Equal(t, 9500, token.RemainQuota)
			assert.Equal(t, 500, user.UsedQuota)
			assert.Equal(t, 500, token.UsedQuota)
			assert.EqualValues(t, 500, channel.UsedQuota)
			assert.Equal(t, 1, user.RequestCount)
			require.Len(t, records, 1)
			assert.Equal(t, 10, records[0].PromptTokens)
			assert.Equal(t, 1, records[0].CompletionTokens)
			assert.Equal(t, 500, records[0].Quota)
			assert.EqualValues(t, 1, attempts.Load())
			assert.Zero(t, refunds.Load())
			assert.False(t, formatted.Load())
			assert.NotContains(t, logs.String(), "ROUND8_PANIC_SECRET")
			assert.NotContains(t, response.Body.String(), "ROUND8_PANIC_SECRET")
			t.Logf("failure=%t attempts=%d wallet=%d token=%d used=%d refunds=%d logs=%d usage=%d/%d", failure, attempts.Load(), user.Quota, token.RemainQuota, user.UsedQuota, refunds.Load(), len(records), records[0].PromptTokens, records[0].CompletionTokens)
		})
	}
}

type failedStreamAccounting struct {
	relaycommon.BillingSettler
	attempts, refunds int
}

func (b *failedStreamAccounting) Settle(int) error {
	b.attempts++
	return errors.New("fixture settlement failed")
}
func (b *failedStreamAccounting) Refund(*gin.Context) { b.refunds++ }
func TestStreamPanicDoesNotAddRefundAfterAccountingAttempt(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	for _, handled := range []bool{false, true} {
		t.Run(map[bool]string{false: "no usage handled", true: "old accounting attempted"}[handled], func(t *testing.T) {
			status := relaycommon.NewStreamStatus()
			status.MarkPanic()
			status.FinalizePanic()
			billing := &failedStreamAccounting{}
			if handled {
				require.EqualError(t, billing.Settle(500), "fixture settlement failed")
				status.MarkPanicUsageHandled()
			}
			info := &relaycommon.RelayInfo{Billing: billing, StreamStatus: status}
			failure := status.PanicError()
			assert.Same(t, failure, relay.RefundFailedRequestBilling(c, info, failure))
			if handled {
				assert.Equal(t, 1, billing.attempts)
				assert.Zero(t, billing.refunds)
			} else {
				assert.Zero(t, billing.attempts)
				assert.Equal(t, 1, billing.refunds)
			}
		})
	}
}

func TestRealtimePanicPreservesActualAccounting(t *testing.T) {
	for _, scenario := range []string{"normal", "two responses", "panic after usage", "panic before usage", "reservation insufficient", "reservation update failure", "reservation update panic", "local reservation insufficient", "local reservation update failure", "local reservation update panic"} {
		t.Run(scenario, func(t *testing.T) {
			db := relayPanicDatabase(t)
			reservationFailure := strings.Contains(scenario, "reservation ")
			localEstimate := strings.HasPrefix(scenario, "local ")
			if strings.HasSuffix(scenario, "reservation insufficient") {
				initialQuota := 18
				if localEstimate {
					initialQuota = 3
				}
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 82).Update("quota", initialQuota).Error)
			}
			var walletUpdates atomic.Int32
			if strings.Contains(scenario, "reservation update ") {
				require.NoError(t, db.Callback().Update().Before("gorm:begin_transaction").Register("round11:reserve-failure", func(tx *gorm.DB) {
					if tx.Statement.Schema == nil || tx.Statement.Schema.Name != "User" {
						return
					}
					values, ok := tx.Statement.Dest.(map[string]any)
					if !ok {
						return
					}
					delta, ok := values["quota"].(clause.Expr)
					if ok && delta.SQL == "quota - ?" && walletUpdates.Add(1) == 2 {
						if strings.HasSuffix(scenario, "panic") {
							panic("ROUND11_RESERVE_PANIC_SECRET")
						}
						tx.AddError(errors.New("injected wallet reservation failure"))
					}
				}))
			}
			oldPrices, oldRatios, oldGroup := ratio_setting.ModelPrice2JSONString(), ratio_setting.ModelRatio2JSONString(), ratio_setting.GroupRatio2JSONString()
			oldCompletion := ratio_setting.CompletionRatio2JSONString()
			quota := operation_setting.GetQuotaSetting()
			oldQuota := *quota
			quota.TrustQuotaUSD = 0
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{}`))
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"round8-panic-model":1}`))
			require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"round8-panic-model":1}`))
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
			t.Cleanup(func() {
				*quota = oldQuota
				require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices))
				require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatios))
				require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(oldCompletion))
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroup))
			})
			peerReady := make(chan *websocket.Conn, 1)
			var attempts atomic.Int32
			upgrader := websocket.Upgrader{}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				ws, err := upgrader.Upgrade(w, r, nil)
				if err == nil {
					peerReady <- ws
				}
			}))
			t.Cleanup(upstream.Close)
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 82).Update("base_url", upstream.URL).Error)
			finished := make(chan struct{})
			engine := gin.New()
			engine.Use(middleware.RelayPanicRecover(), middleware.RequestId())
			engine.GET("/v1/realtime", func(c *gin.Context) {
				defer close(finished)
				for key, value := range map[string]any{"id": 82, "token_id": 82, "token_key": "ROUND8_TOKEN_SECRET", "group": "default", "user_group": "default", "original_model": "round8-panic-model", "channel_id": 82, "channel_type": constant.ChannelTypeOpenAI, "channel_name": "round11 fixture", "base_url": upstream.URL, "channel_key": "ROUND8_CHANNEL_SECRET", "token_quota": 10000, "user_setting": kitdto.UserSetting{BillingPreference: "wallet_only"}} {
					c.Set(key, value)
				}
				service.GetChannelConstraints(c).AddPin(dto.ChannelPin{ChannelId: 82, Source: dto.PinSourceOriginTask, Rank: dto.PinRankOriginTask, RetryMode: dto.PinRetrySameChannel})
				Relay(c, types.RelayFormatOpenAIRealtime)
			})
			gateway := httptest.NewServer(engine)
			t.Cleanup(gateway.Close)
			client, _, err := websocket.DefaultDialer.Dial(strings.Replace(gateway.URL, "http", "ws", 1)+"/v1/realtime?model=round8-panic-model", nil)
			require.NoError(t, err)
			t.Cleanup(func() { _ = client.Close() })
			var peer *websocket.Conn
			select {
			case peer = <-peerReady:
			case <-time.After(3 * time.Second):
				require.FailNow(t, "upstream websocket was not opened")
			}
			t.Cleanup(func() { _ = peer.Close() })
			completed := `{"type":"response.done","response":{"usage":{"total_tokens":12,"input_tokens":10,"output_tokens":2,"input_token_details":{"text_tokens":10},"output_token_details":{"text_tokens":2}}}}`
			if localEstimate {
				completed = `{"type":"response.done","response":{}}`
			}
			responses := 1
			if scenario == "two responses" || reservationFailure {
				responses = 2
			}
			for response := range responses {
				if scenario != "panic before usage" {
					if reservationFailure {
						// Content was delivered before the authoritative usage arrives.
						// Its local estimate must not be billed again after a failed reserve.
						delta := `{"type":"response.audio_transcript.delta","delta":"x"}`
						require.NoError(t, peer.WriteMessage(1, []byte(delta)))
						require.NoError(t, client.SetReadDeadline(time.Now().Add(3*time.Second)))
						_, message, err := client.ReadMessage()
						require.NoError(t, err)
						assert.JSONEq(t, delta, string(message))
					}
					require.NoError(t, peer.WriteMessage(1, []byte(completed)))
					require.NoError(t, client.SetReadDeadline(time.Now().Add(3*time.Second)))
					_, message, err := client.ReadMessage()
					if reservationFailure && response == 1 {
						assert.Error(t, err, "the failed reservation must stop the connection")
						assert.NotContains(t, string(message), "data:")
					} else {
						require.NoError(t, err)
						assert.JSONEq(t, completed, string(message))
					}
				}
			}
			if scenario == "normal" || scenario == "two responses" {
				require.NoError(t, peer.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1000, "")))
			} else if !reservationFailure {
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"response.done"}`)))
			}
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				require.FailNow(t, "request owner failed to return")
			}
			var user model.User
			var token model.Token
			var channel model.Channel
			var records []model.Log
			require.NoError(t, db.First(&user, 82).Error)
			require.NoError(t, db.First(&token, 82).Error)
			require.NoError(t, db.First(&channel, 82).Error)
			require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeConsume).Find(&records).Error)
			wallet, tokenBalance, used, requests, prompt, completion := 9988, 9988, 12, 1, 10, 2
			if scenario == "two responses" || reservationFailure {
				wallet, tokenBalance, used, prompt, completion = 9976, 9976, 24, 20, 4
			}
			if scenario == "reservation insufficient" {
				// Final settlement retains the existing debt semantics for delivered
				// usage; insufficient reservation must not duplicate that usage.
				wallet = 18 - used
			}
			if localEstimate {
				wallet, tokenBalance, used, prompt, completion = 9996, 9996, 4, 0, 4
				if scenario == "local reservation insufficient" {
					wallet = 3 - used
				}
			}
			if scenario == "panic before usage" {
				wallet, tokenBalance, used, requests, prompt, completion = 10000, 10000, 0, 0, 0, 0
			}
			assert.Equal(t, wallet, user.Quota)
			assert.Equal(t, tokenBalance, token.RemainQuota)
			assert.Equal(t, used, user.UsedQuota)
			assert.Equal(t, used, token.UsedQuota)
			assert.EqualValues(t, used, channel.UsedQuota)
			assert.Equal(t, requests, user.RequestCount)
			require.Len(t, records, 1)
			assert.Equal(t, used, records[0].Quota)
			assert.Equal(t, prompt, records[0].PromptTokens)
			assert.Equal(t, completion, records[0].CompletionTokens)
			if strings.Contains(scenario, "reservation update ") {
				assert.EqualValues(t, 3, walletUpdates.Load(), "reserve, injected failure, final settlement")
			}
			assert.EqualValues(t, 1, attempts.Load())
			require.NoError(t, client.SetReadDeadline(time.Now().Add(time.Second)))
			_, tail, err := client.ReadMessage()
			assert.Error(t, err)
			assert.NotContains(t, string(tail), "data:")
			assert.NotContains(t, string(tail), "ROUND8_")
			assert.NotContains(t, string(tail), "ROUND11_")
			t.Logf("scenario=%s attempts=%d wallet=%d token=%d userUsed=%d tokenUsed=%d channelUsed=%d requests=%d logQuota=%d", scenario, attempts.Load(), user.Quota, token.RemainQuota, user.UsedQuota, token.UsedQuota, channel.UsedQuota, user.RequestCount, records[0].Quota)
		})
	}
}

func TestKeepAlivePanicPreservesReservationBoundary(t *testing.T) {
	for _, stage := range []string{"before reservation", "reservation applied"} {
		t.Run(stage, func(t *testing.T) {
			db := relayPanicDatabase(t)
			oldPrices := ratio_setting.ModelPrice2JSONString()
			require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"round8-panic-model":0.001}`))
			quota := operation_setting.GetQuotaSetting()
			oldQuota := *quota
			quota.TrustQuotaUSD = 0
			quota.EnableFreeModelPreConsume = true
			t.Cleanup(func() { *quota = oldQuota; require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices)) })
			service.InitHttpClient()
			var attempts, refunds atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
			}))
			t.Cleanup(upstream.Close)
			faulted, finished, refundDone := make(chan struct{}), make(chan struct{}), make(chan struct{}, 2)
			var armed, formatted atomic.Bool
			if stage == "before reservation" {
				armed.Store(true)
			}
			require.NoError(t, db.Callback().Update().After("gorm:commit_or_rollback_transaction").Register("round11:reservation-boundary", func(tx *gorm.DB) {
				values, ok := tx.Statement.Dest.(map[string]any)
				if !ok || tx.Error != nil {
					return
				}
				if e, ok := values["quota"].(clause.Expr); ok && tx.Statement.Table == "users" && strings.Contains(e.SQL, "-") && stage == "reservation applied" {
					armed.Store(true)
					<-faulted
				}
				if e, ok := values["remain_quota"].(clause.Expr); ok && strings.Contains(e.SQL, "+") {
					refunds.Add(1)
					refundDone <- struct{}{}
				}
			}))
			engine := gin.New()
			engine.Use(middleware.RelayPanicRecover(), middleware.RequestId())
			engine.POST("/v1/chat/completions", func(c *gin.Context) {
				defer close(finished)
				c.Writer = &keepAliveFaultWriter{ResponseWriter: c.Writer, faulted: faulted, formatted: &formatted, armed: &armed}
				stop := helper.StartStreamKeepAlive(c, time.Millisecond)
				defer stop()
				if stage == "before reservation" {
					<-faulted
					stop()
				}
				for key, value := range map[string]any{"id": 82, "token_id": 82, "token_key": "ROUND8_TOKEN_SECRET", "group": "default", "user_group": "default", "original_model": "round8-panic-model", "channel_id": 82, "channel_type": constant.ChannelTypeOpenAI, "channel_name": "fixture", "base_url": upstream.URL, "channel_key": "ROUND8_CHANNEL_SECRET", "token_quota": 10000, "user_setting": kitdto.UserSetting{BillingPreference: "wallet_only"}} {
					c.Set(key, value)
				}
				service.GetChannelConstraints(c).AddPin(dto.ChannelPin{ChannelId: 82, Source: dto.PinSourceOriginTask, Rank: dto.PinRankOriginTask, RetryMode: dto.PinRetrySameChannel})
				Relay(c, types.RelayFormatOpenAI)
			})
			gateway := httptest.NewServer(engine)
			t.Cleanup(gateway.Close)
			client := &http.Client{Timeout: 4 * time.Second}
			response, err := client.Post(gateway.URL+"/v1/chat/completions", "application/json", strings.NewReader(`{"model":"round8-panic-model","stream":true,"messages":[{"role":"user","content":"hello"}]}`))
			require.NoError(t, err)
			body, readErr := io.ReadAll(response.Body)
			require.NoError(t, response.Body.Close())
			assert.Error(t, readErr)
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				require.FailNow(t, "request owner failed to exit")
			}
			if stage == "reservation applied" {
				select {
				case <-refundDone:
				case <-time.After(3 * time.Second):
					require.FailNow(t, "reservation refund did not finish")
				}
				assert.EqualValues(t, 1, refunds.Load())
			} else {
				assert.Zero(t, refunds.Load())
			}
			var user model.User
			var token model.Token
			var records []model.Log
			require.NoError(t, db.First(&user, 82).Error)
			require.NoError(t, db.First(&token, 82).Error)
			require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeConsume).Find(&records).Error)
			assert.Equal(t, 10000, user.Quota)
			assert.Equal(t, 10000, token.RemainQuota)
			assert.Zero(t, user.UsedQuota)
			assert.Zero(t, token.UsedQuota)
			assert.Zero(t, user.RequestCount)
			assert.Empty(t, records)
			assert.Zero(t, attempts.Load())
			assert.False(t, formatted.Load())
			assert.NotContains(t, string(body), "[DONE]")
			assert.NotContains(t, string(body), "ROUND8_")
			t.Logf("stage=%s upstream=%d wallet=%d token=%d refunds=%d", stage, attempts.Load(), user.Quota, token.RemainQuota, refunds.Load())
		})
	}
}

type adapterPanic struct{ formatted *atomic.Bool }

func (p adapterPanic) Error() string { p.formatted.Store(true); return "ROUND10_ADAPTER_SECRET" }

type adapterPanicWriter struct {
	gin.ResponseWriter
	value any
	fired bool
	flush bool
}

func (w *adapterPanicWriter) Write(p []byte) (int, error) {
	if !w.flush && !w.fired && strings.Contains(string(p), "partial") {
		w.fired = true
		panic(w.value)
	}
	return w.ResponseWriter.Write(p)
}
func (w *adapterPanicWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }
func (w *adapterPanicWriter) Flush() {
	if w.flush && !w.fired {
		w.fired = true
		panic(w.value)
	}
	w.ResponseWriter.Flush()
}

type adapterBody struct {
	reader *strings.Reader
	closed chan struct{}
	once   sync.Once
}

func (b *adapterBody) Read(p []byte) (int, error) {
	n, err := b.reader.Read(p)
	if n > 0 {
		return n, nil
	}
	if err == io.EOF {
		<-b.closed
	}
	return n, err
}
func (b *adapterBody) Close() error { b.once.Do(func() { close(b.closed) }); return nil }

func TestAdapterStreamPanicIsFailure(t *testing.T) {
	previousMode, previousTimeout := gin.Mode(), constant.StreamingTimeout
	settings := operation_setting.GetGeneralSetting()
	previousPing := settings.PingIntervalEnabled
	gin.SetMode(gin.ReleaseMode)
	constant.StreamingTimeout = 3
	settings.PingIntervalEnabled = false
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		constant.StreamingTimeout = previousTimeout
		settings.PingIntervalEnabled = previousPing
	})
	chat := `{"model":"fixture","choices":[{"index":0,"delta":{"content":"partial"}}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}`
	responses := `{"type":"response.output_text.delta","delta":"partial","sequence_number":0}`
	geminiData := `{"candidates":[{"content":{"parts":[{"text":"partial"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":1,"totalTokenCount":11}}`
	claudeData := `{"type":"message_start","message":{"id":"fixture","type":"message","role":"assistant","model":"fixture","content":[],"usage":{"input_tokens":10,"output_tokens":1}}}` + "\n\ndata: " + `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}` + "\n\ndata: " + `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}`
	for _, test := range []struct {
		name, payload string
		format        types.RelayFormat
		handler       func(*gin.Context, *relaycommon.RelayInfo, *http.Response) (*kitdto.Usage, *types.NewAPIError)
		wantUsage     int
	}{
		{"openai-chat", chat, types.RelayFormatOpenAI, openai.OaiStreamHandler, 11},
		{"openai-responses", responses, types.RelayFormatOpenAIResponses, openai.OaiResponsesStreamHandler, -1},
		{"gemini-responses", geminiData, types.RelayFormatOpenAIResponses, gemini.GeminiResponsesStreamHandler, 11},
		{"openai-responses-flush", responses, types.RelayFormatOpenAIResponses, openai.OaiResponsesStreamHandler, -1},
		{"gemini-responses-flush", geminiData, types.RelayFormatOpenAIResponses, gemini.GeminiResponsesStreamHandler, 11},
		{"gemini-native-flush", geminiData, types.RelayFormatGemini, gemini.GeminiTextGenerationStreamHandler, -2},
		{"responses-to-chat-flush", responses, types.RelayFormatOpenAI, openai.OaiResponsesToChatStreamHandler, -2},
		{"claude-responses-flush", claudeData, types.RelayFormatOpenAIResponses, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			return claude.ClaudeResponsesStreamHandler(c, r, i)
		}, -2},
		{"gemini-native", geminiData, types.RelayFormatGemini, gemini.GeminiTextGenerationStreamHandler, 11},
		{"gemini-chat", geminiData, types.RelayFormatOpenAI, gemini.GeminiChatStreamHandler, 11},
		{"chat-to-responses", chat, types.RelayFormatOpenAIResponses, openai.OaiChatToResponsesStreamHandler, 11},
		{"responses-to-chat", responses, types.RelayFormatOpenAI, openai.OaiResponsesToChatStreamHandler, -1},
		{"responses-to-claude", responses, types.RelayFormatClaude, openai.OaiResponsesToChatStreamHandler, -1},
		{"responses-to-gemini", responses, types.RelayFormatGemini, openai.OaiResponsesToChatStreamHandler, -1},
		{"claude-native", claudeData, types.RelayFormatClaude, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			return claude.ClaudeStreamHandler(c, r, i)
		}, -1},
		{"claude-chat", claudeData, types.RelayFormatOpenAI, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			return claude.ClaudeStreamHandler(c, r, i)
		}, -1},
		{"claude-responses", claudeData, types.RelayFormatOpenAIResponses, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			return claude.ClaudeResponsesStreamHandler(c, r, i)
		}, -1},
		{"xai", chat, types.RelayFormatOpenAI, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			u, e := (&xai.Adaptor{}).DoResponse(c, r, i)
			return u.(*kitdto.Usage), e
		}, 11},
		{"baidu", `{"result":"partial","usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}`, types.RelayFormatOpenAI, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			u, e := (&baidu.Adaptor{}).DoResponse(c, r, i)
			return u.(*kitdto.Usage), e
		}, 11},
		{"dify", `{"event":"message","answer":"partial"}`, types.RelayFormatOpenAI, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			u, e := (&dify.Adaptor{}).DoResponse(c, r, i)
			return u.(*kitdto.Usage), e
		}, -1},
		{"image", `{"type":"image_generation.partial_image","partial_image_b64":"partial"}`, types.RelayFormatOpenAI, openai.OpenaiImageStreamHandler, 0},
		{"tts", `{"text":"partial","usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}}`, types.RelayFormatOpenAI, func(c *gin.Context, i *relaycommon.RelayInfo, r *http.Response) (*kitdto.Usage, *types.NewAPIError) {
			i.RelayMode = relayconstant.RelayModeAudioSpeech
			u, e := (&openai.Adaptor{}).DoResponse(c, r, i)
			return u.(*kitdto.Usage), e
		}, -1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var output bytes.Buffer
			common.LogWriterMu.Lock()
			previousWriter := gin.DefaultErrorWriter
			gin.DefaultErrorWriter = &output
			common.LogWriterMu.Unlock()
			t.Cleanup(func() {
				common.LogWriterMu.Lock()
				gin.DefaultErrorWriter = previousWriter
				common.LogWriterMu.Unlock()
			})
			var formatted atomic.Bool
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("POST", "/v1/stream", nil)
			writer := &adapterPanicWriter{ResponseWriter: c.Writer, value: adapterPanic{&formatted}}
			writer.flush = strings.HasSuffix(test.name, "-flush")
			c.Writer = writer
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fixture"}, RelayFormat: test.format, IsStream: true, StartTime: time.Now()}
			info.EnsureClaudeConvertInfo()
			body := &adapterBody{reader: strings.NewReader("data: " + test.payload + "\n\ndata: " + test.payload + "\n\n"), closed: make(chan struct{})}
			response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: body}
			usage, apiError := test.handler(c, info, response)
			require.True(t, writer.fired, "fixture must reach the real adapter output path")
			if test.wantUsage == -2 {
				assert.Nil(t, usage, "preserve the existing ordinary-error usage contract")
			} else {
				require.NotNil(t, usage)
			}
			if test.wantUsage >= 0 {
				assert.Equal(t, test.wantUsage, usage.TotalTokens, "retain the existing parsed usage")
			}
			require.NotNil(t, apiError, "internal panic must not return nil API error")
			assert.True(t, types.IsSkipRetryError(apiError))
			assert.False(t, formatted.Load())
			assert.Equal(t, "failed", info.StreamStatus.ResponseOutcome())
			assert.Equal(t, relaycommon.StreamEndReasonPanic, info.StreamStatus.EndReason)
			assert.NotContains(t, recorder.Body.String(), "[DONE]")
			assert.NotContains(t, recorder.Body.String(), "response.completed")
			assert.NotContains(t, recorder.Body.String(), `"type":"message_stop"`)
			for _, text := range []string{output.String(), recorder.Body.String(), info.StreamStatus.Summary(), apiError.Error()} {
				assert.NotContains(t, text, "ROUND10_ADAPTER_SECRET")
			}
			select {
			case <-body.closed:
			default:
				assert.Fail(t, "upstream body must be closed before adapter returns")
			}
		})
	}
}

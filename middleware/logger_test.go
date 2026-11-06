package middleware

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetUpLoggerMasksQueryCredentials(t *testing.T) {
	previousMode, previousWriter := gin.Mode(), gin.DefaultWriter
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		gin.DefaultWriter = previousWriter
	})

	for _, tc := range []struct{ target, loggedPath string }{
		{"/v1/models?%6bey=first&key=second&API-Key=third&session_token=fourth&alt=sse",
			"/v1/models?API-Key=%2A%2A%2Amasked%2A%2A%2A&alt=sse&key=%2A%2A%2Amasked%2A%2A%2A&session_token=%2A%2A%2Amasked%2A%2A%2A"},
		{"/v1/models%23test%25?key=#secret&alt=#sse",
			"/v1/models%23test%25?alt=%23sse&key=%2A%2A%2Amasked%2A%2A%2A"},
		{"//v1%2Fmodels?key=secret", "//v1%2Fmodels?key=%2A%2A%2Amasked%2A%2A%2A"},
		{"/v1/models?key=bad%ZZ&%ZZ=bad&token=bad;other=true&alt=sse", "/v1/models?alt=sse"},
		{"/v1/models?key=bad%ZZ", "/v1/models?"},
		{"/v1/models?alt=sse&api-version=2024-02-01", "/v1/models?alt=sse&api-version=2024-02-01"},
		{"/v1/models", "/v1/models"},
		{"/%61pi/oauth/test?code=secret&state=secret", "/api/oauth/test"},
		{"/v1/models?X-Amz-Credential=credential&X-Amz-Signature=signature&password=password&refresh_token=refresh",
			"/v1/models?X-Amz-Credential=%2A%2A%2Amasked%2A%2A%2A&X-Amz-Signature=%2A%2A%2Amasked%2A%2A%2A&password=%2A%2A%2Amasked%2A%2A%2A&refresh_token=%2A%2A%2Amasked%2A%2A%2A"},
	} {
		t.Run(tc.target, func(t *testing.T) {
			for _, status := range []int{http.StatusUnauthorized, http.StatusInternalServerError} {
				t.Run(http.StatusText(status), func(t *testing.T) {
					var output bytes.Buffer
					gin.DefaultWriter = &output
					router := gin.New()
					SetUpLogger(router)
					request := httptest.NewRequest(http.MethodGet, tc.target, nil)
					originalURL := *request.URL
					router.NoRoute(func(c *gin.Context) {
						assert.Equal(t, originalURL, *c.Request.URL)
						assert.Equal(t, tc.target, c.Request.RequestURI)
						c.Status(status)
					})
					response := httptest.NewRecorder()
					router.ServeHTTP(response, request)

					require.Equal(t, status, response.Code)
					_, loggedPath, found := strings.Cut(strings.TrimSuffix(output.String(), "\n"), "GET ")
					require.True(t, found)
					assert.Equal(t, tc.loggedPath, loggedPath)
					assert.Equal(t, originalURL, *request.URL)
					assert.Equal(t, tc.target, request.RequestURI)
				})
			}
		})
	}
}

func TestAccessAndPanicLogsFollowLogRotation(t *testing.T) {
	previousMode, previousWriter, previousErrorWriter := gin.Mode(), gin.DefaultWriter, gin.DefaultErrorWriter
	previousLogDir := *common.LogDir
	gin.SetMode(gin.TestMode)
	*common.LogDir = t.TempDir()
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		gin.DefaultWriter, gin.DefaultErrorWriter = previousWriter, previousErrorWriter
		*common.LogDir = previousLogDir
	})

	logger.SetupLogger()
	router := gin.New()
	router.Use(PanicRecover(), RequestId())
	SetUpLogger(router)
	router.GET("/ok/:step", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	router.GET("/panic", func(c *gin.Context) { panic("rotation-panic-marker") })

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok/before-rotation", nil))
	content, err := os.ReadFile(logger.GetCurrentLogPath())
	require.NoError(t, err)
	assert.Contains(t, string(content), "/ok/before-rotation")

	// Rotation closes the file the middleware saw at startup. The new file may
	// reuse the old name when both calls land in the same second; the checks
	// below hold either way because only the new descriptor stays open.
	logFile := logger.SetupLogger()
	require.NotNil(t, logFile)
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		defer common.LogWriterMu.Unlock()
		require.NoError(t, logFile.Close())
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok/after-rotation", nil))
	panicResponse := httptest.NewRecorder()
	router.ServeHTTP(panicResponse, httptest.NewRequest(http.MethodGet, "/panic", nil))
	require.Equal(t, http.StatusInternalServerError, panicResponse.Code)

	content, err = os.ReadFile(logger.GetCurrentLogPath())
	require.NoError(t, err)
	assert.Contains(t, string(content), "/ok/after-rotation")
	assert.Contains(t, string(content), "[ERR]")
	assert.Contains(t, string(content), "TestAccessAndPanicLogsFollowLogRotation")
	assert.Contains(t, string(content), panicResponse.Header().Get(common.RequestIdKey))
	assert.NotContains(t, string(content), "rotation-panic-marker")
	assert.NotContains(t, panicResponse.Body.String(), "rotation-panic-marker")
}

func TestSetUpLoggerOmitsQueryCredentialsTakenOutByHandlers(t *testing.T) {
	previousMode, previousWriter := gin.Mode(), gin.DefaultWriter
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		gin.DefaultWriter = previousWriter
	})

	for _, tc := range []struct{ target, loggedPath string }{
		{"/v1beta/models/veo:predictLongRunning?key=sk-secret", "/v1beta/models/veo:predictLongRunning"},
		{"/v1beta/models/veo:predictLongRunning?key=sk-secret&alt=sse", "/v1beta/models/veo:predictLongRunning?alt=sse"},
	} {
		t.Run(tc.target, func(t *testing.T) {
			var output bytes.Buffer
			gin.DefaultWriter = &output
			router := gin.New()
			SetUpLogger(router)
			router.POST("/v1beta/models/:action", NativeRouteCredential("google"), func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, tc.target, nil))

			require.Equal(t, http.StatusNoContent, response.Code)
			assert.NotContains(t, output.String(), "sk-secret")
			_, loggedPath, found := strings.Cut(strings.TrimSuffix(output.String(), "\n"), "POST ")
			require.True(t, found)
			assert.Equal(t, tc.loggedPath, loggedPath)
		})
	}
}

type credentialPanicError struct {
	formatted *bool
}

type secondaryPanicError struct {
	method string
}

func (e secondaryPanicError) Error() string { return "ROUND5_SECONDARY_SECRET" }
func (e secondaryPanicError) Unwrap() error {
	if e.method == "Unwrap" {
		panic("ROUND5_SECONDARY_SECRET")
	}
	return nil
}
func (e secondaryPanicError) As(any) bool {
	if e.method == "As" {
		panic("ROUND5_SECONDARY_SECRET")
	}
	return false
}
func (e secondaryPanicError) Is(error) bool {
	if e.method == "Is" {
		panic("ROUND5_SECONDARY_SECRET")
	}
	return false
}

func TestPanicRecoverySurvivesPanickingErrorClassification(t *testing.T) {
	previousMode, previousDebug := gin.Mode(), common.DebugEnabled
	common.LogWriterMu.Lock()
	previousWriter := gin.DefaultErrorWriter
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		common.DebugEnabled = previousDebug
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = previousWriter
		common.LogWriterMu.Unlock()
	})
	gin.SetMode(gin.ReleaseMode)
	common.DebugEnabled = true
	for _, method := range []string{"Unwrap", "As", "Is"} {
		t.Run(method, func(t *testing.T) {
			var output, fallback bytes.Buffer
			common.LogWriterMu.Lock()
			gin.DefaultErrorWriter = &output
			common.LogWriterMu.Unlock()
			var wrapped error = secondaryPanicError{method: method}
			if method == "Is" {
				wrapped = &os.SyscallError{Syscall: "write", Err: wrapped}
			}
			router := gin.New()
			router.Use(RelayPanicRecover(), RequestId())
			router.GET("/panic", func(c *gin.Context) { panic(&net.OpError{Op: "read", Net: "tcp", Err: wrapped}) })
			server := httptest.NewUnstartedServer(router)
			server.Config.ErrorLog = log.New(&fallback, "", 0)
			server.Start()
			defer server.Close()
			request, err := http.NewRequest(http.MethodGet, server.URL+"/panic?token=ROUND5_REQUEST_SECRET", nil)
			require.NoError(t, err)
			request.Header.Set("Authorization", "Bearer ROUND5_AUTH_SECRET")

			response, err := server.Client().Do(request)

			if assert.NoError(t, err, "classification must not escape to net/http recovery") {
				defer response.Body.Close()
				body, readErr := io.ReadAll(response.Body)
				require.NoError(t, readErr)
				assert.Equal(t, http.StatusInternalServerError, response.StatusCode)
				assert.JSONEq(t, `{"error":{"message":"Internal server error. Please submit a issue here: https://github.com/Calcium-Ion/new-api","type":"new_api_panic"}}`, string(body))
				assert.NotEmpty(t, response.Header.Get(common.RequestIdKey))
			}
			server.Close()
			assert.Empty(t, fallback.String(), "net/http must not receive an unhandled second panic")
			assert.Contains(t, output.String(), "[ERR]")
			assert.Contains(t, output.String(), "type=*net.OpError")
			for _, secret := range []string{"ROUND5_SECONDARY_SECRET", "ROUND5_REQUEST_SECRET", "ROUND5_AUTH_SECRET"} {
				assert.NotContains(t, output.String(), secret)
				assert.NotContains(t, fallback.String(), secret)
			}
		})
	}
}

func (e credentialPanicError) Error() string {
	*e.formatted = true
	return "password=RECOVERY_ERROR_SECRET"
}

func TestPanicRecoveryDoesNotWriteToHijackedWebSocket(t *testing.T) {
	var logs, fallback bytes.Buffer
	common.LogWriterMu.Lock()
	previous := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logs
	common.LogWriterMu.Unlock()
	t.Cleanup(func() { common.LogWriterMu.Lock(); gin.DefaultErrorWriter = previous; common.LogWriterMu.Unlock() })
	var formatted bool
	done := make(chan struct{})
	router := gin.New()
	router.Use(func(c *gin.Context) { defer close(done); c.Next() }, RelayPanicRecover())
	router.GET("/ws", func(c *gin.Context) {
		upgrader := websocket.Upgrader{}
		connection, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		_ = connection.WriteMessage(websocket.TextMessage, []byte("partial"))
		panic(credentialPanicError{formatted: &formatted})
	})
	server := httptest.NewUnstartedServer(router)
	server.Config.ErrorLog = log.New(&fallback, "", 0)
	server.Start()
	t.Cleanup(server.Close)
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?token=ROUND8_WS_SECRET", nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = connection.Close() })
	require.NoError(t, connection.SetReadDeadline(time.Now().Add(3*time.Second)))
	kind, payload, err := connection.ReadMessage()
	require.NoError(t, err)
	assert.Equal(t, websocket.TextMessage, kind)
	assert.Equal(t, "partial", string(payload))
	_, _, err = connection.ReadMessage()
	require.Error(t, err)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		require.FailNow(t, "recovery did not finish")
	}
	assert.False(t, formatted)
	assert.Empty(t, fallback.String(), "recovery must not write HTTP JSON to a hijacked connection")
	assert.NotContains(t, logs.String(), "ROUND8_WS_SECRET")
	assert.NotContains(t, logs.String(), "RECOVERY_ERROR_SECRET")
}

func TestPanicRecoveryProtectsCredentialsAndKeepsDiagnostics(t *testing.T) {
	previousMode, previousDebug := gin.Mode(), common.DebugEnabled
	common.LogWriterMu.Lock()
	previousWriter, previousErrorWriter := gin.DefaultWriter, gin.DefaultErrorWriter
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		common.DebugEnabled = previousDebug
		common.LogWriterMu.Lock()
		gin.DefaultWriter, gin.DefaultErrorWriter = previousWriter, previousErrorWriter
		common.LogWriterMu.Unlock()
	})
	for _, mode := range []string{gin.DebugMode, gin.ReleaseMode} {
		for _, debugEnabled := range []bool{false, true} {
			for _, kind := range []string{"URL", "error", "structured value", "nil", "nil syscall error"} {
				t.Run(fmt.Sprintf("%s/debug=%t/%s", mode, debugEnabled, kind), func(t *testing.T) {
					gin.SetMode(mode)
					common.DebugEnabled = debugEnabled
					var output bytes.Buffer
					common.LogWriterMu.Lock()
					gin.DefaultWriter, gin.DefaultErrorWriter = &output, &output
					common.LogWriterMu.Unlock()
					router := gin.New()
					router.Use(RelayPanicRecover(), RequestId())
					SetUpLogger(router)
					var observed *gin.Context
					var formatted, continued bool
					router.POST("/panic/:part", func(c *gin.Context) {
						observed = c
						switch kind {
						case "URL":
							panic(&url.Error{Op: "Post", URL: "https://RECOVERY_USER:RECOVERY_PASSWORD@provider.example/path?%61pi_key=RECOVERY_API_KEY&token=RECOVERY_TOKEN#password=RECOVERY_FRAGMENT", Err: errors.New("RECOVERY_ERROR_SECRET")})
						case "error":
							panic(credentialPanicError{formatted: &formatted})
						case "structured value":
							panic(map[string]any{"password": "RECOVERY_ERROR_SECRET", "url": "https://provider.example/%ZZ?token=RECOVERY_TOKEN"})
						case "nil syscall error":
							panic(&net.OpError{Err: (*os.SyscallError)(nil)})
						default:
							panic(nil)
						}
					}, func(c *gin.Context) { continued = true })
					router.GET("/healthy", func(c *gin.Context) { c.String(http.StatusOK, "healthy") })
					request := httptest.NewRequest(http.MethodPost, "/panic/RECOVERY_PATH?access_token=RECOVERY_QUERY&api_key=RECOVERY_KEY&password=RECOVERY_QUERY_PASSWORD", strings.NewReader(`{"password":"RECOVERY_BODY"}`))
					for name, value := range map[string]string{"Authorization": "Bearer RECOVERY_AUTHORIZATION", "Proxy-Authorization": "Basic RECOVERY_PROXY_AUTHORIZATION", "X-Api-Key": "RECOVERY_HEADER", "X-Goog-Api-Key": "RECOVERY_GOOG", "Cookie": "session=RECOVERY_COOKIE", common.RequestIdKey: "RECOVERY_UNTRUSTED_ID"} {
						request.Header.Set(name, value)
					}
					originalURL, originalHeaders, originalURI := *request.URL, request.Header.Clone(), request.RequestURI
					response := httptest.NewRecorder()

					router.ServeHTTP(response, request)

					require.Equal(t, http.StatusInternalServerError, response.Code)
					assert.JSONEq(t, `{"error":{"message":"Internal server error. Please submit a issue here: https://github.com/Calcium-Ion/new-api","type":"new_api_panic"}}`, response.Body.String())
					assert.Contains(t, response.Header().Get("Content-Type"), "application/json")
					require.NotNil(t, observed)
					assert.True(t, observed.IsAborted())
					assert.False(t, continued, "recovery must not continue the handler chain")
					assert.False(t, formatted, "panic values must not invoke Error or String methods")
					assert.Equal(t, originalURL, *request.URL)
					assert.Equal(t, originalHeaders, request.Header)
					assert.Equal(t, originalURI, request.RequestURI)
					requestID := response.Header().Get(common.RequestIdKey)
					require.NotEmpty(t, requestID)
					logged := output.String()
					assert.Contains(t, logged, "[ERR]")
					assert.Contains(t, logged, requestID)
					assert.Contains(t, logged, "type=")
					assert.Contains(t, logged, "TestPanicRecoveryProtectsCredentialsAndKeepsDiagnostics")
					assert.Contains(t, logged, `/panic/:part`)
					for _, secret := range []string{"RECOVERY_USER", "RECOVERY_PASSWORD", "RECOVERY_API_KEY", "RECOVERY_TOKEN", "RECOVERY_FRAGMENT", "RECOVERY_ERROR_SECRET", "RECOVERY_PATH", "RECOVERY_QUERY", "RECOVERY_KEY", "RECOVERY_BODY", "RECOVERY_AUTHORIZATION", "RECOVERY_PROXY_AUTHORIZATION", "RECOVERY_HEADER", "RECOVERY_GOOG", "RECOVERY_COOKIE", "RECOVERY_UNTRUSTED_ID"} {
						assert.NotContains(t, response.Body.String(), secret)
						assert.NotContains(t, logged, secret)
					}
					healthy := httptest.NewRecorder()
					router.ServeHTTP(healthy, httptest.NewRequest(http.MethodGet, "/healthy", nil))
					assert.Equal(t, http.StatusOK, healthy.Code)
					assert.Equal(t, "healthy", healthy.Body.String())
				})
			}
		}
	}
}

func TestPanicRecoveryLeavesOrdinaryErrorsUnchanged(t *testing.T) {
	previousMode := gin.Mode()
	common.LogWriterMu.Lock()
	previousWriter, previousErrorWriter := gin.DefaultWriter, gin.DefaultErrorWriter
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		gin.SetMode(previousMode)
		common.LogWriterMu.Lock()
		gin.DefaultWriter, gin.DefaultErrorWriter = previousWriter, previousErrorWriter
		common.LogWriterMu.Unlock()
	})
	for _, mode := range []string{gin.DebugMode, gin.ReleaseMode} {
		t.Run(mode, func(t *testing.T) {
			gin.SetMode(mode)
			var output bytes.Buffer
			common.LogWriterMu.Lock()
			gin.DefaultWriter, gin.DefaultErrorWriter = &output, &output
			common.LogWriterMu.Unlock()
			router := gin.New()
			router.Use(RelayPanicRecover(), RequestId())
			SetUpLogger(router)
			router.POST("/ordinary", func(c *gin.Context) {
				_ = c.Error(errors.New("request rejected"))
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{"message": "invalid request", "type": "new_api_error"}})
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/ordinary?key=ORDINARY_KEY&password=ORDINARY_PASSWORD&token=ORDINARY_TOKEN", nil))
			assert.Equal(t, http.StatusBadRequest, response.Code)
			assert.JSONEq(t, `{"error":{"message":"invalid request","type":"new_api_error"}}`, response.Body.String())
			assert.Contains(t, output.String(), "[GIN]")
			assert.NotContains(t, output.String(), "panic detected")
			for _, secret := range []string{"ORDINARY_KEY", "ORDINARY_PASSWORD", "ORDINARY_TOKEN"} {
				assert.NotContains(t, output.String(), secret)
			}
		})
	}
}

func TestPanicRecoveryDoesNotWriteJSONToBrokenConnections(t *testing.T) {
	for _, errno := range []syscall.Errno{syscall.EPIPE, syscall.ECONNRESET} {
		t.Run(fmt.Sprint(errno), func(t *testing.T) {
			router := gin.New()
			router.Use(RelayPanicRecover())
			var observed *gin.Context
			router.GET("/closed", func(c *gin.Context) {
				observed = c
				panic(&net.OpError{Op: "write", Net: "tcp", Err: &os.SyscallError{Syscall: "write", Err: errno}})
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/closed", nil))
			assert.Empty(t, response.Body.String())
			assert.Empty(t, response.Header().Get("Content-Type"))
			require.NotNil(t, observed)
			assert.True(t, observed.IsAborted())
			require.Len(t, observed.Errors, 1)
			assert.Equal(t, "connection closed during panic recovery", observed.Errors.Last().Error())
		})
	}
}

type recoveryWireWriter struct {
	gin.ResponseWriter
	fault string
	armed bool
}

func (w *recoveryWireWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *recoveryWireWriter) Write(p []byte) (int, error) {
	if w.armed && w.fault == "write error" {
		return 0, errors.New("ROUND10_WRITE_SECRET")
	}
	return w.ResponseWriter.Write(p)
}
func (w *recoveryWireWriter) FlushError() error {
	if w.armed && w.fault == "flush error" {
		return errors.New("ROUND10_FLUSH_SECRET")
	}
	return http.NewResponseController(w.ResponseWriter).Flush()
}

func TestPanicRecoveryAbortsHTTPWire(t *testing.T) {
	previousMode := gin.Mode()
	gin.SetMode(gin.ReleaseMode)
	t.Cleanup(func() { gin.SetMode(previousMode) })
	for _, h2 := range []bool{false, true} {

		for _, stage := range []string{"not written", "written", "flushed", "write error", "flush error"} {
			t.Run(fmt.Sprintf("h2=%t/%s", h2, stage), func(t *testing.T) {
				var logs, fallback bytes.Buffer
				common.LogWriterMu.Lock()
				previousWriter := gin.DefaultErrorWriter
				gin.DefaultErrorWriter = &logs
				common.LogWriterMu.Unlock()
				t.Cleanup(func() {
					common.LogWriterMu.Lock()
					gin.DefaultErrorWriter = previousWriter
					common.LogWriterMu.Unlock()
				})
				prefix := "data: {\"partial\":true}\n\n"
				router := gin.New()
				router.Use(RelayPanicRecover())
				finished := make(chan struct{})
				observedProtocol := 0
				router.GET("/wire", func(c *gin.Context) {
					defer close(finished)
					observedProtocol = c.Request.ProtoMajor
					w := &recoveryWireWriter{ResponseWriter: c.Writer, fault: stage}
					c.Writer = w
					c.Header("Content-Type", "text/event-stream")
					if stage != "not written" {
						_, _ = c.Writer.Write([]byte(prefix))
					}
					if stage == "flushed" || stage == "write error" || stage == "flush error" {
						if err := http.NewResponseController(w).Flush(); err != nil {
							panic(err)
						}
					}
					w.armed = true
					if stage == "write error" {
						_, err := w.Write([]byte("never delivered"))
						if err != nil {
							panic(err)
						}
					}
					if stage == "flush error" {
						if err := http.NewResponseController(w).Flush(); err != nil {
							panic(err)
						}
					}
					panic("ROUND10_PANIC_SECRET")
				})
				server := httptest.NewUnstartedServer(router)
				server.EnableHTTP2 = h2
				server.Config.ErrorLog = log.New(&fallback, "", 0)
				if h2 {
					server.StartTLS()
				} else {
					server.Start()
				}
				t.Cleanup(server.Close)
				client := server.Client()
				client.Timeout = 3 * time.Second
				response, requestErr := client.Get(server.URL + "/wire?key=ROUND10_QUERY_SECRET")
				var body []byte
				var readErr error
				if response != nil {
					body, readErr = io.ReadAll(response.Body)
					require.NoError(t, response.Body.Close())
				}
				select {
				case <-finished:
				case <-time.After(3 * time.Second):
					require.FailNow(t, "handler did not finish")
				}
				server.Close()
				wantProtocol := 1
				if h2 {
					wantProtocol = 2
				}
				assert.Equal(t, wantProtocol, observedProtocol)
				if stage == "not written" {
					require.NoError(t, requestErr)
					require.NoError(t, readErr)
					require.NotNil(t, response)
					assert.Equal(t, 500, response.StatusCode)
					assert.JSONEq(t, `{"error":{"message":"Internal server error. Please submit a issue here: https://github.com/Calcium-Ion/new-api","type":"new_api_panic"}}`, string(body))
				} else {
					assert.True(t, requestErr != nil || readErr != nil, "partial response must not finish with a clean EOF")
					if response != nil {
						assert.Equal(t, 200, response.StatusCode)
						assert.NotContains(t, string(body), `"new_api_panic"`)
					}
					if stage != "written" {
						assert.Equal(t, prefix, string(body))
					}
				}
				assert.Empty(t, fallback.String(), "net/http abort sentinel must not log a panic")
				for _, secret := range []string{"ROUND10_PANIC_SECRET", "ROUND10_QUERY_SECRET", "ROUND10_WRITE_SECRET", "ROUND10_FLUSH_SECRET"} {
					assert.NotContains(t, string(body), secret)
					assert.NotContains(t, logs.String(), secret)
					assert.NotContains(t, fallback.String(), secret)
				}
			})
		}
	}
}

type recoveryDiagnosticWriter struct{}

func (recoveryDiagnosticWriter) Write([]byte) (int, error) { panic("ROUND10_LOG_SINK_SECRET") }
func TestPanicRecoveryDiagnosticFailure(t *testing.T) {
	common.LogWriterMu.Lock()
	previous := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = recoveryDiagnosticWriter{}
	common.LogWriterMu.Unlock()
	t.Cleanup(func() { common.LogWriterMu.Lock(); gin.DefaultErrorWriter = previous; common.LogWriterMu.Unlock() })
	router := gin.New()
	router.Use(RelayPanicRecover())
	var formatted bool
	router.GET("/panic", func(c *gin.Context) { panic(credentialPanicError{&formatted}) })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/panic", nil))
	assert.Equal(t, 500, response.Code)
	assert.Contains(t, response.Body.String(), `"type":"new_api_panic"`)
	assert.False(t, formatted)
	assert.NotContains(t, response.Body.String(), "SECRET")
}

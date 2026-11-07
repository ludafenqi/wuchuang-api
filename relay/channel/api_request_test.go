package channel

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type debugLogAdaptor struct {
	Adaptor
	requestURL string
}

func (a debugLogAdaptor) GetRequestURL(*relaycommon.RelayInfo) (string, error) {
	return a.requestURL, nil
}

func (a debugLogAdaptor) SetupRequestHeader(*gin.Context, *http.Header, *relaycommon.RelayInfo) error {
	return nil
}

func TestAPIRequestDebugLogsProtectCredentials(t *testing.T) {
	previousDebug := common.DebugEnabled
	common.DebugEnabled = true
	common.LogWriterMu.Lock()
	previousWriter := gin.DefaultErrorWriter
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.DebugEnabled = previousDebug
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = previousWriter
		common.LogWriterMu.Unlock()
	})
	for _, tc := range []struct {
		name string
		send func(Adaptor, *gin.Context, *relaycommon.RelayInfo, io.Reader) (*http.Response, error)
	}{
		{"JSON", DoApiRequest},
		{"form", DoFormRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type receivedRequest struct {
				query, body string
				err         error
			}
			received := make(chan receivedRequest, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					received <- receivedRequest{err: err}
					return
				}
				conn, _, err := w.(http.Hijacker).Hijack()
				received <- receivedRequest{query: r.URL.RawQuery, body: string(body), err: err}
				if err == nil {
					_ = conn.Close()
				}
			}))
			defer upstream.Close()
			var output bytes.Buffer
			common.LogWriterMu.Lock()
			gin.DefaultErrorWriter = &output
			common.LogWriterMu.Unlock()
			target := strings.Replace(upstream.URL, "://", "://debug-user:debug-password@", 1) + "/v1/responses?api_key=debug-key&token=debug-token&password=debug-query-password#access_token=debug-fragment"
			parsed, err := url.Parse(target)
			require.NoError(t, err)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/relay", nil)
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
			response, err := tc.send(debugLogAdaptor{requestURL: target}, ctx, info, strings.NewReader("body=unchanged"))
			require.Error(t, err)
			assert.Nil(t, response)
			assert.Contains(t, output.String(), "[DEBUG]")
			assert.Contains(t, output.String(), "/v1/responses")
			assert.Contains(t, output.String(), "EOF")
			for _, secret := range []string{"debug-user", "debug-password", "debug-key", "debug-token", "debug-query-password", "debug-fragment"} {
				assert.NotContains(t, output.String(), secret)
			}
			require.Len(t, received, 1)
			got := <-received
			require.NoError(t, got.err)
			assert.Equal(t, parsed.RawQuery, got.query, "log redaction must not change upstream credentials")
			assert.Equal(t, "body=unchanged", got.body)
		})
	}
}

func TestDoRequestMasksCredentialsInTransportFailureLogs(t *testing.T) {
	common.LogWriterMu.Lock()
	previousWriter := gin.DefaultErrorWriter
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = previousWriter
		common.LogWriterMu.Unlock()
	})
	for _, tc := range []struct {
		name, userinfo, query string
		secrets               []string
	}{
		{"duplicate and encoded keys", "", "%6bey=fixture-key-a&key=fixture-key-b&access_token=fixture-token&alt=sse", []string{"fixture-key-a", "fixture-key-b", "fixture-token"}},
		{"userinfo and signed query", "fixture-user:fixture-password@", "X-Amz-Credential=fixture-credential&X-Amz-Signature=fixture-signature", []string{"fixture-user", "fixture-password", "fixture-credential", "fixture-signature"}},
		{"malformed query", "", "key=fixture-malformed%ZZ&session_token=fixture-session;extra=value", []string{"fixture-malformed", "fixture-session"}},
		{"fragment credential", "", "alt=sse#access_token=fixture-fragment", []string{"fixture-fragment"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// A real transport error includes the requested URL in *url.Error.
			// Closing a loopback connection before headers produces that path
			// without DNS, external proxies, or real credentials.
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = conn.Close()
				}
			}))
			defer upstream.Close()
			var output bytes.Buffer
			common.LogWriterMu.Lock()
			gin.DefaultErrorWriter = &output
			common.LogWriterMu.Unlock()
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/relay", nil)
			target := strings.Replace(upstream.URL, "://", "://"+tc.userinfo, 1) + "/v1/responses?" + tc.query
			req, err := http.NewRequest(http.MethodPost, target, strings.NewReader(`{"model":"fixture"}`))
			require.NoError(t, err)
			defer req.Body.Close()
			originalURL := req.URL.String()
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}

			response, err := doRequest(ctx, req, info)

			require.Error(t, err)
			assert.Nil(t, response)
			var apiError *types.NewAPIError
			require.ErrorAs(t, err, &apiError)
			assert.Equal(t, types.ErrorCodeDoRequestFailed, apiError.GetErrorCode())
			assert.Equal(t, "upstream error: do request failed", apiError.ToOpenAIError().Message)
			logged := output.String()
			assert.Contains(t, logged, "EOF")
			for _, secret := range tc.secrets {
				assert.NotContains(t, logged, secret)
			}
			assert.Equal(t, originalURL, req.URL.String(), "logging must not alter the upstream request")
		})
	}
}

func TestNewTaskAPIRequestInheritsClientCancellation(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithCancel(context.Background())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(requestContext)

	upstream, err := newTaskAPIRequest(c, "https://provider.example/tasks", nil)
	require.NoError(t, err)
	cancel()

	require.ErrorIs(t, upstream.Context().Err(), context.Canceled)
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}

func TestToWebSocketURL(t *testing.T) {
	for input, want := range map[string]string{
		"https://api.openai.com/v1/responses":             "wss://api.openai.com/v1/responses",
		"http://127.0.0.1:3000/v1/responses":              "ws://127.0.0.1:3000/v1/responses",
		"wss://chatgpt.com/backend-api/codex/responses":   "wss://chatgpt.com/backend-api/codex/responses",
		"ws://127.0.0.1:3000/backend-api/codex/responses": "ws://127.0.0.1:3000/backend-api/codex/responses",
	} {
		assert.Equal(t, want, toWebSocketURL(input), input)
	}
}

package openai

import (
	"bytes"
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestObserveStreamChoicesDedupesFunctionCallNames(t *testing.T) {
	info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
	seen := make(map[string]struct{})
	var names []string

	chunks := []string{
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":"}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\"}"}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"get_time","arguments":""}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{}"}}]}}]}`,
	}
	for _, chunk := range chunks {
		observeStreamChoices(info, chunk, seen, &names)
	}

	require.Len(t, names, 2)
	assert.Equal(t, []string{"get_weather", "get_time"}, names)
	assert.Empty(t, info.StreamStatus.ResponseOutcome(), "tool call deltas carry no finish reason")

	observeStreamChoices(info, `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`, seen, &names)
	assert.Equal(t, "completed", info.StreamStatus.ResponseOutcome())
	assert.False(t, info.PerformanceBusinessRejection)

	filtered := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
	observeStreamChoices(filtered, `{"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}`, map[string]struct{}{}, &names)
	assert.True(t, filtered.PerformanceBusinessRejection)
}

type realtimeSecretPanic struct{ called *atomic.Bool }

func (e realtimeSecretPanic) Error() string  { e.called.Store(true); return "ROUND11_WS_SECRET" }
func (e realtimeSecretPanic) String() string { e.called.Store(true); return "ROUND11_WS_SECRET" }

type realtimeFaultConn struct {
	net.Conn
	mode      atomic.Int32
	active    atomic.Int32
	closes    atomic.Int32
	formatted *atomic.Bool
}

func (c *realtimeFaultConn) Read(p []byte) (int, error) {
	c.active.Add(1)
	defer c.active.Add(-1)
	n, err := c.Conn.Read(p)
	switch c.mode.Load() {
	case 1:
		panic(realtimeSecretPanic{c.formatted})
	case 3:
		return 0, errors.New("ROUND11_READ_SECRET")
	}
	return n, err
}
func (c *realtimeFaultConn) Write(p []byte) (int, error) {
	switch c.mode.Load() {
	case 2:
		panic(realtimeSecretPanic{c.formatted})
	case 4:
		return 0, errors.New("ROUND11_WRITE_SECRET")
	}
	return c.Conn.Write(p)
}
func (c *realtimeFaultConn) Close() error { c.closes.Add(1); return c.Conn.Close() }

type realtimeFaultListener struct {
	net.Listener
	accepted  chan *realtimeFaultConn
	formatted *atomic.Bool
}

func (l *realtimeFaultListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	w := &realtimeFaultConn{Conn: c, formatted: l.formatted}
	l.accepted <- w
	return w, nil
}

func TestRealtimeReadersPropagateFailureAndJoin(t *testing.T) {
	for _, scenario := range []string{"client read panic", "target read panic", "target write panic", "client write panic", "target read error", "client write error", "missing response panic", "client token panic", "target token panic", "client close", "target close", "context cancel"} {
		t.Run(scenario, func(t *testing.T) {
			var formatted atomic.Bool
			var logs, fallback bytes.Buffer
			previousMode := gin.Mode()
			gin.SetMode(gin.ReleaseMode)
			t.Cleanup(func() { gin.SetMode(previousMode) })
			common.LogWriterMu.Lock()
			old := gin.DefaultErrorWriter
			gin.DefaultErrorWriter = &logs
			common.LogWriterMu.Unlock()
			t.Cleanup(func() { common.LogWriterMu.Lock(); gin.DefaultErrorWriter = old; common.LogWriterMu.Unlock() })
			peerReady := make(chan *websocket.Conn, 1)
			upgrader := websocket.Upgrader{}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ws, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				peerReady <- ws
			}))
			t.Cleanup(upstream.Close)
			type result struct {
				err   *types.NewAPIError
				usage *dto.RealtimeUsage
			}
			finished := make(chan result, 1)
			start := make(chan struct{})
			cancelReady := make(chan context.CancelFunc, 1)
			targetReady := make(chan *realtimeFaultConn, 1)
			gateway := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				client, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer client.Close()
				dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
					conn, err := (&net.Dialer{}).DialContext(ctx, network, address)
					if err != nil {
						return nil, err
					}
					fault := &realtimeFaultConn{Conn: conn, formatted: &formatted}
					targetReady <- fault
					return fault, nil
				}}
				target, _, err := dialer.Dial(strings.Replace(upstream.URL, "http", "ws", 1), nil)
				if err != nil {
					return
				}
				defer target.Close()
				ctx, cancel := context.WithCancel(r.Context())
				defer cancel()
				cancelReady <- cancel
				c, _ := gin.CreateTestContext(w)
				c.Request = r.WithContext(ctx)
				info := &relaycommon.RelayInfo{ClientWs: client, TargetWs: target, UsePrice: true, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "fixture"}}
				<-start
				var apiErr *types.NewAPIError
				var usage *dto.RealtimeUsage
				if strings.Contains(scenario, "token panic") {
					apiErr, usage = realtimeHandler(c, info, func(info *relaycommon.RelayInfo, event dto.RealtimeEvent, model string) (int, int, error) {
						if event.Type != dto.RealtimeEventTypeResponseDone {
							panic(realtimeSecretPanic{&formatted})
						}
						return service.CountTokenRealtime(info, event, model)
					})
				} else {
					apiErr, usage = OpenaiRealtimeHandler(c, info)
				}
				finished <- result{apiErr, usage}
			}))
			listener := &realtimeFaultListener{Listener: gateway.Listener, accepted: make(chan *realtimeFaultConn, 1), formatted: &formatted}
			gateway.Listener = listener
			gateway.Config.ErrorLog = log.New(&fallback, "", 0)
			gateway.Start()
			t.Cleanup(gateway.Close)
			client, _, err := websocket.DefaultDialer.Dial(strings.Replace(gateway.URL, "http", "ws", 1), nil)
			require.NoError(t, err)
			t.Cleanup(func() { _ = client.Close() })
			clientWire, targetWire, peer, cancel := <-listener.accepted, <-targetReady, <-peerReady, <-cancelReady
			t.Cleanup(func() { _ = peer.Close() })
			close(start)
			completed := `{"type":"response.done","response":{"usage":{"total_tokens":12,"input_tokens":10,"output_tokens":2,"input_token_details":{"text_tokens":10},"output_token_details":{"text_tokens":2}}}}`
			require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(completed)))
			require.NoError(t, client.SetReadDeadline(time.Now().Add(3*time.Second)))
			_, message, err := client.ReadMessage()
			require.NoError(t, err)
			assert.JSONEq(t, completed, string(message))
			switch scenario {
			case "client read panic":
				clientWire.mode.Store(1)
				require.NoError(t, client.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "target read panic":
				targetWire.mode.Store(1)
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "target write panic":
				targetWire.mode.Store(2)
				require.NoError(t, client.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "client write panic":
				clientWire.mode.Store(2)
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "target read error":
				targetWire.mode.Store(3)
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "client write error":
				clientWire.mode.Store(4)
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"fixture"}`)))
			case "missing response panic":
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"response.done"}`)))
			case "client token panic":
				require.NoError(t, client.WriteMessage(1, []byte(`{"type":"session.update","session":{"instructions":"fixture"}}`)))
			case "target token panic":
				require.NoError(t, peer.WriteMessage(1, []byte(`{"type":"response.audio_transcript.delta","delta":"fixture"}`)))
			case "client close":
				require.NoError(t, client.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1000, "")))
			case "target close":
				require.NoError(t, peer.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1000, "")))
			case "context cancel":
				cancel()
			}
			var got result
			select {
			case got = <-finished:
			case <-time.After(3 * time.Second):
				assert.Fail(t, "request owner did not receive reader termination")
				_ = clientWire.Close()
				_ = targetWire.Close()
				got = <-finished
			}
			assert.Zero(t, clientWire.active.Load(), "client reader must join before owner returns")
			assert.Zero(t, targetWire.active.Load(), "target reader must join before owner returns")
			if strings.Contains(scenario, "panic") {
				require.NotNil(t, got.err, "reader panic must not be reported as success")
				assert.True(t, types.IsSkipRetryError(got.err))
			}
			require.NotNil(t, got.usage)
			assert.Equal(t, 12, got.usage.TotalTokens)
			assert.Equal(t, 10, got.usage.InputTokens)
			assert.Equal(t, 2, got.usage.OutputTokens)
			assert.False(t, formatted.Load(), "panic Error/String must not execute")
			for _, secret := range []string{"ROUND11_WS_SECRET", "ROUND11_READ_SECRET", "ROUND11_WRITE_SECRET"} {
				assert.NotContains(t, logs.String(), secret)
				assert.NotContains(t, fallback.String(), secret)
			}
			_, tail, readErr := client.ReadMessage()
			assert.Error(t, readErr)
			assert.NotContains(t, string(tail), "data:")
			assert.NotContains(t, string(tail), "ROUND11")
		})
	}
}

package openai

import (
	"errors"
	"fmt"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relay/requestplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func OpenaiRealtimeHandler(c *gin.Context, info *relaycommon.RelayInfo) (*types.NewAPIError, *dto.RealtimeUsage) {
	return realtimeHandler(c, info, service.CountTokenRealtime)
}

func recoverRealtimeReader(c *gin.Context, status *relaycommon.StreamStatus, origin string) {
	if value := recover(); value != nil {
		status.MarkPanic()
		logger.LogPanic(c, value, origin)
	}
}

func realtimeHandler(c *gin.Context, info *relaycommon.RelayInfo, countTokens func(*relaycommon.RelayInfo, dto.RealtimeEvent, string) (int, int, error)) (*types.NewAPIError, *dto.RealtimeUsage) {
	if info == nil || info.ClientWs == nil || info.TargetWs == nil {
		return types.NewError(fmt.Errorf("invalid websocket connection"), types.ErrorCodeBadResponse), nil
	}

	info.IsStream = true
	clientConn := info.ClientWs
	targetConn := info.TargetWs

	finished := make(chan struct{}, 2)
	var workers sync.WaitGroup
	var usageMutex sync.Mutex
	info.StreamStatus = relaycommon.NewStreamStatus()
	sendChan := make(chan []byte, 100)
	receiveChan := make(chan []byte, 100)
	errChan := make(chan error, 2)
	recordError := func(err error) {
		select {
		case errChan <- err:
		default:
		}
	}

	usage := &dto.RealtimeUsage{}
	localUsage := &dto.RealtimeUsage{}
	sumUsage := &dto.RealtimeUsage{}

	// The request plugins answer the client and cancel upstream responses
	// from either reader, so each socket takes one writer at a time.
	var clientWriteMu, targetWriteMu sync.Mutex
	writeClient := func(message []byte) error {
		clientWriteMu.Lock()
		defer clientWriteMu.Unlock()
		return helper.WssString(c, clientConn, string(message))
	}
	writeTarget := func(message []byte) error {
		targetWriteMu.Lock()
		defer targetWriteMu.Unlock()
		return helper.WssString(c, targetConn, string(message))
	}
	plugins := requestplugin.NewRealtime(c, info, func(message []byte) {
		if err := writeClient(message); err != nil {
			recordError(fmt.Errorf("error writing to client: %v", err))
		}
	}, func(message []byte) {
		if err := writeTarget(message); err != nil {
			recordError(fmt.Errorf("error writing to target: %v", err))
		}
	})
	if plugins != nil {
		// The consume log reads what the plugins did once the session ends.
		defer plugins.Close(info)
	}

	workers.Add(1)
	gopool.Go(func() {
		defer workers.Done()
		defer func() { finished <- struct{}{} }()
		defer recoverRealtimeReader(c, info.StreamStatus, "realtime client reader")
		for {
			select {
			case <-c.Request.Context().Done():
				return
			default:
				_, message, err := clientConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						recordError(errors.New("error reading from client"))
					}
					return
				}

				if !func() bool {
					usageMutex.Lock()
					defer usageMutex.Unlock()
					realtimeEvent := &dto.RealtimeEvent{}
					err = common.Unmarshal(message, realtimeEvent)
					if err != nil {
						recordError(errors.New("error unmarshalling message"))
						return false
					}

					if plugins != nil {
						patched, dropped := plugins.ClientEvent(realtimeEvent.Type, message)
						if dropped {
							return true
						}
						if patched != nil {
							message, realtimeEvent = patched, &dto.RealtimeEvent{}
							if err = common.Unmarshal(message, realtimeEvent); err != nil {
								recordError(errors.New("error unmarshalling message"))
								return false
							}
						}
					}

					if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdate {
						if realtimeEvent.Session != nil {
							if realtimeEvent.Session.Tools != nil {
								info.RealtimeTools = realtimeEvent.Session.Tools
							}
						}
					}

					textToken, audioToken, err := countTokens(info, *realtimeEvent, info.UpstreamModelName)
					if err != nil {
						recordError(errors.New("error counting text token"))
						return false
					}
					logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
					localUsage.TotalTokens += textToken + audioToken
					localUsage.InputTokens += textToken + audioToken
					localUsage.InputTokenDetails.TextTokens += textToken
					localUsage.InputTokenDetails.AudioTokens += audioToken

					err = writeTarget(message)
					if err != nil {
						recordError(errors.New("error writing to target"))
						return false
					}

					select {
					case sendChan <- message:
					default:
					}
					return true
				}() {
					return
				}
			}
		}
	})

	workers.Add(1)
	gopool.Go(func() {
		defer workers.Done()
		defer func() { finished <- struct{}{} }()
		defer recoverRealtimeReader(c, info.StreamStatus, "realtime target reader")
		for {
			select {
			case <-c.Request.Context().Done():
				return
			default:
				_, message, err := targetConn.ReadMessage()
				if err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						recordError(errors.New("error reading from target"))
					}
					return
				}
				info.SetFirstResponseTime()
				if !func() bool {
					usageMutex.Lock()
					defer usageMutex.Unlock()
					realtimeEvent := &dto.RealtimeEvent{}
					err = common.Unmarshal(message, realtimeEvent)
					if err != nil {
						recordError(errors.New("error unmarshalling message"))
						return false
					}

					quota := 0
					if realtimeEvent.Type == dto.RealtimeEventTypeResponseDone {
						realtimeUsage := realtimeEvent.Response.Usage
						if realtimeUsage != nil {
							usage.TotalTokens += realtimeUsage.TotalTokens
							usage.InputTokens += realtimeUsage.InputTokens
							usage.OutputTokens += realtimeUsage.OutputTokens
							usage.InputTokenDetails.AudioTokens += realtimeUsage.InputTokenDetails.AudioTokens
							usage.InputTokenDetails.CachedTokens += realtimeUsage.InputTokenDetails.CachedTokens
							usage.InputTokenDetails.TextTokens += realtimeUsage.InputTokenDetails.TextTokens
							usage.OutputTokenDetails.AudioTokens += realtimeUsage.OutputTokenDetails.AudioTokens
							usage.OutputTokenDetails.TextTokens += realtimeUsage.OutputTokenDetails.TextTokens
							// Authoritative usage replaces this response's local estimate,
							// including when reservation expansion fails or panics.
							localUsage = &dto.RealtimeUsage{}
							quota, err = preConsumeUsage(c, info, usage, sumUsage)
							if err != nil {
								recordError(errors.New("error consume usage"))
								return false
							}
						} else {
							textToken, audioToken, err := countTokens(info, *realtimeEvent, info.UpstreamModelName)
							if err != nil {
								recordError(errors.New("error counting text token"))
								return false
							}
							logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
							localUsage.TotalTokens += textToken + audioToken
							info.IsFirstRequest = false
							localUsage.InputTokens += textToken + audioToken
							localUsage.InputTokenDetails.TextTokens += textToken
							localUsage.InputTokenDetails.AudioTokens += audioToken
							quota, err = preConsumeUsage(c, info, localUsage, sumUsage)
							if err != nil {
								recordError(errors.New("error consume usage"))
								return false
							}
						}
						logger.LogInfo(c, common.LogText("realtime streaming sumUsage: %v", sumUsage))
						logger.LogInfo(c, common.LogText("realtime streaming localUsage: %v", localUsage))

					} else if realtimeEvent.Type == dto.RealtimeEventTypeSessionUpdated || realtimeEvent.Type == dto.RealtimeEventTypeSessionCreated {
						realtimeSession := realtimeEvent.Session
						if realtimeSession != nil {
							// update audio format
							info.InputAudioFormat = common.GetStringIfEmpty(realtimeSession.InputAudioFormat, info.InputAudioFormat)
							info.OutputAudioFormat = common.GetStringIfEmpty(realtimeSession.OutputAudioFormat, info.OutputAudioFormat)
						}
					} else {
						textToken, audioToken, err := countTokens(info, *realtimeEvent, info.UpstreamModelName)
						if err != nil {
							recordError(errors.New("error counting text token"))
							return false
						}
						logger.LogInfo(c, common.LogText("type: %s, textToken: %d, audioToken: %d", realtimeEvent.Type, textToken, audioToken))
						localUsage.TotalTokens += textToken + audioToken
						localUsage.OutputTokens += textToken + audioToken
						localUsage.OutputTokenDetails.TextTokens += textToken
						localUsage.OutputTokenDetails.AudioTokens += audioToken
					}

					if plugins != nil {
						var responseUsage *dto.RealtimeUsage
						if realtimeEvent.Response != nil {
							responseUsage = realtimeEvent.Response.Usage
						}
						plugins.ServerEvent(realtimeEvent.Type, message, responseUsage, quota)
					} else if err = writeClient(message); err != nil {
						recordError(errors.New("error writing to client"))
						return false
					}

					select {
					case receiveChan <- message:
					default:
					}
					return true
				}() {
					return
				}
			}
		}
	})

	var streamErr error
	select {
	case <-finished:
	case streamErr = <-errChan:
	case <-c.Request.Context().Done():
	}
	// The request owner interrupts both blocking readers/writers, then joins them
	// before touching usage or returning Gin context / billing state to its caller.
	_ = clientConn.Close()
	_ = targetConn.Close()
	workers.Wait()
	info.StreamStatus.FinalizePanic()
	if streamErr == nil {
		select {
		case streamErr = <-errChan:
		default:
		}
	}
	if streamErr != nil {
		logger.LogError(c, common.LogText("realtime error: %s", streamErr.Error()))
	}

	if usage.TotalTokens != 0 {
		_, _ = preConsumeUsage(c, info, usage, sumUsage)
	}

	if localUsage.TotalTokens != 0 {
		_, _ = preConsumeUsage(c, info, localUsage, sumUsage)
	}

	// check usage total tokens, if 0, use local usage

	return info.StreamStatus.PanicError(), sumUsage
}

func preConsumeUsage(ctx *gin.Context, info *relaycommon.RelayInfo, usage *dto.RealtimeUsage, totalUsage *dto.RealtimeUsage) (int, error) {
	if usage == nil || totalUsage == nil {
		return 0, fmt.Errorf("invalid usage pointer")
	}

	// Move the pending fact into cumulative usage exactly once. Reservation can
	// fail or panic; cleanup must retain the fact without adding it a second time.
	pending := *usage
	*usage = dto.RealtimeUsage{}
	totalUsage.TotalTokens += pending.TotalTokens
	totalUsage.InputTokens += pending.InputTokens
	totalUsage.OutputTokens += pending.OutputTokens
	totalUsage.InputTokenDetails.CachedTokens += pending.InputTokenDetails.CachedTokens
	totalUsage.InputTokenDetails.TextTokens += pending.InputTokenDetails.TextTokens
	totalUsage.InputTokenDetails.AudioTokens += pending.InputTokenDetails.AudioTokens
	totalUsage.OutputTokenDetails.TextTokens += pending.OutputTokenDetails.TextTokens
	totalUsage.OutputTokenDetails.AudioTokens += pending.OutputTokenDetails.AudioTokens
	if info.Billing != nil {
		return service.PreWssConsumeQuota(ctx, info, totalUsage)
	}
	return service.PreWssConsumeQuota(ctx, info, &pending)
}

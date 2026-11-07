package middleware

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"os"
	"syscall"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
)

type panicRecoveryWriter struct {
	gin.ResponseWriter
	hijacked bool
}

func (w *panicRecoveryWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *panicRecoveryWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	connection, buffered, err := w.ResponseWriter.Hijack()
	if err == nil {
		w.hijacked = true
	}
	return connection, buffered, err
}

func RelayPanicRecover() gin.HandlerFunc {
	translationsReady := i18n.Init() == nil
	return func(c *gin.Context) {
		writer := &panicRecoveryWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		defer func() {
			if err := recover(); err != nil {
				// A broken response writer must not expose a second panic to
				// net/http's logging fallback, even while writing the generic 500.
				defer func() {
					if recover() != nil {
						panic(http.ErrAbortHandler)
					}
				}()
				if err == http.ErrAbortHandler {
					panic(http.ErrAbortHandler)
				}
				// A panic can contain arbitrary credentials, including ones that
				// are not in a URL. Do not format it, dump the request, or include
				// stack arguments/source lines. Symbols and locations still let
				// operators diagnose the failure using the existing request ID.
				logger.LogPanic(c, err, "request")

				// Preserve the global Gin recovery's broken-connection behavior,
				// but never put the original error into a later error-log dump.
				if isBrokenConnectionPanic(err) {
					_ = c.Error(errors.New("connection closed during panic recovery"))
					c.Abort()
					return
				}
				if c.Writer.Written() {
					// Headers/body may already be on the wire, including SSE or a
					// hijacked connection. End this handler without adding JSON or
					// fabricating a successful terminal event for another protocol.
					c.Abort()
					if writer.hijacked {
						return
					}
					panic(http.ErrAbortHandler)
				}
				c.Header("Content-Type", "application/json; charset=utf-8")
				message := "Internal server error. Please submit a issue here: https://github.com/Calcium-Ion/new-api"
				if translationsReady {
					// Recovery may follow a database/cache panic. Use only the
					// already-loaded settings and header; never lazy-load the user.
					lang := i18n.ParseAcceptLanguage(c.GetHeader("Accept-Language"))
					if settings, ok := common.GetContextKeyType[dto.UserSetting](c, constant.ContextKeyUserSetting); ok && settings.Language != "" {
						lang = settings.Language
					}
					message = i18n.Translate(lang, i18n.MsgInternalServerError)
				}
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"error": gin.H{
						"message": message,
						"type":    "new_api_panic",
					},
				})
			}
		}()
		c.Next()
	}
}

func isBrokenConnectionPanic(value any) bool {
	// Only inspect the concrete error shape produced by net/http. Calling
	// errors.As/Is or Unwrap here can execute arbitrary methods while recovering
	// another panic. Unrecognized wrappers must receive the generic 500 instead.
	networkError, ok := value.(*net.OpError)
	if !ok || networkError == nil {
		return false
	}
	syscallError, ok := networkError.Err.(*os.SyscallError)
	if !ok || syscallError == nil {
		return false
	}
	errno, ok := syscallError.Err.(syscall.Errno)
	return ok && (errno == syscall.EPIPE || errno == syscall.ECONNRESET)
}

// PanicRecover applies the safe relay boundary to server-wide requests.
func PanicRecover() gin.HandlerFunc { return RelayPanicRecover() }

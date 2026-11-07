package logger

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// LogPanic never formats the recovered value or stack arguments. Diagnostics
// are best-effort: a failing log sink must not break recovery or worker cleanup.
func LogPanic(ctx context.Context, value any, origin string) {
	defer func() { _ = recover() }()
	var safeContext context.Context = context.Background()
	if ctx != nil {
		if id, ok := ctx.Value(common.RequestIdKey).(string); ok {
			safeContext = context.WithValue(safeContext, common.RequestIdKey, id)
		}
	}
	route := ""
	if c, ok := ctx.(*gin.Context); ok {
		route = c.FullPath()
	}
	var pcs [64]uintptr
	n := runtime.Callers(3, pcs[:])
	frames := runtime.CallersFrames(pcs[:n])
	var stack strings.Builder
	for {
		frame, more := frames.Next()
		fmt.Fprintf(&stack, "%s %s:%d\n", frame.Function, filepath.Base(frame.File), frame.Line)
		if !more {
			break
		}
	}
	LogError(safeContext, common.LogText("panic detected: %v", fmt.Sprintf("type=%T origin=%s route=%q\n%s", value, origin, route, stack.String())))
}

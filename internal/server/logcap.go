package server

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// LogLinesPerMinute is each cap's share: refused clients, refused writes'
// audit lines (admin and prefs), and the TLS listener's error log.
const LogLinesPerMinute = 60

// LogCap lets at most perMinute log lines through per minute and counts
// the rest, so a flood of refused requests can't fill the disk with log
// lines (T-115; the approach of Enforcarr's logcap.go). When lines were
// dropped, the next line that gets through comes after one summary line:
// "log lines dropped", with the cap's kind and how many.
type LogCap struct {
	kind      string
	perMinute int
	now       func() time.Time

	mu      sync.Mutex
	start   time.Time
	used    int
	dropped int
}

// NewLogCap makes a cap of perMinute lines a minute; kind names it in the
// summary line. now nil: time.Now.
func NewLogCap(kind string, perMinute int, now func() time.Time) *LogCap {
	if now == nil {
		now = time.Now
	}
	return &LogCap{kind: kind, perMinute: perMinute, now: now}
}

// allow reports whether one more line may be written. When a new minute
// starts, it also returns how many lines the previous minutes dropped,
// once.
func (l *LogCap) allow() (dropped int, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.start) >= time.Minute {
		l.start, l.used = now, 0
		dropped, l.dropped = l.dropped, 0
	}
	if l.used >= l.perMinute {
		l.dropped++
		return 0, false
	}
	l.used++
	return dropped, true
}

// Log writes one line to log through the cap.
func (l *LogCap) Log(log *slog.Logger, level slog.Level, msg string, attrs ...slog.Attr) {
	dropped, ok := l.allow()
	if !ok {
		return
	}
	if dropped > 0 {
		log.LogAttrs(context.Background(), slog.LevelWarn, "log lines dropped", slog.String("kind", l.kind), slog.Int("dropped", dropped))
	}
	log.LogAttrs(context.Background(), level, msg, attrs...)
}

// Handler wraps h so every line it writes passes the cap, for loggers
// themarr doesn't call itself (http.Server's ErrorLog: TLS handshake
// errors).
func (l *LogCap) Handler(h slog.Handler) slog.Handler { return capHandler{h: h, c: l} }

type capHandler struct {
	h slog.Handler
	c *LogCap
}

func (c capHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return c.h.Enabled(ctx, level)
}

func (c capHandler) Handle(ctx context.Context, r slog.Record) error {
	dropped, ok := c.c.allow()
	if !ok {
		return nil
	}
	if dropped > 0 {
		s := slog.NewRecord(r.Time, slog.LevelWarn, "log lines dropped", 0)
		s.AddAttrs(slog.String("kind", c.c.kind), slog.Int("dropped", dropped))
		if err := c.h.Handle(ctx, s); err != nil {
			return err
		}
	}
	return c.h.Handle(ctx, r)
}

func (c capHandler) WithAttrs(as []slog.Attr) slog.Handler {
	return capHandler{h: c.h.WithAttrs(as), c: c.c}
}

func (c capHandler) WithGroup(name string) slog.Handler {
	return capHandler{h: c.h.WithGroup(name), c: c.c}
}

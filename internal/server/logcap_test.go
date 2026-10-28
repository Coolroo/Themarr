package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestLogCap: at most n lines a minute; the next minute's first line comes
// after one summary line with the count dropped.
func TestLogCap(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	c := NewLogCap("test", 3, func() time.Time { return now })
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	for i := 0; i < 10; i++ {
		c.Log(log, slog.LevelInfo, "line")
	}
	if n := strings.Count(buf.String(), `"msg":"line"`); n != 3 {
		t.Fatalf("%d lines in the first minute", n)
	}
	now = now.Add(time.Minute)
	c.Log(log, slog.LevelInfo, "line")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 5 || !strings.Contains(lines[3], `"msg":"log lines dropped"`) ||
		!strings.Contains(lines[3], `"kind":"test"`) || !strings.Contains(lines[3], `"dropped":7`) {
		t.Fatalf("%s", buf.String())
	}

	// The same through a handler, as http.Server's ErrorLog uses it.
	buf.Reset()
	now = now.Add(time.Minute)
	h := NewLogCap("errors", 2, func() time.Time { return now })
	l := slog.NewLogLogger(h.Handler(slog.NewJSONHandler(&buf, nil)), slog.LevelWarn)
	for i := 0; i < 5; i++ {
		l.Print("http: TLS handshake error from 192.0.2.1:1234: EOF")
	}
	now = now.Add(time.Minute)
	l.Print("one more")
	if n := strings.Count(buf.String(), "handshake"); n != 2 || !strings.Contains(buf.String(), `"dropped":3`) {
		t.Fatalf("%s", buf.String())
	}
}

// TestRefusalLinesAreCapped (T-115 review): a client with another CN, or
// an admin repeating a refused write, can't flood the log; a minute later
// a summary line says how many lines were dropped. Accepted writes are
// never dropped.
func TestRefusalLinesAreCapped(t *testing.T) {
	hs := newHarness(t)
	for i := 0; i < 3*LogLinesPerMinute; i++ {
		r := req(http.MethodGet, "/v1/catalog", "")
		r.TLS = tlsState("npm-homepi")
		hs.serve(r)
		hs.do(http.MethodPut, "/v1/favourites", `{"favourites":[]}`, without(1, "Origin")...)
	}
	if n := strings.Count(hs.log.String(), `"msg":"client refused"`); n != LogLinesPerMinute {
		t.Fatalf("%d client refused lines", n)
	}
	if n := strings.Count(hs.log.String(), `"result":"refused"`); n != LogLinesPerMinute {
		t.Fatalf("%d refused write lines", n)
	}
	hs.mustWrite(http.MethodPut, "/v1/favourites", `{"favourites":[]}`)
	if !strings.Contains(hs.log.String(), `"result":"ok"`) {
		t.Fatal("an accepted write was not logged")
	}
	hs.now = hs.now.Add(time.Minute)
	r := req(http.MethodGet, "/v1/catalog", "")
	r.TLS = tlsState("npm-homepi")
	hs.serve(r)
	if !strings.Contains(hs.log.String(), `"kind":"client refused","dropped":120`) {
		t.Fatalf("no summary line: %s", hs.log.String()[len(hs.log.String())-400:])
	}
}

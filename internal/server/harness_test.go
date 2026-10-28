package server

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/theme/themetest"
)

const (
	origin = "https://themarr.test"
	gw     = "tls-gateway"
)

type harness struct {
	t     *testing.T
	store *store.Store
	srv   *Server
	h     http.Handler
	log   *syncBuffer
	now   time.Time
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func newHarness(t *testing.T, edit ...func(*Options)) *harness {
	t.Helper()
	st, err := store.Open(t.TempDir(), theme.Default())
	if err != nil {
		t.Fatal(err)
	}
	hs := &harness{t: t, store: st, log: &syncBuffer{}, now: time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)}
	o := Options{ClientCN: gw, PublicOrigin: origin, AdminGroup: "admins",
		Log: slog.New(slog.NewJSONHandler(hs.log, nil)), Now: func() time.Time { return hs.now },
		UI: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Security-Policy", "ui-policy")
			io.WriteString(w, "<html>ui</html>")
		})}
	for _, e := range edit {
		e(&o)
	}
	hs.srv = New(st, o)
	hs.h = hs.srv.Handler()
	return hs
}

// tlsState is a connection whose verified client chain has leaf cn.
func tlsState(cn string) *tls.ConnectionState {
	return &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{{Subject: pkix.Name{CommonName: cn}}}}}
}

// req builds a request through tls-gateway; headers are name, value pairs.
func req(method, path, body string, headers ...string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	r.TLS = tlsState(gw)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Add(headers[i], headers[i+1])
	}
	return r
}

func (hs *harness) serve(r *http.Request) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	hs.h.ServeHTTP(rr, r)
	return rr
}

func (hs *harness) do(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	return hs.serve(req(method, path, body, headers...))
}

var adminHeaders = []string{"Remote-User", "alice", "Remote-Groups", "users,admins"}

// admin makes an admin read.
func (hs *harness) admin(method, path string) *httptest.ResponseRecorder {
	return hs.do(method, path, "", adminHeaders...)
}

// writeHeaders are every header an admin write needs, at store version v.
func writeHeaders(v uint64) []string {
	return append(append([]string{}, adminHeaders...), "Origin", origin, "Sec-Fetch-Site", "same-origin",
		"Content-Type", "application/json", "If-Match", `"`+strconv.FormatUint(v, 10)+`"`)
}

// write makes an admin write at the store's current version.
func (hs *harness) write(method, path, body string) *httptest.ResponseRecorder {
	return hs.do(method, path, body, writeHeaders(hs.store.Snapshot().Version)...)
}

// mustWrite makes a write that must succeed.
func (hs *harness) mustWrite(method, path, body string) *httptest.ResponseRecorder {
	hs.t.Helper()
	rr := hs.write(method, path, body)
	if rr.Code >= 300 {
		hs.t.Fatalf("%s %s: %d %s", method, path, rr.Code, rr.Body.String())
	}
	return rr
}

func (hs *harness) putTheme(id string, modes ...string) {
	hs.t.Helper()
	hs.mustWrite(http.MethodPut, "/v1/themes/"+id, string(themetest.JSON(themetest.Valid(id, modes...))))
}

func (hs *harness) putApp(id string) {
	hs.t.Helper()
	hs.mustWrite(http.MethodPut, "/v1/apps/"+id, `{"id":"`+id+`","name":"App `+id+`","origins":["https://`+id+`.test"]}`)
}

func (hs *harness) assign(global string, perApp map[string]string) {
	hs.t.Helper()
	g := any(nil)
	if global != "" {
		g = global
	}
	b, _ := json.Marshal(map[string]any{"global": g, "perApp": perApp})
	hs.mustWrite(http.MethodPut, "/v1/assignments", string(b))
}

// problem decodes a problem answer and checks its shape.
func problem(t *testing.T, rr *httptest.ResponseRecorder, status int, code string) map[string]any {
	t.Helper()
	if rr.Code != status {
		t.Fatalf("status %d, want %d: %s", rr.Code, status, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("content type %q", ct)
	}
	var p map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p["code"] != code || p["status"] != float64(status) || p["request_id"] == "" || p["request_id"] != rr.Header().Get("X-Request-Id") {
		t.Fatalf("problem %v, want code %s", p, code)
	}
	return p
}

func decode(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("%v: %s", err, rr.Body.String())
	}
	return m
}

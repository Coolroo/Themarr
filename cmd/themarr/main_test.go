package main

import (
	"bytes"
	"context"
	"flag"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Coolroo/themarr/internal/config"
	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/testutil"
)

type setup struct {
	ca      *testutil.CA
	dataDir string
	args    []string
}

func newSetup(t *testing.T) setup {
	t.Helper()
	ca := testutil.NewCA(t, "home CA")
	sc := ca.ServerCert(t)
	dir := t.TempDir()
	return setup{ca: ca, dataDir: dir, args: []string{
		"-cert-file", sc.CertFile, "-key-file", sc.KeyFile, "-client-ca-file", ca.File, "-data-dir", dir,
	}}
}

func runCmd(args []string, env map[string]string) (int, string, string) {
	var out, errOut bytes.Buffer
	code := run(args, func(k string) string { return env[k] }, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestVersion(t *testing.T) {
	code, out, _ := runCmd([]string{"-version"}, nil)
	if code != 0 || strings.TrimSpace(out) != version {
		t.Fatalf("%d %q", code, out)
	}
}

func TestCheck(t *testing.T) {
	s := newSetup(t)
	code, out, errOut := runCmd(append(s.args, "-check"), nil)
	if code != 0 || !strings.Contains(out, "configuration ok") {
		t.Fatalf("%d %q %q", code, out, errOut)
	}
	// The data dir from the environment, the rest from flags.
	env := map[string]string{"THEMARR_DATA_DIR": s.dataDir}
	if code, _, errOut := runCmd(append(s.args[:6:6], "-check"), env); code != 0 {
		t.Fatalf("env data dir: %d %q", code, errOut)
	}
}

func TestCheckRefuses(t *testing.T) {
	s := newSetup(t)
	other := testutil.NewCA(t, "other CA").ServerCert(t)
	for name, extra := range map[string][]string{
		"public health listener": {"-health-listen", "0.0.0.0:8081"},
		"wrong key":              {"-key-file", other.KeyFile},
		"missing client CA":      {"-client-ca-file", filepath.Join(t.TempDir(), "none.crt")},
		"missing data dir":       {"-data-dir", filepath.Join(t.TempDir(), "none")},
		"http origin":            {"-public-origin", "http://themarr.coolroo.dev"},
		"stray argument":         {"serve"},
	} {
		if code, _, _ := runCmd(append(append([]string{}, s.args...), append(extra, "-check")...), nil); code == 0 {
			t.Errorf("%s: accepted", name)
		}
	}
}

// TestCorruptStoreStopsStartAndIsKept: themarr refuses to start on a store
// file it can't read, and leaves the file alone.
func TestCorruptStoreStopsStartAndIsKept(t *testing.T) {
	s := newSetup(t)
	path := filepath.Join(s.dataDir, store.FileName)
	if err := os.WriteFile(path, []byte(`{"format": 1, "version": `), 0o600); err != nil {
		t.Fatal(err)
	}
	code, _, errOut := runCmd(append(s.args, "-check"), nil)
	if code == 0 || !strings.Contains(errOut, "left as it is") {
		t.Fatalf("%d %q", code, errOut)
	}
	b, _ := os.ReadFile(path)
	if string(b) != `{"format": 1, "version": ` {
		t.Fatal("the store file was changed")
	}
}

// TestCorruptPrefsStopsStartAndIsKept: the same for the prefs file.
func TestCorruptPrefsStopsStartAndIsKept(t *testing.T) {
	s := newSetup(t)
	path := filepath.Join(s.dataDir, prefs.FileName)
	bad := `{"format": 1, "version": 1, "choices": {}, "policies": {"users": {"bob": {"theme": "x", "kind": "always"}}, "groups": {}}}`
	if err := os.WriteFile(path, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	code, _, errOut := runCmd(append(s.args, "-check"), nil)
	if code == 0 || !strings.Contains(errOut, "left as it is") || !strings.Contains(errOut, prefs.FileName) {
		t.Fatalf("%d %q", code, errOut)
	}
	b, _ := os.ReadFile(path)
	if string(b) != bad {
		t.Fatal("the prefs file was changed")
	}
}

func TestHealthcheck(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: healthHandler()}
	go srv.Serve(ln)
	defer srv.Close()
	if code, _, errOut := runCmd([]string{"-healthcheck", "-health-listen", ln.Addr().String()}, nil); code != 0 {
		t.Fatalf("healthy: %d %q", code, errOut)
	}
	// Nothing listening.
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := dead.Addr().String()
	dead.Close()
	if code, _, _ := runCmd([]string{"-healthcheck", "-health-listen", addr}, nil); code == 0 {
		t.Fatal("a dead listener passed")
	}
	// Never off loopback.
	if code, _, _ := runCmd([]string{"-healthcheck", "-health-listen", "192.0.2.1:8081"}, nil); code == 0 {
		t.Fatal("a non-loopback health check ran")
	}
}

func TestHealthListenerServesOnlyHealthz(t *testing.T) {
	h := healthHandler()
	for path, want := range map[string]int{"/healthz": 200, "/": 404, "/v1/apps/a/theme": 404} {
		req, _ := http.NewRequest(http.MethodGet, path, nil)
		rr := &statusWriter{header: http.Header{}}
		h.ServeHTTP(rr, req)
		if rr.status != want {
			t.Errorf("%s: %d, want %d", path, rr.status, want)
		}
	}
}

type statusWriter struct {
	header http.Header
	status int
}

func (w *statusWriter) Header() http.Header { return w.header }
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return len(b), nil
}
func (w *statusWriter) WriteHeader(s int) { w.status = s }

// TestServe runs the real listeners: plain health on loopback, and the TLS
// API that lets in only the configured client CN from the home CA.
func TestServe(t *testing.T) {
	s := newSetup(t)
	checkArgs := append(append([]string{}, s.args...), "-check")
	if code, _, errOut := runCmd(checkArgs, nil); code != 0 {
		t.Fatal(errOut)
	}
	cfgApp := mustPrepare(t, s.args)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	hln, _ := net.Listen("tcp", "127.0.0.1:0")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, cfgApp, ln, hln) }()

	resp, err := http.Get("http://" + hln.Addr().String() + "/healthz")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("health: %v %v", resp, err)
	}
	resp.Body.Close()

	url := "https://" + ln.Addr().String() + "/v1/apps/board/theme"
	gateway := s.ca.ClientCert(t, "tls-gateway")
	resp, err = testutil.Client(s.ca, &gateway).Get(url)
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("tls-gateway: %v %v", resp, err)
	}
	resp.Body.Close()

	// The per-user routes are wired: /v1/me needs a signed-in user, and
	// with one there is nothing set yet.
	meURL := "https://" + ln.Addr().String() + "/v1/me/apps/board/theme"
	resp, err = testutil.Client(s.ca, &gateway).Get(meURL)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me without a user: %v %v", resp, err)
	}
	resp.Body.Close()
	meReq, _ := http.NewRequest(http.MethodGet, meURL, nil)
	meReq.Header.Set("Remote-User", "alice")
	resp, err = testutil.Client(s.ca, &gateway).Do(meReq)
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("me: %v %v", resp, err)
	}
	resp.Body.Close()

	npm := s.ca.ClientCert(t, "npm-homepi")
	resp, err = testutil.Client(s.ca, &npm).Get(url)
	if err != nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("npm-homepi: %v %v", resp, err)
	}
	resp.Body.Close()

	if _, err := testutil.Client(s.ca, nil).Get(url); err == nil {
		t.Fatal("no client certificate was let in")
	}
	foreign := testutil.NewCA(t, "foreign CA").ClientCert(t, "tls-gateway")
	if _, err := testutil.Client(s.ca, &foreign).Get(url); err == nil {
		t.Fatal("a tls-gateway certificate from another CA was let in")
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("serve did not stop")
	}
}

func mustPrepare(t *testing.T, args []string) *app {
	t.Helper()
	fs := flag.NewFlagSet("themarr", flag.ContinueOnError)
	cfg := config.Bind(fs, func(string) string { return "" })
	if err := fs.Parse(args); err != nil {
		t.Fatal(err)
	}
	a, err := prepare(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// Command themarr keeps the homelab's themes and serves each app its theme.
//
//	themarr [flags]               serve: TLS on -listen, plain /healthz on loopback
//	themarr -check [flags]        validate the settings, certificates and store, and exit
//	themarr -healthcheck [flags]  the container's health check: GET /healthz on loopback
//	themarr -version              print the version and exit
//
// Every flag falls back to an environment variable (themarr -h lists them).
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Coolroo/themarr/internal/config"
	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/prefs/prefsapi"
	"github.com/Coolroo/themarr/internal/resolve"
	"github.com/Coolroo/themarr/internal/server"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/tlsutil"
	"github.com/Coolroo/themarr/internal/webui"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("themarr", flag.ContinueOnError)
	fs.SetOutput(stderr)
	cfg := config.Bind(fs, getenv)
	health := fs.Bool("healthcheck", false, "GET /healthz on the loopback health listener and exit")
	check := fs.Bool("check", false, "validate the settings, certificates and store, and exit")
	showVersion := fs.Bool("version", false, "print the version and exit")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintln(stderr, "unexpected arguments:", fs.Args())
		return 2
	}
	if *showVersion {
		fmt.Fprintln(stdout, version)
		return 0
	}
	if *health {
		if err := healthcheck(cfg); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	app, err := prepare(cfg)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if *check {
		fmt.Fprintln(stdout, "configuration ok")
		return 0
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	hln, err := net.Listen("tcp", cfg.HealthListen)
	if err != nil {
		ln.Close()
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := serve(ctx, app, ln, hln); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

// app is everything serve needs, checked before anything listens.
type app struct {
	cfg   *config.Config
	tls   *tls.Config
	store *store.Store
	prefs *prefs.Store
	log   *slog.Logger
}

// prepare validates the settings and loads the certificates, the store and
// the prefs. A store or prefs file that can't be read stops themarr here;
// it is never overwritten.
func prepare(cfg *config.Config) (*app, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if err := cfg.DataDirExists(); err != nil {
		return nil, err
	}
	tlsCfg, err := tlsutil.ServerConfig(cfg.CertFile, cfg.KeyFile, cfg.ClientCAFile)
	if err != nil {
		return nil, err
	}
	st, err := store.Open(cfg.DataDir, theme.Default())
	if err != nil {
		return nil, err
	}
	pr, err := prefs.Open(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	return &app{cfg: cfg, tls: tlsCfg, store: st, prefs: pr, log: slog.New(slog.NewJSONHandler(os.Stdout, nil))}, nil
}

// publicResolver is the public route's resolver: the app's assignment,
// then the global default (internal/resolve, no identity).
func publicResolver(d *store.Data, app string) server.Resolution {
	r := resolve.Public(d, app)
	return server.Resolution{Theme: r.Theme, From: string(r.Source)}
}

// serve runs the TLS API on ln and the plain health check on hln until ctx
// ends, then shuts both down.
func serve(ctx context.Context, a *app, ln, hln net.Listener) error {
	// The one identity module: Authelia's headers on the tls-gateway hop.
	who := identity.Authelia{}
	me := prefsapi.New(prefsapi.Config{
		Store:        a.store,
		Prefs:        a.prefs,
		Identity:     who,
		PublicOrigin: a.cfg.PublicOrigin,
		AdminGroup:   a.cfg.AdminGroup,
		Manifest:     theme.Default(),
		Log:          a.log,
	})
	srv := server.New(a.store, server.Options{
		ClientCN:     a.cfg.ClientCN,
		PublicOrigin: a.cfg.PublicOrigin,
		AdminGroup:   a.cfg.AdminGroup,
		Manifest:     theme.Default(),
		Resolver:     publicResolver,
		Identify:     who.Identify,
		Routes:       me.Routes(),
		ThemeInUse:   a.prefs.ThemeInUse,
		UI:           webui.Handler(),
		Drawer:       webui.Drawer(),
		Log:          a.log,
	})
	// The listeners' own errors (a failed TLS handshake is one line each,
	// and anybody who reaches the port can cause them) pass a cap.
	errCap := server.NewLogCap("http server error", server.LogLinesPerMinute, nil)
	errLog := slog.NewLogLogger(errCap.Handler(slog.NewJSONHandler(os.Stderr, nil)), slog.LevelWarn)
	api := &http.Server{
		Handler:           srv.Handler(),
		TLSConfig:         a.tls,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          errLog,
	}
	health := &http.Server{
		Handler:           healthHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    4 << 10,
		ErrorLog:          errLog,
	}
	errc := make(chan error, 2)
	go func() { errc <- api.ServeTLS(ln, "", "") }()
	go func() { errc <- health.Serve(hln) }()
	a.log.Info("listening", slog.String("address", ln.Addr().String()), slog.String("health", hln.Addr().String()),
		slog.String("version", version), slog.Uint64("store_version", a.store.Snapshot().Version))
	var err error
	select {
	case err = <-errc:
	case <-ctx.Done():
	}
	a.log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	api.Shutdown(shutdownCtx)
	health.Shutdown(shutdownCtx)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// healthHandler is the plain loopback listener: GET /healthz and nothing
// else. It answers ok while the process serves; it holds nothing secret.
func healthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, `{"status":"ok"}`+"\n")
	})
	return mux
}

// healthcheck asks this instance's loopback health listener. It is the one
// plain-HTTP call themarr makes: loopback only (ValidateHealth refuses any
// other address), inside the container, on a port nothing publishes.
func healthcheck(cfg *config.Config) error {
	if err := cfg.ValidateHealth(); err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Get("http://" + cfg.HealthListen + "/healthz")
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz: %s", resp.Status)
	}
	return nil
}

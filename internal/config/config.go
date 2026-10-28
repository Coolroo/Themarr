// Package config reads themarr's settings from flags, with an environment
// variable as each flag's fallback and a built-in default after that. There
// is no config file: the settings are a few names and paths, and secrets
// (the TLS key) live in files named here, never in a value.
package config

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Config is every setting themarr takes.
type Config struct {
	Listen       string // the TLS listener, ":8443"
	HealthListen string // the plain loopback health listener, "127.0.0.1:8081"
	CertFile     string // themarr's home-CA server certificate
	KeyFile      string // its key
	ClientCAFile string // the CA that signs the allowed client certificate (the home CA)
	ClientCN     string // the one client certificate CN let in ("tls-gateway")
	DataDir      string // where the store file lives
	PublicOrigin string // themarr's own origin, which admin writes must come from
	AdminGroup   string // the Remote-Groups entry that makes a user an admin
}

// setting is one flag and its environment fallback.
type setting struct {
	flag, env, def, usage string
	dst                   func(*Config) *string
}

var settings = []setting{
	{"listen", "THEMARR_LISTEN", ":8443", "TLS listen address", func(c *Config) *string { return &c.Listen }},
	{"health-listen", "THEMARR_HEALTH_LISTEN", "127.0.0.1:8081", "plain HTTP health listener (loopback only)", func(c *Config) *string { return &c.HealthListen }},
	{"cert-file", "THEMARR_CERT_FILE", "/certs/themarr.crt", "server certificate (PEM)", func(c *Config) *string { return &c.CertFile }},
	{"key-file", "THEMARR_KEY_FILE", "/certs/themarr.key", "server key (PEM)", func(c *Config) *string { return &c.KeyFile }},
	{"client-ca-file", "THEMARR_CLIENT_CA_FILE", "/certs/home-ca.crt", "CA for client certificates (PEM)", func(c *Config) *string { return &c.ClientCAFile }},
	{"client-cn", "THEMARR_CLIENT_CN", "tls-gateway", "the only client certificate common name allowed", func(c *Config) *string { return &c.ClientCN }},
	{"data-dir", "THEMARR_DATA_DIR", "/data", "directory of the store file", func(c *Config) *string { return &c.DataDir }},
	{"public-origin", "THEMARR_PUBLIC_ORIGIN", "https://themarr.coolroo.dev", "themarr's public origin; admin writes must send it as Origin", func(c *Config) *string { return &c.PublicOrigin }},
	{"admin-group", "THEMARR_ADMIN_GROUP", "admins", "the Remote-Groups group that may use admin routes", func(c *Config) *string { return &c.AdminGroup }},
}

// Bind adds every setting to fs as a string flag whose default is the
// environment variable's value when set (getenv), else the built-in
// default. After fs.Parse, the returned Config holds the values.
func Bind(fs *flag.FlagSet, getenv func(string) string) *Config {
	c := &Config{}
	for _, s := range settings {
		def := s.def
		if v := getenv(s.env); v != "" {
			def = v
		}
		fs.StringVar(s.dst(c), s.flag, def, s.usage+" (env "+s.env+")")
	}
	return c
}

var (
	cnPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	groupPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
)

// ValidateHealth checks only what the health check needs: the health
// listener must be a loopback address with a port, because it speaks plain
// HTTP.
func (c *Config) ValidateHealth() error {
	host, port, err := net.SplitHostPort(c.HealthListen)
	if err != nil || port == "" {
		return fmt.Errorf("health-listen %q: want host:port", c.HealthListen)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("health-listen %q: the plain health listener must be on a loopback IP", c.HealthListen)
	}
	return nil
}

// Validate checks every setting's form. It reads no file; the caller loads
// the certificates and the store, which checks those.
func (c *Config) Validate() error {
	var errs []error
	if _, port, err := net.SplitHostPort(c.Listen); err != nil || port == "" {
		errs = append(errs, fmt.Errorf("listen %q: want host:port", c.Listen))
	}
	if err := c.ValidateHealth(); err != nil {
		errs = append(errs, err)
	}
	for name, v := range map[string]string{"cert-file": c.CertFile, "key-file": c.KeyFile, "client-ca-file": c.ClientCAFile, "data-dir": c.DataDir} {
		if v == "" {
			errs = append(errs, fmt.Errorf("%s is required", name))
		}
	}
	if !cnPattern.MatchString(c.ClientCN) {
		errs = append(errs, fmt.Errorf("client-cn %q: want 1-64 letters, digits or . _ -", c.ClientCN))
	}
	if !groupPattern.MatchString(c.AdminGroup) {
		errs = append(errs, fmt.Errorf("admin-group %q: want 1-64 letters, digits or . _ -", c.AdminGroup))
	}
	if err := checkOrigin(c.PublicOrigin); err != nil {
		errs = append(errs, fmt.Errorf("public-origin %q: %w", c.PublicOrigin, err))
	}
	return errors.Join(errs...)
}

// checkOrigin accepts exactly an https origin as a browser sends it in the
// Origin header: scheme, lower-case host, optional port, nothing else.
func checkOrigin(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.HasSuffix(s, "/") {
		return errors.New("want https://host[:port] with no path")
	}
	if u.Host != strings.ToLower(u.Host) {
		return errors.New("the host must be lower case")
	}
	return nil
}

// DataDirExists checks that the data directory is a directory.
func (c *Config) DataDirExists() error {
	fi, err := os.Stat(c.DataDir)
	if err != nil {
		return fmt.Errorf("data-dir: %w", err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("data-dir %s is not a directory", c.DataDir)
	}
	return nil
}

package config

import (
	"flag"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func parse(t *testing.T, env map[string]string, args ...string) *Config {
	t.Helper()
	fs := flag.NewFlagSet("themarr", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	c := Bind(fs, func(k string) string { return env[k] })
	if err := fs.Parse(args); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestDefaults(t *testing.T) {
	c := parse(t, nil)
	want := Config{
		Listen: ":8443", HealthListen: "127.0.0.1:8081",
		CertFile: "/certs/themarr.crt", KeyFile: "/certs/themarr.key", ClientCAFile: "/certs/home-ca.crt",
		ClientCN: "tls-gateway", DataDir: "/data", PublicOrigin: "https://themarr.coolroo.dev", AdminGroup: "admins",
	}
	if *c != want {
		t.Fatalf("defaults %+v", *c)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

// TestFlagBeatsEnvBeatsDefault: a flag wins over its environment variable,
// which wins over the default.
func TestFlagBeatsEnvBeatsDefault(t *testing.T) {
	env := map[string]string{"THEMARR_CLIENT_CN": "from-env", "THEMARR_DATA_DIR": "/env/data"}
	c := parse(t, env, "-client-cn", "from-flag")
	if c.ClientCN != "from-flag" || c.DataDir != "/env/data" || c.AdminGroup != "admins" {
		t.Fatalf("got %+v", *c)
	}
}

func TestValidateRefuses(t *testing.T) {
	for name, args := range map[string][]string{
		"health on all addresses": {"-health-listen", ":8081"},
		"health on a public IP":   {"-health-listen", "192.168.1.5:8081"},
		"health by name":          {"-health-listen", "localhost:8081"},
		"listen without port":     {"-listen", "8443"},
		"http origin":             {"-public-origin", "http://themarr.coolroo.dev"},
		"origin with path":        {"-public-origin", "https://themarr.coolroo.dev/"},
		"origin with path 2":      {"-public-origin", "https://themarr.coolroo.dev/x"},
		"origin upper case":       {"-public-origin", "https://Themarr.coolroo.dev"},
		"origin with user":        {"-public-origin", "https://a@themarr.coolroo.dev"},
		"empty CN":                {"-client-cn", ""},
		"CN with comma":           {"-client-cn", "tls-gateway,x"},
		"group with comma":        {"-admin-group", "admins,users"},
		"no cert file":            {"-cert-file", ""},
		"no data dir":             {"-data-dir", ""},
	} {
		if err := parse(t, nil, args...).Validate(); err == nil {
			t.Errorf("%s: accepted %v", name, args)
		}
	}
}

func TestIPv6LoopbackHealthIsAllowed(t *testing.T) {
	if err := parse(t, nil, "-health-listen", "[::1]:8081").Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestDataDirExists(t *testing.T) {
	dir := t.TempDir()
	if err := parse(t, nil, "-data-dir", dir).DataDirExists(); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := parse(t, nil, "-data-dir", file).DataDirExists(); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("a file was accepted as data dir: %v", err)
	}
	if err := parse(t, nil, "-data-dir", filepath.Join(dir, "missing")).DataDirExists(); err == nil {
		t.Fatal("a missing data dir was accepted")
	}
}

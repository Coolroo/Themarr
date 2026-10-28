package tlsutil

import (
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"os"
	"path/filepath"
	"testing"

	"github.com/Coolroo/themarr/internal/testutil"
)

// TestServerConfig: TLS 1.3 at least, a verified client certificate
// required, from the given CA only.
func TestServerConfig(t *testing.T) {
	ca := testutil.NewCA(t, "home CA")
	sc := ca.ServerCert(t)
	cfg, err := ServerConfig(sc.CertFile, sc.KeyFile, ca.File)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MinVersion != tls.VersionTLS13 || cfg.ClientAuth != tls.RequireAndVerifyClientCert || cfg.ClientCAs == nil || len(cfg.Certificates) != 1 {
		t.Fatalf("config %+v", cfg)
	}
}

func TestServerConfigRefusesBadFiles(t *testing.T) {
	ca := testutil.NewCA(t, "home CA")
	sc := ca.ServerCert(t)
	if _, err := ServerConfig(sc.CertFile, ca.File, ca.File); err == nil {
		t.Fatal("a certificate with the wrong key file was accepted")
	}
	if _, err := ServerConfig(sc.CertFile, sc.KeyFile, filepath.Join(t.TempDir(), "missing.crt")); err == nil {
		t.Fatal("a missing CA file was accepted")
	}
	empty := filepath.Join(t.TempDir(), "empty.crt")
	if err := os.WriteFile(empty, []byte("not a certificate\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ServerConfig(sc.CertFile, sc.KeyFile, empty); err == nil {
		t.Fatal("a CA file without certificates was accepted")
	}
}

// TestVerifiedCN reads only verified chains, never what the client sent.
func TestVerifiedCN(t *testing.T) {
	if _, ok := VerifiedCN(nil); ok {
		t.Fatal("no TLS gave a CN")
	}
	sent := &x509.Certificate{Subject: pkix.Name{CommonName: "tls-gateway"}}
	if _, ok := VerifiedCN(&tls.ConnectionState{PeerCertificates: []*x509.Certificate{sent}}); ok {
		t.Fatal("an unverified peer certificate gave a CN")
	}
	cn, ok := VerifiedCN(&tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{sent}}})
	if !ok || cn != "tls-gateway" {
		t.Fatalf("cn %q ok %v", cn, ok)
	}
}

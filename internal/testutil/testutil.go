// Package testutil makes test certificate authorities and certificates
// (copied from Enforcarr's testutil). Every test server gets its own CA:
// httptest's one shared certificate would hide verification bugs.
package testutil

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// CA is a test certificate authority, standing in for the home CA.
type CA struct {
	Cert *x509.Certificate
	key  *ecdsa.PrivateKey
	File string // the CA certificate as PEM, to trust it

	mu     sync.Mutex
	serial int64
}

// NewCA makes a CA for one test.
func NewCA(t *testing.T, name string) *CA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name + " " + t.Name()},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	return &CA{Cert: cert, key: key, File: WriteCert(t, cert), serial: 1}
}

// Pool is a certificate pool holding only this CA.
func (ca *CA) Pool() *x509.CertPool {
	pool := x509.NewCertPool()
	pool.AddCert(ca.Cert)
	return pool
}

// issue signs a leaf certificate for tmpl's subject and usages.
func (ca *CA) issue(t *testing.T, tmpl *x509.Certificate) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca.mu.Lock()
	ca.serial++
	serial := ca.serial
	ca.mu.Unlock()
	now := time.Now()
	tmpl.SerialNumber = big.NewInt(serial)
	tmpl.NotBefore, tmpl.NotAfter = now.Add(-time.Hour), now.Add(time.Hour)
	tmpl.KeyUsage = x509.KeyUsageDigitalSignature
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.Cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// KeyPair is a certificate and its key in files, as cert_file and key_file
// name them.
type KeyPair struct {
	CertFile, KeyFile string
	TLS               tls.Certificate
}

// ClientCert issues a client certificate (clientAuth only) with common
// name cn.
func (ca *CA) ClientCert(t *testing.T, cn string) KeyPair {
	t.Helper()
	return write(t, ca.issue(t, &x509.Certificate{Subject: pkix.Name{CommonName: cn}, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}))
}

// ServerCert issues a server certificate (serverAuth only) for 127.0.0.1
// and localhost.
func (ca *CA) ServerCert(t *testing.T) KeyPair {
	t.Helper()
	return write(t, ca.issue(t, &x509.Certificate{
		Subject:     pkix.Name{CommonName: "127.0.0.1"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"},
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}))
}

func write(t *testing.T, c tls.Certificate) KeyPair {
	t.Helper()
	dir := t.TempDir()
	out := KeyPair{CertFile: filepath.Join(dir, "tls.crt"), KeyFile: filepath.Join(dir, "tls.key"), TLS: c}
	keyDER, err := x509.MarshalECPrivateKey(c.PrivateKey.(*ecdsa.PrivateKey))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out.CertFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Certificate[0]}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out.KeyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return out
}

// Client is an HTTPS client that trusts only serverCA and, unless client is
// nil, presents client's certificate.
func Client(serverCA *CA, client *KeyPair) *http.Client {
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: serverCA.Pool()}
	if client != nil {
		cfg.Certificates = []tls.Certificate{client.TLS}
	}
	return &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: cfg}}
}

// WriteCert writes a certificate as PEM to a temp file and returns its path.
func WriteCert(t *testing.T, cert *x509.Certificate) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

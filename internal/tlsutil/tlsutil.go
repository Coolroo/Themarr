// Package tlsutil builds themarr's TLS listener configuration. The listener
// speaks TLS 1.3 only and requires a client certificate that Go itself
// verifies against the home CA; there is deliberately no way to turn
// verification off (docs/security.md).
package tlsutil

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

// ServerConfig serves the certificate in certFile (key in keyFile) and
// requires every client to present a certificate that chains to a CA in
// clientCAFile. Which verified client is allowed in is the HTTP layer's
// check (VerifiedCN), so a refusal can be answered and logged.
func ServerConfig(certFile, keyFile, clientCAFile string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		// The error names the files, never their contents.
		return nil, fmt.Errorf("server certificate %s: %w", certFile, err)
	}
	pool, err := LoadPool(clientCAFile)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}, nil
}

// VerifiedCN is the common name of the client certificate Go verified for
// this connection: the leaf of the first verified chain. It is empty, and
// ok false, when no chain was verified (no TLS, or no client certificate).
// PeerCertificates is never used: it holds what the client sent, verified
// or not.
func VerifiedCN(state *tls.ConnectionState) (cn string, ok bool) {
	if state == nil || len(state.VerifiedChains) == 0 || len(state.VerifiedChains[0]) == 0 {
		return "", false
	}
	return state.VerifiedChains[0][0].Subject.CommonName, true
}

// LoadPool reads a PEM file holding one or more CA certificates.
func LoadPool(caFile string) (*x509.CertPool, error) {
	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("ca file %s: %w", caFile, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("ca file %s: no PEM certificates found", caFile)
	}
	return pool, nil
}

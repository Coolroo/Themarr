package tlsutil

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNoCertificateChecksTurnedOff fails the build if any non-test Go file
// in the repo mentions InsecureSkipVerify or replaces Go's own certificate
// verification. Themarr never skips verification (docs/security.md); this
// keeps it that way.
func TestNoCertificateChecksTurnedOff(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == ".git" || d.Name() == "vendor" || d.Name() == "node_modules" || d.Name() == "worktrees") {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, banned := range []string{"InsecureSkipVerify", "VerifyPeerCertificate", "VerifyConnection"} {
			if strings.Contains(string(b), banned) {
				t.Errorf("%s mentions %s", path, banned)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"

	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
)

// publicCache holds the encoded public answers of one store snapshot. A
// snapshot never changes after it is published, so neither do they: the
// catalog is built and hashed once per snapshot, not once per anonymous
// request (T-115), and each theme's public body is encoded once.
type publicCache struct {
	data *store.Data

	catalogOnce sync.Once
	catalogBody []byte
	catalogTag  string

	mu     sync.Mutex
	bodies map[*theme.Theme][]byte
}

// cached is the cache of snapshot d. Only the newest snapshot's cache is
// kept; a request still holding an older snapshot gets a cache of its own
// that is dropped after it.
func (s *Server) cached(d *store.Data) *publicCache {
	c := &publicCache{data: d, bodies: map[*theme.Theme][]byte{}}
	for {
		old := s.cache.Load()
		switch {
		case old != nil && old.data == d:
			return old
		case old != nil && old.data.Version > d.Version:
			return c
		case s.cache.CompareAndSwap(old, c):
			return c
		}
	}
}

// catalog is the catalog's body and its ETag (a hash of the body).
func (c *publicCache) catalog() ([]byte, string) {
	c.catalogOnce.Do(func() {
		var buf bytes.Buffer
		// Strings, integers and maps of strings: encoding can't fail.
		json.NewEncoder(&buf).Encode(buildCatalog(c.data))
		sum := sha256.Sum256(buf.Bytes())
		c.catalogBody, c.catalogTag = buf.Bytes(), `"c`+hex.EncodeToString(sum[:12])+`"`
	})
	return c.catalogBody, c.catalogTag
}

// themeBody is t's public view, encoded.
func (c *publicCache) themeBody(t *theme.Theme) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.bodies[t]
	if !ok {
		var buf bytes.Buffer
		json.NewEncoder(&buf).Encode(t.Public())
		b = buf.Bytes()
		c.bodies[t] = b
	}
	return b
}

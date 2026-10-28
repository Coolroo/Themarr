// Package webui serves the admin UI, embedded in the binary. dist/ holds a
// placeholder page until the admin UI (T-119) builds into it.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed dist
var dist embed.FS

// CSP is the admin UI's policy: its own files only, never framed.
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"

// Handler serves the files in dist, and index.html for any other path (the
// UI routes in the browser).
func Handler() http.Handler {
	return handler(dist)
}

func handler(root embed.FS) http.Handler {
	files, err := fs.Sub(root, "dist")
	if err != nil {
		panic("webui: " + err.Error())
	}
	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		panic("webui: dist/index.html is missing")
	}
	fileServer := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", CSP)
		w.Header().Set("Cache-Control", "no-cache")
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if fi, err := fs.Stat(files, name); err == nil && !fi.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if r.Method != http.MethodHead {
			w.Write(index)
		}
	})
}

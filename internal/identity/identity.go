// Package identity says who sent a request. A Source is one way to learn
// it; the first is Authelia's headers (decision 0007). Themarr never
// decides who someone is or which groups they are in: the Source does.
// Themarr stores only their choices and the admins' policies
// (internal/prefs).
//
// A Source is trusted only on requests that came through the trusted hop:
// the server's client-certificate gate lets in only tls-gateway, which sits
// behind NPM and Authelia. Public routes (an Authelia bypass) must never
// ask a Source, because anybody can send the headers there.
package identity

import (
	"net/http"
	"regexp"
	"strings"
)

// Identity is who sent a request: a user name and the user's groups.
type Identity struct {
	User   string
	Groups []string
}

// InGroup reports whether the identity holds group (an exact match).
func (id Identity) InGroup(group string) bool {
	for _, g := range id.Groups {
		if g == group {
			return true
		}
	}
	return false
}

// Source reads the caller's identity from a request on the trusted hop.
// ok is false when the request carries no usable identity: the caller is
// not signed in, or the headers are out of shape.
type Source interface {
	Identify(r *http.Request) (id Identity, ok bool)
}

// Func adapts a function to a Source.
type Func func(r *http.Request) (Identity, bool)

// Identify calls f.
func (f Func) Identify(r *http.Request) (Identity, bool) { return f(r) }

var validName = regexp.MustCompile(`^[A-Za-z0-9._@-]{1,128}$`)

// ValidName is the rule for user names, and for the group names a policy
// may name: 1-128 of A-Za-z0-9 . _ @ -.
func ValidName(s string) bool { return validName.MatchString(s) }

// Authelia reads Authelia's Remote-User and Remote-Groups, as NPM's
// auth_request snippet sets them (it overwrites what the browser sent).
// Remote-User must come exactly once and be a ValidName; Remote-Groups at
// most once, a comma-separated list (spaces trimmed, empty items dropped).
// A repeated header is refused, never merged.
type Authelia struct{}

// Identify implements Source.
func (Authelia) Identify(r *http.Request) (Identity, bool) {
	users := r.Header.Values("Remote-User")
	if len(users) != 1 || !ValidName(users[0]) {
		return Identity{}, false
	}
	id := Identity{User: users[0]}
	groups := r.Header.Values("Remote-Groups")
	if len(groups) > 1 {
		return Identity{}, false
	}
	if len(groups) == 1 {
		for _, g := range strings.Split(groups[0], ",") {
			if g = strings.TrimSpace(g); g != "" {
				id.Groups = append(id.Groups, g)
			}
		}
	}
	return id, true
}

// Package strictjson decodes request bodies strictly (copied from
// Enforcarr's internal/server/strict.go): one object, exact field names,
// no repeated keys, bounded depth, valid UTF-8, nothing after the object.
package strictjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// Decode decodes data, which must be exactly one JSON object, into
// dst. Go's decoder alone would accept a field named in another case
// ("Mode" for "mode") and take the last of two repeated keys, so the
// object's keys are walked first: at every path named in fields, each key
// must be one listed, exactly; at every depth, no key may repeat. Objects
// at other paths (a map, such as labels) may have any keys. Nesting is
// bounded, and nothing may follow the object.
func Decode(data []byte, dst any, fields map[string][]string) error {
	if err := CheckKeys(data, fields); err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errors.New("the body does not have the expected fields and types")
	}
	return nil
}

// maxJSONDepth bounds nesting. A theme needs 6
// (tokens.light.primary.$value.components[]).
const maxJSONDepth = 8

var (
	errNotObject = errors.New("the body must be one JSON object")
	errMalformed = errors.New("the body is not valid JSON")
	errTrailing  = errors.New("the body must hold one object and nothing after it")
	errDeep      = errors.New("the body is nested too deeply")
)

// frame is one open object or array in checkKeys' walk.
type frame struct {
	object    bool
	path      string // "" for the top object, "source" for its source field
	expectKey bool   // an object waiting for a key (or its end)
	keys      map[string]bool
}

// CheckKeys is Decode's walk without the decode: data must be valid UTF-8
// and one JSON object, with no repeated key at any depth, nesting of at most
// maxJSONDepth, and at each path named in fields only the keys listed.
// Paths join keys with "." and mark array items with "[]".
func CheckKeys(data []byte, fields map[string][]string) error {
	if !utf8.Valid(data) {
		return errors.New("the body is not valid UTF-8")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var stack []*frame
	key := ""
	started := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			if !started || len(stack) > 0 {
				return errMalformed
			}
			return nil
		}
		if err != nil {
			return errMalformed
		}
		if !started {
			if tok != json.Delim('{') {
				return errNotObject
			}
			started = true
			stack = append(stack, &frame{object: true, expectKey: true, keys: map[string]bool{}})
			continue
		}
		if len(stack) == 0 {
			return errTrailing
		}
		top := stack[len(stack)-1]
		if top.object && top.expectKey {
			if tok == json.Delim('}') {
				stack = pop(stack)
				continue
			}
			k, _ := tok.(string)
			if top.keys[k] {
				return errors.New("the body repeats the field " + quote(k))
			}
			top.keys[k] = true
			if allowed, checked := fields[top.path]; checked && !contains(allowed, k) {
				return errors.New("the body has an unknown field " + quote(k))
			}
			top.expectKey, key = false, k
			continue
		}
		// A value: in an object (after its key) or in an array.
		switch tok {
		case json.Delim('{'), json.Delim('['):
			if len(stack) >= maxJSONDepth {
				return errDeep
			}
			path := top.path + "[]"
			if top.object {
				path = join(top.path, key)
			}
			stack = append(stack, &frame{object: tok == json.Delim('{'), path: path, expectKey: true, keys: map[string]bool{}})
		case json.Delim(']'):
			stack = pop(stack)
		default:
			if top.object {
				top.expectKey = true
			}
		}
	}
}

// pop closes the innermost frame; its parent, if an object, waits for its
// next key.
func pop(stack []*frame) []*frame {
	stack = stack[:len(stack)-1]
	if n := len(stack); n > 0 && stack[n-1].object {
		stack[n-1].expectKey = true
	}
	return stack
}

func join(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}

func contains(list []string, s string) bool {
	for _, l := range list {
		if l == s {
			return true
		}
	}
	return false
}

// quote names a field from the body in an error, bounded so a huge key
// can't fill the answer.
func quote(s string) string {
	if r := []rune(s); len(r) > 40 {
		s = string(r[:40]) + "..."
	}
	b, _ := json.Marshal(s)
	return string(b)
}

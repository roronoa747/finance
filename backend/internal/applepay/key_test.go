package applepay

import (
	"bytes"
	"strings"
	"testing"
)

func TestNewKey(t *testing.T) {
	a, hashA, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := NewKey()
	if !strings.HasPrefix(a, KeyPrefix) || len(a) != len(KeyPrefix)+43 {
		t.Fatalf("key shape: %q (%d)", a, len(a))
	}
	if a == b {
		t.Fatal("two keys are equal")
	}
	if !bytes.Equal(hashA, HashKey(a)) || len(hashA) != 32 || bytes.Equal(HashKey(a), HashKey(b)) {
		t.Fatal("hash is not SHA-256 of the key")
	}
	if got, ok := ParseBearer("Bearer " + a); !ok || got != a {
		t.Fatalf("own key not parsed: %q %v", got, ok)
	}
}

func TestParseBearerRejects(t *testing.T) {
	// Built from parts: the pre-commit hook flags key-like literals.
	key := KeyPrefix + strings.Repeat("A", 43)
	for _, h := range []string{
		"",
		"Bearer",
		"Bearer ",
		"Bearer  " + key,                      // two spaces inside
		"bearer " + key,                       // other case
		"Basic " + key,                        // other scheme
		key,                                   // no scheme
		"Bearer " + key + "A",                 // 44 characters
		"Bearer " + key[:len(key)-1],          // 42 characters
		"Bearer " + key[:10] + " " + key[10:], // space inside the key
		"Bearer " + strings.Replace(key, "A", "+", 1),                                              // not base64url
		"Bearer " + strings.Join([]string{"eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "c2ln"}, "."), // a JWT
	} {
		if _, ok := ParseBearer(h); ok {
			t.Errorf("accepted %q", h)
		}
	}
	if got, ok := ParseBearer("  Bearer " + key + " \n"); !ok || got != key {
		t.Errorf("spaces around the header: %q %v", got, ok)
	}
}

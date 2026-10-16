// Package applepay holds the pieces of the Apple Pay endpoints that need no database: phone keys
// (бэклог «Apple Pay», Р-5, Р-13) and parsing what the Shortcuts "Transaction" trigger sends
// (Р-7, Р-13а, Р-15) and bank pushes of the "Notification" trigger (Блок 2, Р-8, Р-10, Р-23).
package applepay

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strings"
)

// KeyPrefix marks a phone key: "ffk_" + base64url of 32 random bytes (43 characters).
const KeyPrefix = "ffk_"

var keyPattern = regexp.MustCompile(`^ffk_[A-Za-z0-9_-]{43}$`)

// NewKey makes a phone key. Only the hash is stored; the plain key leaves the server once.
func NewKey() (plain string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	plain = KeyPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return plain, HashKey(plain), nil
}

// HashKey is SHA-256 of the key: the key is high-entropy, so a fast hash suffices and lets the
// database find it by the hash.
func HashKey(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

// ParseBearer takes the key out of an Authorization header: exactly "Bearer ffk_<43>", spaces
// around the whole header aside. A JWT or anything else is not a phone key.
func ParseBearer(header string) (string, bool) {
	key, found := strings.CutPrefix(strings.TrimSpace(header), "Bearer ")
	if !found || !keyPattern.MatchString(key) {
		return "", false
	}
	return key, true
}

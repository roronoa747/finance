// Package googleauth verifies Google ID tokens (B2C-22, Р-25): the signature by the
// key Google publishes in its JWKS, then issuer, audience, expiry and a verified email.
// Nothing from a token is logged.
package googleauth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// DefaultJWKSURL is where Google publishes the keys that sign its ID tokens.
const DefaultJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// issuers are the two spellings Google uses for "iss".
var issuers = []string{"accounts.google.com", "https://accounts.google.com"}

const (
	// defaultKeysTTL keeps the keys when Google sends no max-age.
	defaultKeysTTL = time.Hour
	// refreshCooldown stops tokens with made-up key ids from refetching the keys on every request.
	refreshCooldown = time.Minute
	// maxJWKSBytes bounds the answer; Google's is about 1.5 KB.
	maxJWKSBytes = 64 << 10
)

// ErrInvalidToken means the token is not a valid Google ID token for this app.
var ErrInvalidToken = errors.New("invalid google id token")

// ErrUnavailable means Google's keys could not be fetched; the token was not judged.
var ErrUnavailable = errors.New("google keys unavailable")

// Identity is what the app takes from a verified token.
type Identity struct {
	Sub   string
	Email string
	Name  string
}

// Verifier checks ID tokens against Google's keys. ClientIDs are the accepted audiences
// (web, Android, iOS clients).
type Verifier struct {
	JWKSURL   string
	HTTP      *http.Client
	ClientIDs []string
	Now       func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
	fetchedAt time.Time
	failedAt  time.Time // the last failed fetch: Google down is not asked again within the cooldown
}

// New returns a verifier for the live Google keys, or nil without client ids — sign-in
// with Google is then switched off.
func New(clientIDs []string) *Verifier {
	if len(clientIDs) == 0 {
		return nil
	}
	return &Verifier{
		JWKSURL:   DefaultJWKSURL,
		HTTP:      &http.Client{Timeout: 4 * time.Second},
		ClientIDs: clientIDs,
		Now:       time.Now,
	}
}

type googleClaims struct {
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"` // a bool; old tokens send the string "true"
	Name          string `json:"name"`
	jwt.RegisteredClaims
}

// Verify returns the identity of a valid token: ErrInvalidToken for any rejected token,
// ErrUnavailable when the keys could not be fetched.
func (v *Verifier) Verify(ctx context.Context, idToken string) (*Identity, error) {
	var keyErr error
	claims := &googleClaims{}
	_, err := jwt.ParseWithClaims(idToken, claims, func(t *jwt.Token) (interface{}, error) {
		kid, _ := t.Header["kid"].(string)
		key, err := v.key(ctx, kid)
		if err != nil {
			keyErr = err
			return nil, err
		}
		return key, nil
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithTimeFunc(v.Now),
		jwt.WithExpirationRequired(),
	)
	if errors.Is(keyErr, ErrUnavailable) {
		return nil, keyErr
	}
	if err != nil {
		return nil, ErrInvalidToken
	}

	if !slices.Contains(issuers, claims.Issuer) {
		return nil, ErrInvalidToken
	}
	if !slices.ContainsFunc(claims.Audience, func(aud string) bool { return slices.Contains(v.ClientIDs, aud) }) {
		return nil, ErrInvalidToken
	}
	if claims.Subject == "" || !strings.Contains(claims.Email, "@") || !emailVerified(claims.EmailVerified) {
		return nil, ErrInvalidToken
	}
	return &Identity{
		Sub:   claims.Subject,
		Email: strings.ToLower(strings.TrimSpace(claims.Email)),
		Name:  strings.TrimSpace(claims.Name),
	}, nil
}

func emailVerified(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return val == "true"
	}
	return false
}

// key returns the public key for kid, refetching the keys when they are stale or kid is
// unknown (Google rotates keys) — but not more often than refreshCooldown.
func (v *Verifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	now := v.Now()
	if key, ok := v.keys[kid]; ok && now.Before(v.expiresAt) {
		return key, nil
	}
	if v.keys != nil && now.Sub(v.fetchedAt) < refreshCooldown {
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
		return nil, ErrInvalidToken
	}

	if !v.failedAt.IsZero() && now.Sub(v.failedAt) < refreshCooldown {
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
		return nil, fmt.Errorf("%w: keys failed to load a moment ago", ErrUnavailable)
	}

	// A client that hung up must not arm the cooldown for every sign-in on this instance:
	// the fetch outlives the request and is bounded by HTTP.Timeout alone.
	keys, ttl, err := v.fetch(context.WithoutCancel(ctx))
	if err != nil {
		v.failedAt = now
		// Stale keys still verify a known kid better than refusing everyone.
		if key, ok := v.keys[kid]; ok {
			return key, nil
		}
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	v.keys, v.fetchedAt, v.expiresAt, v.failedAt = keys, now, now.Add(ttl), time.Time{}
	if key, ok := keys[kid]; ok {
		return key, nil
	}
	return nil, ErrInvalidToken
}

type jwks struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

var maxAgeRe = regexp.MustCompile(`max-age=(\d+)`)

func (v *Verifier) fetch(ctx context.Context) (map[string]*rsa.PublicKey, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.JWKSURL, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := v.HTTP.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("jwks answered %d", resp.StatusCode)
	}

	var set jwks
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJWKSBytes)).Decode(&set); err != nil {
		return nil, 0, fmt.Errorf("decode jwks: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		key, err := rsaKey(k.N, k.E)
		if err != nil {
			continue
		}
		keys[k.Kid] = key
	}
	if len(keys) == 0 {
		return nil, 0, errors.New("jwks has no RSA keys")
	}

	ttl := defaultKeysTTL
	if m := maxAgeRe.FindStringSubmatch(resp.Header.Get("Cache-Control")); m != nil {
		if secs, err := strconv.Atoi(m[1]); err == nil && secs > 0 {
			ttl = time.Duration(secs) * time.Second
		}
	}
	return keys, ttl, nil
}

func rsaKey(n, e string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(n)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(e)
	if err != nil {
		return nil, err
	}
	exp := new(big.Int).SetBytes(eb)
	if !exp.IsInt64() || exp.Int64() < 3 || exp.Int64() > 1<<31-1 {
		return nil, errors.New("bad exponent")
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: int(exp.Int64())}, nil
}

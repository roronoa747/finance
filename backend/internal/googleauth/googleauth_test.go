package googleauth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const clientID = "web-client.apps.googleusercontent.com"

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

type fakeGoogle struct {
	srv   *httptest.Server
	keys  map[string]*rsa.PrivateKey
	hits  atomic.Int32
	delay time.Duration
}

func newFakeGoogle(t *testing.T, kids ...string) *fakeGoogle {
	t.Helper()
	g := &fakeGoogle{keys: map[string]*rsa.PrivateKey{}}
	for _, kid := range kids {
		g.addKey(t, kid)
	}
	g.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.hits.Add(1)
		if g.delay > 0 {
			time.Sleep(g.delay)
		}
		var set jwks
		for kid, k := range g.keys {
			set.Keys = append(set.Keys, struct {
				Kid string `json:"kid"`
				Kty string `json:"kty"`
				N   string `json:"n"`
				E   string `json:"e"`
			}{kid, "RSA", base64.RawURLEncoding.EncodeToString(k.N.Bytes()), base64.RawURLEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes())})
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(set)
	}))
	t.Cleanup(g.srv.Close)
	return g
}

func (g *fakeGoogle) addKey(t *testing.T, kid string) {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	g.keys[kid] = k
}

func (g *fakeGoogle) verifier() *Verifier {
	return &Verifier{JWKSURL: g.srv.URL, HTTP: g.srv.Client(), ClientIDs: []string{"android-client", clientID}, Now: func() time.Time { return now }}
}

func (g *fakeGoogle) token(t *testing.T, kid string, edit func(c jwt.MapClaims)) string {
	t.Helper()
	c := jwt.MapClaims{
		"iss":            "https://accounts.google.com",
		"aud":            clientID,
		"sub":            "1234567890",
		"email":          "Dana@Example.com",
		"email_verified": true,
		"name":           "Дана",
		"iat":            now.Add(-time.Minute).Unix(),
		"exp":            now.Add(time.Hour).Unix(),
	}
	if edit != nil {
		edit(c)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(g.keys[kid])
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestVerifyValidToken(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	id, err := g.verifier().Verify(context.Background(), g.token(t, "k1", nil))
	if err != nil {
		t.Fatalf("valid token: %v", err)
	}
	if id.Sub != "1234567890" || id.Email != "dana@example.com" || id.Name != "Дана" {
		t.Errorf("identity = %+v", id)
	}
}

func TestVerifyAcceptsShortIssuerAndStringVerified(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	tok := g.token(t, "k1", func(c jwt.MapClaims) {
		c["iss"] = "accounts.google.com"
		c["email_verified"] = "true"
	})
	if _, err := g.verifier().Verify(context.Background(), tok); err != nil {
		t.Fatalf("short iss: %v", err)
	}
}

func TestVerifyRejects(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	cases := map[string]func(c jwt.MapClaims){
		"foreign audience":   func(c jwt.MapClaims) { c["aud"] = "someone-else" },
		"expired":            func(c jwt.MapClaims) { c["exp"] = now.Add(-time.Minute).Unix() },
		"no expiry":          func(c jwt.MapClaims) { delete(c, "exp") },
		"issuer not google":  func(c jwt.MapClaims) { c["iss"] = "https://evil.example.com" },
		"email not verified": func(c jwt.MapClaims) { c["email_verified"] = false },
		"no email verified":  func(c jwt.MapClaims) { delete(c, "email_verified") },
		"no email":           func(c jwt.MapClaims) { delete(c, "email") },
		"no subject":         func(c jwt.MapClaims) { delete(c, "sub") },
	}
	for name, edit := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := g.verifier().Verify(context.Background(), g.token(t, "k1", edit))
			if !errors.Is(err, ErrInvalidToken) {
				t.Errorf("err = %v, want ErrInvalidToken", err)
			}
		})
	}
}

func TestVerifyRejectsForeignSignatureAndHS256(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	other := newFakeGoogle(t, "k1") // same kid, another key
	if _, err := g.verifier().Verify(context.Background(), other.token(t, "k1", nil)); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("foreign signature: err = %v", err)
	}

	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"iss": "accounts.google.com", "aud": clientID, "sub": "1", "email": "a@b.c", "email_verified": true, "exp": now.Add(time.Hour).Unix()})
	hs.Header["kid"] = "k1"
	s, _ := hs.SignedString([]byte("secret"))
	if _, err := g.verifier().Verify(context.Background(), s); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("HS256: err = %v", err)
	}
}

func TestVerifyRefetchesOnUnknownKid(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	v := g.verifier()
	if _, err := v.Verify(context.Background(), g.token(t, "k1", nil)); err != nil {
		t.Fatal(err)
	}
	// Google rotated keys: the new kid is unknown to the cache.
	g.addKey(t, "k2")
	tok := g.token(t, "k2", nil)

	// Within the cooldown the keys are not refetched.
	if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("within cooldown: err = %v", err)
	}
	if got := g.hits.Load(); got != 1 {
		t.Fatalf("jwks hits within cooldown = %d, want 1", got)
	}

	now2 := now.Add(2 * time.Minute)
	v.Now = func() time.Time { return now2 }
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("after rotation: %v", err)
	}
	if got := g.hits.Load(); got != 2 {
		t.Errorf("jwks hits = %d, want 2", got)
	}
	// Cached now: no third fetch.
	if _, err := v.Verify(context.Background(), g.token(t, "k1", nil)); err != nil {
		t.Fatal(err)
	}
	if got := g.hits.Load(); got != 2 {
		t.Errorf("jwks hits after cache = %d, want 2", got)
	}
}

func TestVerifyTimeoutIsUnavailable(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	g.delay = 300 * time.Millisecond
	v := g.verifier()
	v.HTTP.Timeout = 50 * time.Millisecond
	_, err := v.Verify(context.Background(), g.token(t, "k1", nil))
	if !errors.Is(err, ErrUnavailable) {
		t.Errorf("err = %v, want ErrUnavailable", err)
	}
}

// Google down: sign-ins within the cooldown do not each wait out another timeout under the
// lock (critic of Block 4); after the cooldown the keys are asked for again.
func TestVerifyFailedFetchIsNotRepeatedWithinCooldown(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	g.delay = 300 * time.Millisecond
	v := g.verifier()
	v.HTTP.Timeout = 50 * time.Millisecond
	tok := g.token(t, "k1", nil)
	for i := 0; i < 3; i++ {
		if _, err := v.Verify(context.Background(), tok); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("try %d: err = %v, want ErrUnavailable", i, err)
		}
	}
	if got := g.hits.Load(); got != 1 {
		t.Errorf("jwks hits while down = %d, want 1", got)
	}

	g.delay = 0
	later := now.Add(2 * time.Minute)
	v.Now = func() time.Time { return later }
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("after the cooldown: %v", err)
	}
}

// A sign-in whose client hung up while the keys were loading does not switch Google
// sign-in off for a minute on a cold instance (review backend Block 4, Н-1).
func TestVerifyCanceledRequestDoesNotArmCooldown(t *testing.T) {
	g := newFakeGoogle(t, "k1")
	g.delay = 200 * time.Millisecond
	v := g.verifier()
	tok := g.token(t, "k1", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, _ = v.Verify(ctx, tok)

	g.delay = 0
	if _, err := v.Verify(context.Background(), tok); err != nil {
		t.Fatalf("next sign-in after a canceled one: %v", err)
	}
}

func TestNewWithoutClientIDsIsOff(t *testing.T) {
	if New(nil) != nil {
		t.Error("New(nil) should switch Google sign-in off")
	}
	v := New([]string{clientID})
	if v == nil || v.JWKSURL != DefaultJWKSURL || v.HTTP.Timeout != 4*time.Second {
		t.Errorf("New = %+v", v)
	}
}

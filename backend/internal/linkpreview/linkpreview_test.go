package linkpreview

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

// Фото по ссылке (B2C-65, Р-69): проверка адресов отдельно, разбор страницы и
// лимиты — на httptest.NewTLSServer. Наружу тесты не ходят.

func TestPublicBlocksInternalAddresses(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.8.9.10", "::1", // loopback
		"10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", // private
		"169.254.169.254", "169.254.0.1", "fe80::1", // link-local, cloud metadata
		"100.64.0.1", "100.127.255.254", // CGNAT
		"fc00::1", "fd00:ec2::254", // ULA (fd00:ec2::254 — метаданные AWS по IPv6)
		"224.0.0.1", "239.255.255.250", "ff02::1", // multicast
		"0.0.0.0", "::", "0.1.2.3", // unspecified, «эта сеть»
		"255.255.255.255", "240.0.0.1", // broadcast, reserved
		"192.0.0.1", "198.18.0.1", // IETF, benchmarking
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", // IPv4 в IPv6
		"64:ff9b::7f00:1", "64:ff9b::a00:1", // NAT64 на внутренний IPv4
		"2002:7f00:1::1", "2002:a00:1::1", // 6to4 на внутренний IPv4
		"2001::1", "fec0::1", // Teredo, site-local
	}
	for _, s := range blocked {
		if Public(netip.MustParseAddr(s)) {
			t.Errorf("%s: must be blocked", s)
		}
	}
	allowed := []string{"1.1.1.1", "8.8.8.8", "185.22.64.1", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"}
	for _, s := range allowed {
		if !Public(netip.MustParseAddr(s)) {
			t.Errorf("%s: must be allowed", s)
		}
	}
}

func TestBadURLs(t *testing.T) {
	f := New()
	for _, raw := range []string{
		"http://shop.kz/p/1", "ftp://shop.kz/x", "https://user:pass@shop.kz/", "https://shop.kz:8443/",
		"https:///nohost", "not a url", "javascript:alert(1)", "https://shop.kz/" + strings.Repeat("a", 2100),
	} {
		if _, err := f.Fetch(t.Context(), raw); !errors.Is(err, ErrBadURL) {
			t.Errorf("%q: want ErrBadURL, got %v", raw, err)
		}
	}
}

// Имя, разрешающееся во внутренний адрес, отказано на соединении — до запроса.
func TestNameResolvingToInternalAddressIsBlocked(t *testing.T) {
	hits := 0
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
	// Production check, but "localhost:443" is dialled at the test server: the socket targets 127.0.0.1.
	f := newFetcher(nil, func(string) string { return "localhost:" + port }, trust(srv))
	if _, err := f.Fetch(t.Context(), "https://localhost/p"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("want ErrBlocked, got %v", err)
	}
	if _, err := f.Fetch(t.Context(), "https://127.0.0.1/p"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("literal: want ErrBlocked, got %v", err)
	}
	if hits != 0 {
		t.Fatalf("blocked address was reached %d times", hits)
	}
}

// site is a TLS test server reachable as https://example.com (its certificate
// covers that name); other names are dialled at a second, "internal" listener
// that the test check refuses.
type site struct {
	srv          *httptest.Server
	internal     *httptest.Server
	mux          *http.ServeMux
	internalHits int
}

func newSite(t *testing.T) (*site, *Fetcher) {
	t.Helper()
	s := &site{mux: http.NewServeMux()}
	s.srv = httptest.NewTLSServer(s.mux)
	s.internal = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.internalHits++ }))
	t.Cleanup(s.srv.Close)
	t.Cleanup(s.internal.Close)
	allowed := netip.MustParseAddrPort(s.srv.Listener.Addr().String())
	f := newFetcher(
		func(ap netip.AddrPort) bool { return ap == allowed },
		func(addr string) string {
			if addr == "example.com:443" {
				return s.srv.Listener.Addr().String()
			}
			return s.internal.Listener.Addr().String()
		},
		trust(s.srv),
	)
	return s, f
}

func trust(srv *httptest.Server) *tls.Config {
	return srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
}

func page(head string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, "<!doctype html><html><head>%s</head><body><svg><title>иконка</title></svg></body></html>", head)
	}
}

func jpeg(n int) []byte {
	b := bytes.Repeat([]byte{0x55}, n)
	copy(b, []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00})
	return b
}

func image(body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(body)
	}
}

func TestFetchOgImageAndTitle(t *testing.T) {
	s, f := newSite(t)
	var ua string
	s.mux.HandleFunc("/p/dyson", func(w http.ResponseWriter, r *http.Request) {
		ua = r.Header.Get("User-Agent")
		page(`<meta property="og:title" content="  Dyson   Airwrap
		Complete NanoSIM&amp;#43;eSIM ">
		<meta name="twitter:image" content="https://example.com/tw.jpg">
		<meta property="og:image" content="/img/main.jpg"><title>Не это</title>`)(w, r)
	})
	s.mux.HandleFunc("/img/main.jpg", image(jpeg(4000)))
	p, err := f.Fetch(t.Context(), "https://example.com/p/dyson?utm=1")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if p.Title != "Dyson Airwrap Complete NanoSIM+eSIM" || p.ImageType != "image/jpeg" || len(p.Image) != 4000 {
		t.Fatalf("unexpected preview: %q %s %d", p.Title, p.ImageType, len(p.Image))
	}
	if !strings.Contains(ua, "Mozilla/5.0") {
		t.Fatalf("browser user agent expected, got %q", ua)
	}
}

func TestFetchFallbacks(t *testing.T) {
	s, f := newSite(t)
	long := strings.Repeat("Пылесос ", 30)
	s.mux.HandleFunc("/tw", page(`<title>  Фен
	Dyson </title><meta name="twitter:image" content="https://example.com/a.png">`))
	s.mux.HandleFunc("/link", page(`<title>`+long+`</title><link rel="image_src" href="b.webp">`))
	s.mux.HandleFunc("/a.png", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("\x89PNG\r\n\x1a\n0000IHDR")) })
	s.mux.HandleFunc("/b.webp", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("RIFF\x00\x00\x00\x00WEBPVP8 ")) })

	p, err := f.Fetch(t.Context(), "https://example.com/tw")
	if err != nil || p.Title != "Фен Dyson" || p.ImageType != "image/png" {
		t.Fatalf("twitter:image + <title>: %+v %v", p.Title, err)
	}
	p, err = f.Fetch(t.Context(), "https://example.com/link")
	if err != nil || p.ImageType != "image/webp" {
		t.Fatalf("link rel=image_src, relative: %v %v", p.ImageType, err)
	}
	if n := len([]rune(p.Title)); n != 120 && n != 119 {
		t.Fatalf("title must be clipped to 120 characters, got %d", n)
	}
}

func TestFetchNoImageAndNotHTML(t *testing.T) {
	s, f := newSite(t)
	s.mux.HandleFunc("/none", page(`<title>Без картинки</title>`))
	s.mux.HandleFunc("/svg", page(`<meta property="og:image" content="/logo.svg">`))
	s.mux.HandleFunc("/logo.svg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	})
	s.mux.HandleFunc("/json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"og:image":"x"}`))
	})
	s.mux.HandleFunc("/gone", http.NotFound)
	for path, want := range map[string]error{"/none": ErrNoImage, "/svg": ErrNoImage, "/json": ErrUpstream, "/gone": ErrUpstream} {
		if _, err := f.Fetch(t.Context(), "https://example.com"+path); !errors.Is(err, want) {
			t.Errorf("%s: want %v, got %v", path, want, err)
		}
	}
}

func TestFetchLimits(t *testing.T) {
	s, f := newSite(t)
	// og:image after the first megabyte is not read.
	s.mux.HandleFunc("/huge", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><head><!-- " + strings.Repeat("x", maxPageBytes) + ` --><meta property="og:image" content="/ok.jpg"></head></html>`))
	})
	s.mux.HandleFunc("/ok.jpg", image(jpeg(100)))
	s.mux.HandleFunc("/big", page(`<meta property="og:image" content="/big.jpg">`))
	s.mux.HandleFunc("/big.jpg", image(jpeg(maxImageSize+1)))
	s.mux.HandleFunc("/edge", page(`<meta property="og:image" content="/edge.jpg">`))
	s.mux.HandleFunc("/edge.jpg", image(jpeg(maxImageSize)))

	if _, err := f.Fetch(t.Context(), "https://example.com/huge"); !errors.Is(err, ErrNoImage) {
		t.Fatalf("page limit: want ErrNoImage, got %v", err)
	}
	if _, err := f.Fetch(t.Context(), "https://example.com/big"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("image limit: want ErrTooLarge, got %v", err)
	}
	if p, err := f.Fetch(t.Context(), "https://example.com/edge"); err != nil || len(p.Image) != maxImageSize {
		t.Fatalf("image of exactly 2 MB: %v", err)
	}
}

func TestRedirects(t *testing.T) {
	s, f := newSite(t)
	s.mux.HandleFunc("/img.jpg", image(jpeg(100)))
	s.mux.HandleFunc("/final", page(`<meta property="og:image" content="img.jpg">`))
	s.mux.HandleFunc("/r/", func(w http.ResponseWriter, r *http.Request) {
		var n int
		fmt.Sscanf(strings.TrimPrefix(r.URL.Path, "/r/"), "%d", &n)
		if n <= 1 {
			http.Redirect(w, r, "/final", http.StatusFound)
			return
		}
		http.Redirect(w, r, fmt.Sprintf("/r/%d", n-1), http.StatusFound)
	})
	s.mux.HandleFunc("/to-http", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://example.com/final", http.StatusFound)
	})
	s.mux.HandleFunc("/to-internal", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://internal.test/final", http.StatusFound)
	})
	s.mux.HandleFunc("/to-metadata", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://169.254.169.254/latest/meta-data/", http.StatusFound)
	})
	s.mux.HandleFunc("/image-internal", page(`<meta property="og:image" content="https://internal.test/a.jpg">`))

	if _, err := f.Fetch(t.Context(), "https://example.com/r/3"); err != nil {
		t.Fatalf("3 redirects are allowed: %v", err)
	}
	if _, err := f.Fetch(t.Context(), "https://example.com/r/4"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("4 redirects: want ErrUpstream, got %v", err)
	}
	if _, err := f.Fetch(t.Context(), "https://example.com/to-http"); !errors.Is(err, ErrBadURL) {
		t.Fatalf("redirect to http: want ErrBadURL, got %v", err)
	}
	for _, path := range []string{"/to-internal", "/to-metadata", "/image-internal"} {
		if _, err := f.Fetch(t.Context(), "https://example.com"+path); !errors.Is(err, ErrBlocked) {
			t.Fatalf("%s: want ErrBlocked, got %v", path, err)
		}
	}
	if s.internalHits != 0 {
		t.Fatalf("internal listener was reached %d times", s.internalHits)
	}
}

func TestTimeout(t *testing.T) {
	s, f := newSite(t)
	s.mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	ctx, cancel := context.WithTimeout(t.Context(), 200_000_000) // 200 ms
	defer cancel()
	_, err := f.Fetch(ctx, "https://example.com/slow")
	if !errors.Is(err, ErrUpstream) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want ErrUpstream wrapping the deadline, got %v", err)
	}
}

// Package linkpreview opens a product page and takes its main picture and
// title (Р-60, B2C-65): a wish added by link gets a photo without the user
// saving it by hand. The page is someone else's server, so every connection —
// the page, each redirect and the picture — is checked after the name is
// resolved: internal addresses are refused (SSRF, Р-69). Price is not taken.
package linkpreview

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
)

// Errors are typed so the handler can answer with a code, never with the URL.
var (
	ErrBadURL   = errors.New("bad url")
	ErrBlocked  = errors.New("blocked address")
	ErrNoImage  = errors.New("no image")
	ErrTooLarge = errors.New("too large")
	ErrUpstream = errors.New("page unavailable")
)

const (
	maxURLLen    = 2048
	maxPageBytes = 1 << 20
	maxImageSize = 2 << 20
	maxRedirects = 3
	maxTitle     = 120
	// timeout covers the page and the picture together, well under the Vercel
	// function limit (§6 «Грабли»).
	timeout = 6 * time.Second
	// userAgent is an ordinary browser: shops answer bots with a captcha page.
	userAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36"
)

// Preview is what the page gave: the title and the picture bytes with their
// type detected from the signature.
type Preview struct {
	Title     string
	ImageType string
	Image     []byte
}

// Fetcher holds the guarded HTTP client.
type Fetcher struct {
	client *http.Client
	// Test hooks — nil in production: allow replaces the address check, dial
	// maps "host:443" to a test server. Unexported: no production code can set them.
	allow func(netip.AddrPort) bool
	dial  func(addr string) string
}

// New returns the production fetcher: internal addresses are refused.
func New() *Fetcher { return newFetcher(nil, nil, nil) }

func newFetcher(allow func(netip.AddrPort) bool, dial func(string) string, tlsConfig *tls.Config) *Fetcher {
	f := &Fetcher{allow: allow, dial: dial}
	dialer := &net.Dialer{Timeout: 3 * time.Second, Control: f.control}
	transport := &http.Transport{
		Proxy: nil, // a proxy from the environment would connect for us, past the check
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if f.dial != nil {
				addr = f.dial(addr)
			}
			return dialer.DialContext(ctx, network, addr)
		},
		TLSClientConfig:        tlsConfig,
		TLSHandshakeTimeout:    3 * time.Second,
		ResponseHeaderTimeout:  4 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		ForceAttemptHTTP2:      true,
	}
	f.client = &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return fmt.Errorf("%w: too many redirects", ErrUpstream)
			}
			return checkURL(req.URL)
		},
	}
	return f
}

// control runs for every connection after the name is resolved: the address
// the socket is about to reach is the one checked.
func (f *Fetcher) control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return ErrBlocked
	}
	if f.allow != nil {
		if !f.allow(ap) {
			return ErrBlocked
		}
		return nil
	}
	if !Public(ap.Addr()) {
		return ErrBlocked
	}
	return nil
}

// blockedPrefixes are ranges netip's predicates do not cover.
var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),  // CGNAT
	netip.MustParsePrefix("192.0.0.0/24"),   // IETF protocol assignments
	netip.MustParsePrefix("198.18.0.0/15"),  // benchmarking
	netip.MustParsePrefix("240.0.0.0/4"),    // reserved, broadcast
	netip.MustParsePrefix("::/96"),          // IPv4-compatible ::a.b.c.d (deprecated): netip calls it global unicast
	netip.MustParsePrefix("64:ff9b:1::/48"), // local-use NAT64: the network's own translator
	netip.MustParsePrefix("2001::/32"),      // Teredo: tunnels to anywhere
	netip.MustParsePrefix("fec0::/10"),      // deprecated site-local
}

// embeddedV4 are IPv6 ranges that carry an IPv4 address: the IPv4 one is checked.
var embeddedV4 = []struct {
	prefix netip.Prefix
	at     int // byte offset of the IPv4 address
}{
	{netip.MustParsePrefix("64:ff9b::/96"), 12}, // NAT64
	{netip.MustParsePrefix("2002::/16"), 2},     // 6to4
}

// Public reports whether ip is an ordinary internet address: not loopback,
// private, link-local (cloud metadata 169.254.169.254), CGNAT, ULA,
// multicast, unspecified or reserved. IPv4-in-IPv6 is judged as IPv4.
func Public(ip netip.Addr) bool {
	ip = ip.Unmap().WithZone("")
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	if ip.Is6() {
		b := ip.As16()
		for _, e := range embeddedV4 {
			if e.prefix.Contains(ip) {
				return Public(netip.AddrFrom4([4]byte(b[e.at : e.at+4])))
			}
		}
	}
	return true
}

// checkURL allows https on the default port, without credentials.
func checkURL(u *url.URL) error {
	if u == nil || len(u.String()) > maxURLLen {
		return ErrBadURL
	}
	if u.Scheme != "https" || u.User != nil || u.Hostname() == "" {
		return ErrBadURL
	}
	if p := u.Port(); p != "" && p != "443" {
		return ErrBadURL
	}
	return nil
}

// Fetch opens the page, finds its picture and title, and downloads the picture.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (Preview, error) {
	rawURL = strings.TrimSpace(rawURL)
	if len(rawURL) > maxURLLen {
		return Preview{}, ErrBadURL
	}
	page, err := url.Parse(rawURL)
	if err != nil {
		return Preview{}, ErrBadURL
	}
	if err := checkURL(page); err != nil {
		return Preview{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resp, err := f.get(ctx, page, "text/html,application/xhtml+xml")
	if err != nil {
		return Preview{}, err
	}
	defer resp.Body.Close()
	if mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mt != "text/html" && mt != "application/xhtml+xml" {
		return Preview{}, fmt.Errorf("%w: not html", ErrUpstream)
	}
	meta, err := parse(io.LimitReader(resp.Body, maxPageBytes))
	if meta.image == "" {
		if err != nil {
			// The body stalled or broke before a picture: a timeout, not "no image".
			return Preview{}, upstream(err)
		}
		return Preview{}, ErrNoImage
	}
	// The final address after redirects is the base for a relative picture.
	imageURL, err := resp.Request.URL.Parse(meta.image)
	if err != nil || checkURL(imageURL) != nil {
		return Preview{}, ErrNoImage
	}

	img, err := f.get(ctx, imageURL, "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5")
	if err != nil {
		return Preview{}, err
	}
	defer img.Body.Close()
	data, err := io.ReadAll(io.LimitReader(img.Body, maxImageSize+1))
	if err != nil {
		return Preview{}, upstream(err)
	}
	if len(data) > maxImageSize {
		return Preview{}, ErrTooLarge
	}
	kind := http.DetectContentType(data)
	switch kind {
	case "image/jpeg", "image/png", "image/webp":
	default: // svg, gif, html error pages — not a photo
		return Preview{}, ErrNoImage
	}
	return Preview{Title: meta.title, ImageType: kind, Image: data}, nil
}

func (f *Fetcher) get(ctx context.Context, u *url.URL, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrBadURL
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, upstream(err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: status %d", ErrUpstream, resp.StatusCode)
	}
	return resp, nil
}

// upstream keeps a typed cause (blocked, bad redirect) and the timeout; the
// rest is "page unavailable".
func upstream(err error) error {
	for _, typed := range []error{ErrBlocked, ErrBadURL, ErrUpstream} {
		if errors.Is(err, typed) {
			return typed
		}
	}
	return fmt.Errorf("%w: %w", ErrUpstream, err)
}

type pageMeta struct {
	image, title string
}

// parse reads meta tags: og:image, then twitter:image, then link rel=image_src;
// og:title, then the <title> of the head. A read error other than EOF is
// returned with what was found before it.
func parse(r io.Reader) (pageMeta, error) {
	var ogImage, twImage, linkImage, ogTitle string
	var title strings.Builder
	inTitle, inBody := false, false
	var readErr error
	z := html.NewTokenizer(r)
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			if err := z.Err(); err != io.EOF {
				readErr = err
			}
			break
		}
		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "meta":
				a := attrs(z)
				key := strings.ToLower(a["property"])
				if key == "" {
					key = strings.ToLower(a["name"])
				}
				content := strings.TrimSpace(a["content"])
				switch {
				case key == "og:image" && ogImage == "":
					ogImage = content
				case key == "twitter:image" && twImage == "":
					twImage = content
				case key == "og:title" && ogTitle == "":
					ogTitle = content
				}
			case "link":
				a := attrs(z)
				if strings.EqualFold(a["rel"], "image_src") && linkImage == "" {
					linkImage = strings.TrimSpace(a["href"])
				}
			case "title":
				inTitle = !inBody && title.Len() == 0
			case "body":
				inBody = true
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); string(name) == "title" {
				inTitle = false
			}
		case html.TextToken:
			if inTitle {
				title.Write(z.Text())
			}
		}
	}
	m := pageMeta{image: firstOf(ogImage, twImage, linkImage), title: firstOf(ogTitle, title.String())}
	// Shops escape twice (Kaspi: "NanoSIM&amp;#43;eSIM"): the title is plain text, unescape once more.
	m.title = clip(shortTitle(strings.Join(strings.Fields(html.UnescapeString(m.title)), " ")), maxTitle)
	return m, readErr
}

var (
	// Shop tail: " – Магазин на Kaspi.kz", " | Shop", " - интернет-магазин …".
	shopTail = regexp.MustCompile(`(?:^|\s+)(?:[–—-]\s+(?:[Мм]агазин|[Ии]нтернет-магазин)(?:\s.*)?|\|.*)$`)
	// " в Алматы" right before the shop tail: " в " + one capitalised word.
	cityTail = regexp.MustCompile(`\s+в\s+\p{Lu}[\p{L}-]*$`)
)

// shortTitle strips shop marketing around the product name (ML-08): a leading
// "Купить", the shop tail and the city before it. Kaspi is the first case:
// "Купить Смартфон … в Алматы – Магазин на Kaspi.kz" → "Смартфон …". Nothing
// left → the title as it was.
func shortTitle(t string) string {
	s := t
	for _, p := range []string{"Купить: ", "Купить "} {
		if strings.HasPrefix(s, p) {
			s = s[len(p):]
			break
		}
	}
	if cut := shopTail.ReplaceAllString(s, ""); cut != s {
		s = cityTail.ReplaceAllString(cut, "")
	}
	if s = strings.TrimSpace(s); s == "" {
		return t
	}
	return s
}

func attrs(z *html.Tokenizer) map[string]string {
	a := map[string]string{}
	for {
		k, v, more := z.TagAttr()
		a[strings.ToLower(string(k))] = string(v)
		if !more {
			return a
		}
	}
}

func firstOf(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// clip cuts to n characters (not bytes) so Cyrillic is not broken mid-letter.
func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n]))
}

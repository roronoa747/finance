// Package fx fetches official exchange rates from the National Bank of
// Kazakhstan. The bank's site sends no CORS headers, so browsers cannot call it
// directly; the API does it for them. Ported from the Supabase Edge Function
// "fx-rate" the React app used.
package fx

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultBaseURL is the bank's RSS endpoint; it takes ?fdate=DD.MM.YYYY.
const DefaultBaseURL = "https://nationalbank.kz/rss/get_rates.cfm"

// Source is reported to the client next to the rates.
const Source = "Национальный банк РК"

// Supported lists the currencies the app offers for accounts.
var Supported = []string{"USD", "EUR", "RUB", "CNY"}

// lookbackDays covers weekends and holidays, when the bank publishes nothing.
const lookbackDays = 7

// almaty is Kazakhstan's single time zone (UTC+5); the bank dates rates by it.
var almaty = time.FixedZone("Asia/Almaty", 5*60*60)

// ErrNoRates means no rates were published for the whole lookback window.
var ErrNoRates = errors.New("курс не опубликован за последнюю неделю")

// Rates matches the frontend's FxRates: Rates[code] is tenge per one unit.
type Rates struct {
	Rates  map[string]float64 `json:"rates"`
	Date   string             `json:"date"`
	Source string             `json:"source"`
}

// Client fetches rates and caches the last successful answer for TTL.
type Client struct {
	HTTP    *http.Client
	BaseURL string
	TTL     time.Duration
	Now     func() time.Time

	mu        sync.Mutex
	cached    *Rates
	fetchedAt time.Time
}

// NewClient returns a client for the live bank with a one-hour cache.
func NewClient() *Client {
	return &Client{
		HTTP:    &http.Client{Timeout: 4 * time.Second},
		BaseURL: DefaultBaseURL,
		TTL:     time.Hour,
		Now:     time.Now,
	}
}

// Rates returns cached rates while they are fresh, otherwise asks the bank,
// stepping back a day at a time until it finds a published date.
func (c *Client) Rates(ctx context.Context) (*Rates, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.Now()
	if c.cached != nil && now.Sub(c.fetchedAt) < c.TTL {
		return c.cached, nil
	}

	today := now.In(almaty)
	for back := 0; back < lookbackDays; back++ {
		day := today.AddDate(0, 0, -back)
		all, err := c.fetchDay(ctx, day)
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			continue // the Edge Function also skipped failed days
		}

		picked := make(map[string]float64, len(Supported))
		for _, code := range Supported {
			if v, ok := all[code]; ok {
				picked[code] = v
			}
		}
		if len(picked) == 0 {
			continue
		}

		c.cached = &Rates{Rates: picked, Date: day.Format("2006-01-02"), Source: Source}
		c.fetchedAt = now
		return c.cached, nil
	}
	return nil, ErrNoRates
}

func (c *Client) fetchDay(ctx context.Context, day time.Time) (map[string]float64, error) {
	url := c.BaseURL + "?fdate=" + day.Format("02.01.2006")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "family-finance/1.0")

	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bank answered %d", res.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return ParseRates(body), nil
}

var (
	itemRe  = regexp.MustCompile(`(?s)<item>.*?</item>`)
	titleRe = regexp.MustCompile(`<title>\s*([A-Z]{3})\s*</title>`)
	descRe  = regexp.MustCompile(`<description>\s*([\d.,]+)\s*</description>`)
	quantRe = regexp.MustCompile(`<quant>\s*(\d+)\s*</quant>`)
)

// ParseRates reads the bank's RSS: <item><title>USD</title><description>447.85</description><quant>1</quant>.
// The price is for <quant> units (e.g. 10 AMD), so it is divided down to one unit.
func ParseRates(xml []byte) map[string]float64 {
	out := make(map[string]float64)
	for _, item := range itemRe.FindAll(xml, -1) {
		code := titleRe.FindSubmatch(item)
		value := descRe.FindSubmatch(item)
		if code == nil || value == nil {
			continue
		}
		num, err := strconv.ParseFloat(strings.Replace(string(value[1]), ",", ".", 1), 64)
		if err != nil || num <= 0 {
			continue
		}
		if q := quantRe.FindSubmatch(item); q != nil {
			if quant, err := strconv.Atoi(string(q[1])); err == nil && quant > 1 {
				num /= float64(quant)
			}
		}
		out[string(code[1])] = num
	}
	return out
}

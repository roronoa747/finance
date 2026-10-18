// Package ai calls Claude (Anthropic API) for the AI helper: one structured call per
// request, answer parsed from a JSON schema. Nothing here logs — not the key, not the
// request, not the answer — and errors carry only a status, never content (Р-15).
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// DefaultBaseURL is the Anthropic API.
const DefaultBaseURL = "https://api.anthropic.com/"

// DefaultTimeout bounds one call, retry included. The Vercel function gets 60 s
// (vercel.json maxDuration), so a slow model still leaves time to answer 502.
const DefaultTimeout = 45 * time.Second

// maxRetries is the SDK retry budget (5xx, network); the timeout covers it too. A 429 is not
// retried: Anthropic asks to wait (retry-after, up to a minute), longer than the call may take,
// and the wait would end as a timeout instead of ErrRateLimited.
const maxRetries = 1

var (
	// ErrRateLimited is Anthropic answering 429 after the retry.
	ErrRateLimited = errors.New("ai: rate limited")
	// ErrRefused is the model declining (stop_reason "refusal").
	ErrRefused = errors.New("ai: refused")
	// ErrFailed is everything else: 4xx/5xx, timeout, network, an answer cut by max_tokens
	// or not matching the schema.
	ErrFailed = errors.New("ai: failed")
)

// Client is a Claude client. A nil *Client means no key: AI is off.
type Client struct {
	sdk     anthropic.Client
	Timeout time.Duration
}

// New returns a client for apiKey, or nil when the key is blank. baseURL is for tests;
// blank means the live API.
func New(apiKey, baseURL string) *Client {
	if apiKey == "" {
		return nil
	}
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		sdk: anthropic.NewClient(
			option.WithAPIKey(apiKey),
			option.WithBaseURL(baseURL),
			option.WithMaxRetries(maxRetries),
			option.WithMiddleware(noRetryOn429),
		),
		Timeout: DefaultTimeout,
	}
}

// Image is one picture sent to the model, already base64-encoded.
type Image struct {
	MediaType string // image/jpeg, image/png, image/gif, image/webp
	Data      string
}

// Request is one call. Schema is the JSON schema the answer must follow (objects need
// "additionalProperties": false); Effort is low…max, blank for the model's default.
type Request struct {
	Model     string
	System    string
	Text      string
	Image     *Image
	Schema    map[string]any
	Effort    string
	MaxTokens int64
}

// Usage is what one call spent: the tokens Anthropic billed.
type Usage struct {
	Model        string
	InputTokens  int64
	OutputTokens int64
}

// Call sends req and decodes the answer into out (unknown fields are a schema miss).
// Usage is filled whenever Anthropic answered — on a refusal, a cut or an off-schema answer
// too, since those are billed (хвост §4, решение владельца 2026-10-16: расход неудачных — в
// «≈ $», а с лимитом в деньгах (Р-11 «ИИ-польза») — и в лимит); an HTTP error, timeout or
// network failure is zero.
func (c *Client) Call(ctx context.Context, req Request, out any) (Usage, error) {
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var content []anthropic.ContentBlockParamUnion
	if req.Image != nil {
		content = append(content, anthropic.NewImageBlockBase64(req.Image.MediaType, req.Image.Data))
	}
	if req.Text != "" {
		content = append(content, anthropic.NewTextBlock(req.Text))
	}
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: req.MaxTokens,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(content...)},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffort(req.Effort),
			Format: anthropic.JSONOutputFormatParam{Schema: req.Schema},
		},
	}
	if req.System != "" {
		params.System = []anthropic.TextBlockParam{{Text: req.System}}
	}

	msg, err := c.sdk.Messages.New(ctx, params)
	if err != nil {
		return Usage{}, classify(err)
	}
	usage := Usage{Model: req.Model, InputTokens: msg.Usage.InputTokens, OutputTokens: msg.Usage.OutputTokens}
	if msg.StopReason == anthropic.StopReasonRefusal {
		return usage, ErrRefused
	}
	if msg.StopReason == anthropic.StopReasonMaxTokens {
		return usage, fmt.Errorf("%w: max_tokens", ErrFailed)
	}
	var text string
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = t.Text
			break
		}
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(text)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return usage, fmt.Errorf("%w: answer off schema", ErrFailed)
	}
	return usage, nil
}

// noRetryOn429 tells the SDK not to retry a 429 (see maxRetries).
func noRetryOn429(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
	res, err := next(req)
	if err == nil && res.StatusCode == http.StatusTooManyRequests {
		res.Header.Set("x-should-retry", "false")
	}
	return res, err
}

// classify maps an SDK error to ours, keeping only the status: the SDK's own message
// carries the request URL and the response body.
func classify(err error) error {
	var apierr *anthropic.Error
	if errors.As(err, &apierr) {
		if apierr.StatusCode == 429 {
			return ErrRateLimited
		}
		return fmt.Errorf("%w: status %d", ErrFailed, apierr.StatusCode)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%w: timeout", ErrFailed)
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("%w: canceled", ErrFailed)
	}
	return fmt.Errorf("%w: network", ErrFailed)
}

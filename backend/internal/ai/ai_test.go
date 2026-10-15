package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

// fakeClaude answers /v1/messages with status and body, recording each request.
type fakeClaude struct {
	status int
	body   string
	delay  time.Duration
	calls  int
	header http.Header
	sent   map[string]any
}

func (f *fakeClaude) start(t *testing.T) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls++
		f.header = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		f.sent = nil
		_ = json.Unmarshal(raw, &f.sent)
		if f.delay > 0 {
			select {
			case <-time.After(f.delay):
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("retry-after-ms", "1")
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, f.body)
	}))
	t.Cleanup(srv.Close)
	return New("test-key", srv.URL+"/")
}

// message is a Messages API answer with one text block.
func message(stop, text string) string {
	b, _ := json.Marshal(map[string]any{
		"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
		"stop_reason": stop,
		"content":     []any{map[string]any{"type": "text", "text": text}},
		"usage":       map[string]any{"input_tokens": 12, "output_tokens": 3},
	})
	return string(b)
}

var okSchema = map[string]any{
	"type":                 "object",
	"properties":           map[string]any{"ok": map[string]any{"type": "boolean"}},
	"required":             []string{"ok"},
	"additionalProperties": false,
}

func okRequest() Request {
	return Request{Model: "claude-haiku-5-5", System: "Ответь ok.", Text: "привет", Schema: okSchema, Effort: "low", MaxTokens: 64}
}

type okAnswer struct {
	OK bool `json:"ok"`
}

func TestNewWithoutKeyIsNil(t *testing.T) {
	if New("", "") != nil {
		t.Fatal("no key must mean no client")
	}
}

func TestCallSendsOnlyTheRequest(t *testing.T) {
	f := &fakeClaude{status: 200, body: message("end_turn", `{"ok":true}`)}
	c := f.start(t)

	var out okAnswer
	u, err := c.Call(context.Background(), okRequest(), &out)
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if !out.OK {
		t.Error("answer not decoded")
	}
	if u != (Usage{Model: "claude-haiku-5-5", InputTokens: 12, OutputTokens: 3}) {
		t.Errorf("usage = %+v", u)
	}
	if f.header.Get("x-api-key") != "test-key" {
		t.Error("key must go in x-api-key")
	}
	if f.header.Get("anthropic-version") == "" {
		t.Error("anthropic-version header missing")
	}

	// The body holds what the caller gave and nothing else (Р-15).
	keys := make([]string, 0, len(f.sent))
	for k := range f.sent {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"max_tokens", "messages", "model", "output_config", "system"}; !slices.Equal(keys, want) {
		t.Fatalf("body keys = %v, want %v", keys, want)
	}
	if f.sent["model"] != "claude-haiku-5-5" || f.sent["max_tokens"] != float64(64) {
		t.Errorf("model/max_tokens = %v/%v", f.sent["model"], f.sent["max_tokens"])
	}
	sys, _ := json.Marshal(f.sent["system"])
	if string(sys) != `[{"text":"Ответь ok.","type":"text"}]` {
		t.Errorf("system = %s", sys)
	}
	msgs, _ := json.Marshal(f.sent["messages"])
	if string(msgs) != `[{"content":[{"text":"привет","type":"text"}],"role":"user"}]` {
		t.Errorf("messages = %s", msgs)
	}
	oc, _ := json.Marshal(f.sent["output_config"])
	want := `{"effort":"low","format":{"schema":{"additionalProperties":false,"properties":{"ok":{"type":"boolean"}},"required":["ok"],"type":"object"},"type":"json_schema"}}`
	if string(oc) != want {
		t.Errorf("output_config = %s", oc)
	}
}

func TestCallSendsImageBeforeText(t *testing.T) {
	f := &fakeClaude{status: 200, body: message("end_turn", `{"ok":true}`)}
	c := f.start(t)
	req := okRequest()
	req.System = ""
	req.Image = &Image{MediaType: "image/png", Data: "aGk="}

	var out okAnswer
	if _, err := c.Call(context.Background(), req, &out); err != nil {
		t.Fatalf("call: %v", err)
	}
	if _, ok := f.sent["system"]; ok {
		t.Error("blank system must not be sent")
	}
	msgs, _ := json.Marshal(f.sent["messages"])
	want := `[{"content":[{"source":{"data":"aGk=","media_type":"image/png","type":"base64"},"type":"image"},{"text":"привет","type":"text"}],"role":"user"}]`
	if string(msgs) != want {
		t.Errorf("messages = %s", msgs)
	}
}

func TestCallErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"429", 429, `{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`, ErrRateLimited},
		{"500", 500, `{"type":"error","error":{"type":"api_error","message":"boom"}}`, ErrFailed},
		{"400", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}`, ErrFailed},
		{"refusal", 200, message("refusal", ""), ErrRefused},
		{"max_tokens", 200, message("max_tokens", `{"ok":`), ErrFailed},
		{"not json", 200, message("end_turn", "ok"), ErrFailed},
		{"off schema", 200, message("end_turn", `{"ok":true,"extra":1}`), ErrFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeClaude{status: tc.status, body: tc.body}
			c := f.start(t)
			var out okAnswer
			u, err := c.Call(context.Background(), okRequest(), &out)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if u != (Usage{}) {
				t.Errorf("failure must not report usage: %+v", u)
			}
			// Errors carry no content: neither the prompt nor the provider's message.
			for _, leak := range []string{"привет", "Ответь", "slow down", "boom", "test-key", "127.0.0.1"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("error %q leaks %q", err, leak)
				}
			}
		})
	}
}

func TestCallRetriesOnce(t *testing.T) {
	f := &fakeClaude{status: 500, body: `{"type":"error","error":{"type":"api_error","message":"boom"}}`}
	c := f.start(t)
	var out okAnswer
	_, _ = c.Call(context.Background(), okRequest(), &out)
	if f.calls != 2 {
		t.Errorf("calls = %d, want 2 (one retry)", f.calls)
	}
}

// A 429 asking to wait half a minute answers ErrRateLimited at once: no retry, no sleep into the
// call's deadline (which would end as a timeout).
func TestCall429IsNotRetried(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("retry-after", "30")
		w.WriteHeader(429)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`)
	}))
	t.Cleanup(srv.Close)
	c := New("test-key", srv.URL+"/")
	c.Timeout = 2 * time.Second

	start := time.Now()
	var out okAnswer
	_, err := c.Call(context.Background(), okRequest(), &out)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1 (429 is not retried)", calls)
	}
	if took := time.Since(start); took > time.Second {
		t.Errorf("took %v, a 429 must answer at once", took)
	}
}

// A blank Effort leaves the model's default: the field is not sent at all.
func TestCallBlankEffortIsOmitted(t *testing.T) {
	f := &fakeClaude{status: 200, body: message("end_turn", `{"ok":true}`)}
	c := f.start(t)
	req := okRequest()
	req.Effort = ""
	var out okAnswer
	if _, err := c.Call(context.Background(), req, &out); err != nil {
		t.Fatalf("call: %v", err)
	}
	if oc, _ := f.sent["output_config"].(map[string]any); oc == nil || oc["effort"] != nil || oc["format"] == nil {
		t.Errorf("output_config = %v, want format without effort", f.sent["output_config"])
	}
}

func TestCallTimeout(t *testing.T) {
	f := &fakeClaude{status: 200, body: message("end_turn", `{"ok":true}`), delay: 2 * time.Second}
	c := f.start(t)
	c.Timeout = 100 * time.Millisecond

	start := time.Now()
	var out okAnswer
	_, err := c.Call(context.Background(), okRequest(), &out)
	if !errors.Is(err, ErrFailed) {
		t.Fatalf("err = %v, want ErrFailed", err)
	}
	// One deadline covers the retry too.
	if took := time.Since(start); took > time.Second {
		t.Errorf("took %v, the timeout must bound the whole call", took)
	}
}

func TestCostMicros(t *testing.T) {
	cases := []struct {
		u    Usage
		want int64
	}{
		{Usage{Model: "claude-opus-5-5", InputTokens: 1_000_000, OutputTokens: 100_000}, 6_000_000},
		{Usage{Model: "claude-haiku-5-5", InputTokens: 10_000, OutputTokens: 2_000}, 2_000},
		{Usage{Model: "claude-unknown", InputTokens: 10_000, OutputTokens: 2_000}, 0},
	}
	for _, tc := range cases {
		if got := CostMicros(tc.u); got != tc.want {
			t.Errorf("CostMicros(%+v) = %d, want %d", tc.u, got, tc.want)
		}
	}
}

// TestLiveCall hits the real API: AI_LIVE=1 and ANTHROPIC_API_KEY (memory/secrets/anthropic.md).
func TestLiveCall(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" || os.Getenv("AI_LIVE") != "1" {
		t.Skip("live call: set AI_LIVE=1 and ANTHROPIC_API_KEY")
	}
	var out okAnswer
	u, err := New(key, "").Call(context.Background(), okRequest(), &out)
	if err != nil {
		t.Fatalf("live call: %v", err)
	}
	if u.InputTokens == 0 || u.OutputTokens == 0 {
		t.Errorf("usage = %+v", u)
	}
}

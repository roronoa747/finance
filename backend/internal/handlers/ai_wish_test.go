package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"finance-backend/internal/ai"
)

// Pictures by signature: only the first bytes are checked.
var (
	wishJPEG = append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{1}, 60)...)
	wishPNG  = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{2}, 60)...)
	wishWEBP = append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), bytes.Repeat([]byte{3}, 60)...)
)

func wishBody(typ string, data []byte) string {
	b, _ := json.Marshal(map[string]string{"image": base64.StdEncoding.EncodeToString(data), "type": typ})
	return string(b)
}

func decodeWish(t *testing.T, rec *httptest.ResponseRecorder) WishAnswer {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var got WishAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

// The instruction (Р-6): one product, a short Russian title, the price only in tenge as printed, a box in fractions.
func TestWishSystem(t *testing.T) {
	for _, want := range []string{"один главный товар", "по-русски", "только если она в тенге", "Ничего не пересчитывай", "не зачёркнутая", "в долях"} {
		if !strings.Contains(wishSystem, want) {
			t.Errorf("wishSystem has no %q", want)
		}
	}
}

// The model gets the instruction and one image block with the picture sent — nothing else (Р-15).
func TestWishSendsOnlyInstructionAndImage(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{`{"title":"Пылесос Dyson V15","price":329990,"box":{"x":0.1,"y":0.2,"w":0.8,"h":0.4}}`}}, true)
	rec := f.postTo(t, "/api/ai/wish", f.member, wishBody("image/png", wishPNG))
	got := decodeWish(t, rec)

	if len(f.claude.sent) != 1 {
		t.Fatalf("calls = %d, want 1", len(f.claude.sent))
	}
	sent := f.claude.sent[0]
	keys := make([]string, 0, len(sent))
	for k := range sent {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"max_tokens", "messages", "model", "output_config", "system"}; !slices.Equal(keys, want) {
		t.Fatalf("body keys = %v, want %v", keys, want)
	}
	sys, _ := json.Marshal(sent["system"])
	wantSys, _ := json.Marshal([]any{map[string]any{"text": wishSystem, "type": "text"}})
	if !bytes.Equal(sys, wantSys) {
		t.Errorf("system = %s", sys)
	}
	msgs, _ := json.Marshal(sent["messages"])
	wantMsgs, _ := json.Marshal([]any{map[string]any{"role": "user", "content": []any{map[string]any{
		"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": base64.StdEncoding.EncodeToString(wishPNG)},
	}}}})
	if !bytes.Equal(msgs, wantMsgs) {
		t.Errorf("messages = %s\nwant %s", msgs, wantMsgs)
	}
	raw, _ := json.Marshal(sent)
	for _, leak := range []string{f.family, "a@example.com", "2026-10"} {
		if bytes.Contains(raw, []byte(leak)) {
			t.Errorf("request leaks %q", leak)
		}
	}
	if sent["model"] != "claude-opus-5-5" {
		t.Errorf("model = %v", sent["model"])
	}
	if oc, _ := sent["output_config"].(map[string]any); oc["effort"] != "low" {
		t.Errorf("effort = %v", oc["effort"])
	}

	if got.Title == nil || *got.Title != "Пылесос Dyson V15" || got.Price == nil || *got.Price != 329990 ||
		got.Box == nil || *got.Box != (WishBox{0.1, 0.2, 0.8, 0.4}) {
		t.Errorf("answer = %s", rec.Body.String())
	}
	if u := f.usage(); u.Requests != 1 || u.CostMicros != ai.CostMicros(ai.Usage{Model: "claude-opus-5-5", InputTokens: 1000, OutputTokens: 200}) {
		t.Errorf("usage = %+v", u)
	}
}

// What the phone must not take is null; the title is cut to 80 characters.
func TestWishAnswerChecked(t *testing.T) {
	long := strings.Repeat("Пылесос ", 15)
	for _, tc := range []struct {
		name, answer string
		check        func(WishAnswer) bool
	}{
		{"all null", `{"title":null,"price":null,"box":null}`, func(a WishAnswer) bool { return a.Title == nil && a.Price == nil && a.Box == nil }},
		{"price 0", `{"title":"Чайник","price":0,"box":null}`, func(a WishAnswer) bool { return a.Price == nil && *a.Title == "Чайник" }},
		{"price negative", `{"title":"Чайник","price":-5,"box":null}`, func(a WishAnswer) bool { return a.Price == nil }},
		{"price above a billion", `{"title":"Яхта","price":1000000001,"box":null}`, func(a WishAnswer) bool { return a.Price == nil }},
		{"price a billion", `{"title":"Яхта","price":1000000000,"box":null}`, func(a WishAnswer) bool { return a.Price != nil && *a.Price == 1_000_000_000 }},
		{"blank title", `{"title":"   ","price":5000,"box":null}`, func(a WishAnswer) bool { return a.Title == nil && *a.Price == 5000 }},
		{"long title", `{"title":"` + long + `","price":null,"box":null}`, func(a WishAnswer) bool {
			return a.Title != nil && len([]rune(*a.Title)) <= 80 && strings.HasPrefix(long, *a.Title)
		}},
		{"box outside", `{"title":"A","price":null,"box":{"x":0.5,"y":0.1,"w":0.6,"h":0.5}}`, func(a WishAnswer) bool { return a.Box == nil }},
		{"box negative", `{"title":"A","price":null,"box":{"x":-0.1,"y":0.1,"w":0.5,"h":0.5}}`, func(a WishAnswer) bool { return a.Box == nil }},
		{"box above 1", `{"title":"A","price":null,"box":{"x":0,"y":0,"w":1.2,"h":0.5}}`, func(a WishAnswer) bool { return a.Box == nil }},
		{"box thin", `{"title":"A","price":null,"box":{"x":0.1,"y":0.1,"w":0.05,"h":0.5}}`, func(a WishAnswer) bool { return a.Box == nil }},
		{"box whole picture", `{"title":"A","price":null,"box":{"x":0,"y":0,"w":1,"h":1}}`, func(a WishAnswer) bool { return a.Box != nil }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{tc.answer}}, true)
			rec := f.postTo(t, "/api/ai/wish", f.member, wishBody("image/jpeg", wishJPEG))
			if got := decodeWish(t, rec); !tc.check(got) {
				t.Errorf("answer = %s", rec.Body.String())
			}
		})
	}
}

func TestWishGuard(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{`{"title":null,"price":null,"box":null}`}}, true)
	big := strings.Repeat("A", 3<<20)
	for name, tc := range map[string]struct {
		body string
		want int
	}{
		"not a picture":     {wishBody("image/jpeg", []byte("hello, this is text")), http.StatusBadRequest},
		"png sent as jpeg":  {wishBody("image/jpeg", wishPNG), http.StatusBadRequest},
		"type outside list": {wishBody("image/gif", []byte("GIF89a......")), http.StatusBadRequest},
		"no type":           {wishBody("", wishJPEG), http.StatusBadRequest},
		"empty image":       {wishBody("image/jpeg", nil), http.StatusBadRequest},
		"not base64":        {`{"image":"@@@not base64@@@","type":"image/jpeg"}`, http.StatusBadRequest},
		"extra field":       {`{"image":"` + base64.StdEncoding.EncodeToString(wishJPEG) + `","type":"image/jpeg","note":"x"}`, http.StatusBadRequest},
		"not json":          {`not json`, http.StatusBadRequest},
		"larger than 3 MB":  {`{"image":"` + big + `","type":"image/jpeg"}`, http.StatusRequestEntityTooLarge},
	} {
		if rec := f.postTo(t, "/api/ai/wish", f.member, tc.body); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", name, rec.Code, tc.want, rec.Body.String())
		}
	}
	if len(f.claude.sent) != 0 {
		t.Errorf("calls = %d: a bad body must not reach the model", len(f.claude.sent))
	}
	for _, ok := range []string{wishBody("image/jpeg", wishJPEG), wishBody("image/webp", wishWEBP), wishBody("image/png", wishPNG)} {
		if rec := f.postTo(t, "/api/ai/wish", f.member, ok); rec.Code != http.StatusOK {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	}
}

func TestWishGate(t *testing.T) {
	body := wishBody("image/jpeg", wishJPEG)
	ok := `{"title":null,"price":null,"box":null}`
	t.Run("viewer 403", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{ok}}, true)
		if rec := f.postTo(t, "/api/ai/wish", f.viewer, body); rec.Code != http.StatusForbidden {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("viewer must not reach the model")
		}
	})
	t.Run("no key 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{}, false)
		if rec := f.postTo(t, "/api/ai/wish", f.member, body); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("family off 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{ok}}, true)
		_ = f.aiRepo.SetEnabled(context.Background(), f.family, false)
		if rec := f.postTo(t, "/api/ai/wish", f.member, body); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("limit 429", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{ok}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 3, 0, 0, f.limit)
		if rec := f.postTo(t, "/api/ai/wish", f.member, body); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"ai_limit"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("over the limit must not reach the model")
		}
	})
	t.Run("model error 502 without spend", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{status: 500}, true)
		if rec := f.postTo(t, "/api/ai/wish", f.member, body); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if _, ok := f.aiRepo.Usage[f.family]; ok {
			t.Errorf("an unbilled failure must not write usage: %+v", f.usage())
		}
	})
	t.Run("off-schema 502, tokens billed, no request", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{`{"title":"A","price":1,"box":null,"note":"x"}`}}, true)
		if rec := f.postTo(t, "/api/ai/wish", f.member, body); rec.Code != http.StatusBadGateway {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if u := f.usage(); u.Requests != 0 || u.InputTokens != 1000 {
			t.Errorf("usage = %+v, want 0 requests and the billed tokens", u)
		}
	})
}

// TestLiveWish asks the real API: AI_LIVE=1, ANTHROPIC_API_KEY (memory/secrets/anthropic.md),
// AI_LIVE_SHOTS — a folder of screenshots (.jpg/.jpeg/.png/.webp; not in git). It logs the time and the answer.
func TestLiveWish(t *testing.T) {
	key, dir := os.Getenv("ANTHROPIC_API_KEY"), os.Getenv("AI_LIVE_SHOTS")
	if key == "" || dir == "" || os.Getenv("AI_LIVE") != "1" {
		t.Skip("live wish: set AI_LIVE=1, ANTHROPIC_API_KEY and AI_LIVE_SHOTS")
	}
	types := map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		typ, ok := types[strings.ToLower(filepath.Ext(e.Name()))]
		if !ok {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		f := newReviewFixture(t, &fakeClaudeQueue{}, false)
		f.wish.gate.client = ai.New(key, "")
		start := time.Now()
		rec := f.postTo(t, "/api/ai/wish", f.member, wishBody(typ, data))
		u := f.usage()
		t.Logf("%s: %d in %v (%d in, %d out, %d µ$) %s", e.Name(), rec.Code, time.Since(start).Round(100*time.Millisecond),
			u.InputTokens, u.OutputTokens, u.CostMicros, strings.TrimSpace(rec.Body.String()))
	}
}

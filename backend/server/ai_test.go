package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/fx"
	"finance-backend/internal/handlers"
	"finance-backend/internal/repository"
)

// Р-2 at the router: without ANTHROPIC_API_KEY AI is off everywhere, even for a family the
// owner turned it on for; with the key the family's flag decides.
func TestAIOffWithoutKey(t *testing.T) {
	for _, tc := range []struct {
		name, key string
		wantAI    bool
		wantKey   string
	}{
		{"no key", "", false, `"key":false`},
		{"key", "test-key", true, `"key":true`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mocks := repository.NewMockRepositories()
			mocks.Households.SetDocRepo(mocks.Docs)
			aiRepo := repository.NewMockAIRepo(mocks.Households, mocks.Users)
			cfg := devConfig()
			cfg.AdminEmails = []string{"dana@example.com"}
			cfg.AnthropicAPIKey = tc.key
			cfg.AIMonthlyLimitMicros = 2_000_000
			tokens := auth.NewTokenService(cfg.JWTSecret, time.Hour)
			r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx,
				Accounts: repository.NewMockAccountRepo(mocks), Events: &repository.MockEventRepo{}, Metrics: repository.MockMetricsRepo{}, AI: aiRepo}, tokens, fx.NewClient(), fakeGoogle{})
			a := &googleApp{r: r, mocks: mocks, tokens: tokens}

			_, dana := a.google(t, "id:sub-dana:dana@example.com")
			rec := a.do(t, http.MethodPost, "/api/household", dana.Token, map[string]string{"display_name": "Дана"})
			var hh handlers.AuthResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &hh); err != nil || hh.Household == nil {
				t.Fatalf("create household: %d %s", rec.Code, rec.Body.String())
			}
			if err := aiRepo.SetEnabled(context.Background(), hh.Household.ID, true); err != nil {
				t.Fatal(err)
			}

			rec = a.do(t, http.MethodGet, "/api/auth/me", hh.Token, nil)
			var me struct {
				AI bool `json:"ai"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil || me.AI != tc.wantAI {
				t.Errorf("/auth/me: %d %s, want ai %v", rec.Code, rec.Body.String(), tc.wantAI)
			}
			if rec := a.do(t, http.MethodGet, "/api/admin/families", hh.Token, nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), tc.wantKey) {
				t.Errorf("/admin/families: %d %s, want %s", rec.Code, rec.Body.String(), tc.wantKey)
			}
			if tc.key == "" {
				if rec := a.do(t, http.MethodPost, "/api/admin/ai-check", hh.Token, nil); !strings.Contains(rec.Body.String(), `"no_key"`) {
					t.Errorf("/admin/ai-check: %d %s, want no_key", rec.Code, rec.Body.String())
				}
			}
			// Разбор месяца (AI-08) — в семейной группе за гейтом: без ключа 503 ai_off; с ключом гейт
			// пропускает member, и битое тело — 400 до модели (сети в тесте нет).
			wantReview := http.StatusBadRequest
			if tc.key == "" {
				wantReview = http.StatusServiceUnavailable
			}
			if rec := a.do(t, http.MethodPost, "/api/ai/review", hh.Token, map[string]any{"summary": []int{1}}); rec.Code != wantReview {
				t.Errorf("/ai/review: %d %s, want %d", rec.Code, rec.Body.String(), wantReview)
			}
			// Продавцы (AI-11) — тот же гейт; название с 6+ цифрами — 400 до модели.
			if rec := a.do(t, http.MethodPost, "/api/ai/sellers", hh.Token, map[string]any{"names": []string{"KASPI 1234567"}, "categories": []map[string]string{{"id": "sc_food", "name": "Продукты"}}}); rec.Code != wantReview {
				t.Errorf("/ai/sellers: %d %s, want %d", rec.Code, rec.Body.String(), wantReview)
			}
		})
	}
}

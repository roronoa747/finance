package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"finance-backend/internal/ai"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// AIGate is the common check of the AI endpoints (бэклог «ИИ», контракт §6; AI-11 and AI-14
// reuse it): no key or the family's flag off → 503 ai_off; not a member → 403; the month's
// money limit spent → 429 ai_limit. The endpoint decodes its body after Open and records the
// spend with Spend.
type AIGate struct {
	repo   repository.AIRepository // nil: AI is off (a router without the AI repository)
	client *ai.Client              // nil: no ANTHROPIC_API_KEY
	limit  int64                   // micro-dollars a family may spend per Almaty month (Р-11)
	now    func() time.Time
}

func NewAIGate(repo repository.AIRepository, client *ai.Client, limitMicros int64) *AIGate {
	return &AIGate{repo: repo, client: client, limit: limitMicros, now: time.Now}
}

// aiCall is one opened request: the family and the Almaty month it is counted in.
type aiCall struct {
	household string
	month     string
}

// Open runs the checks in the contract's order; false means it has answered.
func (g *AIGate) Open(w http.ResponseWriter, r *http.Request) (aiCall, bool) {
	household, _, ok := caller(w, r)
	if !ok {
		return aiCall{}, false
	}
	if g.client == nil || g.repo == nil {
		errorJSON(w, http.StatusServiceUnavailable, "ai_off")
		return aiCall{}, false
	}
	on, err := g.repo.Enabled(r.Context(), household)
	if err != nil {
		log.Printf("ai gate: flag: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read ai flag")
		return aiCall{}, false
	}
	if !on {
		errorJSON(w, http.StatusServiceUnavailable, "ai_off")
		return aiCall{}, false
	}
	if role, _ := auth.GetRole(r.Context()); role != "member" {
		errorJSON(w, http.StatusForbidden, "forbidden: only members can use ai")
		return aiCall{}, false
	}
	month := ai.MonthKey(g.now())
	spent, err := g.repo.Spent(r.Context(), household, month)
	if err != nil {
		log.Printf("ai gate: usage: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read ai usage")
		return aiCall{}, false
	}
	if ai.LimitReached(spent, g.limit) {
		errorJSON(w, http.StatusTooManyRequests, "ai_limit")
		return aiCall{}, false
	}
	return aiCall{household: household, month: month}, true
}

// Spend records what the call's attempts cost: one request of the limit on success (Р-14),
// none on a failure — but the tokens Anthropic billed go into «≈ $» either way (хвост §4,
// владелец 2026-10-16). The answer is not held back by a failed write: it is logged.
func (g *AIGate) Spend(ctx context.Context, c aiCall, ok bool, usages ...ai.Usage) {
	var in, out, cost int64
	for _, u := range usages {
		in += u.InputTokens
		out += u.OutputTokens
		cost += ai.CostMicros(u)
	}
	requests := 0
	if ok {
		requests = 1
	}
	if requests == 0 && in == 0 && out == 0 {
		return
	}
	// The request may be gone (the phone closed the sheet): the spend is still the family's.
	if err := g.repo.AddUsage(context.WithoutCancel(ctx), c.household, c.month, requests, in, out, cost); err != nil {
		log.Printf("ai gate: add usage: %v", err)
	}
}

// maxReviewBody bounds POST /api/ai/review: the AI-07 summary is a few KB.
const maxReviewBody = 32 << 10

// reviewDeadline is the whole review, the strict retry included: the Vercel function has 60 s
// (vercel.json), each call is bounded by ai.DefaultTimeout as well.
const reviewDeadline = 55 * time.Second

// reviewScreens are the screens a step may link to (§6 индекса); anything else becomes null.
var reviewScreens = []string{"/", "/week", "/month", "/money", "/money/debts", "/money/history", "/wishes", "/settings"}

// reviewSystem is the fixed instruction of the month review (Р-3, Р-4). The server adds
// nothing else to what the phone sent — no ids, emails or dates (Р-15).
const reviewSystem = `Ты — семейный финансовый помощник в приложении для семейного бюджета. Тебе дают сводку месяца семьи в JSON. Все суммы — в тенге, целыми числами; ratePercent — годовая ставка долга в процентах. Люди названы «участник 1», «участник 2».

Поля сводки: month — месяц; daysToPayday — дней до ближайшей зарплаты; income — доход месяца (byPerson — по участникам); dues — платежи месяца; spend.total — план трат, spend.fact — потрачено по выпискам (null — выписок нет), spend.byCategory — потрачено по разделам (вместе — spend.fact); free — свободно до взносов в цели по плану: доход минус платежи и план трат (меньше нуля — не хватает); rest — «Остаётся» на экране: что остаётся после взносов в цели (слово «остаётся» — только для rest, free называй «свободно до целей»); short — не хватает на платежи и траты; saved — уже отложено в этом месяце в цели и фонды и внесено досрочно в долги; debts — долги: left — остаток, payment — платёж в месяц, endMonth — месяц последнего платежа; prepay — досрочка в долг по плану месяца, она уже идёт (null — нет): monthlyPut — сколько план отводит в этом месяце, doneMonth — когда закроем с ней; goals — цели и фонды: want — сколько собрать, have — уже собрано, monthlyPut — сколько план отводит цели в этом месяце (это ещё не значит, что отложено: отложенное — в saved), doneMonth — когда соберём (null — не соберём), paused — на паузе, afterPlan — на паузе ради плана «Сначала долги»: соберём после него.

Напиши короткий разбор месяца по-русски от лица семьи — «мы»:
- good — что хорошо: одно предложение до 12 слов и одно число;
- risk — где риск: одно предложение до 12 слов и одно число;
- steps — 2–3 конкретных шага, каждый до 6 слов и без чисел (числа человек увидит на экране шага).
Без упрёков и оценок людей. Не сравнивай участников между собой и не называй их. Не пиши названия полей сводки и нулевые суммы — вместо «отложено 0» скажи «пока ничего не отложили».

Числа. Ничего не вычисляй и не вводи новых чисел: ни сумм, ни разниц, ни процентов, ни долей, ни округлений. Каждое число в тексте бери из сводки и пиши так же, как в ней (разряды тысяч — через пробел). Месяц пиши словом с годом («к июню 2028»). Если для мысли нужно число, которого в сводке нет, скажи её без числа.

screen — экран, где сделать шаг: "/month" — план месяца (платежи, траты, взносы в цели), "/money/debts" — долги, "/" — мечты и цели, "/wishes" — желания, "/money" — деньги и счета, "/money/history" — прошлые месяцы, "/week" — траты недели, "/settings" — настройки; null — если подходящего экрана нет.`

// reviewRetry is added to the instruction when the first answer had numbers the summary has not.
const reviewRetry = "\n\nВ прошлом ответе были числа, которых нет во входе: %s. Используй только числа входа."

// reviewSchema is the whole answer (structured outputs: every object closes its properties;
// the API takes no array bounds — 2–3 steps are checked here).
var reviewSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"good": map[string]any{"type": "string"},
		"risk": map[string]any{"type": "string"},
		"steps": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text": map[string]any{"type": "string"},
					"screen": map[string]any{"anyOf": []any{
						map[string]any{"type": "string", "enum": reviewScreens},
						map[string]any{"type": "null"},
					}},
				},
				"required":             []string{"text", "screen"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"good", "risk", "steps"},
	"additionalProperties": false,
}

// ReviewStep is one step of the review; Screen is a path of reviewScreens or null.
type ReviewStep struct {
	Text   string  `json:"text"`
	Screen *string `json:"screen"`
}

// ReviewAnswer is the model's answer and the endpoint's 200.
type ReviewAnswer struct {
	Good  string       `json:"good"`
	Risk  string       `json:"risk"`
	Steps []ReviewStep `json:"steps"`
}

func (a ReviewAnswer) texts() []string {
	t := []string{a.Good, a.Risk}
	for _, s := range a.Steps {
		t = append(t, s.Text)
	}
	return t
}

// usable: something in every part. More than 3 steps are cut, not a defect.
func (a ReviewAnswer) usable() bool {
	if strings.TrimSpace(a.Good) == "" || strings.TrimSpace(a.Risk) == "" || len(a.Steps) == 0 {
		return false
	}
	for _, s := range a.Steps {
		if strings.TrimSpace(s.Text) == "" {
			return false
		}
	}
	return true
}

// AIReviewHandler is POST /api/ai/review (бэклог «ИИ», AI-08).
type AIReviewHandler struct {
	gate   *AIGate
	model  string
	effort string
}

func NewAIReviewHandler(gate *AIGate, model string) *AIReviewHandler {
	return &AIReviewHandler{gate: gate, model: model, effort: "medium"}
}

// Review — {summary} → {good, risk, steps[{text, screen|null}]}. Only the summary (as JSON text)
// and the fixed instruction go to the model. An answer with a number the summary has not is
// asked again once with the numbers named; a second defect is 502 ai_failed (Р-3). Nothing of
// the body or the answer is logged.
func (h *AIReviewHandler) Review(w http.ResponseWriter, r *http.Request) {
	call, ok := h.gate.Open(w, r)
	if !ok {
		return
	}
	var req struct {
		Summary json.RawMessage `json:"summary"`
	}
	if !decodeStrictJSONBody(w, r, maxReviewBody, &req) {
		return
	}
	var text bytes.Buffer
	if err := json.Compact(&text, req.Summary); err != nil || !bytes.HasPrefix(text.Bytes(), []byte("{")) {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	dec := json.NewDecoder(bytes.NewReader(text.Bytes()))
	dec.UseNumber()
	var summary any
	if err := dec.Decode(&summary); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), reviewDeadline)
	defer cancel()
	system := reviewSystem
	var usages []ai.Usage
	for attempt := 0; attempt < 2; attempt++ {
		var answer ReviewAnswer
		u, err := h.gate.client.Call(ctx, ai.Request{
			Model: h.model, System: system, Text: text.String(), Schema: reviewSchema, Effort: h.effort, MaxTokens: 16_000,
		}, &answer)
		usages = append(usages, u)
		if err != nil || !answer.usable() {
			break
		}
		bad := ai.CheckNumbers(answer.texts(), summary)
		if len(bad) == 0 {
			h.gate.Spend(r.Context(), call, true, usages...)
			respondJSON(w, http.StatusOK, answer.clean())
			return
		}
		system = reviewSystem + fmt.Sprintf(reviewRetry, strings.Join(bad, "; "))
	}
	h.gate.Spend(r.Context(), call, false, usages...)
	errorJSON(w, http.StatusBadGateway, "ai_failed")
}

// clean keeps at most 3 steps and drops a screen outside the list (the text stays).
func (a ReviewAnswer) clean() ReviewAnswer {
	if len(a.Steps) > 3 {
		a.Steps = a.Steps[:3]
	}
	steps := make([]ReviewStep, len(a.Steps))
	for i, s := range a.Steps {
		if s.Screen != nil && !slices.Contains(reviewScreens, *s.Screen) {
			s.Screen = nil
		}
		steps[i] = s
	}
	a.Steps = steps
	return a
}

// Bounds of POST /api/ai/sellers (AI-11): one batch «Без раздела» of a statement.
const (
	maxSellersBody       = 16 << 10
	maxSellerNames       = 50
	maxSellerNameRunes   = 80
	maxSellersCategories = 40
)

// sellersSystem is the fixed instruction of the seller suggestions (Р-5). Only the names and the
// family's sections go with it — no sums, dates or ids (Р-15).
const sellersSystem = `Ты раскладываешь траты семьи по разделам бюджета. Тебе дают JSON: names — названия продавцов и сервисов из банковских выписок Казахстана (Kaspi, Freedom и другие банки; названия бывают латиницей, сокращены, с правовой формой ТОО или ИП и городом), categories — разделы трат семьи: id и название.

Для каждого названия из names верни один элемент items в том же порядке: name — название ровно как во входе, categoryId — id подходящего раздела из categories. Если не знаешь, что это за продавец, или ни один раздел не подходит, — categoryId: null; лучше null, чем догадка. Переводы на карту или счёт, возвраты, возмещения и кешбэк — тоже null: по названию не понять, чьи это деньги. Бери только id из categories, новых разделов не придумывай. «ИП», «IP», «ТОО», «TOO» в начале — форма предприятия: суди по словам после неё. Слова в названии подсказывают: FARM, PHARM, APTEKA, DARIKHANA — аптека; MARKET, MART, SUPERMARKET — продукты; RESTAURANT, CAFE, COFFEE — кафе.`

// sellersSchema is the answer (structured outputs; the count of items is checked here).
var sellersSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"items": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{"type": "string"},
					"categoryId": map[string]any{"anyOf": []any{
						map[string]any{"type": "string"},
						map[string]any{"type": "null"},
					}},
				},
				"required":             []string{"name", "categoryId"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []string{"items"},
	"additionalProperties": false,
}

// SellerCategory is one section of the family as the phone sends it.
type SellerCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SellerSuggestion is the section suggested for a name; CategoryID is null when the model is not sure.
type SellerSuggestion struct {
	Name       string  `json:"name"`
	CategoryID *string `json:"categoryId"`
}

// sellersInput is what goes to the model, and only it.
type sellersInput struct {
	Names      []string         `json:"names"`
	Categories []SellerCategory `json:"categories"`
}

// valid: 1…50 distinct names of ≤ 80 characters without 6+ digits (the phone's `sanitize` guard,
// repeated as for operations — `longDigits`, statements.go), 1…40 sections with id and name.
func (in sellersInput) valid() bool {
	if len(in.Names) == 0 || len(in.Names) > maxSellerNames || len(in.Categories) == 0 || len(in.Categories) > maxSellersCategories {
		return false
	}
	seen := map[string]bool{}
	for _, n := range in.Names {
		if strings.TrimSpace(n) == "" || utf8.RuneCountInString(n) > maxSellerNameRunes || longDigits.MatchString(n) || seen[n] {
			return false
		}
		seen[n] = true
	}
	ids := map[string]bool{}
	for _, c := range in.Categories {
		if strings.TrimSpace(c.ID) == "" || strings.TrimSpace(c.Name) == "" || ids[c.ID] {
			return false
		}
		ids[c.ID] = true
	}
	return true
}

// AISellersHandler is POST /api/ai/sellers (бэклог «ИИ», AI-11).
type AISellersHandler struct {
	gate   *AIGate
	model  string
	effort string
}

func NewAISellersHandler(gate *AIGate, model string) *AISellersHandler {
	return &AISellersHandler{gate: gate, model: model, effort: "low"}
}

// Sellers — {names, categories} → {items: [{name, categoryId|null}]} in the order of names. One
// batch is one request of the limit (Р-14); nothing is applied here — the phone shows the
// suggestions and the person accepts each (Р-5). Nothing of the body or the answer is logged.
func (h *AISellersHandler) Sellers(w http.ResponseWriter, r *http.Request) {
	call, ok := h.gate.Open(w, r)
	if !ok {
		return
	}
	var in sellersInput
	if !decodeStrictJSONBody(w, r, maxSellersBody, &in) {
		return
	}
	if !in.valid() {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var text bytes.Buffer
	enc := json.NewEncoder(&text)
	enc.SetEscapeHTML(false) // «Cash&Carry» as printed, not &
	if err := enc.Encode(in); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var answer struct {
		Items []SellerSuggestion `json:"items"`
	}
	u, err := h.gate.client.Call(r.Context(), ai.Request{
		Model: h.model, System: sellersSystem, Text: strings.TrimSpace(text.String()), Schema: sellersSchema, Effort: h.effort, MaxTokens: 8_000,
	}, &answer)
	if err != nil {
		h.gate.Spend(r.Context(), call, false, u)
		errorJSON(w, http.StatusBadGateway, "ai_failed")
		return
	}
	h.gate.Spend(r.Context(), call, true, u)
	respondJSON(w, http.StatusOK, map[string]any{"items": in.suggestions(answer.Items)})
}

// suggestions puts the model's items in the order of the names: a name the input has not is
// dropped, a missing one is null, and so is a section outside the family's list. The model may
// change the case or the spaces of a name — it is still found; the first item for a name wins.
func (in sellersInput) suggestions(items []SellerSuggestion) []SellerSuggestion {
	key := func(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }
	at := map[string]int{}
	out := make([]SellerSuggestion, len(in.Names))
	for i, n := range in.Names {
		out[i] = SellerSuggestion{Name: n}
		if _, dup := at[key(n)]; !dup {
			at[key(n)] = i
		}
	}
	ids := map[string]bool{}
	for _, c := range in.Categories {
		ids[c.ID] = true
	}
	done := make([]bool, len(in.Names))
	for _, it := range items {
		i, found := at[key(it.Name)]
		if !found || done[i] {
			continue
		}
		done[i] = true
		if it.CategoryID != nil && ids[*it.CategoryID] {
			id := *it.CategoryID
			out[i].CategoryID = &id
		}
	}
	return out
}

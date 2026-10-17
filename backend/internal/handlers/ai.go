package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"regexp"
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

// Spend records what the call's attempts cost: +1 request (the admin counter) only on success; the
// tokens Anthropic billed — success or failure — go into cost_micros, which is the monthly limit (Р-11,
// AU-09). The answer is not held back by a failed write: it is logged.
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

// maxReviewBody bounds POST /api/ai/review: the facts of a month are a few KB (AU-11).
const maxReviewBody = 32 << 10

// reviewDeadline is the whole review, the strict retry included: the Vercel function has 60 s
// (vercel.json), each call is bounded by ai.DefaultTimeout as well.
const reviewDeadline = 55 * time.Second

// Bounds of the review v2 body (бэклог «ИИ-польза», AU-12).
const (
	maxReviewFacts      = 30
	maxReviewCandidates = 3
	maxReviewRunes      = 200
	maxReviewRaw        = 5 // numbers of an image line (AU-11)
	maxReviewNumber     = 1e15
)

var (
	// reviewReasons are the occasions of a review (Р-20).
	reviewReasons = []string{"month", "salary", "refresh"}
	// reviewKinds are the step candidates of the code (Р-3).
	reviewKinds = []string{"move", "prepay", "cushion"}
	factID      = regexp.MustCompile(`^f[1-9][0-9]?$`)
	candidateID = regexp.MustCompile(`^c[1-9]$`)
	// reviewRef is a reference of the model's text — "{f3}"; anything in braces is checked.
	reviewRef = regexp.MustCompile(`\{([^{}]*)\}`)
	// quotedName is a name in «» — a goal «iPhone 17» may have digits of its own.
	quotedName  = regexp.MustCompile(`«[^«»]*»`)
	isoMonthRaw = regexp.MustCompile(`^\d{4}-\d{2}$`)
)

// reviewSystem is the fixed instruction of the month review v2 (Р-2, Р-19): the model writes no
// number — only references to the facts the phone counted. The server adds nothing else to what
// the phone sent — no ids, emails or dates (Р-15 «ИИ»).
const reviewSystem = `Ты — семейный финансовый помощник в приложении для семейного бюджета. Тебе дают JSON: reason — повод разбора (month — начался новый месяц, salary — пришла зарплата, refresh — попросили обновить); facts — факты месяца, которые посчитало приложение: id, about — о чём факт, value — значение, как его покажет приложение; candidates — шаги, которые приложение может сделать одной кнопкой: id, kind (move — перенести деньги из плана трат в мечту в этом месяце, prepay — внести досрочно в долг, cushion — отложить в подушку), about — откуда и куда, value — сумма, effect — что это даст. Люди названы «участник 1», «участник 2».

Напиши короткий разбор месяца по-русски от лица семьи — «мы»: что изменилось и почему — через мечту, подушку или свободу от долгов.
- good — что хорошо: одно предложение до 14 слов;
- risk — где риск: одно предложение до 14 слов;
- step.text — один конкретный шаг до 8 слов; step.candidate — id кандидата, если шаг про него, иначе null. Если кандидат отвечает на риск — выбери его.
Главное — перемена: если в facts есть то, что сдвинулось к прошлому месяцу (срок мечты отодвинулся или приблизился, доход больше или меньше, новый платёж, раздел выше обычного), good или risk говорит о ней и о том, как она двигает мечту. Остаток месяца и сроки без перемены — только если перемен нет.
Без упрёков и оценок людей. Не сравнивай участников между собой и не называй их.

Числа. Не пиши ни одной цифры и ни одного числа словами. Каждую сумму, срок, время, долю или месяц пиши только ссылкой на факт в фигурных скобках — {f3}: приложение подставит value факта как есть. Ссылайся только на id из facts. value уже в своей форме: суммы — «80 000 ₸», сроки — «к июню 2028», время — «2 недели», доли — «11 %»; строй фразу так, чтобы value встало без изменений: «соберём {f5}», «отодвинулась на {f6}», «на кафе ушло {f13}». Ничего не вычисляй: ни разниц, ни сумм, ни долей, ни сравнений «в N раз». Если для мысли нужно число, которого нет в facts, скажи её без числа. Названия мечт, разделов и долгов пиши как в about, в кавычках «».`

// reviewRetry is added to the instruction when the first answer was a defect.
const reviewRetry = "\n\nПрошлый ответ не принят: %s. Числа — только ссылками {fN} на присланные факты, без цифр в тексте."

// reviewFact is a fact of the phone (AU-11): about has no digits of the code, value is shown as
// written, raw is the number, the month "YYYY-MM" or the numbers of an image line.
type reviewFact struct {
	ID    string          `json:"id"`
	About string          `json:"about"`
	Value string          `json:"value"`
	Raw   json.RawMessage `json:"raw"`
}

type reviewCandidate struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	About  string `json:"about"`
	Value  string `json:"value"`
	Effect string `json:"effect"`
}

type reviewRequest struct {
	Reason     string            `json:"reason"`
	Facts      []reviewFact      `json:"facts"`
	Candidates []reviewCandidate `json:"candidates"`
}

// shortText: not blank (blank allowed when may), at most maxReviewRunes.
func shortText(s string, may bool) bool {
	return (may || strings.TrimSpace(s) != "") && utf8.RuneCountInString(s) <= maxReviewRunes
}

// validRaw: a number, a month "YYYY-MM", or 1–5 numbers.
func validRaw(raw json.RawMessage) bool {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return false
	}
	switch x := v.(type) {
	case json.Number:
		return saneNumber(x)
	case string:
		return isoMonthRaw.MatchString(x)
	case []any:
		if len(x) == 0 || len(x) > maxReviewRaw {
			return false
		}
		for _, e := range x {
			if n, ok := e.(json.Number); !ok || !saneNumber(n) {
				return false
			}
		}
		return true
	}
	return false
}

// saneNumber: a finite number within money range — «1e999999» would cost CheckNumbers seconds of big.Rat.
func saneNumber(n json.Number) bool {
	f, err := n.Float64()
	return err == nil && math.Abs(f) <= maxReviewNumber
}

// valid checks the body (AU-12): reason, 1–30 facts f<N>, 0–3 candidates c<N>, no duplicates,
// short strings.
func (q reviewRequest) valid() bool {
	if !slices.Contains(reviewReasons, q.Reason) || len(q.Facts) == 0 || len(q.Facts) > maxReviewFacts || len(q.Candidates) > maxReviewCandidates {
		return false
	}
	seen := map[string]bool{}
	for _, f := range q.Facts {
		if !factID.MatchString(f.ID) || seen[f.ID] || !shortText(f.About, false) || !shortText(f.Value, false) || !validRaw(f.Raw) {
			return false
		}
		seen[f.ID] = true
	}
	for _, c := range q.Candidates {
		if !candidateID.MatchString(c.ID) || seen[c.ID] || !slices.Contains(reviewKinds, c.Kind) ||
			!shortText(c.About, false) || !shortText(c.Value, false) || !shortText(c.Effect, true) {
			return false
		}
		seen[c.ID] = true
	}
	return true
}

// modelText is what the model reads: the phone's facts without raw (the model does not count),
// the candidates and the reason — nothing else (the outgoing body is fixed by the tests).
func (q reviewRequest) modelText() string {
	type fact struct {
		ID    string `json:"id"`
		About string `json:"about"`
		Value string `json:"value"`
	}
	facts := make([]fact, len(q.Facts))
	for i, f := range q.Facts {
		facts[i] = fact{f.ID, f.About, f.Value}
	}
	candidates := q.Candidates
	if candidates == nil {
		candidates = []reviewCandidate{}
	}
	b, _ := json.Marshal(map[string]any{"reason": q.Reason, "facts": facts, "candidates": candidates})
	return string(b)
}

// numbers is the input of the second check (ai.CheckNumbers): every about, value and raw sent.
func (q reviewRequest) numbers() any {
	var out []any
	for _, f := range q.Facts {
		dec := json.NewDecoder(bytes.NewReader(f.Raw))
		dec.UseNumber()
		var raw any
		_ = dec.Decode(&raw)
		out = append(out, f.About, f.Value, raw)
	}
	for _, c := range q.Candidates {
		out = append(out, c.About, c.Value, c.Effect)
	}
	return out
}

// reviewSchema is the answer (structured outputs: every object closes its properties); the
// candidate is one of the ids sent or null.
func reviewSchema(candidates []reviewCandidate) map[string]any {
	choice := []any{map[string]any{"type": "null"}}
	if len(candidates) > 0 {
		ids := make([]string, len(candidates))
		for i, c := range candidates {
			ids[i] = c.ID
		}
		choice = append([]any{map[string]any{"type": "string", "enum": ids}}, choice...)
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"good": map[string]any{"type": "string"},
			"risk": map[string]any{"type": "string"},
			"step": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text":      map[string]any{"type": "string"},
					"candidate": map[string]any{"anyOf": choice},
				},
				"required":             []string{"text", "candidate"},
				"additionalProperties": false,
			},
		},
		"required":             []string{"good", "risk", "step"},
		"additionalProperties": false,
	}
}

// ReviewStep is the one step of the review; Candidate is an id of the candidates sent or null.
type ReviewStep struct {
	Text      string  `json:"text"`
	Candidate *string `json:"candidate"`
}

// ReviewAnswer is the model's answer and, with the facts put in, the endpoint's 200.
type ReviewAnswer struct {
	Good string     `json:"good"`
	Risk string     `json:"risk"`
	Step ReviewStep `json:"step"`
}

func (a ReviewAnswer) texts() []string { return []string{a.Good, a.Risk, a.Step.Text} }

// usable: something in every part.
func (a ReviewAnswer) usable() bool {
	return strings.TrimSpace(a.Good) != "" && strings.TrimSpace(a.Risk) != "" && strings.TrimSpace(a.Step.Text) != ""
}

// defects are the first check (Р-19): a reference to a fact not sent, a digit outside the
// references. A name in «» that the phone sent (a goal «iPhone 17») keeps its digits.
func (a ReviewAnswer) defects(q reviewRequest) []string {
	sent := map[string]bool{}
	for _, f := range q.Facts {
		sent[f.ID] = true
	}
	names := map[string]bool{}
	for _, s := range q.texts() {
		for _, n := range quotedName.FindAllString(s, -1) {
			names[n] = true
		}
	}
	var bad []string
	add := func(s string) {
		if !slices.Contains(bad, s) {
			bad = append(bad, s)
		}
	}
	for _, t := range a.texts() {
		for _, m := range reviewRef.FindAllStringSubmatch(t, -1) {
			if !sent[m[1]] {
				add("ссылка {" + m[1] + "} — такого факта нет")
			}
		}
		t = reviewRef.ReplaceAllString(t, " ")
		t = quotedName.ReplaceAllStringFunc(t, func(n string) string {
			if names[n] {
				return " "
			}
			return n
		})
		if strings.ContainsAny(t, "0123456789") {
			add("цифры в тексте")
		}
	}
	return bad
}

// texts are the phone's strings: the names in «» of the facts and candidates come from them.
func (q reviewRequest) texts() []string {
	var out []string
	for _, f := range q.Facts {
		out = append(out, f.About, f.Value)
	}
	for _, c := range q.Candidates {
		out = append(out, c.About, c.Value, c.Effect)
	}
	return out
}

// filled puts every fact's value in place of its reference; a candidate outside the list is null
// (not a defect).
func (a ReviewAnswer) filled(q reviewRequest) ReviewAnswer {
	values := map[string]string{}
	for _, f := range q.Facts {
		values[f.ID] = f.Value
	}
	put := func(t string) string {
		return reviewRef.ReplaceAllStringFunc(t, func(m string) string { return values[m[1:len(m)-1]] })
	}
	out := ReviewAnswer{Good: put(a.Good), Risk: put(a.Risk), Step: ReviewStep{Text: put(a.Step.Text)}}
	if c := a.Step.Candidate; c != nil && slices.ContainsFunc(q.Candidates, func(x reviewCandidate) bool { return x.ID == *c }) {
		out.Step.Candidate = c
	}
	return out
}

// AIReviewHandler is POST /api/ai/review (бэклог «ИИ», AI-08; v2 — «ИИ-польза», AU-12).
type AIReviewHandler struct {
	gate   *AIGate
	model  string
	effort string
}

func NewAIReviewHandler(gate *AIGate, model string) *AIReviewHandler {
	return &AIReviewHandler{gate: gate, model: model, effort: "medium"}
}

// Review — {reason, facts, candidates} → {good, risk, step: {text, candidate|null}} with the facts'
// values put in. Only the facts, the candidates and the fixed instruction go to the model. A digit
// outside the references or a reference to a fact not sent is a defect; so is a number of the
// filled text that the body has not (ai.CheckNumbers — the second guard). A defect is asked again
// once with what was wrong; a second is 502 ai_failed. The old body {summary} is 400 (v1 is gone,
// Р-19). Nothing of the body or the answer is logged.
func (h *AIReviewHandler) Review(w http.ResponseWriter, r *http.Request) {
	call, ok := h.gate.Open(w, r)
	if !ok {
		return
	}
	var req reviewRequest
	if !decodeStrictJSONBody(w, r, maxReviewBody, &req) {
		return
	}
	if !req.valid() {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), reviewDeadline)
	defer cancel()
	system := reviewSystem
	schema := reviewSchema(req.Candidates)
	text := req.modelText()
	var usages []ai.Usage
	for attempt := 0; attempt < 2; attempt++ {
		var answer ReviewAnswer
		u, err := h.gate.client.Call(ctx, ai.Request{
			Model: h.model, System: system, Text: text, Schema: schema, Effort: h.effort, MaxTokens: 16_000,
		}, &answer)
		usages = append(usages, u)
		if err != nil || !answer.usable() {
			break
		}
		bad := answer.defects(req)
		if len(bad) == 0 {
			out := answer.filled(req)
			wrong := ai.CheckNumbers(out.texts(), req.numbers())
			if len(wrong) == 0 {
				h.gate.Spend(r.Context(), call, true, usages...)
				respondJSON(w, http.StatusOK, out)
				return
			}
			bad = append(bad, "числа не из фактов: "+strings.Join(wrong, "; "))
		}
		system = reviewSystem + fmt.Sprintf(reviewRetry, strings.Join(bad, "; "))
	}
	h.gate.Spend(r.Context(), call, false, usages...)
	errorJSON(w, http.StatusBadGateway, "ai_failed")
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

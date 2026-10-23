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

// maxReviewBody bounds POST /api/ai/review: the facts and actions of a month are a few KB (RZ-03).
const maxReviewBody = 48 << 10

// reviewDeadline is the whole review, the strict retry included: the Vercel function has 60 s
// (vercel.json), each call is bounded by ai.DefaultTimeout as well.
const reviewDeadline = 55 * time.Second

// Bounds of the review v3 body and answer (бэклог «Разбор», Р-16; v2 — «ИИ-польза», AU-12).
const (
	maxReviewFacts   = 40
	maxReviewActions = 9
	maxReviewRunes   = 200
	maxReviewRaw     = 5 // numbers of an image line (AU-11)
	maxReviewNumber  = 1e15
	maxReviewAdvices = 3
	maxAdviceWords   = 4   // a title (Р-12: one to four words)
	maxAdviceRunes   = 160 // a text: one short sentence
)

var (
	// reviewReasons are the occasions of a review (Р-20).
	reviewReasons = []string{"month", "salary", "refresh"}
	// reviewActionKinds: do — a step the code makes (move, prepay, cushion); open — the screen of a find (Р-6).
	reviewActionKinds = []string{"do", "open"}
	factID            = regexp.MustCompile(`^f[1-9][0-9]?$`)
	actionID          = regexp.MustCompile(`^a[1-9]$`)
	// reviewRef is a reference of the model's text — "{f3}"; anything in braces is checked.
	reviewRef = regexp.MustCompile(`\{([^{}]*)\}`)
	// quotedName is a name in «» — a goal «iPhone 17» may have digits of its own.
	quotedName  = regexp.MustCompile(`«[^«»]*»`)
	isoMonthRaw = regexp.MustCompile(`^\d{4}-\d{2}$`)
)

// reviewSystem is the fixed instruction of the month review v3 (бэклог «Разбор», Р-1, Р-5, Р-6, Р-24): the model
// picks the finds the family would not see and says what to do — every advice leads to one action; it writes no
// number — only references to the facts the phone counted. The server adds nothing else to what the phone sent — no
// ids, emails or dates (Р-15 «ИИ»). The number of the figure is shown big above the text — the text does not repeat it
// (owner 2026-10-19, RZ-15). Money is per month — the facts have no yearly sums (бэклог «Фидбек», Р-8, Р-19).
const reviewSystem = `Ты — семейный финансовый помощник в приложении для семейного бюджета. Тебя наняли сделать работу, на которую у семьи ушли бы часы: приложение уже просмотрело операции и посчитало факты — твоя работа выбрать из них то, чего семья сама не заметит, и сказать, что с этим сделать. Тебе дают JSON: reason — повод разбора (month — начался новый месяц, salary — пришла зарплата, refresh — попросили обновить); facts — факты месяца, которые посчитало приложение: id, about — о чём факт, value — значение, как его покажет приложение; actions — что приложение может сделать одной кнопкой: id, kind (do — сделать само: перенести деньги из плана трат в мечту в этом месяце, внести досрочно в долг, отложить в подушку; open — открыть экран предмета: раздел трат, покупки у продавца, подписку, мечту, долг), about — что это, value — сумма (у do), effect — что это даст. Люди названы «участник 1», «участник 2».

Напиши по-русски от лица семьи — «мы»:
- where — одно предложение до 14 слов к картинке «куда ушло»: что выросло и почему это важно для мечты, подушки или свободы от долгов;
- advices — от одного до трёх советов, самых ценных по деньгам в месяц; у каждого: title — заголовок до четырёх слов без точки; text — одно предложение до 20 слов: что нашли и почему это важно; figure — id факта с главным числом совета (сумма в месяц, доля взноса в мечту, срок) или null; action — id действия из actions, которое этот совет выполняет (do — если действие прямо отвечает на находку, иначе open экрана предмета совета). Два совета не могут вести на одно действие. Число из figure приложение покажет крупно над текстом — в text его не повторяй.
Ценное — то, чего не видно на экранах: частые траты у одного продавца с суммой в месяц, новое регулярное списание, подорожавшая подписка, двойное списание, что именно раздуло раздел, сценарий «если убрать — мечта раньше». Факт «потратили больше обычного» без причины и без действия — не совет. Остаток месяца и сроки без перемены — только если находок нет.
Без упрёков и оценок людей. Не сравнивай участников между собой и не называй их.

Числа. Не пиши ни одной цифры и ни одного числа словами. Каждую сумму, срок, время, долю или месяц пиши только ссылкой на факт в фигурных скобках — {f3}: приложение подставит value факта как есть. Ссылайся только на id из facts. value уже в своей форме: суммы — «80 000 ₸», сроки — «к июню 2028», время — «2 недели», доли — «11 %»; строй фразу так, чтобы value встало без изменений: «в месяц это {f5}», «мечта раньше на {f6}». Ничего не вычисляй: ни разниц, ни сумм, ни долей, ни сравнений «в N раз». Если для мысли нужно число, которого нет в facts, скажи её без числа. Названия мечт, разделов, продавцов, подписок и долгов пиши как в about, в кавычках «».`

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

// reviewAction is one button of an advice (Р-6): do — a step of the code with its sum and effect; open — the screen
// of a find, about only.
type reviewAction struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	About  string `json:"about"`
	Value  string `json:"value"`
	Effect string `json:"effect"`
}

type reviewRequest struct {
	V       int            `json:"v"`
	Reason  string         `json:"reason"`
	Facts   []reviewFact   `json:"facts"`
	Actions []reviewAction `json:"actions"`
	// Cards are the code's cards of a review v4 (бэклог «Фидбек», Р-26); a v3 body has actions instead.
	Cards []reviewCard `json:"cards"`
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

// valid checks the body (RZ-04): v 3 or v 4, reason, 1–40 facts f<N>; v 3 — 1–9 actions a<N> (do — with a sum,
// open — about only), v 4 — the cards (validV4); no duplicates, short strings. A v2 body (no v, candidates) is 400 —
// the old client says «не вышло» (Р-16).
func (q reviewRequest) valid() bool {
	if (q.V != 3 && q.V != 4) || !slices.Contains(reviewReasons, q.Reason) {
		return false
	}
	seen := map[string]bool{}
	if !q.validFacts(seen) {
		return false
	}
	if q.V == 4 {
		return q.validV4(seen)
	}
	if len(q.Cards) > 0 || len(q.Actions) == 0 || len(q.Actions) > maxReviewActions {
		return false
	}
	for _, a := range q.Actions {
		if !actionID.MatchString(a.ID) || seen[a.ID] || !slices.Contains(reviewActionKinds, a.Kind) || !shortText(a.About, false) {
			return false
		}
		if a.Kind == "do" && (!shortText(a.Value, false) || !shortText(a.Effect, true)) {
			return false
		}
		if a.Kind == "open" && (a.Value != "" || a.Effect != "") {
			return false
		}
		seen[a.ID] = true
	}
	return true
}

// modelText is what the model reads: the phone's facts without raw (the model does not count), the actions (v 3)
// or the cards (v 4) and the reason — nothing else (the outgoing body is fixed by the tests).
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
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false) // «Дом & сад» as named, not a \u code — as the sellers handler
	m := map[string]any{"reason": q.Reason, "facts": facts}
	if q.V == 4 {
		m["cards"] = q.Cards
	} else {
		m["actions"] = q.Actions
	}
	_ = enc.Encode(m)
	return strings.TrimSpace(b.String())
}

// hasFact: a fact with this id was sent.
func (q reviewRequest) hasFact(id string) bool {
	return slices.ContainsFunc(q.Facts, func(f reviewFact) bool { return f.ID == id })
}

// figureSchema: the figure of an answer is one of the facts sent or null.
func figureSchema(facts []reviewFact) map[string]any {
	ids := make([]string, len(facts))
	for i, f := range facts {
		ids[i] = f.ID
	}
	return map[string]any{"anyOf": []any{map[string]any{"type": "string", "enum": ids}, map[string]any{"type": "null"}}}
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
	for _, a := range q.Actions {
		out = append(out, a.About, a.Value, a.Effect)
	}
	for _, c := range q.Cards {
		out = append(out, c.About)
	}
	return out
}

// texts are the phone's strings: the names in «» of the facts, actions and cards come from them.
func (q reviewRequest) texts() []string {
	var out []string
	for _, f := range q.Facts {
		out = append(out, f.About, f.Value)
	}
	for _, a := range q.Actions {
		out = append(out, a.About, a.Value, a.Effect)
	}
	for _, c := range q.Cards {
		out = append(out, c.About)
	}
	return out
}

// reviewSchema is the answer (structured outputs: every object closes its properties): the figure is one of the
// facts sent or null, the action one of the actions sent — never null (Р-6: no advice without a button).
func reviewSchema(facts []reviewFact, actions []reviewAction) map[string]any {
	actionIDs := make([]string, len(actions))
	for i, a := range actions {
		actionIDs[i] = a.ID
	}
	str := map[string]any{"type": "string"}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"where": str,
			"advices": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"title":  str,
						"text":   str,
						"figure": figureSchema(facts),
						"action": map[string]any{"type": "string", "enum": actionIDs},
					},
					"required":             []string{"title", "text", "figure", "action"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"where", "advices"},
		"additionalProperties": false,
	}
}

// ReviewAdvice is one advice: Figure is a fact id sent or null, Action an action id sent.
type ReviewAdvice struct {
	Title  string  `json:"title"`
	Text   string  `json:"text"`
	Figure *string `json:"figure"`
	Action string  `json:"action"`
}

// ReviewAnswer is the model's answer and, with the facts put in, the endpoint's 200.
type ReviewAnswer struct {
	Where   string         `json:"where"`
	Advices []ReviewAdvice `json:"advices"`
}

func (a ReviewAnswer) texts() []string {
	out := []string{a.Where}
	for _, x := range a.Advices {
		out = append(out, x.Title, x.Text)
	}
	return out
}

// usable: a where and something in every advice (how many — a defect, asked again).
func (a ReviewAnswer) usable() bool {
	if strings.TrimSpace(a.Where) == "" {
		return false
	}
	for _, x := range a.Advices {
		if strings.TrimSpace(x.Title) == "" || strings.TrimSpace(x.Text) == "" {
			return false
		}
	}
	return true
}

// defects are the first check (Р-16, Р-19): one to three advices on different actions, a title of up to four words,
// a text of one short sentence, a figure and an action from the ones sent, a reference to a fact sent, no digit
// outside the references. A name in «» that the phone sent (a goal «iPhone 17») keeps its digits.
func (a ReviewAnswer) defects(q reviewRequest) []string {
	var bad []string
	add := func(s string) {
		if !slices.Contains(bad, s) {
			bad = append(bad, s)
		}
	}
	if len(a.Advices) == 0 || len(a.Advices) > maxReviewAdvices {
		add("советов должно быть от одного до трёх")
	}
	used := map[string]bool{}
	for _, x := range a.Advices {
		if used[x.Action] {
			add("одно действие на совет")
		}
		used[x.Action] = true
		if !slices.ContainsFunc(q.Actions, func(y reviewAction) bool { return y.ID == x.Action }) {
			add("действие " + x.Action + " — такого нет")
		}
		if x.Figure != nil && !q.hasFact(*x.Figure) {
			add("figure " + *x.Figure + " — такого факта нет")
		}
		// Words as the family sees them: «Аптека {f7}» is «Аптека 144 000 ₸» — four, not two (Р-12).
		if len(strings.Fields(q.fill(x.Title))) > maxAdviceWords {
			add("заголовок до четырёх слов вместе с подставленным значением и названием — лучше без {fN} в заголовке")
		}
		// The text — before the values are put in, unlike the title: a reference is one word of the model, and 160
		// runes are the instruction's «up to 20 words»; a value of an image line is 60+ runes on its own.
		if utf8.RuneCountInString(x.Text) > maxAdviceRunes {
			add("совет — одно короткое предложение")
		}
	}
	q.textDefects(a.texts(), add)
	return bad
}

// textDefects are the checks of every answer text (v3 and v4): a reference to a fact sent, no digit outside the
// references and the names in «» the phone sent.
func (q reviewRequest) textDefects(texts []string, add func(string)) {
	names := map[string]bool{}
	for _, s := range q.texts() {
		for _, n := range quotedName.FindAllString(s, -1) {
			names[n] = true
		}
	}
	for _, t := range texts {
		for _, m := range reviewRef.FindAllStringSubmatch(t, -1) {
			if !q.hasFact(m[1]) {
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
}

// fill puts each fact's value in place of its reference "{fN}" (a reference to no fact — empty; defects names it).
func (q reviewRequest) fill(t string) string {
	return reviewRef.ReplaceAllStringFunc(t, func(m string) string {
		for _, f := range q.Facts {
			if f.ID == m[1:len(m)-1] {
				return f.Value
			}
		}
		return ""
	})
}

// filled puts every fact's value in place of its reference in where, titles and texts; figure and action stay ids.
func (a ReviewAnswer) filled(q reviewRequest) ReviewAnswer {
	out := ReviewAnswer{Where: q.fill(a.Where), Advices: make([]ReviewAdvice, len(a.Advices))}
	for i, x := range a.Advices {
		out.Advices[i] = ReviewAdvice{Title: q.fill(x.Title), Text: q.fill(x.Text), Figure: x.Figure, Action: x.Action}
	}
	return out
}

// Bounds of the review v4 (бэклог «Фидбек», Р-26): the code's cards and one thought of the month.
const (
	maxReviewCards = 6  // REVIEW_CARDS_MAX of the phone
	maxLeadWords   = 4  // a title
	maxLeadText    = 25 // words of a text: one thought
)

var (
	cardID = regexp.MustCompile(`^c[1-9]$`)
	// reviewCardKinds are the kinds of the code's cards (Р-24).
	reviewCardKinds = []string{"unknown", "people", "cash", "oneoff", "week", "recurring", "habit", "small", "plan", "pricier", "double"}
)

// reviewCard is one card the phone shows below the thought (Р-24): its kind and what it is about — sellers as v3,
// people and cash without names (Р-28); its numbers are facts.
type reviewCard struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	About string `json:"about"`
}

// reviewSystemV4 is the fixed instruction of the month review v4 (бэклог «Фидбек», Р-23, Р-26): the code found the
// finds and made their buttons; the model writes one thought of the month and names the card to show second. No
// number of its own, as v3; no names of people.
const reviewSystemV4 = `Ты — семейный финансовый помощник в приложении для семейного бюджета. Приложение уже разобрало операции месяца и само собрало карточки — что сделать одной кнопкой; твоя работа — одна главная мысль месяца: что в нём главное и почему это важно для мечты или свободы от долгов. Тебе дают JSON: reason — повод разбора (month — начался новый месяц, salary — пришла зарплата, refresh — попросили обновить); facts — факты месяца, которые посчитало приложение: id, about — о чём факт, value — значение, как его покажет приложение; cards — карточки приложения: id, kind — вид (unknown — траты без раздела, people — переводы людям, cash — наличные, oneoff — похоже на разовую покупку, week — неделя дороже обычной, recurring — регулярное списание не в платежах, habit — привычка, small — мелкие покупки, plan — раздел без плана или выше плана, pricier — подорожала подписка, double — двойное списание), about — о чём карточка. Люди названы «участник 1», «участник 2».

Напиши по-русски от лица семьи — «мы» — одну карточку:
- title — заголовок до четырёх слов без точки;
- text — одна-две короткие фразы, всего до 25 слов: что в месяце главное и почему это важно для мечты, подушки или свободы от долгов;
- figure — id факта с главным числом мысли (сумма в месяц, доля, срок) или null; число из figure приложение покажет крупно над текстом — в text его не повторяй;
- next — id карточки из cards, которую показать второй: та, что больше всего помогает этой мысли.
Не пересказывай карточки — приложение покажет их само; скажи то, что связывает месяц в одно. Без упрёков и оценок людей. Не сравнивай участников между собой и не называй их; людей из переводов не называй.

Числа. Не пиши ни одной цифры и ни одного числа словами. Каждую сумму, срок, время, долю или месяц пиши только ссылкой на факт в фигурных скобках — {f3}: приложение подставит value факта как есть. Ссылайся только на id из facts. value уже в своей форме: суммы — «80 000 ₸», сроки — «к июню 2028», время — «2 недели», доли — «11 %»; строй фразу так, чтобы value встало без изменений: «в месяц это {f5}», «мечта раньше на {f6}». Ничего не вычисляй: ни разниц, ни сумм, ни долей, ни сравнений «в N раз». Если для мысли нужно число, которого нет в facts, скажи её без числа. Названия мечт, разделов, продавцов, подписок и долгов пиши как в about, в кавычках «».`

// validFacts: 1–40 facts f<N>, no duplicates, short strings, a sane raw; ids go into seen.
func (q reviewRequest) validFacts(seen map[string]bool) bool {
	if len(q.Facts) == 0 || len(q.Facts) > maxReviewFacts {
		return false
	}
	for _, f := range q.Facts {
		if !factID.MatchString(f.ID) || seen[f.ID] || !shortText(f.About, false) || !shortText(f.Value, false) || !validRaw(f.Raw) {
			return false
		}
		seen[f.ID] = true
	}
	return true
}

// validV4 checks the rest of a v4 body (the reason and the facts — valid): 1–6 cards c<N> of the known kinds, no
// actions; seen holds the fact ids.
func (q reviewRequest) validV4(seen map[string]bool) bool {
	if len(q.Actions) > 0 || len(q.Cards) == 0 || len(q.Cards) > maxReviewCards {
		return false
	}
	for _, c := range q.Cards {
		if !cardID.MatchString(c.ID) || seen[c.ID] || !slices.Contains(reviewCardKinds, c.Kind) || !shortText(c.About, false) {
			return false
		}
		seen[c.ID] = true
	}
	return true
}

// reviewSchemaV4 is the answer v4: the figure is one of the facts sent or null, next — one of the cards sent.
func reviewSchemaV4(facts []reviewFact, cards []reviewCard) map[string]any {
	cardIDs := make([]string, len(cards))
	for i, c := range cards {
		cardIDs[i] = c.ID
	}
	str := map[string]any{"type": "string"}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":  str,
			"text":   str,
			"figure": figureSchema(facts),
			"next":   map[string]any{"type": "string", "enum": cardIDs},
		},
		"required":             []string{"title", "text", "figure", "next"},
		"additionalProperties": false,
	}
}

// ReviewLead is the answer v4 — the first card of the report: one thought, the figure (a fact id or null) and the
// card to show next (a card id).
type ReviewLead struct {
	Title  string  `json:"title"`
	Text   string  `json:"text"`
	Figure *string `json:"figure"`
	Next   string  `json:"next"`
}

func (a ReviewLead) texts() []string { return []string{a.Title, a.Text} }

func (a ReviewLead) usable() bool {
	return strings.TrimSpace(a.Title) != "" && strings.TrimSpace(a.Text) != ""
}

// defects of a v4 answer: a title of up to four words as the family sees it, a text of up to 25 words, the figure
// and next from the ones sent, the references and digits as v3.
func (a ReviewLead) defects(q reviewRequest) []string {
	var bad []string
	add := func(s string) {
		if !slices.Contains(bad, s) {
			bad = append(bad, s)
		}
	}
	if len(strings.Fields(q.fill(a.Title))) > maxLeadWords {
		add("заголовок до четырёх слов вместе с подставленным значением и названием — лучше без {fN} в заголовке")
	}
	if len(strings.Fields(a.Text)) > maxLeadText {
		add("мысль — до двадцати пяти слов")
	}
	if a.Figure != nil && !q.hasFact(*a.Figure) {
		add("figure " + *a.Figure + " — такого факта нет")
	}
	if !slices.ContainsFunc(q.Cards, func(c reviewCard) bool { return c.ID == a.Next }) {
		add("next " + a.Next + " — такой карточки нет")
	}
	q.textDefects(a.texts(), add)
	return bad
}

func (a ReviewLead) filled(q reviewRequest) ReviewLead {
	return ReviewLead{Title: q.fill(a.Title), Text: q.fill(a.Text), Figure: a.Figure, Next: a.Next}
}

// AIReviewHandler is POST /api/ai/review (бэклог «ИИ», AI-08; v2 — «ИИ-польза», AU-12; v3 — «Разбор», RZ-04;
// v4 — «Фидбек», FB-16).
type AIReviewHandler struct {
	gate   *AIGate
	model  string
	effort string
}

func NewAIReviewHandler(gate *AIGate, model string) *AIReviewHandler {
	return &AIReviewHandler{gate: gate, model: model, effort: "medium"}
}

// Review — v 3: {reason, facts, actions} → {where, advices: [{title, text, figure|null, action}]}; v 4 (бэклог
// «Фидбек», FB-16): {reason, facts, cards} → {title, text, figure|null, next}; with the facts' values put in. Only
// the facts, the actions or the cards and the fixed instruction go to the model. A defect (see defects) or a
// number of the filled text that the body has not (ai.CheckNumbers — the second guard) is asked again once with what
// was wrong; a second is 502 ai_failed. A v2 body is 400 (Р-16). Nothing of the body or the answer is logged.
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

	if req.V == 4 {
		answerReview[ReviewLead](h, w, r, call, req, reviewSystemV4, reviewSchemaV4(req.Facts, req.Cards), req.modelText())
		return
	}
	answerReview[ReviewAnswer](h, w, r, call, req, reviewSystem, reviewSchema(req.Facts, req.Actions), req.modelText())
}

// reviewReply is an answer of the model v3 (ReviewAnswer) or v4 (ReviewLead).
type reviewReply[A any] interface {
	usable() bool
	defects(q reviewRequest) []string
	filled(q reviewRequest) A
	texts() []string
}

// answerReview asks the model and answers: a defect or a number of the filled text that the body has not
// (ai.CheckNumbers — the second guard) is asked again once with what was wrong; a second is 502 ai_failed.
func answerReview[A reviewReply[A]](h *AIReviewHandler, w http.ResponseWriter, r *http.Request, call aiCall, req reviewRequest, base string, schema map[string]any, text string) {
	ctx, cancel := context.WithTimeout(r.Context(), reviewDeadline)
	defer cancel()
	system := base
	var usages []ai.Usage
	for attempt := 0; attempt < 2; attempt++ {
		var answer A
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
		system = base + fmt.Sprintf(reviewRetry, strings.Join(bad, "; "))
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
// batch is one request in the admin counter, its cost goes to the limit (Р-11); nothing is applied here — the phone shows the
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

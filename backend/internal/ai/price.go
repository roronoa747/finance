package ai

// price is a model's list price in cents per million tokens.
type price struct{ in, out int64 }

// prices are Anthropic's list prices (platform.claude.com/docs/en/about-claude/pricing,
// checked 2026-10-15). Haiku 5.5 costs more above 100K prompt tokens; our prompts are short.
var prices = map[string]price{
	"claude-opus-5-5":   {in: 400, out: 2000},
	"claude-sonnet-5-5": {in: 200, out: 1000},
	"claude-haiku-5-5":  {in: 10, out: 50},
}

// priciest is what a model missing from prices costs: the family limit is money (Р-11
// «ИИ-польза»), so a dated snapshot or a new model must reach it sooner, never not at all.
var priciest = func() price {
	var top price
	for _, p := range prices {
		if p.out > top.out {
			top = p
		}
	}
	return top
}()

// KnownPrice says whether model is in the price table; the server logs the ones that are not.
func KnownPrice(model string) bool {
	_, ok := prices[model]
	return ok
}

// CostMicros is what u cost in whole microdollars (cents/MTok × tokens / 100); a model
// missing from the table is billed as the priciest one.
func CostMicros(u Usage) int64 {
	p, ok := prices[u.Model]
	if !ok {
		p = priciest
	}
	return (u.InputTokens*p.in + u.OutputTokens*p.out) / 100
}

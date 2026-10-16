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

// CostMicros is what u cost in whole microdollars (cents/MTok × tokens / 100); an unknown
// model costs 0 and the admin page shows "≈ —".
func CostMicros(u Usage) int64 {
	p, ok := prices[u.Model]
	if !ok {
		return 0
	}
	return (u.InputTokens*p.in + u.OutputTokens*p.out) / 100
}

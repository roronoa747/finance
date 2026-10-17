package ai

import "time"

// almaty is Kazakhstan's single time zone (UTC+5), as in internal/fx: the limit resets on
// the 1st by Almaty.
var almaty = time.FixedZone("Asia/Almaty", 5*60*60)

// MonthKey is now's Almaty month, 'YYYY-MM' — the key of app.ai_usage.
func MonthKey(now time.Time) string {
	return now.In(almaty).Format("2006-01")
}

// LimitReached reports whether a family that spent `spentMicros` micro-dollars this month
// may not make another request (the limit is money, Р-11). Two requests racing at the edge
// may both pass (at most a request or two over) — accepted, see backend/README.md.
func LimitReached(spentMicros, limitMicros int64) bool {
	return spentMicros >= limitMicros
}

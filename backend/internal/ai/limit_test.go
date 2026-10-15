package ai

import (
	"testing"
	"time"
)

func TestMonthKeyIsAlmaty(t *testing.T) {
	cases := []struct {
		at   time.Time
		want string
	}{
		{time.Date(2026, 10, 31, 20, 0, 0, 0, time.UTC), "2026-11"}, // 01:00 1 ноября в Алматы
		{time.Date(2026, 10, 31, 18, 0, 0, 0, time.UTC), "2026-10"}, // 23:00 31 октября
	}
	for _, tc := range cases {
		if got := MonthKey(tc.at); got != tc.want {
			t.Errorf("MonthKey(%v) = %s, want %s", tc.at, got, tc.want)
		}
	}
}

func TestLimitReached(t *testing.T) {
	if LimitReached(29, 30) {
		t.Error("29 of 30 leaves one")
	}
	if !LimitReached(30, 30) || !LimitReached(31, 30) {
		t.Error("30 of 30 is the end")
	}
}

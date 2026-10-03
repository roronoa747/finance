// Command fxbackfill fills the National Bank's rate history (app.fx_rates, B2C-76)
// for the last -days days and exits. Days already asked are skipped, so a second
// run only adds what the first one missed.
//
// Production runs it by hand next to cmd/migrate, with the same DATABASE_URL.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"finance-backend/internal/db"
	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

func main() {
	days := flag.Int("days", 730, "how many days back from today to fill")
	pause := flag.Duration("pause", 150*time.Millisecond, "pause between requests to the bank")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("fxbackfill: DATABASE_URL is not set")
	}
	database, err := db.Connect(databaseURL, db.Pool{MaxOpen: 2, MaxIdle: 1})
	if err != nil {
		log.Fatalf("fxbackfill: %v", err)
	}
	defer database.Close()

	res, err := run(context.Background(), fx.NewClient(), repository.NewSQLFxRepository(database), *days, *pause)
	if err != nil {
		log.Fatalf("fxbackfill: %v", err)
	}
	fmt.Println(res)
}

type result struct {
	filled, published, failed int
}

func (r result) String() string {
	s := fmt.Sprintf("filled %d days, %d published", r.filled, r.published)
	if r.failed > 0 {
		s += fmt.Sprintf(", %d failed (run again to retry)", r.failed)
	}
	return s
}

// run asks the bank for every day of today-days+1..today not yet in the store, newest
// first. A bank error skips the day (the next run retries it); a store error stops.
// An empty past day is stored as "nothing published"; an empty today is left for later.
func run(ctx context.Context, client *fx.Client, store repository.FxRepository, days int, pause time.Duration) (result, error) {
	var res result
	if days < 1 {
		return res, fmt.Errorf("-days must be positive")
	}
	today := client.Today()
	from := today.AddDate(0, 0, -(days - 1))
	checked, err := store.Checked(ctx, from, today)
	if err != nil {
		return res, err
	}

	asked := false
	for d := today; !d.Before(from); d = d.AddDate(0, 0, -1) {
		if _, ok := checked[repository.DayKey(d)]; ok {
			continue
		}
		if asked && pause > 0 {
			time.Sleep(pause)
		}
		asked = true

		rates, err := client.Day(ctx, d)
		if err != nil {
			log.Printf("fxbackfill: %s: %v", repository.DayKey(d), err)
			res.failed++
			continue
		}
		if len(rates) == 0 && !d.Before(today) {
			continue
		}
		if err := store.Save(ctx, d, rates); err != nil {
			return res, err
		}
		res.filled++
		if len(rates) > 0 {
			res.published++
		}
	}
	return res, nil
}

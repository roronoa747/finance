// Command transfer copies the family's data between the React tables and the
// Go schema of the same Supabase database, in one transaction with a
// reconciliation before COMMIT.
//
//	transfer forward [-replace] [-dry-run]   auth.users + public.* → app.*
//	transfer back    [-force]   [-dry-run]   app documents → public (rollback)
//
// DATABASE_URL must be a session or direct connection (port 5432) with access
// to the auth schema. The report never prints emails or document bodies.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"finance-backend/internal/db"
)

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Getenv("DATABASE_URL"), os.Stdout))
}

func run(ctx context.Context, args []string, databaseURL string, out io.Writer) int {
	opt, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(out, "transfer:", err)
		fmt.Fprintln(out, "usage: transfer forward [-replace] [-dry-run] | transfer back [-force] [-dry-run]")
		return 2
	}
	if databaseURL == "" {
		fmt.Fprintln(out, "transfer: DATABASE_URL is not set")
		return 2
	}

	database, err := db.Connect(databaseURL, db.Pool{MaxOpen: 1, MaxIdle: 1})
	if err != nil {
		fmt.Fprintln(out, "transfer:", err)
		return 1
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := transfer(ctx, database, opt, out); err != nil {
		if !errors.Is(err, ErrMismatch) {
			fmt.Fprintln(out, "transfer: rolled back:", err)
		}
		return 1
	}
	return 0
}

func parseArgs(args []string) (options, error) {
	if len(args) == 0 {
		return options{}, errors.New("direction is required")
	}
	opt := options{direction: args[0]}
	fs := flag.NewFlagSet("transfer "+opt.direction, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&opt.dryRun, "dry-run", false, "roll back at the end")
	switch opt.direction {
	case "forward":
		fs.BoolVar(&opt.replace, "replace", false, "wipe a non-empty app schema first")
	case "back":
		fs.BoolVar(&opt.force, "force", false, "return documents although app has some public lacks")
	default:
		return options{}, fmt.Errorf("unknown direction %q", opt.direction)
	}
	if err := fs.Parse(args[1:]); err != nil {
		return options{}, err
	}
	if fs.NArg() > 0 {
		return options{}, fmt.Errorf("unexpected arguments: %v", fs.Args())
	}
	return opt, nil
}

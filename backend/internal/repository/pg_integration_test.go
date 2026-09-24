package repository

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"testing"

	"finance-backend/internal/testdb"
)

// Н-3: parallel joins into one household must get distinct slots, never a
// UNIQUE (household_id, slot) violation.
func TestPostgresConcurrentJoinAssignsDistinctSlots(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)

	for round := 0; round < 20; round++ {
		owner, err := users.Create(ctx, fmt.Sprintf("owner%d@example.com", round), "hash")
		if err != nil {
			t.Fatalf("create owner: %v", err)
		}
		h, _, err := households.CreateHousehold(ctx, "Казна", owner.ID, "Владелец")
		if err != nil {
			t.Fatalf("create household: %v", err)
		}

		const joiners = 2
		codes := make([]string, joiners)
		userIDs := make([]string, joiners)
		for i := range joiners {
			inv, err := households.CreateInvite(ctx, h.ID, owner.ID)
			if err != nil {
				t.Fatalf("create invite: %v", err)
			}
			u, err := users.Create(ctx, fmt.Sprintf("joiner%d-%d@example.com", round, i), "hash")
			if err != nil {
				t.Fatalf("create joiner: %v", err)
			}
			codes[i], userIDs[i] = inv.Code, u.ID
		}

		var wg sync.WaitGroup
		slots := make([]string, joiners)
		errs := make([]error, joiners)
		for i := range joiners {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				m, err := households.JoinHousehold(ctx, codes[i], userIDs[i], "Партнёр")
				errs[i] = err
				if m != nil {
					slots[i] = m.Slot
				}
			}(i)
		}
		wg.Wait()

		for i, err := range errs {
			if err != nil {
				t.Fatalf("round %d: join %d failed: %v", round, i, err)
			}
		}
		sort.Strings(slots)
		if slots[0] != "b" || slots[1] != "c" {
			t.Fatalf("round %d: expected slots [b c], got %v", round, slots)
		}
	}
}

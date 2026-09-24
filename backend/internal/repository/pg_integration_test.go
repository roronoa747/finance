package repository

import (
	"context"
	"encoding/json"
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

// RP-03 (Р-14): a push without a top-level key keeps the stored one; explicit
// [] wins; a stale revision (409) leaves the stored document untouched.
func TestPostgresPushKeepsKeysMissingFromOldClient(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)
	docs := NewSQLDocRepository(database)

	owner, err := users.Create(ctx, "keys@example.com", "hash")
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	h, _, err := households.CreateHousehold(ctx, "Казна", owner.ID, "Владелец")
	if err != nil {
		t.Fatalf("create household: %v", err)
	}

	keys := func(raw json.RawMessage) map[string]string {
		t.Helper()
		var m map[string]json.RawMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("decode doc %s: %v", raw, err)
		}
		out := make(map[string]string, len(m))
		for k, v := range m {
			var x any
			_ = json.Unmarshal(v, &x)
			b, _ := json.Marshal(x)
			out[k] = string(b)
		}
		return out
	}
	pushHH := func(rev int64, data string) (json.RawMessage, bool) {
		t.Helper()
		doc, conflict, err := docs.PushHouseholdDoc(ctx, h.ID, rev, json.RawMessage(data), owner.ID)
		if err != nil {
			t.Fatalf("push rev %d: %v", rev, err)
		}
		return doc.Data, conflict
	}

	// Registration stored {} at rev 1: the first push lands as is.
	if _, conflict := pushHH(1, `{"people":[{"id":"a"}],"payments":[{"id":"p1"}]}`); conflict {
		t.Fatal("first push: unexpected conflict")
	}
	data, _ := pushHH(2, `{"people":[{"id":"a","name":"Ильяс"}]}`)
	if got := keys(data); got["payments"] != `[{"id":"p1"}]` || got["people"] != `[{"id":"a","name":"Ильяс"}]` {
		t.Fatalf("old client push: got %v", got)
	}
	stored, err := docs.GetHouseholdDoc(ctx, h.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got := keys(stored.Data); got["payments"] != `[{"id":"p1"}]` {
		t.Fatalf("stored after old client push: got %v", got)
	}

	// Stale revision: 409, nothing written.
	if _, conflict := pushHH(2, `{"payments":[]}`); !conflict {
		t.Fatal("stale push: expected conflict")
	}
	after, _ := docs.GetHouseholdDoc(ctx, h.ID)
	if after.Rev != 3 || keys(after.Data)["payments"] != `[{"id":"p1"}]` {
		t.Fatalf("stale push changed the doc: rev %d, %s", after.Rev, after.Data)
	}

	data, _ = pushHH(3, `{"people":[],"payments":[]}`)
	if got := keys(data); got["payments"] != `[]` || got["people"] != `[]` {
		t.Fatalf("explicit []: got %v", got)
	}

	// Private document: the same rule.
	priv, _, err := docs.PushPrivateDoc(ctx, h.ID, owner.ID, 1, json.RawMessage(`{"accounts":[{"id":"x"}],"wishes":[{"id":"w1"}]}`))
	if err != nil {
		t.Fatalf("private push: %v", err)
	}
	priv, _, err = docs.PushPrivateDoc(ctx, h.ID, owner.ID, priv.Rev, json.RawMessage(`{"accounts":[]}`))
	if err != nil {
		t.Fatalf("private old client push: %v", err)
	}
	if got := keys(priv.Data); got["wishes"] != `[{"id":"w1"}]` || got["accounts"] != `[]` {
		t.Fatalf("private old client push: got %v", got)
	}
}

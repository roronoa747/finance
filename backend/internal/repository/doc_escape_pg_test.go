package repository

import (
	"context"
	"encoding/json"
	"testing"

	"finance-backend/internal/testdb"
)

// B2C-26: why the sync handler refuses these escapes — PostgreSQL's jsonb does not store them,
// and the push would fail as a 500. The handler answers 400 first (handlers.docDataProblem).
func TestPostgresJsonbRefusesNulAndLoneSurrogate(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	u, _ := users.Create(ctx, "esc@example.com", "hash")
	h, _, err := NewSQLHouseholdRepository(database).CreateHousehold(ctx, "", u.ID, "Тест")
	if err != nil {
		t.Fatal(err)
	}
	docs := NewSQLDocRepository(database)
	bs := string(rune(92))
	for _, bad := range []string{`{"name": "a` + bs + `u0000"}`, `{"name": "` + bs + `ud83d"}`} {
		if _, _, err := docs.PushHouseholdDoc(ctx, h.ID, 1, json.RawMessage(bad), u.ID); err == nil {
			t.Errorf("jsonb stored %s — the handler check would be unnecessary", bad)
		}
	}
	if _, _, err := docs.PushHouseholdDoc(ctx, h.ID, 1, json.RawMessage(`{"name": "`+bs+`ud83c`+bs+`udf38"}`), u.ID); err != nil {
		t.Errorf("a surrogate pair must store: %v", err)
	}
}

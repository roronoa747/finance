package repository

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"finance-backend/internal/db"
	"finance-backend/migrations"
)

// Фото (B2C-16) на настоящем PostgreSQL: миграция 000003 на чистой и мигрированной базе,
// байты через []byte (bytea принимает и текстовую, и бинарную форму — CI гоняет оба DSN,
// в том числе binary_parameters=yes), скрытое, каскад при удалении пользователя и семьи.

func pgWebp(n int) []byte {
	b := make([]byte, n)
	copy(b, "RIFF\x00\x00\x00\x00WEBPVP8 ")
	for i := 12; i < n; i++ {
		b[i] = byte(i * 7 % 256)
	}
	return b
}

func TestPostgresPhotosMigrationAndBytes(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	photos := NewSQLPhotoRepository(f.db)

	// Все 256 значений байта, включая NUL, — через bytea без потерь.
	pic := pgWebp(4096)
	created, err := photos.Create(ctx, f.householdID, f.aliceID, PhotoInput{Hidden: true, ContentType: "image/webp", Data: pic})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || !created.Hidden || created.Size != 4096 || created.HouseholdID != f.householdID || created.UserID != f.aliceID {
		t.Fatalf("created: %+v", created)
	}
	got, data, err := photos.Get(ctx, created.ID)
	if err != nil || !bytes.Equal(data, pic) || got.ContentType != "image/webp" || !got.Hidden || got.UserID != f.aliceID {
		t.Fatalf("get: %+v %v (bytes equal: %v)", got, err, bytes.Equal(data, pic))
	}

	// Повторный прогон миграций ничего не ломает и не трогает фото; в public — ничего.
	if err := db.RunMigrations(ctx, f.db, migrations.FS); err != nil {
		t.Fatalf("rerun migrations: %v", err)
	}
	if _, data, err := photos.Get(ctx, created.ID); err != nil || len(data) != 4096 {
		t.Fatalf("after rerun: %v %d", err, len(data))
	}
	var tables int
	_ = f.db.QueryRow(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`).Scan(&tables)
	if tables != 0 {
		t.Fatalf("migration created %d tables in public", tables)
	}
	for _, name := range []string{"photos_household_idx", "photos_user_idx"} {
		var found int
		if err := f.db.QueryRow(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND indexname = $1`, name).Scan(&found); err != nil || found != 1 {
			t.Errorf("index %s: %d, %v", name, found, err)
		}
	}

	// Тип вне белого списка и пустое тело — CHECK базы, последняя линия после хендлера.
	if _, err := photos.Create(ctx, f.householdID, f.aliceID, PhotoInput{ContentType: "image/png", Data: pic}); err == nil {
		t.Fatalf("png accepted by the database")
	}
	if _, err := photos.Create(ctx, f.householdID, f.aliceID, PhotoInput{ContentType: "image/webp", Data: nil}); err == nil {
		t.Fatalf("empty photo accepted by the database")
	}

	// Удаление: один раз; второй — ErrPhotoNotFound; неизвестный uuid — ErrPhotoNotFound.
	if err := photos.Delete(ctx, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := photos.Delete(ctx, created.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("delete twice: %v", err)
	}
	if _, _, err := photos.Get(ctx, "00000000-0000-4000-8000-000000000000"); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("get unknown: %v", err)
	}
}

func TestPostgresPhotosCascade(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	photos := NewSQLPhotoRepository(f.db)

	mine, _ := photos.Create(ctx, f.householdID, f.aliceID, PhotoInput{ContentType: "image/jpeg", Data: []byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}})
	bobs, _ := photos.Create(ctx, f.householdID, f.bobID, PhotoInput{ContentType: "image/webp", Data: pgWebp(64)})

	// Удаление пользователя уносит его фото, чужие остаются.
	if err := f.users.Delete(ctx, f.bobID); err != nil {
		t.Fatalf("delete bob: %v", err)
	}
	if _, _, err := photos.Get(ctx, bobs.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("bob's photo after user delete: %v", err)
	}
	if _, _, err := photos.Get(ctx, mine.ID); err != nil {
		t.Fatalf("alice's photo lost: %v", err)
	}

	// Удаление семьи — каскадом все её фото.
	if _, err := f.db.ExecContext(ctx, `DELETE FROM app.households WHERE id = $1`, f.householdID); err != nil {
		t.Fatalf("delete household: %v", err)
	}
	if _, _, err := photos.Get(ctx, mine.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("photo after household delete: %v", err)
	}
}

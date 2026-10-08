package handlers

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthHandler_NilDB(t *testing.T) {
	handler := HealthHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Status != "ok" {
		t.Errorf("expected status 'ok', got %q", resp.Status)
	}
	if resp.DB != "disconnected" {
		t.Errorf("expected db 'disconnected', got %q", resp.DB)
	}
}

// fakeDB — база для health без Postgres (ML-10): соединение отвечает на ping или нет.
type fakeConnector struct{ err error }

func (c fakeConnector) Connect(context.Context) (driver.Conn, error) {
	if c.err != nil {
		return nil, c.err
	}
	return fakeConn{}, nil
}
func (c fakeConnector) Driver() driver.Driver { return nil }

type fakeConn struct{}

func (fakeConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not supported") }
func (fakeConn) Close() error                        { return nil }
func (fakeConn) Begin() (driver.Tx, error)           { return nil, errors.New("not supported") }
func (fakeConn) Ping(context.Context) error          { return nil }

func healthOf(t *testing.T, db *sql.DB) HealthResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	HealthHandler(db).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var resp HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp
}

// Будильник базы ходит в /api/health: ответ «connected» значит, что запрос дошёл до Postgres.
func TestHealthHandler_DBReachable(t *testing.T) {
	db := sql.OpenDB(fakeConnector{})
	defer db.Close()
	if resp := healthOf(t, db); resp.DB != "connected" {
		t.Errorf("expected db 'connected', got %q", resp.DB)
	}
}

func TestHealthHandler_DBDown(t *testing.T) {
	db := sql.OpenDB(fakeConnector{err: errors.New("connection refused")})
	defer db.Close()
	if resp := healthOf(t, db); resp.DB != "disconnected" {
		t.Errorf("expected db 'disconnected', got %q", resp.DB)
	}
}

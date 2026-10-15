package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"finance-backend/internal/applepay"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// WalletHandler serves Apple Pay (бэклог «Apple Pay»): settings connect, show and revoke the
// person's phone keys (JWT, members); the phone endpoints take a phone key instead of a JWT.
// Keys and request bodies are never logged.
type WalletHandler struct {
	keys       repository.PhoneKeyRepository
	households repository.HouseholdRepository
	// Shortcut links from the environment (Р-17); empty — no Apple Pay card for that path.
	shortcutURL, shortcutURLLegacy string
	now                            func() time.Time
}

func NewWalletHandler(keys repository.PhoneKeyRepository, households repository.HouseholdRepository, shortcutURL, shortcutURLLegacy string) *WalletHandler {
	return &WalletHandler{keys: keys, households: households, shortcutURL: shortcutURL, shortcutURLLegacy: shortcutURLLegacy, now: time.Now}
}

type walletStatus struct {
	Connected         bool       `json:"connected"`
	Phones            int        `json:"phones"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	ShortcutURL       string     `json:"shortcut_url"`
	ShortcutURLLegacy string     `json:"shortcut_url_legacy"`
}

// Status — GET /api/wallet (member): connected phones and the shortcut links.
func (h *WalletHandler) Status(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	phones, last, err := h.keys.Status(r.Context(), userID)
	if err != nil {
		log.Printf("wallet: status: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read wallet status")
		return
	}
	respondJSON(w, http.StatusOK, walletStatus{
		Connected: phones > 0, Phones: phones, LastUsedAt: last,
		ShortcutURL: h.shortcutURL, ShortcutURLLegacy: h.shortcutURLLegacy,
	})
}

// Connect — POST /api/wallet/connect (member): a new key for one more phone. The only time a
// key leaves the server; it is not stored, only its hash.
func (h *WalletHandler) Connect(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	plain, hash, err := applepay.NewKey()
	if err == nil {
		err = h.keys.Add(r.Context(), userID, hash)
	}
	if err != nil {
		log.Printf("wallet: connect: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to connect")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusCreated, map[string]string{"key": plain})
}

// Disconnect — DELETE /api/wallet (member): revokes all the person's phone keys. 204, also
// when there were none.
func (h *WalletHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	if err := h.keys.DeleteAll(r.Context(), userID); err != nil {
		log.Printf("wallet: disconnect: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to disconnect")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// KeyAuth guards the phone endpoints: a live phone key (401 otherwise, no details), then the
// household and role from the database on every request — a viewer or a person without a
// household gets 403. The caller lands in the context like a JWT caller.
func (h *WalletHandler) KeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		plain, ok := applepay.ParseBearer(r.Header.Get("Authorization"))
		if !ok {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		userID, err := h.keys.UserByHash(r.Context(), applepay.HashKey(plain))
		if errors.Is(err, repository.ErrPhoneKeyNotFound) {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err != nil {
			log.Printf("wallet: key: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to check key")
			return
		}
		m, _, err := h.households.GetMembership(r.Context(), userID)
		if errors.Is(err, repository.ErrMembershipNotFound) {
			errorJSON(w, http.StatusForbidden, "forbidden")
			return
		}
		if err != nil {
			log.Printf("wallet: membership: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to check key")
			return
		}
		if m.Role != "member" {
			errorJSON(w, http.StatusForbidden, "forbidden")
			return
		}
		ctx := auth.WithMembership(r.Context(), userID, auth.Membership{HouseholdID: m.HouseholdID, Role: m.Role, Slot: m.Slot})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

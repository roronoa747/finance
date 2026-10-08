package handlers

import (
	"log"
	"net/http"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// AccountHandler deletes the signed-in account with its data (B2C-24, Р-14).
type AccountHandler struct {
	accounts repository.AccountRepository
}

func NewAccountHandler(accounts repository.AccountRepository) *AccountHandler {
	return &AccountHandler{accounts: accounts}
}

// Delete is open to anyone signed in — member, viewer, without a household. 204; the
// token stops working at once (the middleware finds no user: 401).
func (h *AccountHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok || userID == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err := h.accounts.DeleteAccount(r.Context(), userID); err != nil {
		log.Printf("account deletion failed: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete account"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

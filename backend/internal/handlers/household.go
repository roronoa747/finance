package handlers

import (
	"errors"
	"net/http"
	"strings"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

type HouseholdHandler struct {
	householdRepo repository.HouseholdRepository
	tokens        *auth.TokenService
}

func NewHouseholdHandler(
	householdRepo repository.HouseholdRepository,
	tokens *auth.TokenService,
) *HouseholdHandler {
	return &HouseholdHandler{
		householdRepo: householdRepo,
		tokens:        tokens,
	}
}

type JoinRequest struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
}

type JoinResponse struct {
	Token  string                  `json:"token"`
	Member *models.HouseholdMember `json:"member"`
}

func (h *HouseholdHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	role, _ := auth.GetRole(r.Context())
	if role != "member" {
		respondJSON(w, http.StatusForbidden, map[string]string{"error": "only full members can create invites"})
		return
	}

	householdID, ok := auth.GetHouseholdID(r.Context())
	if !ok || strings.TrimSpace(householdID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	invite, err := h.householdRepo.CreateInvite(r.Context(), householdID, userID)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create invite"})
		return
	}

	respondJSON(w, http.StatusCreated, invite)
}

func (h *HouseholdHandler) JoinHousehold(w http.ResponseWriter, r *http.Request) {
	var req JoinRequest
	if !decodeJSONBody(w, r, 1<<20, &req) {
		return
	}

	req.Code = strings.TrimSpace(req.Code)
	if req.Code == "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invite code is required"})
		return
	}

	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	member, err := h.householdRepo.JoinHousehold(r.Context(), req.Code, userID, req.DisplayName)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrInviteNotFound):
			respondJSON(w, http.StatusNotFound, map[string]string{"error": "invite code not found"})
		case errors.Is(err, repository.ErrInviteAlreadyUsed):
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invite code has already been used"})
		case errors.Is(err, repository.ErrInviteExpired):
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invite code has expired"})
		case errors.Is(err, repository.ErrHouseholdFull):
			respondJSON(w, http.StatusBadRequest, map[string]string{"error": "household has maximum members"})
		default:
			respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to join household"})
		}
		return
	}

	// Issue updated token with new household and assigned slot
	token, err := h.tokens.GenerateToken(userID, member.HouseholdID, member.Role, member.Slot)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	respondJSON(w, http.StatusOK, JoinResponse{
		Token:  token,
		Member: member,
	})
}

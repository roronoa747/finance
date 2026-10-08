package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

type HouseholdHandler struct {
	userRepo      repository.UserRepository
	householdRepo repository.HouseholdRepository
	tokens        *auth.TokenService
}

func NewHouseholdHandler(
	userRepo repository.UserRepository,
	householdRepo repository.HouseholdRepository,
	tokens *auth.TokenService,
) *HouseholdHandler {
	return &HouseholdHandler{
		userRepo:      userRepo,
		householdRepo: householdRepo,
		tokens:        tokens,
	}
}

type CreateHouseholdRequest struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
}

// HouseholdMemberView is a member as the household sees them: no user id, no email.
type HouseholdMemberView struct {
	Slot        string    `json:"slot"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	JoinedAt    time.Time `json:"joined_at"`
}

// inHousehold reports whether the signed-in user already has a household (from the
// database — the middleware put it into the context).
func inHousehold(r *http.Request) bool {
	id, _ := auth.GetHouseholdID(r.Context())
	return strings.TrimSpace(id) != ""
}

// CreateHousehold is "с кем → один / создать семью" (B2C-23, Р-7): a user without a
// household creates one (slot a, documents) and gets a token with it. One person is a
// household too.
func (h *HouseholdHandler) CreateHousehold(w http.ResponseWriter, r *http.Request) {
	var req CreateHouseholdRequest
	if !decodeJSONBody(w, r, 16<<10, &req) {
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "display_name is required"})
		return
	}
	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if inHousehold(r) {
		respondJSON(w, http.StatusConflict, map[string]string{"error": "already in household"})
		return
	}

	user, err := h.userRepo.GetByID(r.Context(), userID)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load user"})
		return
	}
	household, member, err := h.householdRepo.CreateHousehold(r.Context(), strings.TrimSpace(req.Name), userID, req.DisplayName)
	if err != nil {
		if errors.Is(err, repository.ErrAlreadyInHousehold) {
			respondJSON(w, http.StatusConflict, map[string]string{"error": "already in household"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create household"})
		return
	}
	token, err := h.tokens.GenerateToken(userID, household.ID, member.Role, member.Slot)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}
	respondJSON(w, http.StatusCreated, AuthResponse{Token: token, User: user, Household: household, Member: member})
}

// Members lists the household's members to member and viewer (B2C-23): who is in the
// family and with which role — the document's people do not know roles.
func (h *HouseholdHandler) Members(w http.ResponseWriter, r *http.Request) {
	if role, _ := auth.GetRole(r.Context()); role != "member" && role != "viewer" {
		respondJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	householdID, _ := auth.GetHouseholdID(r.Context())
	members, err := h.householdRepo.GetMembers(r.Context(), householdID)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list members"})
		return
	}
	out := make([]HouseholdMemberView, 0, len(members))
	for _, m := range members {
		out = append(out, HouseholdMemberView{Slot: m.Slot, DisplayName: m.DisplayName, Role: m.Role, JoinedAt: m.JoinedAt})
	}
	respondJSON(w, http.StatusOK, map[string]any{"members": out})
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
	// "По коду" is for a user without a household (B2C-23); moving between households is out of scope.
	if inHousehold(r) {
		respondJSON(w, http.StatusConflict, map[string]string{"error": "already in household"})
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
		case errors.Is(err, repository.ErrAlreadyInHousehold):
			respondJSON(w, http.StatusConflict, map[string]string{"error": "already in household"})
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

package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

type AuthHandler struct {
	userRepo      repository.UserRepository
	householdRepo repository.HouseholdRepository
	tokens        *auth.TokenService
}

func NewAuthHandler(
	userRepo repository.UserRepository,
	householdRepo repository.HouseholdRepository,
	tokens *auth.TokenService,
) *AuthHandler {
	return &AuthHandler{
		userRepo:      userRepo,
		householdRepo: householdRepo,
		tokens:        tokens,
	}
}

type RegisterRequest struct {
	Email         string `json:"email"`
	Password      string `json:"password"`
	DisplayName   string `json:"display_name"`
	HouseholdName string `json:"household_name"`
}

type AuthResponse struct {
	Token     string                  `json:"token"`
	User      *models.User            `json:"user"`
	Household *models.Household       `json:"household"`
	Member    *models.HouseholdMember `json:"member"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "valid email is required"})
		return
	}

	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// 1. Create user
	user, err := h.userRepo.Create(r.Context(), req.Email, passwordHash)
	if err != nil {
		if errors.Is(err, repository.ErrUserAlreadyExists) {
			respondJSON(w, http.StatusConflict, map[string]string{"error": "user already exists"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
		return
	}

	// 2. Create household and initial membership (slot 'a')
	household, member, err := h.householdRepo.CreateHousehold(r.Context(), req.HouseholdName, user.ID, req.DisplayName)
	if err != nil {
		_ = h.userRepo.Delete(r.Context(), user.ID)
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create household"})
		return
	}

	// 3. Issue token
	token, err := h.tokens.GenerateToken(user.ID, household.ID, member.Role, member.Slot)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	respondJSON(w, http.StatusCreated, AuthResponse{
		Token:     token,
		User:      user,
		Household: household,
		Member:    member,
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" || req.Password == "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}

	user, err := h.userRepo.GetByEmail(r.Context(), req.Email)
	if err != nil {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	if !auth.CheckPassword(user.PasswordHash, req.Password) {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	member, household, err := h.householdRepo.GetMembership(r.Context(), user.ID)
	if err != nil {
		if errors.Is(err, repository.ErrMembershipNotFound) {
			respondJSON(w, http.StatusNotFound, map[string]string{"error": "household membership not found"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load household membership"})
		return
	}

	token, err := h.tokens.GenerateToken(user.ID, household.ID, member.Role, member.Slot)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	respondJSON(w, http.StatusOK, AuthResponse{
		Token:     token,
		User:      user,
		Household: household,
		Member:    member,
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	user, err := h.userRepo.GetByID(r.Context(), userID)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}

	member, household, err := h.householdRepo.GetMembership(r.Context(), userID)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "membership not found"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"user":      user,
		"household": household,
		"member":    member,
	})
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

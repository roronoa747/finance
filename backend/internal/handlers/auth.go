package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"finance-backend/internal/auth"
	"finance-backend/internal/googleauth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// GoogleVerifier checks a Google ID token (googleauth.Verifier; a fake in tests).
type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (*googleauth.Identity, error)
}

type AuthHandler struct {
	userRepo      repository.UserRepository
	householdRepo repository.HouseholdRepository
	tokens        *auth.TokenService
	google        GoogleVerifier // nil: GOOGLE_CLIENT_IDS is not set
}

func NewAuthHandler(
	userRepo repository.UserRepository,
	householdRepo repository.HouseholdRepository,
	tokens *auth.TokenService,
	google GoogleVerifier,
) *AuthHandler {
	return &AuthHandler{
		userRepo:      userRepo,
		householdRepo: householdRepo,
		tokens:        tokens,
		google:        google,
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
	if !decodeJSONBody(w, r, 1<<20, &req) {
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
		// Compensate even if the client has gone: a cancelled request context is
		// the likeliest cause of this failure and would otherwise abort the delete.
		if delErr := h.userRepo.Delete(context.WithoutCancel(r.Context()), user.ID); delErr != nil {
			log.Printf("register: failed to remove orphan user %s: %v", user.ID, delErr)
		}
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
	if !decodeJSONBody(w, r, 1<<20, &req) {
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

	// A Google-only user has no hash to check — the same answer as a wrong one.
	if user.PasswordHash == "" || !auth.CheckPassword(user.PasswordHash, req.Password) {
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

type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// GoogleLogin signs in with a Google ID token (B2C-22, Р-13): the user by Google account,
// else by email (an existing user is linked), else a new one — without a password and
// without a household (Р-25: then "с кем"). 201 for a new user, 200 otherwise.
func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if h.google == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "google sign-in is not configured"})
		return
	}
	var req GoogleLoginRequest
	if !decodeJSONBody(w, r, 16<<10, &req) {
		return
	}
	if strings.TrimSpace(req.IDToken) == "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token is required"})
		return
	}

	id, err := h.google.Verify(r.Context(), strings.TrimSpace(req.IDToken))
	if err != nil {
		if errors.Is(err, googleauth.ErrUnavailable) {
			log.Printf("google sign-in: keys unavailable")
			respondJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "google sign-in is unavailable"})
			return
		}
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid google token"})
		return
	}

	status := http.StatusOK
	user, err := h.userRepo.GetByGoogleSub(r.Context(), id.Sub)
	if errors.Is(err, repository.ErrUserNotFound) {
		user, err = h.userRepo.GetByEmail(r.Context(), id.Email)
		switch {
		case err == nil && user.GoogleSub != "" && user.GoogleSub != id.Sub:
			// The email belongs to an account linked to another Google account.
			respondJSON(w, http.StatusConflict, map[string]string{"error": "email is linked to another google account"})
			return
		case err == nil:
			user, err = h.userRepo.LinkGoogle(r.Context(), user.ID, id.Sub, id.Name)
		case errors.Is(err, repository.ErrUserNotFound):
			user, err = h.userRepo.CreateGoogle(r.Context(), id.Email, id.Sub, id.Name)
			status = http.StatusCreated
		}
	}
	if err != nil {
		if errors.Is(err, repository.ErrUserAlreadyExists) {
			// A concurrent first sign-in won the race: the client retries and is found.
			respondJSON(w, http.StatusConflict, map[string]string{"error": "user already exists"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to sign in"})
		return
	}

	resp, err := h.authResponse(r.Context(), user)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to sign in"})
		return
	}
	respondJSON(w, status, resp)
}

// authResponse issues a token for the user's household now — or one without a household
// (Household and Member null) for a user who has none yet.
func (h *AuthHandler) authResponse(ctx context.Context, user *models.User) (*AuthResponse, error) {
	member, household, err := h.householdRepo.GetMembership(ctx, user.ID)
	if err != nil && !errors.Is(err, repository.ErrMembershipNotFound) {
		return nil, err
	}
	var token string
	if member != nil {
		token, err = h.tokens.GenerateToken(user.ID, household.ID, member.Role, member.Slot)
	} else {
		token, err = h.tokens.GenerateToken(user.ID, "", "", "")
	}
	if err != nil {
		return nil, err
	}
	return &AuthResponse{Token: token, User: user, Household: household, Member: member}, nil
}

// Me answers who is signed in; household and member are null for a user without a household.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	user, err := h.userRepo.GetByID(r.Context(), userID)
	if errors.Is(err, repository.ErrUserNotFound) {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load user"})
		return
	}

	member, household, err := h.householdRepo.GetMembership(r.Context(), userID)
	if err != nil && !errors.Is(err, repository.ErrMembershipNotFound) {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load household membership"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"user":      user,
		"household": household,
		"member":    member,
	})
}

// decodeJSONBody reads at most limit bytes of JSON into dst. On failure it has
// already answered: 413 when the body exceeds the limit, 400 when it is malformed.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, limit int64, dst interface{}) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			respondJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body too large"})
			return false
		}
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return false
	}
	return true
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

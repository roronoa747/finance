package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"finance-backend/internal/models"
)

// MockRepositories holds in-memory stores for testing.
type MockRepositories struct {
	Users      *MockUserRepo
	Households *MockHouseholdRepo
	Docs       *MockDocRepo
}

func NewMockRepositories() *MockRepositories {
	return &MockRepositories{
		Users:      NewMockUserRepo(),
		Households: NewMockHouseholdRepo(),
		Docs:       NewMockDocRepo(),
	}
}

// --- MockUserRepo ---

type MockUserRepo struct {
	mu      sync.RWMutex
	users   map[string]*models.User // id -> User
	byEmail map[string]*models.User
}

func NewMockUserRepo() *MockUserRepo {
	return &MockUserRepo{
		users:   make(map[string]*models.User),
		byEmail: make(map[string]*models.User),
	}
}

func (m *MockUserRepo) Create(ctx context.Context, email, passwordHash string) (*models.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	if _, exists := m.byEmail[cleanEmail]; exists {
		return nil, ErrUserAlreadyExists
	}

	user := &models.User{
		ID:           uuid.New().String(),
		Email:        cleanEmail,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now(),
	}
	m.users[user.ID] = user
	m.byEmail[cleanEmail] = user
	return user, nil
}

func (m *MockUserRepo) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	user, exists := m.byEmail[strings.ToLower(strings.TrimSpace(email))]
	if !exists {
		return nil, ErrUserNotFound
	}
	return user, nil
}

func (m *MockUserRepo) GetByID(ctx context.Context, id string) (*models.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	user, exists := m.users[id]
	if !exists {
		return nil, ErrUserNotFound
	}
	return user, nil
}

func (m *MockUserRepo) Delete(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	user, exists := m.users[id]
	if !exists {
		return nil
	}
	delete(m.users, id)
	delete(m.byEmail, user.Email)
	return nil
}

// --- MockHouseholdRepo ---

type MockHouseholdRepo struct {
	mu         sync.RWMutex
	households map[string]*models.Household
	members    map[string][]*models.HouseholdMember // householdID -> members
	invites    map[string]*models.HouseholdInvite   // code -> invite
	docs       *MockDocRepo
}

func NewMockHouseholdRepo() *MockHouseholdRepo {
	return &MockHouseholdRepo{
		households: make(map[string]*models.Household),
		members:    make(map[string][]*models.HouseholdMember),
		invites:    make(map[string]*models.HouseholdInvite),
	}
}

func (m *MockHouseholdRepo) SetDocRepo(docs *MockDocRepo) {
	m.docs = docs
}

func (m *MockHouseholdRepo) CreateHousehold(ctx context.Context, name, creatorID, creatorDisplayName string) (*models.Household, *models.HouseholdMember, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if strings.TrimSpace(name) == "" {
		name = "Наша казна"
	}
	if strings.TrimSpace(creatorDisplayName) == "" {
		creatorDisplayName = "Участник"
	}

	h := &models.Household{
		ID:        uuid.New().String(),
		Name:      name,
		CreatedBy: creatorID,
		CreatedAt: time.Now(),
	}
	m.households[h.ID] = h

	member := &models.HouseholdMember{
		HouseholdID: h.ID,
		UserID:      creatorID,
		Slot:        "a",
		DisplayName: creatorDisplayName,
		Role:        "member",
		JoinedAt:    time.Now(),
	}
	m.members[h.ID] = []*models.HouseholdMember{member}

	if m.docs != nil {
		_ = m.docs.InitDocs(h.ID, creatorID)
	}

	return h, member, nil
}

func (m *MockHouseholdRepo) GetHousehold(ctx context.Context, householdID string) (*models.Household, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	h, exists := m.households[householdID]
	if !exists {
		return nil, ErrHouseholdNotFound
	}
	return h, nil
}

func (m *MockHouseholdRepo) GetMembership(ctx context.Context, userID string) (*models.HouseholdMember, *models.Household, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var latestMember *models.HouseholdMember
	var latestHousehold *models.Household

	for hID, memberList := range m.members {
		for _, member := range memberList {
			if member.UserID == userID {
				if latestMember == nil || member.JoinedAt.After(latestMember.JoinedAt) {
					latestMember = member
					latestHousehold = m.households[hID]
				}
			}
		}
	}

	if latestMember != nil {
		return latestMember, latestHousehold, nil
	}
	return nil, nil, ErrMembershipNotFound
}

func (m *MockHouseholdRepo) GetMembers(ctx context.Context, householdID string) ([]models.HouseholdMember, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list, exists := m.members[householdID]
	if !exists {
		return []models.HouseholdMember{}, nil
	}
	result := make([]models.HouseholdMember, len(list))
	for i, item := range list {
		result[i] = *item
	}
	return result, nil
}

func (m *MockHouseholdRepo) CreateInvite(ctx context.Context, householdID, creatorID string) (*models.HouseholdInvite, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	codeBytes := make([]byte, 4)
	_, _ = rand.Read(codeBytes)
	code := strings.ToUpper(hex.EncodeToString(codeBytes))

	inv := &models.HouseholdInvite{
		Code:        code,
		HouseholdID: householdID,
		CreatedBy:   creatorID,
		CreatedAt:   time.Now(),
		ExpiresAt:   time.Now().Add(14 * 24 * time.Hour),
	}
	m.invites[code] = inv
	return inv, nil
}

func (m *MockHouseholdRepo) GetInvite(ctx context.Context, code string) (*models.HouseholdInvite, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	inv, exists := m.invites[strings.ToUpper(strings.TrimSpace(code))]
	if !exists {
		return nil, ErrInviteNotFound
	}
	return inv, nil
}

func (m *MockHouseholdRepo) JoinHousehold(ctx context.Context, code, userID, displayName string) (*models.HouseholdMember, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanCode := strings.ToUpper(strings.TrimSpace(code))
	inv, exists := m.invites[cleanCode]
	if !exists {
		return nil, ErrInviteNotFound
	}
	if inv.UsedAt != nil {
		return nil, ErrInviteAlreadyUsed
	}
	if time.Now().After(inv.ExpiresAt) {
		return nil, ErrInviteExpired
	}

	members := m.members[inv.HouseholdID]
	for _, existing := range members {
		if existing.UserID == userID {
			return existing, nil
		}
	}

	usedSlots := make(map[string]bool)
	for _, mem := range members {
		usedSlots[mem.Slot] = true
	}

	var assignedSlot string
	for _, candidate := range []string{"a", "b", "c"} {
		if !usedSlots[candidate] {
			assignedSlot = candidate
			break
		}
	}
	if assignedSlot == "" {
		return nil, ErrHouseholdFull
	}

	if strings.TrimSpace(displayName) == "" {
		displayName = "Участник"
	}

	newMember := &models.HouseholdMember{
		HouseholdID: inv.HouseholdID,
		UserID:      userID,
		Slot:        assignedSlot,
		DisplayName: displayName,
		Role:        "member",
		JoinedAt:    time.Now(),
	}
	m.members[inv.HouseholdID] = append(m.members[inv.HouseholdID], newMember)

	now := time.Now()
	inv.UsedBy = &userID
	inv.UsedAt = &now

	if m.docs != nil {
		_ = m.docs.InitPrivateDoc(inv.HouseholdID, userID)
	}

	return newMember, nil
}

// --- MockDocRepo ---

// keepStoredKeys mirrors keepStoredKeysSQL (doc_repo.go): top-level keys the
// pushed document lacks come from the stored one; anything but two objects is
// stored as sent.
func keepStoredKeys(stored, pushed json.RawMessage) json.RawMessage {
	var s, p map[string]json.RawMessage
	if json.Unmarshal(stored, &s) != nil || json.Unmarshal(pushed, &p) != nil || s == nil || p == nil {
		return pushed
	}
	for k, v := range s {
		if _, ok := p[k]; !ok {
			p[k] = v
		}
	}
	out, err := json.Marshal(p)
	if err != nil {
		return pushed
	}
	return out
}

type MockDocRepo struct {
	mu            sync.RWMutex
	householdDocs map[string]*models.HouseholdDoc          // householdID -> doc
	privateDocs   map[string]map[string]*models.PrivateDoc // householdID -> userID -> doc
}

func NewMockDocRepo() *MockDocRepo {
	return &MockDocRepo{
		householdDocs: make(map[string]*models.HouseholdDoc),
		privateDocs:   make(map[string]map[string]*models.PrivateDoc),
	}
}

func (m *MockDocRepo) InitDocs(householdID, creatorID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.householdDocs[householdID] = &models.HouseholdDoc{
		HouseholdID: householdID,
		Rev:         1,
		Data:        json.RawMessage("{}"),
		UpdatedAt:   time.Now(),
		UpdatedBy:   &creatorID,
	}

	if _, exists := m.privateDocs[householdID]; !exists {
		m.privateDocs[householdID] = make(map[string]*models.PrivateDoc)
	}
	m.privateDocs[householdID][creatorID] = &models.PrivateDoc{
		HouseholdID: householdID,
		UserID:      creatorID,
		Rev:         1,
		Data:        json.RawMessage("{}"),
		UpdatedAt:   time.Now(),
	}
	return nil
}

func (m *MockDocRepo) InitPrivateDoc(householdID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.privateDocs[householdID]; !exists {
		m.privateDocs[householdID] = make(map[string]*models.PrivateDoc)
	}
	m.privateDocs[householdID][userID] = &models.PrivateDoc{
		HouseholdID: householdID,
		UserID:      userID,
		Rev:         1,
		Data:        json.RawMessage("{}"),
		UpdatedAt:   time.Now(),
	}
	return nil
}

func (m *MockDocRepo) GetHouseholdDoc(ctx context.Context, householdID string) (*models.HouseholdDoc, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	doc, exists := m.householdDocs[householdID]
	if !exists {
		return nil, ErrDocNotFound
	}
	return doc, nil
}

func (m *MockDocRepo) PushHouseholdDoc(ctx context.Context, householdID string, expectedRev int64, data json.RawMessage, updatedBy string) (*models.HouseholdDoc, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	doc, exists := m.householdDocs[householdID]
	if !exists {
		return nil, false, ErrDocNotFound
	}

	if doc.Rev != expectedRev {
		return doc, true, nil
	}

	newDoc := &models.HouseholdDoc{
		HouseholdID: householdID,
		Rev:         doc.Rev + 1,
		Data:        keepStoredKeys(doc.Data, data),
		UpdatedAt:   time.Now(),
		UpdatedBy:   &updatedBy,
	}
	m.householdDocs[householdID] = newDoc
	return newDoc, false, nil
}

func (m *MockDocRepo) GetPrivateDoc(ctx context.Context, householdID, userID string) (*models.PrivateDoc, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	userDocs, exists := m.privateDocs[householdID]
	if !exists {
		return &models.PrivateDoc{
			HouseholdID: householdID,
			UserID:      userID,
			Rev:         1,
			Data:        json.RawMessage("{}"),
			UpdatedAt:   time.Now(),
		}, nil
	}

	doc, docExists := userDocs[userID]
	if !docExists {
		return &models.PrivateDoc{
			HouseholdID: householdID,
			UserID:      userID,
			Rev:         1,
			Data:        json.RawMessage("{}"),
			UpdatedAt:   time.Now(),
		}, nil
	}

	return doc, nil
}

func (m *MockDocRepo) PushPrivateDoc(ctx context.Context, householdID, userID string, expectedRev int64, data json.RawMessage) (*models.PrivateDoc, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.privateDocs[householdID]; !exists {
		m.privateDocs[householdID] = make(map[string]*models.PrivateDoc)
	}

	doc, exists := m.privateDocs[householdID][userID]
	if !exists {
		newDoc := &models.PrivateDoc{
			HouseholdID: householdID,
			UserID:      userID,
			Rev:         1,
			Data:        data,
			UpdatedAt:   time.Now(),
		}
		m.privateDocs[householdID][userID] = newDoc
		return newDoc, false, nil
	}

	if doc.Rev != expectedRev {
		return doc, true, nil
	}

	newDoc := &models.PrivateDoc{
		HouseholdID: householdID,
		UserID:      userID,
		Rev:         doc.Rev + 1,
		Data:        keepStoredKeys(doc.Data, data),
		UpdatedAt:   time.Now(),
	}
	m.privateDocs[householdID][userID] = newDoc
	return newDoc, false, nil
}

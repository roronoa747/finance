package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
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
	Statements *MockStatementRepo
	Photos     *MockPhotoRepo
	Fx         *MockFxRepo
}

func NewMockRepositories() *MockRepositories {
	households := NewMockHouseholdRepo()
	return &MockRepositories{
		Users:      NewMockUserRepo(),
		Households: households,
		Docs:       NewMockDocRepo(),
		Statements: NewMockStatementRepo(households),
		Photos:     NewMockPhotoRepo(),
		Fx:         NewMockFxRepo(),
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

func (m *MockUserRepo) GetByGoogleSub(ctx context.Context, sub string) (*models.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, user := range m.users {
		if user.GoogleSub != "" && user.GoogleSub == sub {
			return user, nil
		}
	}
	return nil, ErrUserNotFound
}

func (m *MockUserRepo) CreateGoogle(ctx context.Context, email, sub, name string) (*models.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	if _, exists := m.byEmail[cleanEmail]; exists {
		return nil, ErrUserAlreadyExists
	}
	for _, user := range m.users {
		if user.GoogleSub == sub {
			return nil, ErrUserAlreadyExists
		}
	}

	user := &models.User{
		ID:          uuid.New().String(),
		Email:       cleanEmail,
		GoogleSub:   sub,
		DisplayName: name,
		CreatedAt:   time.Now(),
	}
	m.users[user.ID] = user
	m.byEmail[cleanEmail] = user
	return user, nil
}

func (m *MockUserRepo) LinkGoogle(ctx context.Context, id, sub, name string) (*models.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	user, exists := m.users[id]
	if !exists {
		return nil, ErrUserNotFound
	}
	for _, other := range m.users {
		if other.ID != id && other.GoogleSub == sub {
			return nil, ErrUserAlreadyExists
		}
	}
	user.GoogleSub = sub
	if user.DisplayName == "" {
		user.DisplayName = name
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
	lastJoin   time.Time
}

// joinTime is strictly increasing: Windows clocks tick coarsely, and GetMembership
// picks the latest join. Callers hold mu.
func (m *MockHouseholdRepo) joinTime() time.Time {
	now := time.Now()
	if !now.After(m.lastJoin) {
		now = m.lastJoin.Add(time.Microsecond)
	}
	m.lastJoin = now
	return now
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
		JoinedAt:    m.joinTime(),
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

// SetRole changes a member's role — tests only: the app has no route for it, the owner
// does it in SQL.
func (m *MockHouseholdRepo) SetRole(householdID, userID, role string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, member := range m.members[householdID] {
		if member.UserID == userID {
			member.Role = role
		}
	}
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
		JoinedAt:    m.joinTime(),
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

// --- MockStatementRepo ---

type mockUpload struct {
	upload      models.StatementUpload
	householdID string
	userID      string
}

type mockOperation struct {
	op          models.Operation
	householdID string
}

// MockStatementRepo keeps uploads and operations in memory; like PostgreSQL, a
// batch shares one updated_at and timestamps only move forward.
type MockStatementRepo struct {
	mu         sync.Mutex
	households *MockHouseholdRepo
	uploads    []mockUpload
	ops        map[string]map[string]*mockOperation // userID -> id -> operation
	lastStamp  time.Time
}

func NewMockStatementRepo(households *MockHouseholdRepo) *MockStatementRepo {
	return &MockStatementRepo{households: households, ops: make(map[string]map[string]*mockOperation)}
}

func (m *MockStatementRepo) slotOf(ctx context.Context, householdID, userID string) string {
	members, _ := m.households.GetMembers(ctx, householdID)
	for _, member := range members {
		if member.UserID == userID {
			return member.Slot
		}
	}
	return ""
}

func (m *MockStatementRepo) CreateUpload(ctx context.Context, householdID, userID string, in UploadInput) (*models.StatementUpload, error) {
	slot := m.slotOf(ctx, householdID, userID)
	m.mu.Lock()
	defer m.mu.Unlock()
	u := models.StatementUpload{
		ID:         uuid.New().String(),
		Slot:       slot,
		Bank:       in.Bank,
		PeriodFrom: in.PeriodFrom,
		PeriodTo:   in.PeriodTo,
		OpsCount:   in.OpsCount,
		CreatedAt:  m.stamp(),
	}
	m.uploads = append(m.uploads, mockUpload{upload: u, householdID: householdID, userID: userID})
	return &u, nil
}

func (m *MockStatementRepo) ListUploads(ctx context.Context, householdID string, limit int) ([]models.StatementUpload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []models.StatementUpload{}
	for i := len(m.uploads) - 1; i >= 0 && len(out) < limit; i-- {
		if m.uploads[i].householdID == householdID {
			out = append(out, m.uploads[i].upload)
		}
	}
	return out, nil
}

func (m *MockStatementRepo) UpsertOperations(ctx context.Context, userID, householdID string, ops []models.Operation) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ops = lastByID(ops)
	now := m.stamp()
	if m.ops[userID] == nil {
		m.ops[userID] = make(map[string]*mockOperation)
	}
	for _, op := range ops {
		op.UpdatedAt = now
		if op.UploadID != nil && !m.ownsUpload(userID, *op.UploadID) {
			op.UploadID = nil
		}
		if prev, ok := m.ops[userID][op.ID]; ok && op.UploadID == nil {
			op.UploadID = prev.op.UploadID
		}
		m.ops[userID][op.ID] = &mockOperation{op: op, householdID: householdID}
	}
	return len(ops), nil
}

func (m *MockStatementRepo) ListOperations(ctx context.Context, userID string, since time.Time, limit int) ([]models.Operation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	all := []models.Operation{}
	for _, o := range m.ops[userID] {
		if o.op.UpdatedAt.After(since) {
			all = append(all, o.op)
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if !all[i].UpdatedAt.Equal(all[j].UpdatedAt) {
			return all[i].UpdatedAt.Before(all[j].UpdatedAt)
		}
		return all[i].ID < all[j].ID
	})
	if len(all) <= limit {
		return all, nil
	}
	// A page does not end inside one updated_at (see StatementRepository).
	end := limit
	for end < len(all) && all[end].UpdatedAt.Equal(all[limit-1].UpdatedAt) {
		end++
	}
	return all[:end], nil
}

func (m *MockStatementRepo) ownsUpload(userID, uploadID string) bool {
	for _, u := range m.uploads {
		if u.upload.ID == uploadID && u.userID == userID {
			return true
		}
	}
	return false
}

// stamp is a strictly increasing clock with PostgreSQL's microsecond precision.
func (m *MockStatementRepo) stamp() time.Time {
	now := time.Now().UTC().Truncate(time.Microsecond)
	if !now.After(m.lastStamp) {
		now = m.lastStamp.Add(time.Microsecond)
	}
	m.lastStamp = now
	return now
}

// --- MockPhotoRepo ---

type mockPhoto struct {
	photo models.Photo
	data  []byte
}

// MockPhotoRepo keeps photos in memory (B2C-16).
type MockPhotoRepo struct {
	mu     sync.Mutex
	photos map[string]*mockPhoto
}

func NewMockPhotoRepo() *MockPhotoRepo {
	return &MockPhotoRepo{photos: make(map[string]*mockPhoto)}
}

func (m *MockPhotoRepo) Create(ctx context.Context, householdID, userID string, in PhotoInput) (*models.Photo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := models.Photo{
		ID: uuid.New().String(), HouseholdID: householdID, UserID: userID, Hidden: in.Hidden,
		ContentType: in.ContentType, Size: len(in.Data), CreatedAt: time.Now().UTC(),
	}
	m.photos[p.ID] = &mockPhoto{photo: p, data: append([]byte(nil), in.Data...)}
	return &p, nil
}

func (m *MockPhotoRepo) Get(ctx context.Context, id string) (*models.Photo, []byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.photos[id]
	if !ok {
		return nil, nil, ErrPhotoNotFound
	}
	photo := p.photo
	return &photo, append([]byte(nil), p.data...), nil
}

func (m *MockPhotoRepo) Delete(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.photos[id]; !ok {
		return ErrPhotoNotFound
	}
	delete(m.photos, id)
	return nil
}

// Count is for tests: how many photos are stored.
func (m *MockPhotoRepo) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.photos)
}

// --- MockFxRepo ---

// MockFxRepo keeps the rate history in memory (B2C-76).
type MockFxRepo struct {
	mu    sync.Mutex
	rates map[string]map[string]float64 // day → code → rate
	days  map[string]bool               // day → published
	saves int
}

func NewMockFxRepo() *MockFxRepo {
	return &MockFxRepo{rates: make(map[string]map[string]float64), days: make(map[string]bool)}
}

func (m *MockFxRepo) Rates(ctx context.Context, code string, from, to time.Time) (map[string]float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]float64)
	lo, hi := DayKey(from), DayKey(to)
	for day, byCode := range m.rates {
		if v, ok := byCode[code]; ok && day >= lo && day <= hi {
			out[day] = v
		}
	}
	return out, nil
}

func (m *MockFxRepo) Checked(ctx context.Context, from, to time.Time) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]bool)
	lo, hi := DayKey(from), DayKey(to)
	for day, published := range m.days {
		if day >= lo && day <= hi {
			out[day] = published
		}
	}
	return out, nil
}

func (m *MockFxRepo) Save(ctx context.Context, day time.Time, rates map[string]float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := DayKey(day)
	m.saves++
	if m.rates[key] == nil {
		m.rates[key] = make(map[string]float64)
	}
	for code, v := range rates {
		m.rates[key][code] = v
	}
	m.days[key] = m.days[key] || len(rates) > 0
	return nil
}

// Saves is for tests: how many days were written.
func (m *MockFxRepo) Saves() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.saves
}

package repository

import (
	"context"
	"slices"
	"sort"
	"time"
)

type remainingMember struct {
	userID, slot string
	at           time.Time
}

// MockAccountRepo mirrors sqlAccountRepository over the other in-memory stores.
type MockAccountRepo struct {
	users      *MockUserRepo
	households *MockHouseholdRepo
	docs       *MockDocRepo
	statements *MockStatementRepo
	photos     *MockPhotoRepo
}

func NewMockAccountRepo(m *MockRepositories) *MockAccountRepo {
	return &MockAccountRepo{users: m.Users, households: m.Households, docs: m.Docs, statements: m.Statements, photos: m.Photos}
}

func (a *MockAccountRepo) DeleteAccount(ctx context.Context, userID string) error {
	// Households: the last member's goes away whole, otherwise the creator is handed over.
	var gone []string
	h := a.households
	h.mu.Lock()
	for id, household := range h.households {
		members := h.members[id]
		var others []remainingMember
		isMember := false
		for _, m := range members {
			if m.UserID == userID {
				isMember = true
				continue
			}
			others = append(others, remainingMember{m.UserID, m.Slot, m.JoinedAt})
		}
		if !isMember && household.CreatedBy != userID {
			continue
		}
		if len(others) == 0 {
			gone = append(gone, id)
			delete(h.households, id)
			delete(h.members, id)
			continue
		}
		sort.Slice(others, func(i, j int) bool {
			if !others[i].at.Equal(others[j].at) {
				return others[i].at.Before(others[j].at)
			}
			return others[i].slot < others[j].slot
		})
		if household.CreatedBy == userID {
			household.CreatedBy = others[0].userID
		}
		kept := members[:0]
		for _, m := range members {
			if m.UserID != userID {
				kept = append(kept, m)
			}
		}
		h.members[id] = kept
	}
	for code, inv := range h.invites {
		if inv.CreatedBy == userID || slices.Contains(gone, inv.HouseholdID) {
			delete(h.invites, code)
		} else if inv.UsedBy != nil && *inv.UsedBy == userID {
			inv.UsedBy = nil
		}
	}
	h.mu.Unlock()

	a.docs.mu.Lock()
	for _, id := range gone {
		delete(a.docs.householdDocs, id)
		delete(a.docs.privateDocs, id)
	}
	for _, byUser := range a.docs.privateDocs {
		delete(byUser, userID)
	}
	for _, doc := range a.docs.householdDocs {
		if doc.UpdatedBy != nil && *doc.UpdatedBy == userID {
			doc.UpdatedBy = nil
		}
	}
	a.docs.mu.Unlock()

	a.statements.mu.Lock()
	kept := a.statements.uploads[:0]
	for _, u := range a.statements.uploads {
		if u.userID != userID && !slices.Contains(gone, u.householdID) {
			kept = append(kept, u)
		}
	}
	a.statements.uploads = kept
	delete(a.statements.ops, userID)
	for _, ops := range a.statements.ops {
		for id, op := range ops {
			if slices.Contains(gone, op.householdID) {
				delete(ops, id)
			}
		}
	}
	a.statements.mu.Unlock()

	a.photos.mu.Lock()
	for id, p := range a.photos.photos {
		if p.photo.UserID == userID || slices.Contains(gone, p.photo.HouseholdID) {
			delete(a.photos.photos, id)
		}
	}
	a.photos.mu.Unlock()

	return a.users.Delete(ctx, userID)
}

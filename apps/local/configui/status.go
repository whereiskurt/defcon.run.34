package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

// StatusRegion is a region entry in apps/run.status/site/status.json.
type StatusRegion struct {
	ID       string `json:"id"`
	Deployed bool   `json:"deployed"`
}

// StatusService is a service entry in apps/run.status/site/status.json.
type StatusService struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Host    string `json:"host"`
	Link    string `json:"link,omitempty"`
	Version string `json:"version"`
	State   string `json:"state"`
	Note    string `json:"note"`
}

// StatusSite mirrors the schema of apps/run.status/site/status.json.
// The "updated" field is stamped by release.sh at publish time and is
// preserved (never restamped) when saving from the UI.
type StatusSite struct {
	Updated     string          `json:"updated"`
	PollSeconds int             `json:"poll_seconds"`
	Regions     []StatusRegion  `json:"regions"`
	Services    []StatusService `json:"services"`
}

// validStatusStates is the allowed set for a service's "state" field.
var validStatusStates = map[string]bool{"live": true, "dev": true, "down": true}

// LoadStatus reads and parses status.json from disk.
func LoadStatus(path string) (*StatusSite, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s StatusSite
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("parse status.json: %w", err)
	}
	return &s, nil
}

// ValidateStatus rejects any service whose state is not live/dev/down.
func ValidateStatus(s *StatusSite) error {
	for _, svc := range s.Services {
		if !validStatusStates[svc.State] {
			return fmt.Errorf("service %q has invalid state %q (must be one of live, dev, down)", svc.ID, svc.State)
		}
	}
	return nil
}

// SaveStatus validates then writes pretty-printed JSON back to status.json.
func SaveStatus(path string, s *StatusSite) error {
	if err := ValidateStatus(s); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// handleStatusSave persists an edited status.json posted as JSON. The incoming
// "updated" field is ignored — release.sh owns that timestamp, so the existing
// value on disk is preserved.
func (a *App) handleStatusSave(w http.ResponseWriter, r *http.Request) {
	var incoming StatusSite
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := ValidateStatus(&incoming); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Preserve the on-disk "updated" stamp — release.sh restamps it at publish.
	if existing, err := LoadStatus(a.statusPath); err == nil {
		incoming.Updated = existing.Updated
	}

	if err := SaveStatus(a.statusPath, &incoming); err != nil {
		http.Error(w, "failed to save status.json: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":   "saved",
		"path":     a.statusPath,
		"services": len(incoming.Services),
		"regions":  len(incoming.Regions),
	})
}

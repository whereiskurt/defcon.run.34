package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"sync"
)

// LockEntry represents a Terraform state lock found in DynamoDB.
type LockEntry struct {
	Table  string `json:"table"`
	Region string `json:"region"`
	LockID string `json:"lock_id"`
	Info   string `json:"info"`
}

// FixLocksResult is the JSON response from lock endpoints.
type FixLocksResult struct {
	Found   []LockEntry `json:"found"`
	Removed []LockEntry `json:"removed,omitempty"`
	Errors  []string    `json:"errors,omitempty"`
}

// lockTables returns the DynamoDB table name → region pairs from config.
func (a *App) lockTables() (profile string, tables []struct{ table, region string }) {
	a.mu.RLock()
	cfg := a.config
	envLocal := a.envLocal
	a.mu.RUnlock()

	profile = "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	prefix := cfg.Site.TFStatePrefix
	suffix := cfg.Site.RandomSuffix
	for _, r := range AllRegions() {
		tableName := fmt.Sprintf("%s-%s-%s", prefix, r.Label, suffix)
		tables = append(tables, struct{ table, region string }{table: tableName, region: r.Full})
	}
	return
}

// scanLocks scans all DynamoDB state tables for stuck lock entries.
func (a *App) scanLocks() FixLocksResult {
	profile, tables := a.lockTables()

	var mu sync.Mutex
	var wg sync.WaitGroup
	result := FixLocksResult{}

	for _, tr := range tables {
		wg.Add(1)
		go func(table, region string) {
			defer wg.Done()

			out, err := exec.Command("aws", "dynamodb", "scan",
				"--table-name", table,
				"--filter-expression", "attribute_exists(Info)",
				"--profile", profile,
				"--region", region,
				"--output", "json").Output()
			if err != nil {
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("%s (%s): scan failed: %v", table, region, err))
				mu.Unlock()
				return
			}

			var resp struct {
				Items []map[string]map[string]string `json:"Items"`
				Count int                            `json:"Count"`
			}
			if err := json.Unmarshal(out, &resp); err != nil {
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("%s (%s): parse error: %v", table, region, err))
				mu.Unlock()
				return
			}

			for _, item := range resp.Items {
				lockID := ""
				info := ""
				if v, ok := item["LockID"]; ok {
					lockID = v["S"]
				}
				if v, ok := item["Info"]; ok {
					info = v["S"]
				}
				mu.Lock()
				result.Found = append(result.Found, LockEntry{
					Table: table, Region: region, LockID: lockID, Info: info,
				})
				mu.Unlock()
			}
		}(tr.table, tr.region)
	}

	wg.Wait()
	return result
}

// handleScanLocks scans for stuck locks without removing them.
func (a *App) handleScanLocks(w http.ResponseWriter, r *http.Request) {
	if a.config == nil || a.envLocal == nil {
		http.Error(w, "Config not loaded", 500)
		return
	}

	result := a.scanLocks()
	log.Printf("Lock scan: found=%d errors=%d", len(result.Found), len(result.Errors))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleFixLocks scans and removes stuck locks.
func (a *App) handleFixLocks(w http.ResponseWriter, r *http.Request) {
	if a.config == nil || a.envLocal == nil {
		http.Error(w, "Config not loaded", 500)
		return
	}

	profile, _ := a.lockTables()
	result := a.scanLocks()

	// Delete each found lock
	for _, entry := range result.Found {
		keyJSON := fmt.Sprintf(`{"LockID":{"S":"%s"}}`, entry.LockID)
		_, delErr := exec.Command("aws", "dynamodb", "delete-item",
			"--table-name", entry.Table,
			"--key", keyJSON,
			"--profile", profile,
			"--region", entry.Region).Output()

		if delErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("delete %s: %v", entry.LockID, delErr))
		} else {
			result.Removed = append(result.Removed, entry)
		}
	}

	log.Printf("Fix locks: found=%d removed=%d errors=%d", len(result.Found), len(result.Removed), len(result.Errors))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

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

// FixLocksResult is the JSON response from the fix-locks endpoint.
type FixLocksResult struct {
	Found   []LockEntry `json:"found"`
	Removed []LockEntry `json:"removed"`
	Errors  []string    `json:"errors,omitempty"`
}

// handleFixLocks scans DynamoDB state lock tables for stuck locks and removes them.
func (a *App) handleFixLocks(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	cfg := a.config
	envLocal := a.envLocal
	a.mu.RUnlock()

	if cfg == nil || envLocal == nil {
		http.Error(w, "Config not loaded", 500)
		return
	}

	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	prefix := cfg.Site.TFStatePrefix
	suffix := cfg.Site.RandomSuffix

	// Build table name → region mapping
	type tableRegion struct {
		table  string
		region string
	}
	var tables []tableRegion
	for _, r := range AllRegions() {
		tableName := fmt.Sprintf("%s-%s-%s", prefix, r.Label, suffix)
		tables = append(tables, tableRegion{table: tableName, region: r.Full})
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	result := FixLocksResult{}

	// Scan each table in parallel
	for _, tr := range tables {
		wg.Add(1)
		go func(table, region string) {
			defer wg.Done()

			// Scan for items with Info attribute (= active locks)
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

			if resp.Count == 0 {
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

				entry := LockEntry{
					Table:  table,
					Region: region,
					LockID: lockID,
					Info:   info,
				}

				mu.Lock()
				result.Found = append(result.Found, entry)
				mu.Unlock()

				// Delete the lock item
				keyJSON := fmt.Sprintf(`{"LockID":{"S":"%s"}}`, lockID)
				_, delErr := exec.Command("aws", "dynamodb", "delete-item",
					"--table-name", table,
					"--key", keyJSON,
					"--profile", profile,
					"--region", region).Output()

				mu.Lock()
				if delErr != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("delete %s: %v", lockID, delErr))
				} else {
					result.Removed = append(result.Removed, entry)
				}
				mu.Unlock()
			}
		}(tr.table, tr.region)
	}

	wg.Wait()

	log.Printf("Fix locks: found=%d removed=%d errors=%d", len(result.Found), len(result.Removed), len(result.Errors))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

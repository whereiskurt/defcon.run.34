package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"
)

const rrdbMaxEntries = 500

// RRDBEntry represents a single execution record.
type RRDBEntry struct {
	Timestamp  time.Time `json:"timestamp"`
	Module     string    `json:"module"`
	Command    string    `json:"command"`
	Region     string    `json:"region,omitempty"`
	Status     string    `json:"status"`
	DurationMs int64     `json:"duration_ms"`
	Add        int       `json:"add"`
	Change     int       `json:"change"`
	Destroy    int       `json:"destroy"`
	NoChange   bool      `json:"no_change"`
}

// RRDB is a ring buffer of execution entries.
type RRDB struct {
	mu      sync.RWMutex
	Entries []RRDBEntry `json:"entries"`
	path    string
}

// RRDBTimePoint is a single point for sparkline rendering.
type RRDBTimePoint struct {
	Timestamp  time.Time `json:"timestamp"`
	DurationMs int64     `json:"duration_ms"`
	Status     string    `json:"status"`
}

// RRDBPrediction is a simple moving average prediction with trend.
type RRDBPrediction struct {
	DurationMs int64  `json:"duration_ms"`
	Trend      string `json:"trend"` // "up", "down", "stable"
	Samples    int    `json:"samples"`
}

// RRDBBucketStats aggregates stats for a single bucket (module, command, or region).
type RRDBBucketStats struct {
	Runs       int     `json:"runs"`
	SuccessPct float64 `json:"success_pct"`
	AvgMs      int64   `json:"avg_ms"`
	AvgAdd     float64 `json:"avg_add"`
	AvgChange  float64 `json:"avg_change"`
	AvgDestroy float64 `json:"avg_destroy"`
}

// RRDBStats is the response for the stats API endpoint.
type RRDBStats struct {
	TotalRuns    int                        `json:"total_runs"`
	SuccessPct   float64                    `json:"success_pct"`
	AvgMs        int64                      `json:"avg_ms"`
	TotalAdd     int                        `json:"total_add"`
	TotalChange  int                        `json:"total_change"`
	TotalDestroy int                        `json:"total_destroy"`
	Prediction   *RRDBPrediction            `json:"prediction,omitempty"`
	Timeline     []RRDBTimePoint            `json:"timeline"`
	ByModule     map[string]*RRDBBucketStats `json:"by_module"`
	ByCommand    map[string]*RRDBBucketStats `json:"by_command"`
	ByRegion     map[string]*RRDBBucketStats `json:"by_region"`
}

func newRRDB(path string) *RRDB {
	return &RRDB{path: path}
}

// append adds an entry, dropping the oldest if at capacity.
func (db *RRDB) append(e RRDBEntry) {
	db.mu.Lock()
	defer db.mu.Unlock()
	if len(db.Entries) >= rrdbMaxEntries {
		db.Entries = db.Entries[1:]
	}
	db.Entries = append(db.Entries, e)
}

// rrdbRecord converts a completed TermSession to an RRDBEntry and persists it.
func (a *App) rrdbRecord(s *TermSession) {
	if a.rrdb == nil {
		return
	}
	status := "success"
	if s.Status == "error" {
		status = "error"
	}
	entry := RRDBEntry{
		Timestamp:  s.doneAt,
		Module:     s.Module,
		Command:    s.Command,
		Region:     s.Region,
		Status:     status,
		DurationMs: s.doneAt.Sub(s.startAt).Milliseconds(),
	}
	if s.Summary != nil {
		entry.Add = s.Summary.Add
		entry.Change = s.Summary.Change
		entry.Destroy = s.Summary.Destroy
		entry.NoChange = s.Summary.NoChange
	}
	a.rrdb.append(entry)
	a.saveRRDB()
}

// rrdbRecordBuild records a non-terraform build operation (e.g. WAF build & push).
func (a *App) rrdbRecordBuild(module, command string, startTime time.Time, exitCode int) {
	if a.rrdb == nil {
		return
	}
	status := "success"
	if exitCode != 0 {
		status = "error"
	}
	now := time.Now()
	entry := RRDBEntry{
		Timestamp:  now,
		Module:     module,
		Command:    command,
		Status:     status,
		DurationMs: now.Sub(startTime).Milliseconds(),
	}
	a.rrdb.append(entry)
	a.saveRRDB()
}

// queryRRDB filters entries and computes aggregated stats.
func (a *App) queryRRDB(module, command, region string) *RRDBStats {
	a.rrdb.mu.RLock()
	defer a.rrdb.mu.RUnlock()

	stats := &RRDBStats{
		ByModule:  make(map[string]*RRDBBucketStats),
		ByCommand: make(map[string]*RRDBBucketStats),
		ByRegion:  make(map[string]*RRDBBucketStats),
	}

	var filtered []RRDBEntry
	for _, e := range a.rrdb.Entries {
		if module != "" && e.Module != module {
			continue
		}
		if command != "" && e.Command != command {
			continue
		}
		if region != "" && e.Region != region {
			continue
		}
		filtered = append(filtered, e)
	}

	stats.TotalRuns = len(filtered)
	if stats.TotalRuns == 0 {
		stats.Timeline = []RRDBTimePoint{}
		return stats
	}

	var totalMs int64
	var successes int
	for _, e := range filtered {
		totalMs += e.DurationMs
		if e.Status == "success" {
			successes++
		}
		// Sum resources only from individual module runs (not aggregate "all"/"region-all")
		if e.Module != "all" && e.Module != "region-all" {
			stats.TotalAdd += e.Add
			stats.TotalChange += e.Change
			stats.TotalDestroy += e.Destroy
		}
		// Bucket by module
		accumulateBucket(stats.ByModule, e.Module, e)
		// Bucket by command
		accumulateBucket(stats.ByCommand, e.Command, e)
		// Bucket by region
		rKey := e.Region
		if rKey == "" {
			rKey = "global"
		}
		accumulateBucket(stats.ByRegion, rKey, e)
	}

	stats.AvgMs = totalMs / int64(stats.TotalRuns)
	stats.SuccessPct = math.Round(float64(successes)/float64(stats.TotalRuns)*1000) / 10

	// Finalize bucket averages
	finalizeBuckets(stats.ByModule)
	finalizeBuckets(stats.ByCommand)
	finalizeBuckets(stats.ByRegion)

	// Timeline: last 30 entries for sparkline
	start := 0
	if len(filtered) > 30 {
		start = len(filtered) - 30
	}
	stats.Timeline = make([]RRDBTimePoint, 0, 30)
	for _, e := range filtered[start:] {
		stats.Timeline = append(stats.Timeline, RRDBTimePoint{
			Timestamp:  e.Timestamp,
			DurationMs: e.DurationMs,
			Status:     e.Status,
		})
	}

	// Prediction from last 10 matching entries
	stats.Prediction = computePrediction(filtered)

	return stats
}

func accumulateBucket(m map[string]*RRDBBucketStats, key string, e RRDBEntry) {
	b, ok := m[key]
	if !ok {
		b = &RRDBBucketStats{}
		m[key] = b
	}
	b.Runs++
	b.AvgMs += int64(e.DurationMs)          // accumulate, finalize later
	b.AvgAdd += float64(e.Add)
	b.AvgChange += float64(e.Change)
	b.AvgDestroy += float64(e.Destroy)
	if e.Status == "success" {
		b.SuccessPct++ // count successes, finalize later
	}
}

func finalizeBuckets(m map[string]*RRDBBucketStats) {
	for _, b := range m {
		n := float64(b.Runs)
		b.SuccessPct = math.Round(b.SuccessPct/n*1000) / 10
		b.AvgMs = int64(float64(b.AvgMs) / n)
		b.AvgAdd = math.Round(b.AvgAdd/n*10) / 10
		b.AvgChange = math.Round(b.AvgChange/n*10) / 10
		b.AvgDestroy = math.Round(b.AvgDestroy/n*10) / 10
	}
}

// computePrediction uses a simple moving average of the last 10 entries.
func computePrediction(entries []RRDBEntry) *RRDBPrediction {
	n := len(entries)
	if n < 2 {
		return nil
	}
	window := 10
	if n < window {
		window = n
	}
	recent := entries[n-window:]

	var total int64
	for _, e := range recent {
		total += e.DurationMs
	}
	avg := total / int64(len(recent))

	// Trend: compare first half vs second half
	mid := len(recent) / 2
	var firstHalf, secondHalf int64
	for i, e := range recent {
		if i < mid {
			firstHalf += e.DurationMs
		} else {
			secondHalf += e.DurationMs
		}
	}
	firstAvg := float64(firstHalf) / float64(mid)
	secondAvg := float64(secondHalf) / float64(len(recent)-mid)

	trend := "stable"
	if firstAvg > 0 {
		change := (secondAvg - firstAvg) / firstAvg
		if change > 0.15 {
			trend = "up"
		} else if change < -0.15 {
			trend = "down"
		}
	}

	return &RRDBPrediction{
		DurationMs: avg,
		Trend:      trend,
		Samples:    len(recent),
	}
}

func (a *App) saveRRDB() {
	a.rrdb.mu.RLock()
	defer a.rrdb.mu.RUnlock()
	data, err := json.MarshalIndent(a.rrdb, "", "  ")
	if err != nil {
		log.Printf("Warning: RRDB save failed: %v", err)
		return
	}
	if err := os.WriteFile(a.rrdb.path, data, 0644); err != nil {
		log.Printf("Warning: RRDB write failed: %v", err)
	}
}

func (a *App) loadRRDB() {
	data, err := os.ReadFile(a.rrdb.path)
	if err != nil {
		return
	}
	if json.Unmarshal(data, a.rrdb) != nil {
		return
	}
	log.Printf("Loaded RRDB: %d entries", len(a.rrdb.Entries))
}

func (a *App) handleRRDBStats(w http.ResponseWriter, r *http.Request) {
	module := r.URL.Query().Get("module")
	command := r.URL.Query().Get("command")
	region := r.URL.Query().Get("region")
	stats := a.queryRRDB(module, command, region)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (a *App) handleRRDBReset(w http.ResponseWriter, r *http.Request) {
	a.rrdb.mu.Lock()
	a.rrdb.Entries = nil
	a.rrdb.mu.Unlock()
	os.Remove(a.rrdb.path)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "reset"})
}

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// regionFlags maps AWS regions to country flag emoji.
var regionFlags = map[string]string{
	"us-east-1":      "\U0001F1FA\U0001F1F8",
	"us-east-2":      "\U0001F1FA\U0001F1F8",
	"us-west-1":      "\U0001F1FA\U0001F1F8",
	"us-west-2":      "\U0001F1FA\U0001F1F8",
	"ca-central-1":   "\U0001F1E8\U0001F1E6",
	"eu-west-1":      "\U0001F1EE\U0001F1EA",
	"eu-west-2":      "\U0001F1EC\U0001F1E7",
	"eu-central-1":   "\U0001F1E9\U0001F1EA",
	"ap-southeast-1": "\U0001F1F8\U0001F1EC",
	"ap-southeast-2": "\U0001F1E6\U0001F1FA",
	"ap-northeast-1": "\U0001F1EF\U0001F1F5",
	"ap-northeast-2": "\U0001F1F0\U0001F1F7",
	"ap-south-1":     "\U0001F1EE\U0001F1F3",
	"sa-east-1":      "\U0001F1E7\U0001F1F7",
}

func flagForRegion(region string) string {
	if f, ok := regionFlags[region]; ok {
		return f
	}
	return "\U0001F30D" // globe
}

// wafNodeMeta represents a registered waffaw node from S3.
type wafNodeMeta struct {
	IP           string `json:"ip"`
	Region       string `json:"region"`
	NodeID       string `json:"node_id"`
	NodeType     string `json:"node_type"`
	InstanceType string `json:"instance_type"`
	StartedAt    string `json:"started_at"`
	AgentVersion string `json:"agent_version"`
}

// wafNodeStatus extends wafNodeMeta with live status fields.
type wafNodeStatus struct {
	wafNodeMeta
	Flag   string `json:"flag"`
	Status string `json:"status"`
	Rank   string `json:"rank"`
	Uptime string `json:"uptime"`
}

// wafCampaignState represents the S3 campaign-state.json.
type wafCampaignState struct {
	Status        string `json:"status"`
	Campaign      string `json:"campaign"`
	StartedAt     string `json:"started_at"`
	StartedBy     string `json:"started_by"`
	TargetURL     string `json:"target_url"`
	LogLevel      string `json:"log_level"`
	ExpectedNodes int    `json:"expected_nodes"`
}

// controlBucketName returns the waffaw control bucket name.
func controlBucketName(accountID string) string {
	return fmt.Sprintf("waffaw-control-%s", accountID)
}

// wafProfile returns the AWS profile for waffaw operations.
func (a *App) wafProfile() string {
	if a.envLocal.ProfilePrefix != "" {
		return a.envLocal.ProfilePrefix + "-terraform"
	}
	return "terraform"
}

// s3ListKeys lists object keys under a prefix using the AWS CLI.
func s3ListKeys(profile, bucket, prefix, region string) ([]struct {
	Key          string
	LastModified time.Time
}, error) {
	out, err := exec.Command("aws", "s3api", "list-objects-v2",
		"--bucket", bucket,
		"--prefix", prefix,
		"--profile", profile,
		"--region", region,
		"--output", "json",
	).Output()
	if err != nil {
		return nil, err
	}

	var resp struct {
		Contents []struct {
			Key          string `json:"Key"`
			LastModified string `json:"LastModified"`
		} `json:"Contents"`
	}
	if json.Unmarshal(out, &resp) != nil {
		return nil, fmt.Errorf("failed to parse s3 list response")
	}

	type result struct {
		Key          string
		LastModified time.Time
	}
	var results []struct {
		Key          string
		LastModified time.Time
	}
	for _, obj := range resp.Contents {
		t, _ := time.Parse(time.RFC3339, obj.LastModified)
		results = append(results, struct {
			Key          string
			LastModified time.Time
		}{Key: obj.Key, LastModified: t})
	}
	return results, nil
}

// s3GetJSON fetches an S3 object and decodes it as JSON.
func s3GetJSON(profile, bucket, key, region string, out interface{}) error {
	data, err := exec.Command("aws", "s3api", "get-object",
		"--bucket", bucket,
		"--key", key,
		"--profile", profile,
		"--region", region,
		"/dev/stdout",
	).Output()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// s3PutString uploads a string to S3.
func s3PutString(profile, bucket, key, region, body string) error {
	cmd := exec.Command("aws", "s3api", "put-object",
		"--bucket", bucket,
		"--key", key,
		"--body", "/dev/stdin",
		"--profile", profile,
		"--region", region,
	)
	cmd.Stdin = strings.NewReader(body)
	_, err := cmd.Output()
	return err
}

// s3DeleteKey deletes an S3 object.
func s3DeleteKey(profile, bucket, key, region string) {
	exec.Command("aws", "s3api", "delete-object",
		"--bucket", bucket,
		"--key", key,
		"--profile", profile,
		"--region", region,
	).Run()
}

// compareIPsNumerically compares two IP addresses by numeric octets (matches consensus.sh sort).
func compareIPsNumerically(a, b string) bool {
	aParts := strings.Split(a, ".")
	bParts := strings.Split(b, ".")
	for i := 0; i < 4 && i < len(aParts) && i < len(bParts); i++ {
		ai := 0
		bi := 0
		fmt.Sscanf(aParts[i], "%d", &ai)
		fmt.Sscanf(bParts[i], "%d", &bi)
		if ai != bi {
			return ai < bi
		}
	}
	return a < b
}

// handleWAFFleetStatus lists all nodes from S3 and returns an HTML partial.
func (a *App) handleWAFFleetStatus(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<div class="text-xs text-zinc-500 py-2">Configure Application Account ID to view fleet status.</div>`)
		return
	}

	bucket := controlBucketName(accountID)
	profile := a.wafProfile()
	region := "us-east-1"

	// List nodes/ prefix
	objects, err := s3ListKeys(profile, bucket, "nodes/", region)
	if err != nil {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, `<div class="text-xs text-red-400 py-2">S3 error: %s</div>`, template.HTMLEscapeString(err.Error()))
		return
	}

	// Group by IP: find meta.json and alive.txt
	type nodeInfo struct {
		hasMeta  bool
		aliveAt  time.Time
		hasAlive bool
	}
	nodeMap := map[string]*nodeInfo{}
	for _, obj := range objects {
		parts := strings.Split(obj.Key, "/")
		if len(parts) < 3 {
			continue
		}
		ip := parts[1]
		filename := parts[2]
		if nodeMap[ip] == nil {
			nodeMap[ip] = &nodeInfo{}
		}
		if filename == "meta.json" {
			nodeMap[ip].hasMeta = true
		}
		if filename == "alive.txt" {
			nodeMap[ip].hasAlive = true
			nodeMap[ip].aliveAt = obj.LastModified
		}
	}

	// Fetch meta.json for each node
	var nodes []wafNodeStatus
	for ip, info := range nodeMap {
		if !info.hasMeta {
			continue
		}
		var meta wafNodeMeta
		metaKey := fmt.Sprintf("nodes/%s/meta.json", ip)
		if err := s3GetJSON(profile, bucket, metaKey, region, &meta); err != nil {
			continue
		}

		status := "stale"
		if info.hasAlive && time.Since(info.aliveAt) < 2*time.Minute {
			status = "online"
		}

		uptime := ""
		if meta.StartedAt != "" {
			if t, err := time.Parse(time.RFC3339, meta.StartedAt); err == nil {
				d := time.Since(t)
				if d.Hours() >= 1 {
					uptime = fmt.Sprintf("%.0fh %dm", d.Hours(), int(d.Minutes())%60)
				} else {
					uptime = fmt.Sprintf("%dm", int(d.Minutes()))
				}
			}
		}

		nodes = append(nodes, wafNodeStatus{
			wafNodeMeta: meta,
			Flag:        flagForRegion(meta.Region),
			Status:      status,
			Rank:        "-",
			Uptime:      uptime,
		})
	}

	// Try to read roster for rank info — sort IPs numerically to match consensus protocol
	rosterObjects, _ := s3ListKeys(profile, bucket, "consensus/current/roster.d/", region)
	var rosterIPs []string
	for _, obj := range rosterObjects {
		parts := strings.Split(obj.Key, "/")
		if len(parts) >= 4 {
			ip := strings.TrimSuffix(parts[3], ".json")
			if ip != "" {
				rosterIPs = append(rosterIPs, ip)
			}
		}
	}
	// Deterministic numeric IP sort (matches consensus.sh: sort -t. -k1,1n -k2,2n -k3,3n -k4,4n)
	sort.Slice(rosterIPs, func(i, j int) bool {
		return compareIPsNumerically(rosterIPs[i], rosterIPs[j])
	})
	rosterRanks := map[string]int{}
	rosterTotal := len(rosterIPs)
	for i, ip := range rosterIPs {
		rosterRanks[ip] = i + 1
	}

	// Sort nodes by IP
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].IP < nodes[j].IP
	})

	for i := range nodes {
		if rank, ok := rosterRanks[nodes[i].IP]; ok {
			nodes[i].Rank = fmt.Sprintf("%d/%d", rank, rosterTotal)
		}
	}

	// Render HTML table
	w.Header().Set("Content-Type", "text/html")
	if len(nodes) == 0 {
		fmt.Fprint(w, `<div class="text-xs text-zinc-500 py-4 text-center">No nodes registered. Deploy fleet to see active nodes.</div>`)
		return
	}

	fmt.Fprint(w, `<table class="w-full text-xs"><thead><tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">`)
	fmt.Fprint(w, `<th class="py-1 px-2">##</th><th class="py-1 px-2"></th><th class="py-1 px-2">IP Address</th><th class="py-1 px-2">Type</th><th class="py-1 px-2">Status</th><th class="py-1 px-2">Rank</th><th class="py-1 px-2">Uptime</th><th class="py-1 px-2">Actions</th>`)
	fmt.Fprint(w, `</tr></thead><tbody>`)

	for i, n := range nodes {
		rowClass := ""
		statusBadge := `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/30 text-green-400">online</span>`
		if n.Status == "stale" {
			rowClass = ` class="opacity-50"`
			statusBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-900/30 text-yellow-400">stale</span>`
		}
		fmt.Fprintf(w, `<tr%s>`, rowClass)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 text-zinc-400">%d</td>`, i+1)
		fmt.Fprintf(w, `<td class="py-1.5 px-2">%s</td>`, n.Flag)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 font-mono">%s</td>`, template.HTMLEscapeString(n.IP))
		fmt.Fprintf(w, `<td class="py-1.5 px-2"><span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300">%s</span></td>`, template.HTMLEscapeString(n.NodeType))
		fmt.Fprintf(w, `<td class="py-1.5 px-2">%s</td>`, statusBadge)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 font-mono">%s</td>`, template.HTMLEscapeString(n.Rank))
		fmt.Fprintf(w, `<td class="py-1.5 px-2 text-zinc-400">%s</td>`, template.HTMLEscapeString(n.Uptime))
		fmt.Fprintf(w, `<td class="py-1.5 px-2"><button type="button" onclick="navigator.clipboard.writeText('%s');showToast('Copied IP')" class="text-zinc-400 hover:text-zinc-200" title="Copy IP">&#128203;</button> <button type="button" onclick="sendWAFCommand('%s')" class="text-zinc-400 hover:text-zinc-200 ml-1" title="Send script">&#128228;</button></td>`,
			template.HTMLEscapeString(n.IP), template.HTMLEscapeString(n.IP))
		fmt.Fprint(w, `</tr>`)
	}
	fmt.Fprint(w, `</tbody></table>`)
}

// handleWAFCommand uploads a script to the S3 control bucket.
func (a *App) handleWAFCommand(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	target := r.FormValue("target")
	script := r.FormValue("script")
	if script == "" {
		http.Error(w, "No script content", 400)
		return
	}

	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	bucket := controlBucketName(accountID)
	profile := a.wafProfile()
	region := "us-east-1"

	ts := time.Now().Format("20060102-150405")
	var key string
	if target == "global" || target == "" {
		key = fmt.Sprintf("global/run/%s.sh", ts)
	} else {
		key = fmt.Sprintf("nodes/%s/run/%s.sh", target, ts)
	}

	if err := s3PutString(profile, bucket, key, region, script); err != nil {
		http.Error(w, fmt.Sprintf("S3 upload error: %v", err), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "key": key})
}

// handleWAFCampaign starts or halts a campaign.
func (a *App) handleWAFCampaign(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	action := r.FormValue("action")

	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	bucket := controlBucketName(accountID)
	profile := a.wafProfile()
	region := "us-east-1"

	switch action {
	case "start":
		campaignName := r.FormValue("template")
		targetURL := r.FormValue("target_url")
		logLevel := r.FormValue("log_level")

		// Check if a campaign is already running
		var state wafCampaignState
		if err := s3GetJSON(profile, bucket, "campaign-state.json", region, &state); err == nil {
			if state.Status == "running" {
				http.Error(w, "A campaign is already running", 409)
				return
			}
		}

		// Clear consensus
		consObjs, _ := s3ListKeys(profile, bucket, "consensus/current/", region)
		for _, obj := range consObjs {
			s3DeleteKey(profile, bucket, obj.Key, region)
		}

		// Remove halt flag
		s3DeleteKey(profile, bucket, "global/halt", region)

		// Write campaign-state.json
		newState := wafCampaignState{
			Status:    "running",
			Campaign:  campaignName,
			StartedAt: time.Now().UTC().Format(time.RFC3339),
			StartedBy: "configui",
			TargetURL: targetURL,
			LogLevel:  logLevel,
		}
		stateJSON, _ := json.Marshal(newState)
		s3PutString(profile, bucket, "campaign-state.json", region, string(stateJSON))

		// Deploy trigger script to global/run/ so all nodes pick it up
		triggerScript := fmt.Sprintf(`#!/bin/bash
# Campaign trigger — deployed by ConfigUI
# Campaign: %s | Target: %s | Log level: %s
set -euo pipefail

export TARGET_URL="%s"
export LOG_LEVEL="%s"
export CAMPAIGN="%s"

echo "[waffaw] Starting campaign: $CAMPAIGN -> $TARGET_URL (log=$LOG_LEVEL)"

# Run consensus protocol to determine node rank
if [[ -f /opt/waffaw/consensus.sh ]]; then
  source /opt/waffaw/consensus.sh
  echo "[waffaw] Consensus complete: node $NODE_RANK of $NODE_TOTAL"
else
  echo "[waffaw] WARNING: consensus.sh not found, running without coordination"
  export NODE_RANK=1
  export NODE_TOTAL=1
fi

# Run artillery with the selected campaign template
cd /opt/waffaw
npx artillery run "templates/%s.yml" 2>&1 | tee -a "/tmp/campaign-${CAMPAIGN}.log"

echo "[waffaw] Campaign $CAMPAIGN finished on node $NODE_RANK"
`, campaignName, targetURL, logLevel, targetURL, logLevel, campaignName, campaignName)

		ts := time.Now().Format("20060102-150405")
		triggerKey := fmt.Sprintf("global/run/campaign-%s-%s.sh", campaignName, ts)
		if err := s3PutString(profile, bucket, triggerKey, region, triggerScript); err != nil {
			http.Error(w, fmt.Sprintf("Failed to deploy trigger script: %v", err), 500)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "started", "campaign": campaignName, "trigger": triggerKey})

	case "halt":
		// Touch global/halt
		s3PutString(profile, bucket, "global/halt", region, time.Now().UTC().Format(time.RFC3339))

		// Update campaign-state.json
		var state wafCampaignState
		if err := s3GetJSON(profile, bucket, "campaign-state.json", region, &state); err == nil {
			state.Status = "halted"
			stateJSON, _ := json.Marshal(state)
			s3PutString(profile, bucket, "campaign-state.json", region, string(stateJSON))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "halted"})

	default:
		http.Error(w, "Unknown action", 400)
	}
}

// handleWAFLogs streams CloudWatch logs via SSE.
func (a *App) handleWAFLogs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	nodeFilter := r.URL.Query().Get("node")

	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		http.Error(w, "Application Account ID not configured", 400)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", 500)
		return
	}

	profile := a.wafProfile()
	logRegion := r.URL.Query().Get("region")
	if logRegion == "" {
		logRegion = "us-east-1"
	}
	logGroupName := fmt.Sprintf("/waffaw/%s", logRegion)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	startTime := time.Now().Add(-5 * time.Minute).UnixMilli()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			args := []string{"logs", "filter-log-events",
				"--log-group-name", logGroupName,
				"--start-time", fmt.Sprintf("%d", startTime),
				"--limit", "50",
				"--profile", profile,
				"--region", logRegion,
				"--output", "json",
			}
			if nodeFilter != "" && nodeFilter != "all" {
				args = append(args, "--filter-pattern", fmt.Sprintf(`{ $.source_ip = "%s" }`, nodeFilter))
			}

			out, err := exec.Command("aws", args...).Output()
			if err != nil {
				log.Printf("WAF logs: CloudWatch error: %v", err)
				fmt.Fprintf(w, "event: error\ndata: CloudWatch query failed\n\n")
				flusher.Flush()
				continue
			}

			var resp struct {
				Events []struct {
					Timestamp int64  `json:"timestamp"`
					Message   string `json:"message"`
				} `json:"events"`
			}
			if json.Unmarshal(out, &resp) != nil {
				continue
			}

			for _, event := range resp.Events {
				var logEntry map[string]interface{}
				if json.Unmarshal([]byte(event.Message), &logEntry) != nil {
					continue
				}

				ip, _ := logEntry["source_ip"].(string)
				logRegion, _ := logEntry["region"].(string)
				method, _ := logEntry["method"].(string)
				targetURL, _ := logEntry["target_url"].(string)
				statusCode := 0
				if sc, ok := logEntry["status_code"].(float64); ok {
					statusCode = int(sc)
				}
				responseTime := 0
				if rt, ok := logEntry["response_time_ms"].(float64); ok {
					responseTime = int(rt)
				}
				rank := 0
				total := 0
				if nr, ok := logEntry["node_rank"].(float64); ok {
					rank = int(nr)
				}
				if nt, ok := logEntry["node_total"].(float64); ok {
					total = int(nt)
				}

				flag := flagForRegion(logRegion)
				ts := time.UnixMilli(event.Timestamp).Format("15:04:05.000")

				path := targetURL
				if idx := strings.Index(targetURL, "://"); idx >= 0 {
					rest := targetURL[idx+3:]
					if pidx := strings.Index(rest, "/"); pidx >= 0 {
						path = rest[pidx:]
					}
				}

				line := fmt.Sprintf("%s  %s %s  [%d/%d]  %s  %s  %d  %dms",
					ts, flag, ip, rank, total, method, path, statusCode, responseTime)

				lineJSON, _ := json.Marshal(map[string]interface{}{
					"line":    line,
					"status":  statusCode,
					"headers": logEntry["response_headers"],
					"body":    logEntry["response_body_preview"],
				})
				fmt.Fprintf(w, "data: %s\n\n", lineJSON)

				if event.Timestamp > startTime {
					startTime = event.Timestamp + 1
				}
			}
			flusher.Flush()
		}
	}
}

// handleWAFIntel runs Athena queries via AWS CLI and returns results as JSON.
func (a *App) handleWAFIntel(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	campaign := r.FormValue("campaign")
	if campaign == "" {
		campaign = "%"
	}

	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		http.Error(w, "Application Account ID not configured", 400)
		return
	}

	profile := a.wafProfile()
	outputLocation := fmt.Sprintf("s3://waffaw-logs-%s/athena-results/", accountID)

	queries := map[string]string{
		"summary":     fmt.Sprintf(`SELECT campaign, COUNT(*) AS total_requests, COUNT(DISTINCT source_ip) AS unique_ips, MIN(timestamp) AS started, MAX(timestamp) AS ended, date_diff('minute', MIN(timestamp), MAX(timestamp)) AS duration_minutes, ROUND(AVG(response_time_ms), 0) AS avg_response_ms, COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY campaign`, campaign),
		"detection":   fmt.Sprintf(`SELECT source_ip, node_type, MIN(timestamp) AS first_request, MIN(CASE WHEN status_code = 403 THEN timestamp END) AS first_block, date_diff('minute', MIN(timestamp), MIN(CASE WHEN status_code = 403 THEN timestamp END)) AS minutes_to_detect, COUNT(*) AS total_requests, COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked_requests FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY source_ip, node_type ORDER BY minutes_to_detect ASC NULLS LAST`, campaign),
		"scenarios":   fmt.Sprintf(`SELECT scenario, COUNT(*) AS total, COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY scenario ORDER BY block_rate_pct DESC`, campaign),
		"hourly":      fmt.Sprintf(`SELECT date_format(timestamp, '%%%%Y-%%%%m-%%%%d %%%%H:00') AS hour, COUNT(*) AS requests, COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY date_format(timestamp, '%%%%Y-%%%%m-%%%%d %%%%H:00') ORDER BY hour`, campaign),
		"correlation": fmt.Sprintf(`SELECT node_type, COUNT(DISTINCT source_ip) AS unique_ips, COUNT(*) AS total_requests, COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY node_type`, campaign),
	}

	// Submit all queries, collect execution IDs
	type queryResult struct {
		Name string
		Rows [][]string
		Err  string
	}

	resultsChan := make(chan queryResult, len(queries))
	for name, sql := range queries {
		go func(n, q string) {
			execID, err := athenaStartQuery(profile, q, "waffaw", outputLocation)
			if err != nil {
				resultsChan <- queryResult{Name: n, Err: err.Error()}
				return
			}
			rows, err := athenaWaitAndFetch(profile, execID)
			if err != nil {
				resultsChan <- queryResult{Name: n, Err: err.Error()}
				return
			}
			resultsChan <- queryResult{Name: n, Rows: rows}
		}(name, sql)
	}

	results := map[string][][]string{}
	for i := 0; i < len(queries); i++ {
		qr := <-resultsChan
		if qr.Err != "" {
			log.Printf("WAF intel: query %s error: %s", qr.Name, qr.Err)
			continue
		}
		results[qr.Name] = qr.Rows
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// handleWAFBuild runs apps/waffaw/build.sh and streams output via SSE.
func (a *App) handleWAFBuild(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", 500)
		return
	}

	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	profilePrefix := a.envLocal.ProfilePrefix
	siteLabel := a.config.Site.Label
	a.mu.RUnlock()

	buildScript := fmt.Sprintf("%s/apps/waffaw/build.sh", a.repoRoot)

	// Set up environment for build.sh
	profile := "application"
	if profilePrefix != "" {
		profile = profilePrefix + "-application"
	}

	cmd := exec.Command("bash", buildScript)
	cmd.Dir = fmt.Sprintf("%s/apps/waffaw", a.repoRoot)
	cmd.Env = append(os.Environ(),
		"AWS_PROFILE="+profile,
		"AWS_ACCOUNT_ID="+accountID,
		"SITE_LABEL="+siteLabel,
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "Failed to create pipe", 500)
		return
	}
	cmd.Stderr = cmd.Stdout // merge stderr into stdout

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "data: {\"line\":\"ERROR: %s\",\"done\":true}\n\n", err.Error())
		flusher.Flush()
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		lineJSON, _ := json.Marshal(map[string]interface{}{
			"line": line,
			"done": false,
		})
		fmt.Fprintf(w, "data: %s\n\n", lineJSON)
		flusher.Flush()

		// Extract image name:tag from the "Image pushed to" line
		// build.sh prints: "Image pushed to 123456789012.dkr.ecr.us-east-1.amazonaws.com/{label}-waffaw:1.0.0"
		// We extract just "{label}-waffaw:1.0.0" since the module constructs the regional ECR prefix
		if strings.HasPrefix(line, "Image pushed to ") {
			fullURI := strings.TrimSpace(strings.TrimPrefix(line, "Image pushed to "))
			imageNameTag := fullURI
			if idx := strings.LastIndex(fullURI, "/"); idx >= 0 {
				imageNameTag = fullURI[idx+1:]
			}
			uriJSON, _ := json.Marshal(map[string]interface{}{
				"line":      line,
				"done":      false,
				"image_uri": imageNameTag,
			})
			fmt.Fprintf(w, "data: %s\n\n", uriJSON)
			flusher.Flush()
		}
	}

	exitCode := 0
	if err := cmd.Wait(); err != nil {
		exitCode = 1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	doneJSON, _ := json.Marshal(map[string]interface{}{
		"line": fmt.Sprintf("Build finished (exit code %d)", exitCode),
		"done": true,
		"exit": exitCode,
	})
	fmt.Fprintf(w, "data: %s\n\n", doneJSON)
	flusher.Flush()
}

// athenaStartQuery starts an Athena query via AWS CLI and returns the execution ID.
func athenaStartQuery(profile, sql, workgroup, outputLocation string) (string, error) {
	out, err := exec.Command("aws", "athena", "start-query-execution",
		"--query-string", sql,
		"--work-group", workgroup,
		"--result-configuration", fmt.Sprintf(`{"OutputLocation":"%s"}`, outputLocation),
		"--query-execution-context", `{"Database":"waffaw"}`,
		"--profile", profile,
		"--region", "us-east-1",
		"--output", "json",
	).Output()
	if err != nil {
		return "", err
	}
	var resp struct {
		QueryExecutionId string `json:"QueryExecutionId"`
	}
	if json.Unmarshal(out, &resp) != nil {
		return "", fmt.Errorf("failed to parse athena start response")
	}
	return resp.QueryExecutionId, nil
}

// athenaWaitAndFetch polls for query completion then fetches results.
func athenaWaitAndFetch(profile, execID string) ([][]string, error) {
	for i := 0; i < 60; i++ { // 30s max (500ms sleep)
		out, err := exec.Command("aws", "athena", "get-query-execution",
			"--query-execution-id", execID,
			"--profile", profile,
			"--region", "us-east-1",
			"--output", "json",
		).Output()
		if err != nil {
			return nil, err
		}

		var resp struct {
			QueryExecution struct {
				Status struct {
					State             string `json:"State"`
					StateChangeReason string `json:"StateChangeReason"`
				} `json:"Status"`
			} `json:"QueryExecution"`
		}
		if json.Unmarshal(out, &resp) != nil {
			return nil, fmt.Errorf("failed to parse athena status")
		}

		switch resp.QueryExecution.Status.State {
		case "SUCCEEDED":
			return athenaFetchResults(profile, execID)
		case "FAILED", "CANCELLED":
			return nil, fmt.Errorf("query %s: %s", resp.QueryExecution.Status.State, resp.QueryExecution.Status.StateChangeReason)
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil, fmt.Errorf("query timed out")
}

// athenaFetchResults retrieves query results.
func athenaFetchResults(profile, execID string) ([][]string, error) {
	out, err := exec.Command("aws", "athena", "get-query-results",
		"--query-execution-id", execID,
		"--profile", profile,
		"--region", "us-east-1",
		"--output", "json",
	).Output()
	if err != nil {
		return nil, err
	}

	var resp struct {
		ResultSet struct {
			Rows []struct {
				Data []struct {
					VarCharValue string `json:"VarCharValue"`
				} `json:"Data"`
			} `json:"Rows"`
		} `json:"ResultSet"`
	}
	if json.Unmarshal(out, &resp) != nil {
		return nil, fmt.Errorf("failed to parse athena results")
	}

	var rows [][]string
	for _, row := range resp.ResultSet.Rows {
		var cells []string
		for _, d := range row.Data {
			cells = append(cells, d.VarCharValue)
		}
		rows = append(rows, cells)
	}
	return rows, nil
}

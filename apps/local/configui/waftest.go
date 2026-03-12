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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
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
	Status         string `json:"status"`
	Campaign       string `json:"campaign"`
	StartedAt      string `json:"started_at"`
	StartedBy      string `json:"started_by"`
	TargetURL      string `json:"target_url"`
	LogLevel       string `json:"log_level"`
	UserAgent      string `json:"user_agent,omitempty"`
	CustomHeaderKey string `json:"custom_header_key,omitempty"`
	CustomHeaderVal string `json:"custom_header_value,omitempty"`
	ExpectedNodes  int    `json:"expected_nodes"`
}

// countActiveNodes counts fleet nodes with alive.txt < 2 minutes old.
func (a *App) countActiveNodes(profile, bucket, region string) int {
	objects, err := s3ListKeys(profile, bucket, "nodes/", region)
	if err != nil {
		return 0
	}
	count := 0
	for _, obj := range objects {
		parts := strings.Split(obj.Key, "/")
		if len(parts) >= 3 && parts[2] == "alive.txt" && time.Since(obj.LastModified) < 2*time.Minute {
			count++
		}
	}
	return count
}

// controlBucketName returns the waffaw control bucket name.
func (a *App) controlBucketName() string {
	return fmt.Sprintf("waffaw-control-%s-%s-%s",
		"use1", a.config.Site.Label, a.config.Site.RandomSuffix)
}

// errBucketNotFound is a sentinel prefix for NoSuchBucket errors.
const errBucketNotFound = "NoSuchBucket: "

// wafProfile returns the AWS profile for waffaw operations (application account).
func (a *App) wafProfile() string {
	if a.envLocal.ProfilePrefix != "" {
		return a.envLocal.ProfilePrefix + "-application"
	}
	return "application"
}

// s3ListKeys lists object keys under a prefix using the AWS CLI.
func s3ListKeys(profile, bucket, prefix, region string) ([]struct {
	Key          string
	LastModified time.Time
}, error) {
	cmd := exec.Command("aws", "s3api", "list-objects-v2",
		"--bucket", bucket,
		"--prefix", prefix,
		"--profile", profile,
		"--region", region,
		"--output", "json",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "NoSuchBucket") {
			return nil, fmt.Errorf("%s%s", errBucketNotFound, bucket)
		}
		return nil, fmt.Errorf("%v: %s", err, string(out))
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
		t, err := time.Parse(time.RFC3339, obj.LastModified)
		if err != nil {
			t, _ = time.Parse(time.RFC3339Nano, obj.LastModified)
		}
		results = append(results, struct {
			Key          string
			LastModified time.Time
		}{Key: obj.Key, LastModified: t})
	}
	return results, nil
}

// s3GetJSON fetches an S3 object and decodes it as JSON.
func s3GetJSON(profile, bucket, key, region string, out interface{}) error {
	tmp, err := os.CreateTemp("", "waffaw-get-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	tmp.Close()

	cmdOut, err := exec.Command("aws", "s3api", "get-object",
		"--bucket", bucket,
		"--key", key,
		"--profile", profile,
		"--region", region,
		tmp.Name(),
	).CombinedOutput()
	if err != nil {
		if strings.Contains(string(cmdOut), "NoSuchBucket") {
			return fmt.Errorf("%s%s", errBucketNotFound, bucket)
		}
		return fmt.Errorf("%v: %s", err, string(cmdOut))
	}
	data, err := os.ReadFile(tmp.Name())
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// s3PutString uploads a string to S3.
func s3PutString(profile, bucket, key, region, body string) error {
	tmp, err := os.CreateTemp("", "waffaw-s3-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %v", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(body); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp file: %v", err)
	}
	tmp.Close()

	out, cerr := exec.Command("aws", "s3api", "put-object",
		"--bucket", bucket,
		"--key", key,
		"--body", tmp.Name(),
		"--profile", profile,
		"--region", region,
	).CombinedOutput()
	if cerr != nil {
		if strings.Contains(string(out), "NoSuchBucket") {
			return fmt.Errorf("%s%s", errBucketNotFound, bucket)
		}
		return fmt.Errorf("%v: %s", cerr, string(out))
	}
	return nil
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
	profilePrefix := a.envLocal.ProfilePrefix
	a.mu.RUnlock()

	if accountID == "" {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<div class="text-xs text-zinc-500 py-2">Configure Application Account ID to view fleet status.</div>`)
		return
	}

	bucket := a.controlBucketName()
	profile := a.wafProfile()
	region := "us-east-1"

	// List nodes/ prefix
	objects, err := s3ListKeys(profile, bucket, "nodes/", region)
	if err != nil {
		w.Header().Set("Content-Type", "text/html")
		errMsg := err.Error()
		if strings.HasPrefix(errMsg, errBucketNotFound) {
			missingBucket := strings.TrimPrefix(errMsg, errBucketNotFound)
			fmt.Fprintf(w, `<div class="text-xs py-3 text-center flex items-center justify-center gap-2">`+
				`<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800 text-zinc-300">`+
				`<span class="font-mono text-zinc-400">s3://%s</span> not found</span>`+
				`<button type="button" onclick="confirmApplyAll()" `+
				`class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-600 hover:bg-green-500 text-white text-[11px] font-medium transition-colors">`+
				`&#9654; Apply All</button></div>`,
				template.HTMLEscapeString(missingBucket))
		} else {
			fmt.Fprintf(w, `<div class="text-xs py-3 text-center"><span class="inline-block px-3 py-1 rounded-full bg-zinc-800 text-zinc-300">%s</span></div>`, template.HTMLEscapeString(errMsg))
		}
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
		} else if meta.StartedAt != "" {
			if t, err := time.Parse(time.RFC3339, meta.StartedAt); err == nil && time.Since(t) < 5*time.Minute {
				status = "starting"
			}
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

	// Discover EC2 instances via AWS API to catch unregistered nodes
	registeredIPs := map[string]bool{}
	for _, n := range nodes {
		registeredIPs[n.IP] = true
	}
	// EC2 discovery needs terraform profile (application profile lacks ec2:DescribeInstances)
	tfProfile := "terraform"
	if profilePrefix != "" {
		tfProfile = profilePrefix + "-terraform"
	}
	if ec2Nodes := discoverEC2Instances(tfProfile, region); len(ec2Nodes) > 0 {
		for _, ec2n := range ec2Nodes {
			if !registeredIPs[ec2n.IP] {
				nodes = append(nodes, ec2n)
			}
		}
	}

	// Sort nodes by IP (deterministic numeric sort) and assign rank from online nodes
	sort.Slice(nodes, func(i, j int) bool {
		return compareIPsNumerically(nodes[i].IP, nodes[j].IP)
	})
	onlineCount := 0
	for _, n := range nodes {
		if n.Status == "online" {
			onlineCount++
		}
	}
	rank := 0
	for i := range nodes {
		if nodes[i].Status == "online" {
			rank++
			nodes[i].Rank = fmt.Sprintf("%d/%d", rank, onlineCount)
		}
	}

	// Render HTML table
	w.Header().Set("Content-Type", "text/html")
	if len(nodes) == 0 {
		fmt.Fprint(w, `<div class="text-xs text-zinc-500 py-4 text-center">No nodes registered. Deploy fleet to see active nodes.</div>`)
		fmt.Fprint(w, `<script>var pb=document.getElementById('waf-purge-stale-btn');if(pb)pb.style.display='none';</script>`)
		return
	}

	// Count stale nodes for purge button
	staleCount := 0
	for _, n := range nodes {
		if n.Status == "stale" || n.Status == "unregistered" {
			staleCount++
		}
	}

	fmt.Fprint(w, `<table class="w-full text-xs"><thead><tr class="text-left text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">`)
	fmt.Fprint(w, `<th class="py-1 px-2">##</th><th class="py-1 px-2"></th><th class="py-1 px-2">IP Address</th><th class="py-1 px-2">Type</th><th class="py-1 px-2">Agent</th><th class="py-1 px-2">Status</th><th class="py-1 px-2">Rank</th><th class="py-1 px-2">Uptime</th><th class="py-1 px-2">Actions</th>`)
	fmt.Fprint(w, `</tr></thead><tbody>`)

	for i, n := range nodes {
		rowClass := ""
		statusBadge := `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/30 text-green-400">online</span>`
		if n.Status == "starting" {
			statusBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/30 text-blue-400">starting</span>`
		} else if n.Status == "stale" {
			rowClass = ` class="opacity-50"`
			statusBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-900/30 text-yellow-400">stale</span>`
		} else if n.Status == "unregistered" {
			rowClass = ` class="opacity-60"`
			statusBadge = `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/30 text-red-400">no agent</span>`
		}
		fmt.Fprintf(w, `<tr%s>`, rowClass)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 text-zinc-400">%d</td>`, i+1)
		fmt.Fprintf(w, `<td class="py-1.5 px-2">%s</td>`, n.Flag)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 font-mono">%s</td>`, template.HTMLEscapeString(n.IP))
		typeLabel := n.NodeType
		typeBg := "bg-zinc-700 text-zinc-300"
		if typeLabel == "fargate" || typeLabel == "ecs" {
			typeLabel = "ecs"
			typeBg = "bg-indigo-900/40 text-indigo-300"
		} else if typeLabel == "ec2" {
			typeBg = "bg-amber-900/40 text-amber-300"
		}
		fmt.Fprintf(w, `<td class="py-1.5 px-2"><span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium %s">%s</span></td>`, typeBg, template.HTMLEscapeString(typeLabel))
		agentVer := n.AgentVersion
		if agentVer == "" {
			agentVer = "-"
		}
		fmt.Fprintf(w, `<td class="py-1.5 px-2 font-mono text-zinc-400">%s</td>`, template.HTMLEscapeString(agentVer))
		fmt.Fprintf(w, `<td class="py-1.5 px-2">%s</td>`, statusBadge)
		fmt.Fprintf(w, `<td class="py-1.5 px-2 font-mono">%s</td>`, template.HTMLEscapeString(n.Rank))
		fmt.Fprintf(w, `<td class="py-1.5 px-2 text-zinc-400">%s</td>`, template.HTMLEscapeString(n.Uptime))
		ipEsc := template.HTMLEscapeString(n.IP)
		deleteBtn := ""
		if n.Status == "stale" || n.Status == "unregistered" {
			deleteBtn = fmt.Sprintf(` <button type="button" onclick="deleteWAFNode('%s')" class="text-zinc-500 hover:text-red-400 ml-1" title="Remove node">&#128465;</button>`, ipEsc)
		}
		fmt.Fprintf(w, `<td class="py-1.5 px-2"><button type="button" onclick="navigator.clipboard.writeText('%s');showToast('Copied IP')" class="text-zinc-400 hover:text-zinc-200" title="Copy IP">&#128203;</button> <button type="button" onclick="sendWAFCommand('%s')" class="text-zinc-400 hover:text-zinc-200 ml-1" title="Send script">&#128228;</button>%s</td>`,
			ipEsc, ipEsc, deleteBtn)
		fmt.Fprint(w, `</tr>`)
	}
	fmt.Fprint(w, `</tbody></table>`)

	// Toggle purge button in header
	if staleCount > 0 {
		fmt.Fprintf(w, `<script>var pb=document.getElementById('waf-purge-stale-btn');if(pb){pb.style.display='';pb.textContent='Purge %d stale';}</script>`, staleCount)
	} else {
		fmt.Fprint(w, `<script>var pb=document.getElementById('waf-purge-stale-btn');if(pb)pb.style.display='none';</script>`)
	}
}

// handleWAFNodeDelete removes a node's S3 registration (meta.json + alive.txt).
func (a *App) handleWAFNodeDelete(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		http.Error(w, "No account ID", 400)
		return
	}

	ip := r.FormValue("ip")
	if ip == "" {
		http.Error(w, "Missing ip", 400)
		return
	}

	bucket := a.controlBucketName()
	profile := a.wafProfile()
	region := "us-east-1"

	s3DeleteKey(profile, bucket, fmt.Sprintf("nodes/%s/meta.json", ip), region)
	s3DeleteKey(profile, bucket, fmt.Sprintf("nodes/%s/alive.txt", ip), region)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "ip": ip})
}

// discoverEC2Instances queries EC2 for running waffaw instances that may not
// have registered in S3 (e.g. agent failed to start).
func discoverEC2Instances(profile, region string) []wafNodeStatus {
	cmd := exec.Command("aws", "ec2", "describe-instances",
		"--profile", profile,
		"--region", region,
		"--filters",
		"Name=instance-state-name,Values=running",
		"Name=tag:Name,Values=waffaw-*",
		"--query", "Reservations[].Instances[].{ip:PublicIpAddress,id:InstanceId,type:InstanceType,launch:LaunchTime,region:Placement.AvailabilityZone}",
		"--output", "json",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil
	}

	var instances []struct {
		IP     string `json:"ip"`
		ID     string `json:"id"`
		Type   string `json:"type"`
		Launch string `json:"launch"`
		Region string `json:"region"`
	}
	if json.Unmarshal(out, &instances) != nil {
		return nil
	}

	var nodes []wafNodeStatus
	for _, inst := range instances {
		if inst.IP == "" {
			continue
		}
		// Derive region label from AZ (e.g. "us-east-1a" → "us-east-1")
		instRegion := inst.Region
		if len(instRegion) > 0 {
			instRegion = instRegion[:len(instRegion)-1] // strip AZ letter
		}

		uptime := ""
		if t, err := time.Parse(time.RFC3339, inst.Launch); err == nil {
			d := time.Since(t)
			if d.Hours() >= 1 {
				uptime = fmt.Sprintf("%.0fh %dm", d.Hours(), int(d.Minutes())%60)
			} else {
				uptime = fmt.Sprintf("%dm", int(d.Minutes()))
			}
		}

		nodes = append(nodes, wafNodeStatus{
			wafNodeMeta: wafNodeMeta{
				IP:           inst.IP,
				Region:       instRegion,
				NodeID:       inst.ID,
				NodeType:     "ec2",
				InstanceType: inst.Type,
				StartedAt:    inst.Launch,
			},
			Flag:   flagForRegion(instRegion),
			Status: "unregistered",
			Rank:   "-",
			Uptime: uptime,
		})
	}
	return nodes
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

	bucket := a.controlBucketName()
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

	bucket := a.controlBucketName()
	profile := a.wafProfile()
	region := "us-east-1"

	switch action {
	case "start":
		campaignName := r.FormValue("template")
		targetURL := r.FormValue("target_url")
		logLevel := r.FormValue("log_level")
		userAgent := r.FormValue("user_agent")
		customHeaderKey := r.FormValue("custom_header_key")
		customHeaderVal := r.FormValue("custom_header_value")

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

		// Purge old campaign trigger scripts so fresh nodes don't re-execute them
		if runObjs, err := s3ListKeys(profile, bucket, "global/run/", region); err == nil {
			for _, obj := range runObjs {
				s3DeleteKey(profile, bucket, obj.Key, region)
			}
			if len(runObjs) > 0 {
				log.Printf("WAF campaign: purged %d old trigger scripts from global/run/", len(runObjs))
			}
		}

		// Remove halt flag
		s3DeleteKey(profile, bucket, "global/halt", region)

		// Count current fleet size for consensus
		nodeCount := a.countActiveNodes(profile, bucket, region)
		if nodeCount < 1 {
			nodeCount = 1
		}

		// Write campaign-state.json
		newState := wafCampaignState{
			Status:         "running",
			Campaign:       campaignName,
			StartedAt:      time.Now().UTC().Format(time.RFC3339),
			StartedBy:      "configui",
			TargetURL:      targetURL,
			LogLevel:       logLevel,
			UserAgent:      userAgent,
			CustomHeaderKey: customHeaderKey,
			CustomHeaderVal: customHeaderVal,
			ExpectedNodes:  nodeCount,
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
export CAMPAIGN_NAME="%s"
export CAMPAIGN="$CAMPAIGN_NAME"
export WAFFAW_USER_AGENT="%s"
export WAFFAW_HEADER_KEY="%s"
export WAFFAW_HEADER_VALUE="%s"
export EXPECTED_NODES="%d"
export CONTROL_BUCKET="%s"

echo "[waffaw] Starting campaign: $CAMPAIGN -> $TARGET_URL (log=$LOG_LEVEL)"
[[ -n "$WAFFAW_USER_AGENT" ]] && echo "[waffaw] User-Agent: $WAFFAW_USER_AGENT"
[[ -n "$WAFFAW_HEADER_KEY" ]] && echo "[waffaw] Custom header: $WAFFAW_HEADER_KEY: $WAFFAW_HEADER_VALUE"

# Loop while campaign is running
cd /opt/waffaw
ITERATION=0
while true; do
  # Check campaign state from S3
  CAMP_STATE=$(aws s3 cp "s3://${CONTROL_BUCKET}/campaign-state.json" - --quiet 2>/dev/null || echo '{"status":"unknown"}')
  CAMP_STATUS=$(echo "$CAMP_STATE" | jq -r '.status // "unknown"')
  if [[ "$CAMP_STATUS" != "running" ]]; then
    echo "[waffaw] Campaign status='${CAMP_STATUS}', stopping loop"
    break
  fi

  ITERATION=$((ITERATION + 1))
  echo "[waffaw] === Iteration ${ITERATION} starting ==="

  # Re-run consensus each iteration (fleet may have changed)
  if [[ -f /opt/waffaw/consensus.sh ]]; then
    source /opt/waffaw/consensus.sh
    run_consensus "${EXPECTED_NODES:-1}"
    echo "[waffaw] Consensus complete: node $NODE_RANK of $NODE_TOTAL"
  else
    echo "[waffaw] WARNING: consensus.sh not found, running without coordination"
    export NODE_RANK=1
    export NODE_TOTAL=1
  fi

  npx artillery run "templates/%s.yml" 2>&1 \
    | tee -a "/tmp/campaign-${CAMPAIGN}.log" || true

  echo "[waffaw] === Iteration ${ITERATION} complete ==="
  sleep 10
done

echo "[waffaw] Campaign $CAMPAIGN loop exited on node ${NODE_RANK:-?}"
`, campaignName, targetURL, logLevel, targetURL, logLevel, campaignName, userAgent, customHeaderKey, customHeaderVal, nodeCount, bucket, campaignName)

		ts := time.Now().Format("20060102-150405")
		triggerKey := fmt.Sprintf("global/run/campaign-%s-%s.sh", campaignName, ts)
		log.Printf("WAF campaign: deploying trigger to s3://%s/%s (profile=%s, region=%s)", bucket, triggerKey, profile, region)
		if err := s3PutString(profile, bucket, triggerKey, region, triggerScript); err != nil {
			log.Printf("WAF campaign: trigger deploy failed: %v", err)
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

	case "clear":
		// Delete campaign-state.json to reset stale status
		s3DeleteKey(profile, bucket, "campaign-state.json", region)

		// Auto-purge stale node registrations (alive.txt > 2min old)
		purged := 0
		if objects, err := s3ListKeys(profile, bucket, "nodes/", region); err == nil {
			nodeAlive := map[string]time.Time{}
			for _, obj := range objects {
				parts := strings.Split(obj.Key, "/")
				if len(parts) >= 3 && parts[2] == "alive.txt" {
					nodeAlive[parts[1]] = obj.LastModified
				}
			}
			for ip, aliveAt := range nodeAlive {
				if time.Since(aliveAt) > 2*time.Minute {
					s3DeleteKey(profile, bucket, fmt.Sprintf("nodes/%s/meta.json", ip), region)
					s3DeleteKey(profile, bucket, fmt.Sprintf("nodes/%s/alive.txt", ip), region)
					purged++
				}
			}
			// Also purge nodes with meta.json but no alive.txt
			nodeMeta := map[string]bool{}
			for _, obj := range objects {
				parts := strings.Split(obj.Key, "/")
				if len(parts) >= 3 && parts[2] == "meta.json" {
					nodeMeta[parts[1]] = true
				}
			}
			for ip := range nodeMeta {
				if _, hasAlive := nodeAlive[ip]; !hasAlive {
					s3DeleteKey(profile, bucket, fmt.Sprintf("nodes/%s/meta.json", ip), region)
					purged++
				}
			}
		}
		// Purge old campaign trigger scripts from global/run/
		runPurged := 0
		if runObjs, err := s3ListKeys(profile, bucket, "global/run/", region); err == nil {
			for _, obj := range runObjs {
				s3DeleteKey(profile, bucket, obj.Key, region)
			}
			runPurged = len(runObjs)
		}

		log.Printf("WAF campaign: cleared, purged %d stale node(s), %d old trigger scripts", purged, runPurged)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "cleared", "purged": fmt.Sprintf("%d", purged), "scripts_purged": fmt.Sprintf("%d", runPurged)})

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

	startTime := time.Now().Add(-15 * time.Minute).UnixMilli()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			args := []string{"logs", "filter-log-events",
				"--log-group-name", logGroupName,
				"--start-time", fmt.Sprintf("%d", startTime),
				"--limit", "100",
				"--profile", profile,
				"--region", logRegion,
				"--output", "json",
			}
			if nodeFilter != "" && nodeFilter != "all" {
				args = append(args, "--filter-pattern", fmt.Sprintf(`{ $.source_ip = "%s" }`, nodeFilter))
			}

			cmd := exec.Command("aws", args...)
			out, err := cmd.CombinedOutput()
			if err != nil {
				errMsg := strings.TrimSpace(string(out))
				if len(errMsg) > 200 {
					errMsg = errMsg[:200]
				}
				log.Printf("WAF logs: filter-log-events failed: %v | %s", err, errMsg)
				errLine, _ := json.Marshal(map[string]interface{}{
					"line":   fmt.Sprintf("ERROR: CloudWatch query failed: %s", errMsg),
					"status": 0,
					"raw":    true,
				})
				fmt.Fprintf(w, "data: %s\n\n", errLine)
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
				ts := time.UnixMilli(event.Timestamp).Format("15:04:05.000")

				var logEntry map[string]interface{}
				if json.Unmarshal([]byte(event.Message), &logEntry) != nil {
					// Plain-text log message (agent lifecycle, etc.)
					lineJSON, _ := json.Marshal(map[string]interface{}{
						"line":   fmt.Sprintf("%s  %s", ts, event.Message),
						"status": 0,
						"raw":    true,
					})
					fmt.Fprintf(w, "data: %s\n\n", lineJSON)
					if event.Timestamp > startTime {
						startTime = event.Timestamp + 1
					}
					continue
				}

				// Structured JSON log (HTTP request details)
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

// handleWAFLogsLatest fetches the most recent log events in one shot (no streaming).
func (a *App) handleWAFLogsLatest(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		http.Error(w, "Application Account ID not configured", 400)
		return
	}

	profile := a.wafProfile()
	logRegion := r.URL.Query().Get("region")
	if logRegion == "" {
		logRegion = "us-east-1"
	}
	logGroupName := fmt.Sprintf("/waffaw/%s", logRegion)

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "200"
	}

	// Progressive fallback: try recent windows, widen if empty.
	windows := []time.Duration{5 * time.Minute, 1 * time.Hour, 24 * time.Hour}
	if mins := r.URL.Query().Get("minutes"); mins != "" {
		if m, err := strconv.Atoi(mins); err == nil && m > 0 {
			windows = []time.Duration{time.Duration(m) * time.Minute}
		}
	}

	var resp struct {
		Events []struct {
			Timestamp int64  `json:"timestamp"`
			Message   string `json:"message"`
		} `json:"events"`
	}

	for _, window := range windows {
		startTime := time.Now().Add(-window).UnixMilli()
		args := []string{"logs", "filter-log-events",
			"--log-group-name", logGroupName,
			"--start-time", fmt.Sprintf("%d", startTime),
			"--limit", limit,
			"--profile", profile,
			"--region", logRegion,
			"--output", "json",
		}
		cmd := exec.Command("aws", args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			errMsg := strings.TrimSpace(string(out))
			if len(errMsg) > 300 {
				errMsg = errMsg[:300]
			}
			http.Error(w, "CloudWatch query failed: "+errMsg, 500)
			return
		}
		if json.Unmarshal(out, &resp) != nil {
			http.Error(w, "Failed to parse CloudWatch response", 500)
			return
		}
		if len(resp.Events) > 0 {
			break
		}
	}

	type logLine struct {
		Line    string      `json:"line"`
		Status  int         `json:"status"`
		Raw     bool        `json:"raw,omitempty"`
		Headers interface{} `json:"headers,omitempty"`
		Body    interface{} `json:"body,omitempty"`
	}
	lines := make([]logLine, 0, len(resp.Events))

	for _, event := range resp.Events {
		ts := time.UnixMilli(event.Timestamp).Format("15:04:05.000")

		var logEntry map[string]interface{}
		if json.Unmarshal([]byte(event.Message), &logEntry) != nil {
			lines = append(lines, logLine{
				Line:   fmt.Sprintf("%s  %s", ts, event.Message),
				Status: 0,
				Raw:    true,
			})
			continue
		}

		ip, _ := logEntry["source_ip"].(string)
		entryRegion, _ := logEntry["region"].(string)
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

		flag := flagForRegion(entryRegion)
		path := targetURL
		if idx := strings.Index(targetURL, "://"); idx >= 0 {
			rest := targetURL[idx+3:]
			if pidx := strings.Index(rest, "/"); pidx >= 0 {
				path = rest[pidx:]
			}
		}

		line := fmt.Sprintf("%s  %s %s  [%d/%d]  %s  %s  %d  %dms",
			ts, flag, ip, rank, total, method, path, statusCode, responseTime)

		lines = append(lines, logLine{
			Line:    line,
			Status:  statusCode,
			Headers: logEntry["response_headers"],
			Body:    logEntry["response_body_preview"],
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"events": lines, "count": len(lines)})
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
	outputLocation := fmt.Sprintf("s3://waffaw-logs-%s-%s-%s/athena-results/",
		"use1", a.config.Site.Label, a.config.Site.RandomSuffix)

	// Register any new S3 partitions before querying
	repairID, err := athenaStartQuery(profile, "MSCK REPAIR TABLE waffaw_logs", "waffaw", outputLocation)
	if err != nil {
		log.Printf("WAF intel: MSCK REPAIR TABLE failed to start: %v", err)
	} else if _, err := athenaWaitAndFetch(profile, repairID); err != nil {
		log.Printf("WAF intel: MSCK REPAIR TABLE failed: %v", err)
	}

	// Note: timestamp column is varchar (ISO 8601), cast with from_iso8601_timestamp() for date functions.
	queries := map[string]string{
		"summary":     fmt.Sprintf(`SELECT campaign, COUNT(*) AS total_requests, COUNT(DISTINCT source_ip) AS unique_ips, MIN(timestamp) AS started, MAX(timestamp) AS ended, date_diff('minute', MIN(from_iso8601_timestamp(timestamp)), MAX(from_iso8601_timestamp(timestamp))) AS duration_minutes, ROUND(AVG(response_time_ms), 0) AS avg_response_ms, COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY campaign`, campaign),
		"detection":   fmt.Sprintf(`SELECT source_ip, node_type, MIN(timestamp) AS first_request, MIN(CASE WHEN status_code IN (403, 469) THEN timestamp END) AS first_block, date_diff('minute', MIN(from_iso8601_timestamp(timestamp)), MIN(CASE WHEN status_code IN (403, 469) THEN from_iso8601_timestamp(timestamp) END)) AS minutes_to_detect, COUNT(*) AS total_requests, COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) AS blocked_requests FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY source_ip, node_type ORDER BY minutes_to_detect ASC NULLS LAST`, campaign),
		"scenarios":   fmt.Sprintf(`SELECT scenario, COUNT(*) AS total, COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY scenario ORDER BY block_rate_pct DESC`, campaign),
		"hourly":      fmt.Sprintf(`SELECT date_format(from_iso8601_timestamp(timestamp), '%%Y-%%m-%%d %%H:00') AS hour, COUNT(*) AS requests, COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY date_format(from_iso8601_timestamp(timestamp), '%%Y-%%m-%%d %%H:00') ORDER BY hour`, campaign),
		"correlation": fmt.Sprintf(`SELECT node_type, COUNT(DISTINCT source_ip) AS unique_ips, COUNT(*) AS total_requests, COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) AS blocked, ROUND(COUNT(CASE WHEN status_code IN (403, 469) THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct FROM waffaw_logs WHERE campaign LIKE '%s' GROUP BY node_type`, campaign),
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

// handleWAFIntelReset deletes all S3 log data and Athena partitions for a fresh start.
func (a *App) handleWAFIntelReset(w http.ResponseWriter, r *http.Request) {
	profile := a.wafProfile()
	bucket := fmt.Sprintf("waffaw-logs-%s-%s-%s",
		"use1", a.config.Site.Label, a.config.Site.RandomSuffix)

	type step struct {
		Name string `json:"name"`
		Ok   bool   `json:"ok"`
		Msg  string `json:"msg,omitempty"`
	}
	var steps []step

	// 1. Delete all S3 data (except athena-results/)
	cmd := exec.Command("aws", "s3", "rm", "s3://"+bucket+"/",
		"--recursive", "--exclude", "athena-results/*",
		"--profile", profile, "--region", "us-east-1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		steps = append(steps, step{"Delete S3 data", false, strings.TrimSpace(string(out))})
	} else {
		steps = append(steps, step{"Delete S3 data", true, ""})
	}

	// 2. Drop all Glue partitions
	// List partitions first
	listCmd := exec.Command("aws", "glue", "get-partitions",
		"--database-name", "waffaw",
		"--table-name", "waffaw_logs",
		"--profile", profile, "--region", "us-east-1",
		"--output", "json")
	listOut, err := listCmd.CombinedOutput()
	if err != nil {
		steps = append(steps, step{"List partitions", false, strings.TrimSpace(string(listOut))})
	} else {
		var partResp struct {
			Partitions []struct {
				Values []string `json:"Values"`
			} `json:"Partitions"`
		}
		if json.Unmarshal(listOut, &partResp) == nil && len(partResp.Partitions) > 0 {
			// Build batch-delete input
			type partVal struct {
				Values []string `json:"Values"`
			}
			var batch []partVal
			for _, p := range partResp.Partitions {
				batch = append(batch, partVal{Values: p.Values})
			}
			batchJSON, _ := json.Marshal(batch)

			delCmd := exec.Command("aws", "glue", "batch-delete-partition",
				"--database-name", "waffaw",
				"--table-name", "waffaw_logs",
				"--partitions-to-delete", string(batchJSON),
				"--profile", profile, "--region", "us-east-1",
				"--output", "json")
			delOut, err := delCmd.CombinedOutput()
			if err != nil {
				steps = append(steps, step{"Drop partitions", false, strings.TrimSpace(string(delOut))})
			} else {
				steps = append(steps, step{"Drop partitions", true, fmt.Sprintf("Removed %d partitions", len(batch))})
			}
		} else {
			steps = append(steps, step{"Drop partitions", true, "No partitions to drop"})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"steps": steps})
}

// handleWAFBuild runs apps/run.waffaw/build.sh and streams output via SSE.
func (a *App) handleWAFCheckImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	imageURI := r.FormValue("image_uri")
	if imageURI == "" {
		json.NewEncoder(w).Encode(map[string]any{"error": "no image URI"})
		return
	}

	// Split repo:tag
	repo, tag := imageURI, "latest"
	if i := strings.LastIndex(imageURI, ":"); i > 0 {
		repo = imageURI[:i]
		tag = imageURI[i+1:]
	}

	a.mu.RLock()
	profilePrefix := a.envLocal.ProfilePrefix
	a.mu.RUnlock()

	profile := "terraform"
	if profilePrefix != "" {
		profile = profilePrefix + "-terraform"
	}

	exists, _ := checkECRImage(profile, repo, tag, "us-east-1")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"exists": exists, "repo": repo, "tag": tag})
}

// dockerLayerRe matches docker push layer status lines like "a5612b7c5253: Waiting"
var dockerLayerRe = regexp.MustCompile(`^[0-9a-f]{12}: (Waiting|Preparing|Layer already exists|Pushed|Pushing .*|Mounted from .*)$`)

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
	imageURI := a.config.Waffaw.ImageURI
	a.mu.RUnlock()

	// Prefer image_uri from query param (unsaved form value) over saved config
	if qURI := r.URL.Query().Get("image_uri"); qURI != "" {
		imageURI = qURI
	}

	// Extract tag from image_uri (e.g. "dc34-waffaw:1.0.1" -> "1.0.1")
	imageTag := "latest"
	if i := strings.LastIndex(imageURI, ":"); i > 0 {
		imageTag = imageURI[i+1:]
	}

	buildScript := fmt.Sprintf("%s/apps/run.waffaw/build.sh", a.repoRoot)

	// Set up environment for build.sh
	profile := "application"
	if profilePrefix != "" {
		profile = profilePrefix + "-application"
	}

	cmd := exec.Command("bash", buildScript)
	cmd.Dir = fmt.Sprintf("%s/apps/run.waffaw", a.repoRoot)
	cmd.Env = append(os.Environ(),
		"AWS_PROFILE="+profile,
		"AWS_ACCOUNT_ID="+accountID,
		"SITE_LABEL="+siteLabel,
		"IMAGE_TAG="+imageTag,
		"DOCKER_BUILDKIT=1",
		"BUILDKIT_PROGRESS=plain",
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

	startTime := time.Now()

	// Mutex protects SSE writes — tick goroutine and scanner both write to w
	var sseMu sync.Mutex
	sendSSE := func(data []byte) {
		sseMu.Lock()
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
		sseMu.Unlock()
	}

	// Send elapsed tick events every 2 seconds in background
	ctx := r.Context()
	doneCh := make(chan struct{})
	defer close(doneCh)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-doneCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				secs := int(time.Since(startTime).Seconds())
				tickJSON, _ := json.Marshal(map[string]interface{}{"tick": secs})
				sendSSE(tickJSON)
			}
		}
	}()

	// Detect build phases from output and send phase events
	phase := ""
	sendPhase := func(p string) {
		if p != phase {
			phase = p
			phaseJSON, _ := json.Marshal(map[string]interface{}{"phase": p})
			sendSSE(phaseJSON)
		}
	}

	// Layer tracking for docker push — collapse into summary events
	type layerInfo struct {
		Status string // normalized: Waiting, Preparing, Pushing, Pushed, Layer already exists, Mounted
		Detail string // raw status for display (e.g. "Pushing 12.3MB/45.6MB")
	}
	layers := map[string]*layerInfo{} // layerID → info
	sendLayerSummary := func() {
		counts := map[string]int{}
		var pending []map[string]string
		for id, li := range layers {
			counts[li.Status]++
			// Include details for non-done layers
			if li.Status != "Pushed" && li.Status != "Layer already exists" && li.Status != "Mounted" {
				pending = append(pending, map[string]string{"id": id, "status": li.Status, "detail": li.Detail})
			}
		}
		total := len(layers)
		sumJSON, _ := json.Marshal(map[string]interface{}{
			"layers":  counts,
			"total":   total,
			"pending": pending,
		})
		sendSSE(sumJSON)
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()

		// Skip empty lines (BuildKit blank separators)
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Detect phases from output
		lower := strings.ToLower(line)
		if strings.Contains(lower, "login succeeded") || strings.Contains(lower, "get-login-password") {
			sendPhase("ecr-login")
		} else if strings.Contains(line, "docker buildx build") || strings.HasPrefix(line, "=== Building waffaw") {
			sendPhase("docker-build")
		} else if strings.Contains(lower, "step ") || strings.HasPrefix(line, "#") {
			if phase != "docker-push" {
				sendPhase("docker-build")
			}
		} else if strings.Contains(lower, "the push refers to") {
			sendPhase("docker-push")
		} else if strings.HasPrefix(line, "Image pushed to ") {
			sendPhase("complete")
		}

		// Collapse docker push layer status lines into summary events
		if phase == "docker-push" {
			if m := dockerLayerRe.FindStringSubmatch(line); m != nil {
				layerID := line[:12]
				rawStatus := m[1]
				normStatus := rawStatus
				// Normalize variable-suffix statuses
				if strings.HasPrefix(normStatus, "Pushing") {
					normStatus = "Pushing"
				} else if strings.HasPrefix(normStatus, "Mounted from") {
					normStatus = "Mounted"
				}
				layers[layerID] = &layerInfo{Status: normStatus, Detail: rawStatus}
				sendLayerSummary()
				continue
			}
		}

		lineJSON, _ := json.Marshal(map[string]interface{}{
			"line": line,
			"done": false,
		})
		sendSSE(lineJSON)

		// Extract image name:tag from the "Image pushed to" line
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
			sendSSE(uriJSON)
		}
	}

	exitCode := 0
	if err := cmd.Wait(); err != nil {
		exitCode = 1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	elapsed := time.Since(startTime).Round(time.Second)
	doneJSON, _ := json.Marshal(map[string]interface{}{
		"line":    fmt.Sprintf("Build finished in %s (exit code %d)", elapsed, exitCode),
		"done":    true,
		"exit":    exitCode,
		"elapsed": int(elapsed.Seconds()),
	})
	sendSSE(doneJSON)

	go a.rrdbRecordBuild("waffaw", "build", startTime, exitCode)
}

// handleWAFCampaignState returns the current campaign state from S3.
func (a *App) handleWAFCampaignState(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	accountID := a.envLocal.ApplicationAccountID
	a.mu.RUnlock()

	if accountID == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		return
	}

	bucket := a.controlBucketName()
	profile := a.wafProfile()

	var state wafCampaignState
	if err := s3GetJSON(profile, bucket, "campaign-state.json", "us-east-1", &state); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "none"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// validCampaignTemplates lists allowed campaign template IDs.
var validCampaignTemplates = map[string]string{
	"camp-low-and-slow":    "apps/run.waffaw/templates/low-and-slow.yml",
	"camp-public-flood":    "apps/run.waffaw/templates/public-flood.yml",
	"camp-crawl-and-probe": "apps/run.waffaw/templates/crawl-and-probe.yml",
	"camp-auth-probe":      "apps/run.waffaw/templates/auth-probe.yml",
}

// handleWAFCampaignTemplateSave saves edited campaign YAML back to disk.
func (a *App) handleWAFCampaignTemplateSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	tabID := r.FormValue("tab_id")
	content := r.FormValue("content")

	relPath, ok := validCampaignTemplates[tabID]
	if !ok {
		http.Error(w, "unknown template", 400)
		return
	}

	absPath := fmt.Sprintf("%s/%s", a.repoRoot, relPath)
	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		http.Error(w, fmt.Sprintf("write error: %v", err), 500)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": relPath})
}

// quotaDef describes a single AWS Service Quota to fetch.
type quotaDef struct {
	Key         string // JSON key in response
	ServiceCode string
	QuotaCode   string
	Unit        string // "count" or "vcpu"
}

// waffaw-relevant quotas
var wafQuotas = []quotaDef{
	{Key: "eip", ServiceCode: "ec2", QuotaCode: "L-0263D0A3", Unit: "count"},
	{Key: "ec2_ondemand_vcpu", ServiceCode: "ec2", QuotaCode: "L-1216C47A", Unit: "vcpu"},
	{Key: "ec2_spot_vcpu", ServiceCode: "ec2", QuotaCode: "L-34B43A08", Unit: "vcpu"},
	{Key: "fargate_ondemand_vcpu", ServiceCode: "fargate", QuotaCode: "L-3032A538", Unit: "vcpu"},
	{Key: "fargate_spot_vcpu", ServiceCode: "fargate", QuotaCode: "L-36FBB829", Unit: "vcpu"},
}

// handleWAFQuota queries AWS Service Quotas for each waffaw region.
func (a *App) handleWAFQuota(w http.ResponseWriter, r *http.Request) {
	profile := a.wafProfile()

	allRegs := AllRegions()
	regions := make([]string, len(allRegs))
	for i, r := range allRegs {
		regions[i] = r.Full
	}

	type quotaValue struct {
		Region string  `json:"region"`
		Value  float64 `json:"value"`
		Err    string  `json:"error,omitempty"`
	}

	type quotaResult struct {
		Key    string       `json:"key"`
		Unit   string       `json:"unit"`
		Min    float64      `json:"min"`
		Values []quotaValue `json:"regions"`
	}

	// Fetch all quotas x all regions in parallel
	type fetchResult struct {
		quotaIdx  int
		regionIdx int
		value     float64
		err       string
	}

	total := len(wafQuotas) * len(regions)
	ch := make(chan fetchResult, total)

	for qi, qd := range wafQuotas {
		for ri, reg := range regions {
			go func(qi, ri int, qd quotaDef, region string) {
				out, err := exec.Command("aws", "service-quotas", "get-service-quota",
					"--service-code", qd.ServiceCode,
					"--quota-code", qd.QuotaCode,
					"--profile", profile,
					"--region", region,
					"--output", "json",
				).Output()
				if err != nil {
					ch <- fetchResult{qi, ri, 0, err.Error()}
					return
				}
				var resp struct {
					Quota struct {
						Value float64 `json:"Value"`
					} `json:"Quota"`
				}
				if json.Unmarshal(out, &resp) != nil {
					ch <- fetchResult{qi, ri, 0, "parse error"}
					return
				}
				ch <- fetchResult{qi, ri, resp.Quota.Value, ""}
			}(qi, ri, qd, reg)
		}
	}

	// Collect results
	results := make([]quotaResult, len(wafQuotas))
	for i, qd := range wafQuotas {
		results[i] = quotaResult{
			Key:    qd.Key,
			Unit:   qd.Unit,
			Values: make([]quotaValue, len(regions)),
		}
		for j, reg := range regions {
			results[i].Values[j] = quotaValue{Region: reg}
		}
	}

	for i := 0; i < total; i++ {
		fr := <-ch
		results[fr.quotaIdx].Values[fr.regionIdx].Value = fr.value
		results[fr.quotaIdx].Values[fr.regionIdx].Err = fr.err
	}

	// Compute min per quota
	for i := range results {
		minVal := results[i].Values[0].Value
		for _, v := range results[i].Values[1:] {
			if v.Value > 0 && v.Value < minVal {
				minVal = v.Value
			}
		}
		results[i].Min = minVal
	}

	// Build a flat map for easy JS access: { eip: {min, regions}, ... }
	out := map[string]interface{}{}
	for _, r := range results {
		out[r.Key] = map[string]interface{}{
			"min":     r.Min,
			"unit":    r.Unit,
			"regions": r.Values,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
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

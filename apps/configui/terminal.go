package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// TerraformSummary captures the plan/apply summary line from terraform output.
type TerraformSummary struct {
	Add      int    `json:"add"`
	Change   int    `json:"change"`
	Destroy  int    `json:"destroy"`
	Text     string `json:"text"`
	NoChange bool   `json:"no_change"`
}

// ResourceStats breaks down plan/apply counts by module and resource type.
type ResourceStats struct {
	ByModule     map[string]*TerraformSummary `json:"by_module"`
	ByType       map[string]*TerraformSummary `json:"by_type"`
	ByModuleType map[string]*TerraformSummary `json:"by_module_type,omitempty"`
}

// Regex patterns for extracting terraform plan/apply/destroy summaries.
var (
	rePlanSummary    = regexp.MustCompile(`Plan:\s*(\d+)\s+to add,\s*(\d+)\s+to change,\s*(\d+)\s+to destroy`)
	reApplySummary   = regexp.MustCompile(`Resources:\s*(\d+)\s+added,\s*(\d+)\s+changed,\s*(\d+)\s+destroyed`)
	reDestroySummary = regexp.MustCompile(`Destroy complete! Resources:\s*(\d+)\s+destroyed`)
	reNoChanges      = regexp.MustCompile(`No changes\.\s+Your infrastructure matches the configuration`)
	reModulePrefix   = regexp.MustCompile(`^\[([^\]]+)\]\s*(.*)`)
	reResourceAction = regexp.MustCompile(`#\s+(?:module\.[\w.]+\.)?(\w+)\.([\w\[\]"]+)\s+(?:will be (created|updated in-place|destroyed)|must be (replaced))`)
)

// parseSummaryLine checks a line for terraform plan/apply summary patterns.
func parseSummaryLine(line string) *TerraformSummary {
	if m := rePlanSummary.FindStringSubmatch(line); m != nil {
		add, _ := strconv.Atoi(m[1])
		chg, _ := strconv.Atoi(m[2])
		del, _ := strconv.Atoi(m[3])
		return &TerraformSummary{Add: add, Change: chg, Destroy: del, Text: m[0]}
	}
	if m := reApplySummary.FindStringSubmatch(line); m != nil {
		add, _ := strconv.Atoi(m[1])
		chg, _ := strconv.Atoi(m[2])
		del, _ := strconv.Atoi(m[3])
		return &TerraformSummary{Add: add, Change: chg, Destroy: del, Text: m[0]}
	}
	if m := reDestroySummary.FindStringSubmatch(line); m != nil {
		del, _ := strconv.Atoi(m[1])
		return &TerraformSummary{Destroy: del, Text: m[0]}
	}
	if reNoChanges.MatchString(line) {
		return &TerraformSummary{NoChange: true, Text: "No changes"}
	}
	return nil
}

// parseResourceAction extracts resource type and action from a terraform plan line.
// Returns the resource type (e.g. "aws_iam_role"), the action, and whether it matched.
func parseResourceAction(line string) (resourceType, action string, ok bool) {
	m := reResourceAction.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	resourceType = m[1]
	switch {
	case m[3] == "created":
		action = "create"
	case m[3] == "updated in-place":
		action = "update"
	case m[3] == "destroyed":
		action = "destroy"
	case m[4] == "replaced":
		action = "replace"
	default:
		return "", "", false
	}
	return resourceType, action, true
}

// accumulateStats adds a resource action to the stats maps.
func accumulateStats(stats *ResourceStats, module, resourceType, action string) {
	// Helper to get-or-create a summary entry in a map
	getOrCreate := func(m map[string]*TerraformSummary, key string) *TerraformSummary {
		s, ok := m[key]
		if !ok {
			s = &TerraformSummary{}
			m[key] = s
		}
		return s
	}

	targets := []*TerraformSummary{
		getOrCreate(stats.ByModule, module),
		getOrCreate(stats.ByType, resourceType),
		getOrCreate(stats.ByModuleType, module+"|"+resourceType),
	}

	for _, t := range targets {
		switch action {
		case "create":
			t.Add++
		case "update":
			t.Change++
		case "destroy":
			t.Destroy++
		case "replace":
			t.Add++
			t.Destroy++
		}
	}
}

// TermSession represents a running or completed terminal session.
type TermSession struct {
	ID       string             `json:"id"`
	Module   string             `json:"module"`
	Command  string             `json:"command"`
	Region   string             `json:"region,omitempty"`
	CmdLine  string             `json:"cmd_line"`           // Full command string for display
	WorkDir  string             `json:"work_dir"`           // Working directory for display
	Status   string             `json:"status"`             // "running", "done", "error"
	ExitCode int                `json:"exit_code"`
	Summary  *TerraformSummary  `json:"summary,omitempty"`
	Stats    *ResourceStats    `json:"stats,omitempty"`

	mu        sync.Mutex
	lines     []string
	cmd       *exec.Cmd
	clients   map[chan string]struct{}
	startAt   time.Time // when the process started
	doneAt    time.Time // when the process finished (for cleanup)
	siteLabel string    // from Site.Label, used to replace [.] in output
}

// ModuleDef maps a panel ID to a terragrunt module path.
type ModuleDef struct {
	Path     string // relative to infra/terraform/live/site/, use %s for region
	Global   bool   // true = no region needed
	Category string // "infra", "services", "apps", "meta"
}

// ModuleMap maps panel IDs to filesystem paths relative to infra/terraform/live/site/.
var ModuleMap = map[string]ModuleDef{
	// All modules (run from site root)
	"all": {Path: "", Global: true, Category: "meta"},
	// All modules in a single region
	"region-all": {Path: "region/%s", Category: "meta"},
	// Global modules (run once)
	"github_oidc": {Path: "global/github-oidc", Global: true, Category: "infra"},
	"cloudtrail":  {Path: "global/cloudtrail", Global: true, Category: "infra"},
	"cloudfront":  {Path: "global/cloudfront", Global: true, Category: "infra"},
	"waf":         {Path: "global/waf", Global: true, Category: "infra"},
	// Regional modules (need region param)
	"ecs_clusters": {Path: "region/%s/ecs-cluster", Category: "infra"},
	"ecs_services": {Path: "region/%s/ecs-service", Category: "infra"},
	"ecs_tasks":    {Path: "region/%s/ecs-task", Category: "infra"},
	"dynamodb":     {Path: "region/%s/dynamodb", Category: "infra"},
	"ecr":          {Path: "region/%s/ecr", Category: "infra"},
	"ec2spots":     {Path: "region/%s/ec2spot", Category: "infra"},
	"email":        {Path: "region/%s/email", Category: "infra"},
	"secrets":      {Path: "region/%s/secrets", Category: "infra"},
	"s3_uploads":   {Path: "region/%s/s3-uploads", Category: "infra"},
	"upload_proc":  {Path: "region/%s/s3-uploads-processor", Category: "infra"},
	// Services (global — single terragrunt config per service)
	"svc_auth":  {Path: "services/run.auth", Global: true, Category: "services"},
	"svc_human": {Path: "services/run.human", Global: true, Category: "services"},
	"svc_cms":   {Path: "services/run.cms", Global: true, Category: "services"},
	"svc_gpx":   {Path: "services/run.gpx", Global: true, Category: "services"},
	// Apps (regional)
	"waffaw": {Path: "region/%s/waffaw", Category: "apps"},
}

// AllowedCommands maps command names to their terragrunt arguments.
var AllowedCommands = map[string][]string{
	"plan":        {"terragrunt", "plan", "--non-interactive", "--no-color"},
	"apply":       {"terragrunt", "apply", "--non-interactive", "--no-color", "-auto-approve"},
	"plan-all":    {"terragrunt", "plan", "--all", "--non-interactive", "--no-color"},
	"apply-all":   {"terragrunt", "apply", "--all", "--non-interactive", "--no-color", "-auto-approve"},
	"destroy":     {"terragrunt", "destroy", "--non-interactive", "--no-color", "-auto-approve"},
	"destroy-all": {"terragrunt", "destroy", "--all", "--non-interactive", "--no-color", "-auto-approve"},
}

// broadcast sends a line to all SSE clients.
func (s *TermSession) broadcast(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = append(s.lines, line)
	for ch := range s.clients {
		select {
		case ch <- line:
		default:
			// Drop if client is slow
		}
	}
}

// subscribe registers an SSE client channel and returns existing lines for replay.
func (s *TermSession) subscribe() (chan string, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan string, 64)
	s.clients[ch] = struct{}{}
	replay := make([]string, len(s.lines))
	copy(replay, s.lines)
	return ch, replay
}

// unsubscribe removes an SSE client channel.
func (s *TermSession) unsubscribe(ch chan string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, ch)
	close(ch)
}

// closeBroadcast signals done to all clients.
func (s *TermSession) closeBroadcast() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.clients {
		select {
		case ch <- "":
		default:
		}
	}
}

// buildTerminalEnv constructs the environment for a terragrunt child process.
// Instead of sourcing env.sh (which triggers SSO login and credential export),
// we build the equivalent env vars from ConfigUI's already-parsed config.
func buildTerminalEnv(profile string, cfg *SiteConfig, envLocal *EnvLocalConfig) []string {
	// Start with parent env, stripping AWS auth vars that would conflict with AWS_PROFILE
	stripKeys := map[string]bool{
		"AWS_PROFILE":           true,
		"AWS_DEFAULT_PROFILE":   true,
		"AWS_ACCESS_KEY_ID":     true,
		"AWS_SECRET_ACCESS_KEY": true,
		"AWS_SESSION_TOKEN":     true,
		"AWS_SECURITY_TOKEN":    true,
	}

	// Also strip vars we'll set explicitly so there are no stale values
	tgVars := map[string]bool{
		"TF_VAR_profile_prefix":          true,
		"TF_VAR_APPLICATION_ACCOUNT_ID":  true,
		"TF_VAR_MANAGEMENT_ACCOUNT_ID":   true,
		"TF_VAR_GITHUB_ORG":              true,
		"TF_VAR_FWD_EMAIL_TO_ADDRESS":    true,
		"TF_VAR_SOPS_KMS_KEY_ID":         true,
		"SGUID":                           true,
		"SITE_LABEL":                      true,
		"SITE_DOMAIN":                     true,
		"TG_BUCKET_USE1":                  true,
		"TG_TABLE_USE1":                   true,
		"TG_BUCKET_CAC1":                  true,
		"TG_TABLE_CAC1":                   true,
		"TG_BUCKET_APSE1":                 true,
		"TG_TABLE_APSE1":                  true,
	}

	var env []string
	for _, e := range os.Environ() {
		key := e
		if idx := strings.IndexByte(e, '='); idx >= 0 {
			key = e[:idx]
		}
		if !stripKeys[key] && !tgVars[key] {
			env = append(env, e)
		}
	}

	// AWS auth — profile-based SSO (reads token cache from disk)
	env = append(env, "AWS_PROFILE="+profile)

	// env.local.sh equivalents — sensitive values from ConfigUI's parsed config
	env = append(env, "TF_VAR_profile_prefix="+envLocal.ProfilePrefix)
	env = append(env, "TF_VAR_APPLICATION_ACCOUNT_ID="+envLocal.ApplicationAccountID)
	env = append(env, "TF_VAR_MANAGEMENT_ACCOUNT_ID="+envLocal.ManagementAccountID)
	env = append(env, "TF_VAR_GITHUB_ORG="+envLocal.GitHubOrg)
	env = append(env, "TF_VAR_FWD_EMAIL_TO_ADDRESS="+envLocal.FwdEmailToAddress)
	env = append(env, "TF_VAR_SOPS_KMS_KEY_ID="+envLocal.SOPSKMSKeyID)

	// env.sh equivalents — site identity and terragrunt state config
	label := cfg.Site.Label
	suffix := cfg.Site.RandomSuffix
	env = append(env, "SGUID="+suffix)
	env = append(env, "SITE_LABEL="+label)
	env = append(env, "SITE_DOMAIN="+cfg.DNS.ZoneName)

	// Terragrunt state bucket/table names per region
	prefix := cfg.Site.TFStatePrefix
	for _, r := range AllRegions() {
		name := fmt.Sprintf("%s-%s-%s", prefix, r.Label, suffix)
		upper := strings.ToUpper(r.Label)
		env = append(env, fmt.Sprintf("TG_BUCKET_%s=%s", upper, name))
		env = append(env, fmt.Sprintf("TG_TABLE_%s=%s", upper, name))
	}

	return env
}

// startTerminal validates inputs, starts a terragrunt process, and streams output.
func (a *App) startTerminal(module, command, region string) (*TermSession, error) {
	modDef, ok := ModuleMap[module]
	if !ok {
		return nil, fmt.Errorf("unknown module: %s", module)
	}

	cmdArgs, ok := AllowedCommands[command]
	if !ok {
		return nil, fmt.Errorf("unknown command: %s", command)
	}

	// Resolve path
	relPath := modDef.Path
	if !modDef.Global {
		if region == "" {
			return nil, fmt.Errorf("region required for module: %s", module)
		}
		// Validate region
		validRegion := false
		for _, r := range AllRegions() {
			if r.Full == region {
				validRegion = true
				break
			}
		}
		if !validRegion {
			return nil, fmt.Errorf("invalid region: %s", region)
		}
		relPath = fmt.Sprintf(modDef.Path, region)
	}

	workDir := filepath.Join(a.repoRoot, "infra", "terraform", "live", "site", relPath)
	if _, err := os.Stat(workDir); err != nil {
		return nil, fmt.Errorf("module directory not found: %s", workDir)
	}

	// Prune completed sessions older than 5 minutes
	a.mu.Lock()
	now := time.Now()
	for id, s := range a.termSessions {
		if s.Status != "running" && !s.doneAt.IsZero() && now.Sub(s.doneAt) > 5*time.Minute {
			delete(a.termSessions, id)
		}
	}
	a.mu.Unlock()

	// Snapshot config under lock
	a.mu.RLock()
	cfg := a.config
	envLocal := a.envLocal
	a.mu.RUnlock()

	// Build AWS profile
	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	session := &TermSession{
		ID:        fmt.Sprintf("term-%d", time.Now().UnixMilli()),
		Module:    module,
		Command:   command,
		Region:    region,
		CmdLine:   strings.Join(cmdArgs, " "),
		WorkDir:   workDir,
		Status:    "running",
		Stats:     &ResourceStats{ByModule: make(map[string]*TerraformSummary), ByType: make(map[string]*TerraformSummary), ByModuleType: make(map[string]*TerraformSummary)},
		startAt:   time.Now(),
		clients:   make(map[chan string]struct{}),
		siteLabel: cfg.Site.Label,
	}

	cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
	cmd.Dir = workDir
	cmd.Env = buildTerminalEnv(profile, cfg, envLocal)
	session.cmd = cmd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start command: %w", err)
	}

	a.mu.Lock()
	a.termSessions[session.ID] = session
	a.mu.Unlock()

	// Read both pipes concurrently to avoid deadlock when one pipe's
	// buffer fills while the other is still being read sequentially.
	var pipeWg sync.WaitGroup
	scanPipe := func(r io.Reader) {
		defer pipeWg.Done()
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			// Strip leading timestamp (e.g. "20:44:15.356 ") that terragrunt
			// prepends before the stream prefix.
			cleaned := line
			if len(cleaned) > 13 && cleaned[2] == ':' && cleaned[5] == ':' && cleaned[12] == ' ' {
				cleaned = cleaned[13:]
			}
			// Strip terragrunt's stream prefixes to reduce output noise.
			for _, prefix := range []string{
				"STDOUT terraform: ", "STDERR terraform: ",
				"STDOUT tofu: ", "STDERR tofu: ",
				"STDOUT terraform:", "STDERR terraform:",
				"STDOUT tofu:", "STDERR tofu:",
				"STDOUT: ", "STDERR: ",
				"STDOUT ", "STDERR ",
				"terraform: ", "tofu: ",
			} {
				if strings.HasPrefix(cleaned, prefix) {
					cleaned = cleaned[len(prefix):]
					break
				}
			}
			// Extract per-module resource actions for stats breakdown
		innerLine := cleaned
		moduleName := session.Module
		if m := reModulePrefix.FindStringSubmatch(cleaned); m != nil {
			moduleName = m[1]
			innerLine = m[2]
			// Replace [.] with site label for readability
			if moduleName == "." && session.siteLabel != "" {
				moduleName = session.siteLabel
			}
			// Strip "terraform: " / "tofu: " from inside [module] prefix
			for _, p := range []string{"terraform: ", "tofu: "} {
				if strings.HasPrefix(innerLine, p) {
					innerLine = innerLine[len(p):]
					break
				}
			}
			cleaned = "[" + moduleName + "] " + innerLine
		}
		if resType, action, ok := parseResourceAction(innerLine); ok {
			session.mu.Lock()
			accumulateStats(session.Stats, moduleName, resType, action)
			session.mu.Unlock()
		}
		if summary := parseSummaryLine(cleaned); summary != nil {
			// For apply/destroy commands, terraform outputs both the plan preview
			// ("Plan: X to add...") and the actual result ("Resources: X added...").
			// Only count the result to avoid double-counting.
			isApplyCmd := strings.HasPrefix(session.Command, "apply") || strings.HasPrefix(session.Command, "destroy")
			isPlanLine := rePlanSummary.MatchString(cleaned)
			if isApplyCmd && isPlanLine {
				session.broadcast(cleaned)
				continue
			}
				session.mu.Lock()
				if session.Summary == nil {
					session.Summary = summary
				} else {
					session.Summary.Add += summary.Add
					session.Summary.Change += summary.Change
					session.Summary.Destroy += summary.Destroy
					if !summary.NoChange {
						session.Summary.NoChange = false
					}
				}
				// Update Text to reflect aggregate totals
				s := session.Summary
				if s.NoChange {
					s.Text = "No changes"
				} else {
					s.Text = fmt.Sprintf("Plan: %d to add, %d to change, %d to destroy", s.Add, s.Change, s.Destroy)
				}
				session.mu.Unlock()
			}
			session.broadcast(cleaned)
		}
	}
	pipeWg.Add(2)
	go scanPipe(stdout)
	go scanPipe(stderr)

	// Wait for both pipes to drain, then wait for process exit
	go func() {
		pipeWg.Wait()
		err := cmd.Wait()
		if err != nil {
			session.Status = "error"
			if exitErr, ok := err.(*exec.ExitError); ok {
				session.ExitCode = exitErr.ExitCode()
			} else {
				session.ExitCode = 1
			}
		} else {
			session.Status = "done"
			session.ExitCode = 0
		}

		session.doneAt = time.Now()
		go a.rrdbRecord(session)
		log.Printf("Terminal session %s completed: status=%s exit=%d", session.Module, session.Status, session.ExitCode)
		session.closeBroadcast()
	}()

	return session, nil
}

// handleTerminalStart starts a new terminal session.
func (a *App) handleTerminalStart(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	module := r.FormValue("module")
	command := r.FormValue("command")
	region := r.FormValue("region")

	session, err := a.startTerminal(module, command, region)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(409)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

// handleTerminalStream serves SSE events for a specific terminal session.
func (a *App) handleTerminalStream(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	a.mu.RLock()
	session := a.termSessions[id]
	a.mu.RUnlock()

	if session == nil {
		http.Error(w, "No terminal session with id: "+id, 404)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", 500)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, replay := session.subscribe()
	defer session.unsubscribe(ch)

	// Replay existing lines
	for _, line := range replay {
		fmt.Fprintf(w, "data: %s\n\n", line)
	}
	flusher.Flush()

	// sendSummaryAndDone emits a summary SSE event (if available) then the done event.
	sendSummaryAndDone := func() {
		session.mu.Lock()
		summary := session.Summary
		stats := session.Stats
		session.mu.Unlock()
		if summary != nil {
			payload := struct {
				*TerraformSummary
				Stats *ResourceStats `json:"stats,omitempty"`
			}{TerraformSummary: summary, Stats: stats}
			summaryJSON, _ := json.Marshal(payload)
			fmt.Fprintf(w, "event: summary\ndata: %s\n\n", summaryJSON)
		}
		fmt.Fprintf(w, "event: done\ndata: %d\n\n", session.ExitCode)
		flusher.Flush()
	}

	// If already done, send done event immediately
	if session.Status != "running" {
		sendSummaryAndDone()
		return
	}

	ctx := r.Context()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Send elapsed-time tick so the client knows the process is alive
			elapsed := int(time.Since(session.startAt).Seconds())
			fmt.Fprintf(w, "event: tick\ndata: %d\n\n", elapsed)
			// Stream live stats so the client can show mid-execution breakdown
			session.mu.Lock()
			liveStats := session.Stats
			session.mu.Unlock()
			if liveStats != nil && (len(liveStats.ByModule) > 0 || len(liveStats.ByType) > 0) {
				statsJSON, _ := json.Marshal(liveStats)
				fmt.Fprintf(w, "event: stats\ndata: %s\n\n", statsJSON)
			}
			flusher.Flush()
		case line, ok := <-ch:
			if !ok {
				// Channel closed
				sendSummaryAndDone()
				return
			}
			if line == "" && session.Status != "running" {
				// Empty line = done signal
				sendSummaryAndDone()
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		}
	}
}

// handleTerminalStop kills a specific terminal process.
func (a *App) handleTerminalStop(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	id := r.FormValue("id")
	a.mu.RLock()
	session := a.termSessions[id]
	a.mu.RUnlock()

	if session == nil || session.Status != "running" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "no running session"})
		return
	}

	if session.cmd != nil && session.cmd.Process != nil {
		session.cmd.Process.Kill()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

// handleTerminalList returns all terminal sessions as JSON.
func (a *App) handleTerminalList(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	sessions := make([]*TermSession, 0, len(a.termSessions))
	for _, s := range a.termSessions {
		sessions = append(sessions, s)
	}
	a.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

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
	"strings"
	"sync"
)

// TermSession represents a running or completed terminal session.
type TermSession struct {
	ID       string `json:"id"`
	Module   string `json:"module"`
	Command  string `json:"command"`
	Region   string `json:"region,omitempty"`
	CmdLine  string `json:"cmd_line"` // Full command string for display
	Status   string `json:"status"`   // "running", "done", "error"
	ExitCode int    `json:"exit_code"`

	mu      sync.Mutex
	lines   []string
	cmd     *exec.Cmd
	clients map[chan string]struct{}
}

// ModuleDef maps a panel ID to a terragrunt module path.
type ModuleDef struct {
	Path   string // relative to infra/terraform/live/site/, use %s for region
	Global bool   // true = no region needed
}

// ModuleMap maps panel IDs to filesystem paths relative to infra/terraform/live/site/.
var ModuleMap = map[string]ModuleDef{
	// All modules (run from site root)
	"all": {Path: "", Global: true},
	// Global modules (run once)
	"github_oidc": {Path: "global/github-oidc", Global: true},
	"cloudtrail":  {Path: "global/cloudtrail", Global: true},
	"cloudfront":  {Path: "global/cloudfront", Global: true},
	"waf":         {Path: "global/waf", Global: true},
	// Regional modules (need region param)
	"ecs_clusters": {Path: "region/%s/ecs-cluster"},
	"ecs_services": {Path: "region/%s/ecs-service"},
	"ecs_tasks":    {Path: "region/%s/ecs-task"},
	"dynamodb":     {Path: "region/%s/dynamodb"},
	"ecr":          {Path: "region/%s/ecr"},
	"ec2spots":     {Path: "region/%s/ec2spot"},
	"email":        {Path: "region/%s/email"},
	"secrets":      {Path: "region/%s/secrets"},
	"s3_uploads":   {Path: "region/%s/s3-uploads"},
	"upload_proc":  {Path: "region/%s/s3-uploads-processor"},
}

// AllowedCommands maps command names to their terragrunt arguments.
var AllowedCommands = map[string][]string{
	"plan":      {"terragrunt", "plan", "--non-interactive", "--no-color"},
	"apply":     {"terragrunt", "apply", "--non-interactive", "--no-color", "-auto-approve"},
	"plan-all":  {"terragrunt", "plan", "--all", "--non-interactive", "--no-color"},
	"apply-all": {"terragrunt", "apply", "--all", "--non-interactive", "--no-color", "-auto-approve"},
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

	// Check no session already running
	a.mu.Lock()
	if a.termSession != nil && a.termSession.Status == "running" {
		a.mu.Unlock()
		return nil, fmt.Errorf("a terminal session is already running")
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
		ID:      fmt.Sprintf("term-%d", os.Getpid()),
		Module:  module,
		Command: command,
		Region:  region,
		CmdLine: strings.Join(cmdArgs, " "),
		Status:  "running",
		clients: make(map[chan string]struct{}),
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

	merged := io.MultiReader(stdout, stderr)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start command: %w", err)
	}

	a.mu.Lock()
	a.termSession = session
	a.mu.Unlock()

	// Stream output in background
	go func() {
		scanner := bufio.NewScanner(merged)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			// Strip terragrunt's stream prefixes to reduce output noise
			for _, prefix := range []string{"STDOUT terraform: ", "STDERR terraform: ", "STDOUT tofu: ", "STDERR tofu: "} {
				if strings.HasPrefix(line, prefix) {
					line = line[len(prefix):]
					break
				}
			}
			session.broadcast(line)
		}

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

// handleTerminalStream serves SSE events for the current terminal session.
func (a *App) handleTerminalStream(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	session := a.termSession
	a.mu.RUnlock()

	if session == nil {
		http.Error(w, "No terminal session", 404)
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

	// If already done, send done event immediately
	if session.Status != "running" {
		fmt.Fprintf(w, "event: done\ndata: %d\n\n", session.ExitCode)
		flusher.Flush()
		return
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-ch:
			if !ok {
				// Channel closed
				fmt.Fprintf(w, "event: done\ndata: %d\n\n", session.ExitCode)
				flusher.Flush()
				return
			}
			if line == "" && session.Status != "running" {
				// Empty line = done signal
				fmt.Fprintf(w, "event: done\ndata: %d\n\n", session.ExitCode)
				flusher.Flush()
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		}
	}
}

// handleTerminalStop kills the running terminal process.
func (a *App) handleTerminalStop(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	session := a.termSession
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

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// TerraformOutput represents a single terraform output value.
type TerraformOutput struct {
	Value     interface{} `json:"value"`
	Type      interface{} `json:"type"`
	Sensitive bool        `json:"sensitive"`
}

// ModuleOutputs is the response for a single module's outputs.
type ModuleOutputs struct {
	Module  string                      `json:"module"`
	Region  string                      `json:"region,omitempty"`
	Outputs map[string]*TerraformOutput `json:"outputs"`
	Error   string                      `json:"error,omitempty"`
}

// OutputModuleInfo describes a module available for output browsing.
type OutputModuleInfo struct {
	Panel  string `json:"panel"`
	Path   string `json:"path"`
	Global bool   `json:"global"`
}

// cleanOutputError extracts a short, useful error from raw terragrunt stderr.
func cleanOutputError(stderr string) string {
	// Detect common patterns and return a clean message
	lower := strings.ToLower(stderr)

	if strings.Contains(lower, "no outputs") || strings.Contains(lower, "has not been applied yet") ||
		strings.Contains(lower, "detected no outputs") {
		return "Module not applied yet or has no outputs"
	}
	if strings.Contains(lower, "there is no variable named \"dependency\"") {
		return "Dependency resolution failed — dependent modules may not be applied yet"
	}
	if strings.Contains(lower, "no state") || strings.Contains(lower, "state is empty") {
		return "No terraform state found — module has not been applied"
	}
	if strings.Contains(lower, "error acquiring the state lock") {
		return "State is locked by another operation"
	}
	if strings.Contains(lower, "expired") || strings.Contains(lower, "sso") ||
		strings.Contains(lower, "credential") {
		return "AWS credentials expired — run SSO Login"
	}

	// Fall back to first non-empty, non-timestamp ERROR line
	for _, line := range strings.Split(stderr, "\n") {
		line = strings.TrimSpace(line)
		// Skip timestamp-prefixed log lines and empty lines
		if line == "" {
			continue
		}
		// Strip terragrunt timestamp prefix (e.g. "22:58:15.361 ERROR ")
		if idx := strings.Index(line, " ERROR "); idx >= 0 && idx < 20 {
			line = strings.TrimSpace(line[idx+7:])
		}
		if strings.HasPrefix(line, "Error:") || strings.HasPrefix(line, "error") {
			msg := strings.TrimSpace(strings.TrimPrefix(line, "Error:"))
			msg = strings.TrimSpace(strings.TrimPrefix(msg, "error"))
			if len(msg) > 120 {
				msg = msg[:120] + "..."
			}
			return msg
		}
	}

	// Last resort: truncate raw stderr
	if len(stderr) > 150 {
		return stderr[:150] + "..."
	}
	return stderr
}

// handleOutputs fetches terragrunt output -json for a specific module.
func (a *App) handleOutputs(w http.ResponseWriter, r *http.Request) {
	module := r.URL.Query().Get("module")
	region := r.URL.Query().Get("region")

	modDef, ok := ModuleMap[module]
	if !ok {
		http.Error(w, `{"error":"unknown module"}`, 400)
		return
	}

	// Skip meta-modules
	if module == "all" || module == "region-all" {
		http.Error(w, `{"error":"cannot get outputs for meta-module"}`, 400)
		return
	}

	relPath := modDef.Path
	if !modDef.Global {
		if region == "" {
			http.Error(w, `{"error":"region required"}`, 400)
			return
		}
		relPath = fmt.Sprintf(modDef.Path, region)
	}

	workDir := filepath.Join(a.repoRoot, "infra", "terraform", "live", "site", relPath)
	if _, err := os.Stat(workDir); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ModuleOutputs{
			Module: module,
			Region: region,
			Error:  "module directory not found",
		})
		return
	}

	// Build env for terragrunt
	a.mu.RLock()
	cfg := a.config
	envLocal := a.envLocal
	a.mu.RUnlock()

	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	cmd := exec.Command("terragrunt", "output", "-json",
		"--non-interactive", "--no-color", "--log-disable")
	cmd.Dir = workDir
	cmd.Env = buildTerminalEnv(profile, cfg, envLocal)

	out, err := cmd.Output()
	if err != nil {
		errMsg := "failed to run terragrunt output"
		if exitErr, ok := err.(*exec.ExitError); ok {
			errMsg = cleanOutputError(string(exitErr.Stderr))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ModuleOutputs{
			Module: module,
			Region: region,
			Error:  errMsg,
		})
		return
	}

	var outputs map[string]*TerraformOutput
	if err := json.Unmarshal(out, &outputs); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ModuleOutputs{
			Module: module,
			Region: region,
			Error:  "failed to parse output JSON: " + err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ModuleOutputs{
		Module:  module,
		Region:  region,
		Outputs: outputs,
	})
}

// handleOutputsList returns the list of modules available for output browsing.
func (a *App) handleOutputsList(w http.ResponseWriter, r *http.Request) {
	var modules []OutputModuleInfo
	for panel, def := range ModuleMap {
		if panel == "all" || panel == "region-all" {
			continue
		}
		modules = append(modules, OutputModuleInfo{
			Panel:  panel,
			Path:   def.Path,
			Global: def.Global,
		})
	}
	sort.Slice(modules, func(i, j int) bool {
		// Sort global first, then alphabetical
		if modules[i].Global != modules[j].Global {
			return modules[i].Global
		}
		return modules[i].Panel < modules[j].Panel
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(modules)
}

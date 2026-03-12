package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

// Default skip patterns for fork find/replace.
// One pattern per line — matched against relative paths from repo root.
// Supports glob wildcards: * matches within a path component, ** not needed
// since patterns without / match against the filename only.
var defaultSkipPatterns = []string{
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"*.snap",
	"*.min.js",
	"*.min.css",
	"*.map",
	".claude/*",
	"apps/configui/backups/*",
	"apps/configui/site-config.json",
	"apps/configui/docs/*",
}

// ForkState is returned by GET /api/fork/state for dialog pre-fill.
type ForkState struct {
	Domain               string      `json:"domain"`
	Label                string      `json:"label"`
	RandomSuffix         string      `json:"random_suffix"`
	SuggestedSuffix      string      `json:"suggested_suffix"`
	ApplicationAccountID string      `json:"application_account_id"`
	ManagementAccountID  string      `json:"management_account_id"`
	TerraformAccountID   string      `json:"terraform_account_id"`
	KnownRegions         []RegionRef `json:"known_regions"`
	ActiveRegions        []string    `json:"active_regions"`
	SkipPatterns         []string    `json:"skip_patterns"`
}

// ForkResult is returned by POST /api/fork on success.
type ForkResult struct {
	Domain    string       `json:"domain"`
	Label     string       `json:"label"`
	Added     []string     `json:"added"`
	Removed   []string     `json:"removed"`
	Files     int          `json:"files"`
	Edits     int          `json:"edits"`
	Skipped   int          `json:"skipped"`
	Changes   []FileChange `json:"changes"`
	PatchFile string       `json:"patch_file"`
}

// FileChange tracks all line-level edits within a single file.
type FileChange struct {
	File  string     `json:"file"`
	Edits []LineEdit `json:"edits"`
}

// LineEdit records a single line replacement.
type LineEdit struct {
	Line int    `json:"line"`
	Old  string `json:"old"`
	New  string `json:"new"`
}

// generateRandomSuffix returns an 8-character hex string.
func generateRandomSuffix() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		// Fallback: use timestamp-based value
		return fmt.Sprintf("%08x", time.Now().UnixNano()&0xFFFFFFFF)
	}
	return hex.EncodeToString(b)
}

func (a *App) handleForkState(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	regionDir := filepath.Join(a.repoRoot, "infra", "terraform", "live", "site", "region")
	active := scanActiveRegions(regionDir)

	state := ForkState{
		Domain:               a.config.DNS.ZoneName,
		Label:                a.config.Site.Label,
		RandomSuffix:         a.config.Site.RandomSuffix,
		SuggestedSuffix:      generateRandomSuffix(),
		ApplicationAccountID: a.envLocal.ApplicationAccountID,
		ManagementAccountID:  a.envLocal.ManagementAccountID,
		TerraformAccountID:   a.envLocal.TerraformAccountID,
		KnownRegions:         KnownRegions(),
		ActiveRegions:        active,
		SkipPatterns:         defaultSkipPatterns,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// scanActiveRegions returns full region names for folders that exist under regionDir.
func scanActiveRegions(regionDir string) []string {
	known := KnownRegions()
	var active []string
	for _, r := range known {
		info, err := os.Stat(filepath.Join(regionDir, r.Full))
		if err == nil && info.IsDir() {
			active = append(active, r.Full)
		}
	}
	return active
}

func (a *App) handleFork(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	var req struct {
		Domain               string   `json:"domain"`
		Label                string   `json:"label"`
		RandomSuffix         string   `json:"random_suffix"`
		ApplicationAccountID string   `json:"application_account_id"`
		ManagementAccountID  string   `json:"management_account_id"`
		TerraformAccountID   string   `json:"terraform_account_id"`
		Regions              []string `json:"regions"`
		SkipPatterns         []string `json:"skip_patterns"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), 400)
		return
	}

	// Validate
	if strings.TrimSpace(req.Domain) == "" {
		http.Error(w, "Domain is required", 400)
		return
	}
	if strings.TrimSpace(req.Label) == "" {
		http.Error(w, "Label is required", 400)
		return
	}
	hasUSE1 := false
	for _, r := range req.Regions {
		if r == "us-east-1" {
			hasUSE1 = true
			break
		}
	}
	if !hasUSE1 {
		http.Error(w, "us-east-1 must always be included", 400)
		return
	}

	// Default random suffix to current if not provided
	if req.RandomSuffix == "" {
		req.RandomSuffix = a.config.Site.RandomSuffix
	}

	// Capture old values before updating
	oldDomain := a.config.DNS.ZoneName
	oldLabel := a.config.Site.Label
	oldSuffix := a.config.Site.RandomSuffix
	oldAppAccountID := a.envLocal.ApplicationAccountID
	oldMgmtAccountID := a.envLocal.ManagementAccountID
	oldTfAccountID := a.envLocal.TerraformAccountID

	// Backup
	if backupPath, err := a.createBackup(); err != nil {
		log.Printf("Fork backup failed: %v", err)
	} else if backupPath != "" {
		log.Printf("Fork backup: %s", backupPath)
	}

	// Update config identity fields
	a.config.Site.Label = req.Label
	a.config.Site.TFStatePrefix = "tf-" + req.Label
	a.config.Site.RandomSuffix = req.RandomSuffix
	a.config.DNS.ZoneName = req.Domain
	a.config.Env.SiteDomain = req.Domain
	a.config.Env.SiteLabel = req.Label

	// Compute skip_regions
	selectedSet := make(map[string]bool)
	for _, r := range req.Regions {
		selectedSet[r] = true
	}
	var skipRegions []string
	for _, kr := range KnownRegions() {
		if !selectedSet[kr.Full] {
			skipRegions = append(skipRegions, kr.Full)
		}
	}
	a.config.Site.SkipRegions = skipRegions

	// Update env.local account IDs and profile prefix
	a.envLocal.ApplicationAccountID = req.ApplicationAccountID
	a.envLocal.ManagementAccountID = req.ManagementAccountID
	a.envLocal.TerraformAccountID = req.TerraformAccountID
	a.envLocal.ProfilePrefix = req.Label

	// Regenerate all template-based config files
	if err := SaveConfig(a.configPath, a.config); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), 500)
		return
	}
	if err := generateSiteHCL(a.siteHCLPath, a.config); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate site.hcl: %v", err), 500)
		return
	}
	if err := generateServiceHCLs(a.servicesDir, a.config); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate service.hcl: %v", err), 500)
		return
	}
	if err := generateEnvSh(a.envShPath, a.config, a.envLocal); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate env.sh: %v", err), 500)
		return
	}
	if err := generateEnvLocalSh(a.envLocalShPath, a.envLocal); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate env.local.sh: %v", err), 500)
		return
	}

	// Manage region folders
	regionDir := filepath.Join(a.repoRoot, "infra", "terraform", "live", "site", "region")
	srcDir := filepath.Join(regionDir, "us-east-1")

	var added, removed []string

	for _, full := range req.Regions {
		if full == "us-east-1" {
			continue
		}
		dst := filepath.Join(regionDir, full)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		label := RegionLabel(full)
		if label == "" {
			continue
		}
		if err := copyRegionFolder(srcDir, dst, label, full); err != nil {
			http.Error(w, fmt.Sprintf("Failed to create region %s: %v", full, err), 500)
			return
		}
		added = append(added, full)
	}

	for _, kr := range KnownRegions() {
		if kr.Full == "us-east-1" {
			continue
		}
		if selectedSet[kr.Full] {
			continue
		}
		dst := filepath.Join(regionDir, kr.Full)
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			continue
		}
		if err := os.RemoveAll(dst); err != nil {
			http.Error(w, fmt.Sprintf("Failed to remove region %s: %v", kr.Full, err), 500)
			return
		}
		removed = append(removed, kr.Full)
	}

	// Repo-wide text find/replace with full change tracking
	var replacements []findReplace
	if oldDomain != req.Domain && oldDomain != "" {
		replacements = append(replacements, findReplace{old: oldDomain, new: req.Domain})
	}
	if oldLabel != req.Label && oldLabel != "" {
		replacements = append(replacements, findReplace{old: oldLabel, new: req.Label})
	}
	if oldSuffix != req.RandomSuffix && oldSuffix != "" {
		replacements = append(replacements, findReplace{old: oldSuffix, new: req.RandomSuffix})
	}
	// Also replace AWS account IDs when they change (skip placeholder "000000000000")
	for _, acct := range []struct{ old, new string }{
		{oldAppAccountID, req.ApplicationAccountID},
		{oldMgmtAccountID, req.ManagementAccountID},
		{oldTfAccountID, req.TerraformAccountID},
	} {
		if acct.old != acct.new && acct.old != "" && acct.new != "" &&
			acct.old != "000000000000" && acct.new != "000000000000" {
			replacements = append(replacements, findReplace{old: acct.old, new: acct.new})
		}
	}

	var changes []FileChange
	var patchFile string
	skipped := 0
	if len(replacements) > 0 {
		var err error
		changes, skipped, err = repoFindReplace(a.repoRoot, replacements, req.SkipPatterns)
		if err != nil {
			log.Printf("Fork find/replace warning: %v", err)
		}

		// Save patch and manifest
		if len(changes) > 0 {
			patchFile, err = saveForkArtifacts(a.backupDir, a.repoRoot, changes, replacements, req.SkipPatterns)
			if err != nil {
				log.Printf("Fork: failed to save patch: %v", err)
			}
		}

		totalEdits := 0
		for _, fc := range changes {
			totalEdits += len(fc.Edits)
		}
		log.Printf("Fork: %d edits across %d files (%d files skipped by pattern)", totalEdits, len(changes), skipped)
	}

	totalEdits := 0
	for _, fc := range changes {
		totalEdits += len(fc.Edits)
	}

	result := ForkResult{
		Domain:    req.Domain,
		Label:     req.Label,
		Added:     added,
		Removed:   removed,
		Files:     len(changes),
		Edits:     totalEdits,
		Skipped:   skipped,
		Changes:   changes,
		PatchFile: patchFile,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type findReplace struct {
	old string
	new string
}

// Binary extensions — always skip regardless of git tracking or user patterns.
var binaryExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".ico": true, ".webp": true,
	".woff": true, ".woff2": true, ".ttf": true, ".eot": true, ".otf": true,
	".zip": true, ".tar": true, ".gz": true, ".br": true, ".zst": true,
	".pdf": true, ".exe": true, ".dll": true, ".so": true, ".dylib": true,
	".sqlite": true, ".db": true,
	".mp4": true, ".webm": true, ".mp3": true, ".wav": true, ".ogg": true,
}

// gitTrackedFiles returns relative paths of all git-tracked files in repoRoot.
// Falls back to filesystem walk if git is unavailable.
func gitTrackedFiles(repoRoot string) ([]string, error) {
	cmd := exec.Command("git", "ls-files", "--cached", "--others", "--exclude-standard")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git ls-files: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var files []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			files = append(files, l)
		}
	}
	return files, nil
}

// matchSkipPattern checks if a relative path matches a skip pattern.
//   - Pattern without "/" → matches against filename only (e.g. "package-lock.json")
//   - Pattern with "/" → matches against the full relative path (e.g. "apps/configui/backups/*")
func matchSkipPattern(relPath, pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || strings.HasPrefix(pattern, "#") {
		return false
	}

	if strings.Contains(pattern, "/") {
		matched, _ := filepath.Match(pattern, relPath)
		return matched
	}

	// No slash: match against filename
	matched, _ := filepath.Match(pattern, filepath.Base(relPath))
	return matched
}

// repoFindReplace uses git ls-files to iterate tracked files, applies skip
// patterns, performs text replacements, and returns per-file change records.
// Returns (changes, skippedCount, error).
func repoFindReplace(repoRoot string, replacements []findReplace, skipPatterns []string) ([]FileChange, int, error) {
	files, err := gitTrackedFiles(repoRoot)
	if err != nil {
		// Fallback: walk filesystem with basic dir skipping
		log.Printf("Fork: git ls-files failed (%v), falling back to filesystem walk", err)
		changes, err := repoFindReplaceWalk(repoRoot, replacements, skipPatterns)
		return changes, 0, err
	}

	var allChanges []FileChange
	skipped := 0

	for _, relPath := range files {
		// Binary extension check
		ext := strings.ToLower(filepath.Ext(relPath))
		if binaryExts[ext] {
			continue
		}

		// User skip patterns
		if matchesAnySkipPattern(relPath, skipPatterns) {
			skipped++
			continue
		}

		absPath := filepath.Join(repoRoot, relPath)

		info, err := os.Stat(absPath)
		if err != nil || info.IsDir() || info.Size() > 2*1024*1024 || info.Size() == 0 {
			continue
		}

		data, err := os.ReadFile(absPath)
		if err != nil || !utf8.Valid(data) {
			continue
		}

		content := string(data)

		// Quick check: does this file contain any search strings?
		hasMatch := false
		for _, r := range replacements {
			if strings.Contains(content, r.old) {
				hasMatch = true
				break
			}
		}
		if !hasMatch {
			continue
		}

		// Perform replacements and track line-level changes
		oldLines := strings.Split(content, "\n")
		newContent := content
		for _, r := range replacements {
			newContent = strings.ReplaceAll(newContent, r.old, r.new)
		}
		newLines := strings.Split(newContent, "\n")

		var edits []LineEdit
		for i := 0; i < len(oldLines) && i < len(newLines); i++ {
			if oldLines[i] != newLines[i] {
				edits = append(edits, LineEdit{
					Line: i + 1,
					Old:  oldLines[i],
					New:  newLines[i],
				})
			}
		}

		if len(edits) > 0 {
			allChanges = append(allChanges, FileChange{
				File:  relPath,
				Edits: edits,
			})
			if err := os.WriteFile(absPath, []byte(newContent), info.Mode()); err != nil {
				log.Printf("Fork: failed to write %s: %v", relPath, err)
			}
		}
	}

	return allChanges, skipped, nil
}

func matchesAnySkipPattern(relPath string, patterns []string) bool {
	for _, p := range patterns {
		if matchSkipPattern(relPath, p) {
			return true
		}
	}
	return false
}

// repoFindReplaceWalk is the fallback when git is unavailable.
// Walks the filesystem with hardcoded directory skips.
func repoFindReplaceWalk(repoRoot string, replacements []findReplace, skipPatterns []string) ([]FileChange, error) {
	walkSkipDirs := map[string]bool{
		".git": true, "node_modules": true, ".terragrunt-cache": true,
		".terraform": true, ".next": true,
	}

	var allChanges []FileChange

	err := filepath.WalkDir(repoRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if walkSkipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if binaryExts[ext] {
			return nil
		}

		relPath, _ := filepath.Rel(repoRoot, path)
		if matchesAnySkipPattern(relPath, skipPatterns) {
			return nil
		}

		info, err := d.Info()
		if err != nil || info.Size() > 2*1024*1024 || info.Size() == 0 {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil || !utf8.Valid(data) {
			return nil
		}

		content := string(data)
		hasMatch := false
		for _, r := range replacements {
			if strings.Contains(content, r.old) {
				hasMatch = true
				break
			}
		}
		if !hasMatch {
			return nil
		}

		oldLines := strings.Split(content, "\n")
		newContent := content
		for _, r := range replacements {
			newContent = strings.ReplaceAll(newContent, r.old, r.new)
		}
		newLines := strings.Split(newContent, "\n")

		var edits []LineEdit
		for i := 0; i < len(oldLines) && i < len(newLines); i++ {
			if oldLines[i] != newLines[i] {
				edits = append(edits, LineEdit{
					Line: i + 1,
					Old:  oldLines[i],
					New:  newLines[i],
				})
			}
		}

		if len(edits) > 0 {
			allChanges = append(allChanges, FileChange{
				File:  relPath,
				Edits: edits,
			})
			if err := os.WriteFile(path, []byte(newContent), info.Mode()); err != nil {
				log.Printf("Fork: failed to write %s: %v", relPath, err)
			}
		}
		return nil
	})

	return allChanges, err
}

// saveForkArtifacts writes a unified diff .patch file and a JSON manifest
// into the backups directory. Returns the relative patch file path.
func saveForkArtifacts(backupDir, repoRoot string, changes []FileChange, replacements []findReplace, skipPatterns []string) (string, error) {
	ts := time.Now().Format("2006-01-02T15-04-05")
	dir := filepath.Join(backupDir, "fork-"+ts)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	// Build unified diff patch
	var patch strings.Builder
	patch.WriteString("# Fork patch generated " + time.Now().Format(time.RFC3339) + "\n")
	patch.WriteString("# Replacements:\n")
	for _, r := range replacements {
		fmt.Fprintf(&patch, "#   %q -> %q\n", r.old, r.new)
	}
	if len(skipPatterns) > 0 {
		patch.WriteString("# Skip patterns:\n")
		for _, p := range skipPatterns {
			fmt.Fprintf(&patch, "#   %s\n", p)
		}
	}
	patch.WriteString("#\n")

	for _, fc := range changes {
		// Read the current (new) file to get context lines
		newData, err := os.ReadFile(filepath.Join(repoRoot, fc.File))
		var newLines []string
		if err == nil {
			newLines = strings.Split(string(newData), "\n")
		}

		fmt.Fprintf(&patch, "--- a/%s\n", fc.File)
		fmt.Fprintf(&patch, "+++ b/%s\n", fc.File)

		hunks := groupHunks(fc.Edits, 3)
		for _, hunk := range hunks {
			writeHunk(&patch, hunk, newLines)
		}
	}

	patchPath := filepath.Join(dir, "fork.patch")
	if err := os.WriteFile(patchPath, []byte(patch.String()), 0644); err != nil {
		return "", err
	}

	// Write JSON manifest with full detail
	manifest := struct {
		Timestamp    string       `json:"timestamp"`
		Replacements []struct {
			Old string `json:"old"`
			New string `json:"new"`
		} `json:"replacements"`
		SkipPatterns []string     `json:"skip_patterns"`
		Files        int          `json:"files"`
		Edits        int          `json:"edits"`
		Changes      []FileChange `json:"changes"`
	}{
		Timestamp:    time.Now().Format(time.RFC3339),
		SkipPatterns: skipPatterns,
		Files:        len(changes),
	}
	for _, r := range replacements {
		manifest.Replacements = append(manifest.Replacements, struct {
			Old string `json:"old"`
			New string `json:"new"`
		}{Old: r.old, New: r.new})
	}
	for _, fc := range changes {
		manifest.Edits += len(fc.Edits)
	}
	manifest.Changes = changes

	manifestData, _ := json.MarshalIndent(manifest, "", "  ")
	manifestPath := filepath.Join(dir, "fork-manifest.json")
	os.WriteFile(manifestPath, manifestData, 0644)

	relPath, _ := filepath.Rel(repoRoot, patchPath)
	log.Printf("Fork patch: %s", patchPath)
	log.Printf("Fork manifest: %s", manifestPath)
	return relPath, nil
}

// hunk groups consecutive or nearby edits for unified diff output.
type hunk struct {
	edits     []LineEdit
	startLine int
	endLine   int
}

// groupHunks merges edits that are within `ctx` lines of each other.
func groupHunks(edits []LineEdit, ctx int) []hunk {
	if len(edits) == 0 {
		return nil
	}

	var hunks []hunk
	cur := hunk{
		edits:     []LineEdit{edits[0]},
		startLine: edits[0].Line,
		endLine:   edits[0].Line,
	}

	for i := 1; i < len(edits); i++ {
		if edits[i].Line <= cur.endLine+2*ctx+1 {
			cur.edits = append(cur.edits, edits[i])
			cur.endLine = edits[i].Line
		} else {
			hunks = append(hunks, cur)
			cur = hunk{
				edits:     []LineEdit{edits[i]},
				startLine: edits[i].Line,
				endLine:   edits[i].Line,
			}
		}
	}
	hunks = append(hunks, cur)
	return hunks
}

// writeHunk writes a single unified diff hunk with real context lines.
func writeHunk(b *strings.Builder, h hunk, newLines []string) {
	const ctx = 3
	start := h.startLine - ctx
	if start < 1 {
		start = 1
	}
	end := h.endLine + ctx
	if len(newLines) > 0 && end > len(newLines) {
		end = len(newLines)
	}

	editSet := make(map[int]LineEdit)
	for _, e := range h.edits {
		editSet[e.Line] = e
	}

	oldCount := end - start + 1
	newCount := oldCount

	fmt.Fprintf(b, "@@ -%d,%d +%d,%d @@\n", start, oldCount, start, newCount)

	for lineNum := start; lineNum <= end; lineNum++ {
		if e, ok := editSet[lineNum]; ok {
			b.WriteString("-" + e.Old + "\n")
			b.WriteString("+" + e.New + "\n")
		} else {
			contextLine := ""
			if lineNum-1 < len(newLines) {
				contextLine = newLines[lineNum-1]
			}
			b.WriteString(" " + contextLine + "\n")
		}
	}
}

// copyRegionFolder copies srcDir to dstDir, skipping .terragrunt-cache and
// .terraform.lock.hcl, then writes the correct region.hcl for the target region.
func copyRegionFolder(srcDir, dstDir, label, full string) error {
	if err := filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(srcDir, path)

		if d.IsDir() && d.Name() == ".terragrunt-cache" {
			return filepath.SkipDir
		}
		if d.Name() == ".terraform.lock.hcl" {
			return nil
		}

		dst := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(dst, 0755)
		}

		return copyFile(path, dst)
	}); err != nil {
		return err
	}

	regionHCL := fmt.Sprintf("locals {\n  region = {\n    label = %q\n    full  = %q\n  }\n}\n", label, full)
	return os.WriteFile(filepath.Join(dstDir, "region.hcl"), []byte(regionHCL), 0644)
}

// copyFile copies a single file from src to dst, creating parent dirs as needed.
func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

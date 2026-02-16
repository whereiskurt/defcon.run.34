package main

import (
	"bufio"
	"embed"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

//go:embed static templates
var content embed.FS

// App holds all paths and state for the configui server.
type App struct {
	repoRoot             string
	configPath           string
	siteHCLPath          string
	servicesDir          string
	envShPath            string
	envLocalShPath       string
	backupDir            string
	sopsFilePath         string
	discoveryCachePath   string
	awsStatusCachePath   string
	url                  string
	mu                   sync.RWMutex
	config               *SiteConfig
	envLocal             *EnvLocalConfig
	discovery            *DiscoveryResults
	awsStatusCache       *AWSStatusCache
	termSessions         map[string]*TermSession
}

// reload re-imports config from site.hcl, service configs, env files, and versions.
func (a *App) reload() {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.config = DefaultConfig()
	if imported, err := importSiteHCL(a.siteHCLPath); err == nil {
		a.config = imported
		log.Printf("Imported site.hcl: label=%s zone=%s suffix=%s skip=%v",
			imported.Site.Label, imported.DNS.ZoneName,
			imported.Site.RandomSuffix, imported.Site.SkipRegions)
	} else if os.IsNotExist(err) {
		log.Printf("No site.hcl found, using defaults")
	} else {
		log.Printf("Warning: could not import site.hcl: %v", err)
	}

	for _, svc := range []string{"run.auth", "run.human", "run.cms", "run.gpx"} {
		svcPath := filepath.Join(a.servicesDir, svc, "service.hcl")
		if err := importServiceHCL(svcPath, svc, a.config); err != nil {
			log.Printf("Warning: could not import %s: %v", svc, err)
		} else {
			log.Printf("Imported %s/service.hcl", svc)
		}
	}

	a.envLocal = loadEnvLocal(a.envLocalShPath)
	a.config.Versions = readVersions(a.repoRoot)
	loadEnvSh(a.envShPath, a.config)

	log.Printf("Reload complete")
}

// watchStdin watches for double-Enter (two presses within 500ms) to trigger reload.
func (a *App) watchStdin() {
	scanner := bufio.NewScanner(os.Stdin)
	var lastEnter time.Time
	for scanner.Scan() {
		now := time.Now()
		if now.Sub(lastEnter) < 500*time.Millisecond {
			log.Printf("Double-Enter detected — reloading configuration...")
			a.reload()
			if a.url != "" {
				openBrowser(a.url)
			}
			lastEnter = time.Time{} // reset so next single Enter starts fresh
		} else {
			lastEnter = now
		}
	}
}

func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "AGENTS.md")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find repo root (no AGENTS.md found)")
		}
		dir = parent
	}
}

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	default:
		log.Printf("Open %s in your browser", url)
		return
	}
	exec.Command(cmd, args...).Start()
}

func main() {
	noBrowser := flag.Bool("no-browser", false, "Don't auto-open browser")
	flag.Parse()

	repoRoot, err := findRepoRoot()
	if err != nil {
		log.Fatal(err)
	}

	app := &App{
		repoRoot:           repoRoot,
		configPath:         filepath.Join(repoRoot, "apps", "configui", "site-config.json"),
		siteHCLPath:        filepath.Join(repoRoot, "infra", "terraform", "live", "site", "site.hcl"),
		servicesDir:        filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services"),
		envShPath:          filepath.Join(repoRoot, "env.sh"),
		envLocalShPath:     filepath.Join(repoRoot, "env.local.sh"),
		backupDir:          filepath.Join(repoRoot, "apps", "configui", "backups"),
		sopsFilePath:       filepath.Join(repoRoot, "infra", "terraform", "live", "site", ".secrets.sops.json"),
		discoveryCachePath: filepath.Join(repoRoot, "apps", "configui", ".discovery-cache.json"),
		awsStatusCachePath: filepath.Join(repoRoot, "apps", "configui", ".aws-status-cache.json"),
		termSessions:       make(map[string]*TermSession),
	}

	// Initial config load
	app.reload()

	// Load cached discovery and AWS status results (if any)
	app.loadDiscoveryCache()
	app.loadAWSStatusCache()

	// Startup backup
	if backupPath, err := app.createBackup(); err != nil {
		log.Printf("Warning: startup backup failed: %v", err)
	} else if backupPath != "" {
		log.Printf("Startup backup: %s", backupPath)
	}

	// Routes
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", app.handleIndex)
	mux.HandleFunc("POST /save", app.handleSave)
	mux.HandleFunc("POST /preview", app.handlePreview)
	mux.HandleFunc("GET /export", app.handleExport)
	mux.HandleFunc("POST /import", app.handleImport)
	mux.HandleFunc("GET /api/aws-status", app.handleAWSStatus)
	mux.HandleFunc("POST /api/sso-login", app.handleSSOLogin)
	mux.HandleFunc("POST /api/export-creds", app.handleExportCreds)
	mux.HandleFunc("POST /api/reload", app.handleReload)
	mux.HandleFunc("GET /api/discovery", app.handleDiscovery)
	mux.HandleFunc("POST /api/discovery/refresh", app.handleDiscoveryRefresh)
	mux.HandleFunc("POST /api/sops/edit", app.handleSOPSEdit)
	mux.HandleFunc("POST /api/sops/save", app.handleSOPSSave)
	mux.HandleFunc("POST /api/terminal/start", app.handleTerminalStart)
	mux.HandleFunc("GET /api/terminal/stream", app.handleTerminalStream)
	mux.HandleFunc("POST /api/terminal/stop", app.handleTerminalStop)
	mux.HandleFunc("GET /api/terminal/list", app.handleTerminalList)
	mux.HandleFunc("POST /api/scan-locks", app.handleScanLocks)
	mux.HandleFunc("POST /api/fix-locks", app.handleFixLocks)
	mux.Handle("GET /static/", http.FileServerFS(content))

	// Listen on random port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	app.url = fmt.Sprintf("http://127.0.0.1:%d", port)

	log.Printf("%% ./ConfigUI_ running at %s", app.url)
	log.Printf("Press Enter twice to reload configuration from disk")
	if !*noBrowser {
		openBrowser(app.url)
	}

	go app.watchStdin()

	if err := http.Serve(listener, mux); err != nil {
		log.Fatal(err)
	}
}

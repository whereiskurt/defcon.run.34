package main

import (
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
)

//go:embed static templates
var content embed.FS

// App holds all paths and state for the configui server.
type App struct {
	repoRoot      string
	configPath    string
	siteHCLPath   string
	servicesDir   string
	envShPath     string
	envLocalShPath string
	backupDir     string
	config        *SiteConfig
	envLocal      *EnvLocalConfig
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
		repoRoot:       repoRoot,
		configPath:     filepath.Join(repoRoot, "apps", "configui", "site-config.json"),
		siteHCLPath:    filepath.Join(repoRoot, "infra", "terraform", "live", "site", "site.hcl"),
		servicesDir:    filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services"),
		envShPath:      filepath.Join(repoRoot, "env.sh"),
		envLocalShPath: filepath.Join(repoRoot, "env.local.sh"),
		backupDir:      filepath.Join(repoRoot, "apps", "configui", "backups"),
	}

	// Load config
	app.config, err = LoadConfig(app.configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Load env.local.sh values
	app.envLocal = loadEnvLocal(app.envLocalShPath)

	// Load VERSION files
	app.config.Versions = readVersions(repoRoot)

	// Load env.sh values into config
	loadEnvSh(app.envShPath, app.config)

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
	mux.HandleFunc("GET /api/aws-status", app.handleAWSStatus)
	mux.HandleFunc("POST /api/sso-login", app.handleSSOLogin)
	mux.HandleFunc("POST /api/export-creds", app.handleExportCreds)
	mux.Handle("GET /static/", http.FileServerFS(content))

	// Listen on random port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://127.0.0.1:%d", port)

	log.Printf("ConfigUI running at %s", url)
	if !*noBrowser {
		openBrowser(url)
	}

	if err := http.Serve(listener, mux); err != nil {
		log.Fatal(err)
	}
}

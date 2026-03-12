package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func (a *App) createBackup() (string, error) {
	ts := time.Now().Format("2006-01-02T15-04-05")
	dir := filepath.Join(a.backupDir, ts)

	anyFile := false
	for _, src := range []string{a.siteHCLPath, a.configPath, a.envShPath, a.envLocalShPath} {
		if _, err := os.Stat(src); err == nil {
			anyFile = true
			break
		}
	}
	if !anyFile {
		return "", nil
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create backup dir: %w", err)
	}

	copyFileIfExists(a.siteHCLPath, filepath.Join(dir, "site.hcl"))
	copyFileIfExists(a.configPath, filepath.Join(dir, "site-config.json"))
	copyFileIfExists(a.envShPath, filepath.Join(dir, "env.sh"))
	copyFileIfExists(a.envLocalShPath, filepath.Join(dir, "env.local.sh"))

	// Backup service.hcl files
	svcDir := filepath.Join(dir, "services")
	for _, svc := range []string{"run.auth", "run.human", "run.cms", "run.gpx"} {
		src := filepath.Join(a.servicesDir, svc, "service.hcl")
		dst := filepath.Join(svcDir, svc+".service.hcl")
		copyFileIfExists(src, dst)
	}

	// Backup VERSION files
	verDir := filepath.Join(dir, "versions")
	versionFiles := []struct{ src, dst string }{
		{filepath.Join(a.servicesDir, "run.auth", "VERSION.app"), "auth.app"},
		{filepath.Join(a.servicesDir, "run.auth", "VERSION.nginx"), "auth.nginx"},
		{filepath.Join(a.servicesDir, "run.human", "VERSION.app"), "human.app"},
		{filepath.Join(a.servicesDir, "run.human", "VERSION.nginx"), "human.nginx"},
		{filepath.Join(a.servicesDir, "run.cms", "VERSION.app"), "cms.app"},
		{filepath.Join(a.servicesDir, "run.cms", "VERSION.nginx"), "cms.nginx"},
		{filepath.Join(a.servicesDir, "run.gpx", "VERSION.app"), "gpx.app"},
	}
	for _, vf := range versionFiles {
		copyFileIfExists(vf.src, filepath.Join(verDir, vf.dst))
	}

	return dir, nil
}

func copyFileIfExists(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return nil // file doesn't exist, skip
	}
	defer srcFile.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}

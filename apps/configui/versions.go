package main

import (
	"os"
	"path/filepath"
	"strings"
)

// readVersions reads all VERSION files from infra service directories.
func readVersions(repoRoot string) VersionConfig {
	svcDir := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services")
	return VersionConfig{
		Auth: ComponentVersions{
			App:   readVersionFile(filepath.Join(svcDir, "run.auth", "VERSION.app")),
			Nginx: readVersionFile(filepath.Join(svcDir, "run.auth", "VERSION.nginx")),
		},
		Human: ComponentVersions{
			App:   readVersionFile(filepath.Join(svcDir, "run.human", "VERSION.app")),
			Nginx: readVersionFile(filepath.Join(svcDir, "run.human", "VERSION.nginx")),
		},
		CMS: ComponentVersions{
			App:   readVersionFile(filepath.Join(svcDir, "run.cms", "VERSION.app")),
			Nginx: readVersionFile(filepath.Join(svcDir, "run.cms", "VERSION.nginx")),
		},
		GPX: ComponentVersions{
			App: readVersionFile(filepath.Join(svcDir, "run.gpx", "VERSION.app")),
		},
		Flash: ComponentVersions{
			App:   readVersionFile(filepath.Join(svcDir, "run.flash", "VERSION.app")),
			Nginx: readVersionFile(filepath.Join(svcDir, "run.flash", "VERSION.nginx")),
		},
		MQTT: MQTTComponentVersions{
			Mosquitto: readVersionFile(filepath.Join(svcDir, "run.mqtt", "VERSION.mosquitto")),
			Meshtk:    readVersionFile(filepath.Join(svcDir, "run.mqtt", "VERSION.meshtk")),
			Nginx:     readVersionFile(filepath.Join(svcDir, "run.mqtt", "VERSION.nginx")),
		},
	}
}

func readVersionFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return "v0.0.0"
	}
	return strings.TrimSpace(string(data))
}

// writeVersions writes all VERSION files for both app sources and infra.
func writeVersions(repoRoot string, versions VersionConfig) error {
	type versionFile struct {
		path    string
		version string
	}

	svcDir := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services")
	appsDir := filepath.Join(repoRoot, "apps")

	files := []versionFile{
		// Infra VERSION files (source of truth for deployment)
		{filepath.Join(svcDir, "run.auth", "VERSION.app"), versions.Auth.App},
		{filepath.Join(svcDir, "run.auth", "VERSION.nginx"), versions.Auth.Nginx},
		{filepath.Join(svcDir, "run.human", "VERSION.app"), versions.Human.App},
		{filepath.Join(svcDir, "run.human", "VERSION.nginx"), versions.Human.Nginx},
		{filepath.Join(svcDir, "run.cms", "VERSION.app"), versions.CMS.App},
		{filepath.Join(svcDir, "run.cms", "VERSION.nginx"), versions.CMS.Nginx},
		{filepath.Join(svcDir, "run.gpx", "VERSION.app"), versions.GPX.App},
		{filepath.Join(svcDir, "run.flash", "VERSION.app"), versions.Flash.App},
		{filepath.Join(svcDir, "run.flash", "VERSION.nginx"), versions.Flash.Nginx},
		{filepath.Join(svcDir, "run.mqtt", "VERSION.mosquitto"), versions.MQTT.Mosquitto},
		{filepath.Join(svcDir, "run.mqtt", "VERSION.meshtk"), versions.MQTT.Meshtk},
		{filepath.Join(svcDir, "run.mqtt", "VERSION.nginx"), versions.MQTT.Nginx},
		// App source VERSION files
		{filepath.Join(appsDir, "run.auth", "webapp", "VERSION"), versions.Auth.App},
		{filepath.Join(appsDir, "run.auth", "nginx", "VERSION"), versions.Auth.Nginx},
		{filepath.Join(appsDir, "run.human", "webapp", "VERSION"), versions.Human.App},
		{filepath.Join(appsDir, "run.human", "nginx", "VERSION"), versions.Human.Nginx},
		{filepath.Join(appsDir, "run.cms", "app", "VERSION"), versions.CMS.App},
		{filepath.Join(appsDir, "run.cms", "nginx", "VERSION"), versions.CMS.Nginx},
		{filepath.Join(appsDir, "run.gpx", "webapp", "VERSION"), versions.GPX.App},
		{filepath.Join(appsDir, "run.flash", "webapp", "VERSION"), versions.Flash.App},
		{filepath.Join(appsDir, "run.flash", "nginx", "VERSION"), versions.Flash.Nginx},
	}

	for _, vf := range files {
		if vf.version == "" {
			continue
		}
		if err := os.WriteFile(vf.path, []byte(vf.version+"\n"), 0644); err != nil {
			return err
		}
	}
	return nil
}

// versionSyncStatus returns whether app and infra versions match.
func versionSyncStatus(repoRoot string, versions VersionConfig) map[string]map[string]bool {
	appsDir := filepath.Join(repoRoot, "apps")
	svcDir := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services")
	result := make(map[string]map[string]bool)

	checks := map[string]map[string][2]string{
		"auth": {
			"app":   {filepath.Join(appsDir, "run.auth", "webapp", "VERSION"), versions.Auth.App},
			"nginx": {filepath.Join(appsDir, "run.auth", "nginx", "VERSION"), versions.Auth.Nginx},
		},
		"human": {
			"app":   {filepath.Join(appsDir, "run.human", "webapp", "VERSION"), versions.Human.App},
			"nginx": {filepath.Join(appsDir, "run.human", "nginx", "VERSION"), versions.Human.Nginx},
		},
		"cms": {
			"app":   {filepath.Join(appsDir, "run.cms", "app", "VERSION"), versions.CMS.App},
			"nginx": {filepath.Join(appsDir, "run.cms", "nginx", "VERSION"), versions.CMS.Nginx},
		},
		"gpx": {
			"app": {filepath.Join(appsDir, "run.gpx", "webapp", "VERSION"), versions.GPX.App},
		},
		"flash": {
			"app":   {filepath.Join(appsDir, "run.flash", "webapp", "VERSION"), versions.Flash.App},
			"nginx": {filepath.Join(appsDir, "run.flash", "nginx", "VERSION"), versions.Flash.Nginx},
		},
		"mqtt": {
			"mosquitto": {filepath.Join(svcDir, "run.mqtt", "VERSION.mosquitto"), versions.MQTT.Mosquitto},
			"meshtk":    {filepath.Join(svcDir, "run.mqtt", "VERSION.meshtk"), versions.MQTT.Meshtk},
			"nginx":     {filepath.Join(svcDir, "run.mqtt", "VERSION.nginx"), versions.MQTT.Nginx},
		},
	}

	for svc, components := range checks {
		result[svc] = make(map[string]bool)
		for comp, pair := range components {
			appVer := readVersionFile(pair[0])
			result[svc][comp] = appVer == pair[1]
		}
	}
	return result
}

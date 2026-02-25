package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/template"
)

// Template functions available in generation templates.
var genFuncs = template.FuncMap{
	"join":      strings.Join,
	"joinQuote": joinQuote,
	"boolHCL": func(b bool) string {
		if b {
			return "true"
		}
		return "false"
	},
	"regionList": func(regions []RegionRef) string {
		parts := make([]string, len(regions))
		for i, r := range regions {
			parts[i] = fmt.Sprintf(`{
        label = "%s"
        full  = "%s"
      }`, r.Label, r.Full)
		}
		return strings.Join(parts, ",\n      ")
	},
	"regionListCompact": func(regions []RegionRef) string {
		parts := make([]string, len(regions))
		for i, r := range regions {
			parts[i] = fmt.Sprintf(`{ label = "%s", full = "%s" }`, r.Label, r.Full)
		}
		return strings.Join(parts, ",\n          ")
	},
	"stringList": func(items []string) string {
		quoted := make([]string, len(items))
		for i, s := range items {
			quoted[i] = fmt.Sprintf(`"%s"`, s)
		}
		return strings.Join(quoted, ", ")
	},
	"mapEntries": func(m map[string]string) string {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf(`      "%s" = "%s"`, k, m[k]))
		}
		return strings.Join(parts, "\n")
	},
	"secretDefs": func(defs map[string]SecretDefinition) string {
		names := make([]string, 0, len(defs))
		for name := range defs {
			names = append(names, name)
		}
		sort.Strings(names)
		var parts []string
		for _, name := range names {
			def := defs[name]
			keys := make([]string, len(def.Keys))
			for i, k := range def.Keys {
				keys[i] = fmt.Sprintf(`"%s"`, k)
			}
			entry := fmt.Sprintf(`      %s = {
        description = "%s"
        keys        = [%s]`, name, def.Description, strings.Join(keys, ", "))
			if def.Global {
				entry += "\n        global      = true"
			}
			entry += "\n      }"
			parts = append(parts, entry)
		}
		return strings.Join(parts, "\n")
	},
	"fwdMatchExpr": func(match string) string {
		// "admin" → "admin@${local.dns.zonename}"
		// "no-reply@run" → "no-reply@run.${local.dns.zonename}"
		if strings.Contains(match, "@") {
			parts := strings.SplitN(match, "@", 2)
			return fmt.Sprintf(`"%s@%s.${local.dns.zonename}"`, parts[0], parts[1])
		}
		return fmt.Sprintf(`"%s@${local.dns.zonename}"`, match)
	},
	"mapIntEntries": func(m map[string]int) string {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("      %s = %d", k, m[k]))
		}
		return strings.Join(parts, "\n")
	},
	"indent": func(n int, s string) string {
		prefix := strings.Repeat(" ", n)
		lines := strings.Split(s, "\n")
		for i, l := range lines {
			if l != "" {
				lines[i] = prefix + l
			}
		}
		return strings.Join(lines, "\n")
	},
}

// generateSiteHCL renders site.hcl from template and writes to disk.
func generateSiteHCL(path string, cfg *SiteConfig) error {
	result, err := renderSiteHCL(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(result), 0644)
}

// renderSiteHCL renders site.hcl from template and returns the string.
func renderSiteHCL(cfg *SiteConfig) (string, error) {
	tmpl, err := template.New("site.hcl.tmpl").Delims("<<", ">>").Funcs(genFuncs).ParseFS(content, "templates/site.hcl.tmpl")
	if err != nil {
		return "", fmt.Errorf("parse site.hcl template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, cfg); err != nil {
		return "", fmt.Errorf("execute site.hcl template: %w", err)
	}
	return buf.String(), nil
}

// generateServiceHCLs renders all service.hcl files from templates.
func renderServiceHCL(svcName string, cfg *SiteConfig) (string, error) {
	tmplFile := fmt.Sprintf("templates/services/%s.service.hcl.tmpl", svcName)
	tmpl, err := template.New(filepath.Base(tmplFile)).Delims("<<", ">>").Funcs(genFuncs).ParseFS(content, tmplFile)
	if err != nil {
		return "", fmt.Errorf("parse %s template: %w", svcName, err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, cfg); err != nil {
		return "", fmt.Errorf("execute %s template: %w", svcName, err)
	}
	return buf.String(), nil
}

func generateServiceHCLs(servicesDir string, cfg *SiteConfig) error {
	for _, svcName := range []string{"run.auth", "run.human", "run.cms", "run.gpx"} {
		out, err := renderServiceHCL(svcName, cfg)
		if err != nil {
			return err
		}
		outPath := filepath.Join(servicesDir, svcName, "service.hcl")
		if err := os.WriteFile(outPath, []byte(out), 0644); err != nil {
			return fmt.Errorf("write %s: %w", outPath, err)
		}
	}
	return nil
}

// generateEnvSh renders env.sh from template and writes to disk.
func generateEnvSh(path string, cfg *SiteConfig, envLocal *EnvLocalConfig) error {
	out, err := renderEnvSh(cfg, envLocal)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(out), 0755)
}

func renderEnvSh(cfg *SiteConfig, envLocal *EnvLocalConfig) (string, error) {
	tmpl, err := template.New("env.sh.tmpl").Delims("<<", ">>").Funcs(genFuncs).ParseFS(content, "templates/env.sh.tmpl")
	if err != nil {
		return "", fmt.Errorf("parse env.sh template: %w", err)
	}

	data := struct {
		*SiteConfig
		EnvLocal *EnvLocalConfig
	}{cfg, envLocal}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute env.sh template: %w", err)
	}
	return buf.String(), nil
}

// generateEnvLocalSh renders env.local.sh from template and writes to disk.
func generateEnvLocalSh(path string, cfg *EnvLocalConfig) error {
	out, err := renderEnvLocalSh(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(out), 0644)
}

func renderEnvLocalSh(cfg *EnvLocalConfig) (string, error) {
	tmpl, err := template.New("env.local.sh.tmpl").Delims("<<", ">>").Funcs(genFuncs).ParseFS(content, "templates/env.local.sh.tmpl")
	if err != nil {
		return "", fmt.Errorf("parse env.local.sh template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, cfg); err != nil {
		return "", fmt.Errorf("execute env.local.sh template: %w", err)
	}
	return buf.String(), nil
}

// joinQuote returns a comma-separated quoted list.
func joinQuote(items []string) string {
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = fmt.Sprintf(`"%s"`, s)
	}
	return strings.Join(quoted, ", ")
}

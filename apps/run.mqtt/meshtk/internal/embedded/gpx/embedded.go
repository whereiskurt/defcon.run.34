package gpx

import (
	"embed"
	"path/filepath"
)

// DC34 con routes (ghost personas, rabbit sims, city packs) must stay in this
// directive: the upstream meshtk copy of this file only embeds example/*.gpx,
// and a vendor-sync that overwrites it silently strands every GPX-driven sim
// at 0,0 (routes resolve from this embed.FS at runtime, not the filesystem).
//go:embed dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx example/*.gpx
var EmbeddedGPXFiles embed.FS

// GetEmbeddedGPXContent returns the content of an embedded GPX file by name
func GetEmbeddedGPXContent(name string) ([]byte, error) {
	// Try direct access first
	content, err := EmbeddedGPXFiles.ReadFile(name)
	if err == nil {
		return content, nil
	}

	// If not found, check if it might be in a subdirectory
	dirs, err := EmbeddedGPXFiles.ReadDir(".")
	if err != nil {
		return nil, err
	}

	for _, dir := range dirs {
		if dir.IsDir() {
			content, err := EmbeddedGPXFiles.ReadFile(filepath.Join(dir.Name(), name))
			if err == nil {
				return content, nil
			}
		}
	}

	return nil, err
}

// GetEmbeddedGPXMap returns a map of filename to file content
func GetEmbeddedGPXMap() (map[string][]byte, error) {
	gpxMap := make(map[string][]byte)

	// Get files from root directory
	entries, err := EmbeddedGPXFiles.ReadDir(".")
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".gpx" {
			content, err := EmbeddedGPXFiles.ReadFile(entry.Name())
			if err != nil {
				continue
			}
			gpxMap[entry.Name()] = content
		} else if entry.IsDir() {
			// Process subdirectories
			subEntries, err := EmbeddedGPXFiles.ReadDir(entry.Name())
			if err != nil {
				continue
			}

			for _, subEntry := range subEntries {
				if !subEntry.IsDir() && filepath.Ext(subEntry.Name()) == ".gpx" {
					content, err := EmbeddedGPXFiles.ReadFile(filepath.Join(entry.Name(), subEntry.Name()))
					if err != nil {
						continue
					}
					// Flatten the structure by using just the filename
					gpxMap[subEntry.Name()] = content
				}
			}
		}
	}

	return gpxMap, nil
}

// ListEmbeddedGPXFiles returns a list of all embedded GPX files
func ListEmbeddedGPXFiles() ([]string, error) {
	var files []string

	// Get files from root directory
	entries, err := EmbeddedGPXFiles.ReadDir(".")
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".gpx" {
			files = append(files, entry.Name())
		} else if entry.IsDir() {
			// Process subdirectories
			subEntries, err := EmbeddedGPXFiles.ReadDir(entry.Name())
			if err != nil {
				continue
			}

			for _, subEntry := range subEntries {
				if !subEntry.IsDir() && filepath.Ext(subEntry.Name()) == ".gpx" {
					// Flatten the structure by using just the filename
					files = append(files, subEntry.Name())
				}
			}
		}
	}

	return files, nil
}

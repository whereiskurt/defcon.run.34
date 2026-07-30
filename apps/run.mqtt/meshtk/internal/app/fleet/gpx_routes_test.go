package fleet

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"

	"github.com/whereiskurt/meshtk/pkg/config"
)

// TestDC34FleetGPXRoutesResolve walks every Fleet entry in meshtk.dc34.yaml and
// asserts each gpx Movement resolves to at least one coordinate. Before this
// test there was NO coverage anywhere of the embed or of GPXCoords, which is
// exactly why the same regression shipped green twice (#1009, #1028/#1029): a
// vendor-sync reverted the go:embed directive in internal/embedded/gpx to
// upstream's example-only version, GPXCoords started returning an empty slice,
// and publishNextGPXMovement's len()>0 gate silently stopped POSITION_APP for
// all 24 GPX-driven sim nodes with nothing failing.
//
// Because `go test` runs with the cwd set to this package directory, the .gpx
// files are NOT on the filesystem here, so GPXCoords' os.Open() misses and this
// test exercises the go:embed FALLBACK path specifically. That is deliberate and
// complementary to the Dockerfile: the image ships the routes flat in /app so
// production resolves from the filesystem, while this test keeps the embed --
// now the fallback -- honest.
//
// THIS TEST IS ITSELF VENDOR-SYNC-EXPOSED. It lives under internal/, the same
// directory tree that gets replaced wholesale by a fresh upstream clone, so it
// is exactly as clobberable as the embedded.go directive it guards. The
// AUTHORITATIVE guard is the build-time assertion in Dockerfile.meshtk, which
// is monorepo-only and therefore outside vendor-sync's blast radius. Treat this
// test as a secondary net, not as the reason to trust the config.
func TestDC34FleetGPXRoutesResolve(t *testing.T) {
	cfgPath := filepath.Join("..", "..", "..", "meshtk.dc34.yaml")
	if _, err := os.Stat(cfgPath); err != nil {
		t.Fatalf("cannot stat %s: %v", cfgPath, err)
	}

	v := viper.New()
	v.SetConfigType("yaml")
	v.SetConfigFile(cfgPath)
	if err := v.ReadInConfig(); err != nil {
		t.Fatalf("read %s: %v", cfgPath, err)
	}

	var parsed struct{ Fleet []config.Fleet }
	if err := v.Unmarshal(&parsed); err != nil {
		t.Fatalf("unmarshal %s: %v", cfgPath, err)
	}

	// GPXCoords logs through f.Config.Log on the miss path; give it a real
	// logger pointed at io.Discard so a failure reports as a test error rather
	// than a nil-pointer panic.
	logger := logrus.New()
	logger.SetOutput(io.Discard)
	f := &FleetCmd{Config: &config.Config{Log: logger}}

	checked := 0
	for _, fl := range parsed.Fleet {
		for _, m := range fl.Movement {
			if m.Type != "gpx" || m.GPXFile == "" {
				continue
			}
			checked++

			// Assert only ">0 coordinates" -- NOT the presence of <trkpt>.
			// GPXCoords falls back trk -> rte -> wpt, and 4 of the 24 DC34
			// routes legitimately carry no trackpoints at all: history.gpx is
			// waypoints only (15 <wpt>), and north/south/west.gpx are routes
			// only (<rte>/<rtept>). A stricter assertion looking for
			// trackpoints would fail on those four working routes and would
			// most likely get "fixed" by weakening this check into
			// uselessness. Do not tighten it.
			coords := f.GPXCoords(m.GPXFile)
			if len(coords) == 0 {
				t.Errorf("fleet %q: GPX route %q resolved to 0 coordinates -- "+
					"this node would silently never publish POSITION_APP. Check the "+
					"go:embed directive in internal/embedded/gpx/embedded.go; a "+
					"vendor-sync may have reverted it to upstream's example-only version.",
					fl.Id, m.GPXFile)
			}
		}
	}

	// Guard against a vacuous pass: if the config were empty, renamed, or
	// failed to parse into Fleet entries, the loop above would iterate zero
	// times and the test would report success having verified nothing.
	if checked == 0 {
		t.Fatal("no gpx Movement entries found in meshtk.dc34.yaml -- test would pass vacuously")
	}

	t.Logf("resolved %d GPX routes from %s", checked, cfgPath)
}

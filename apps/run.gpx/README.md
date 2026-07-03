# run.gpx - GPX Studio Service

Self-hosted GPX editor at `gpxstudio.defcon.run` with OIDC authentication and S3 storage.

## Architecture

- **Next.js wrapper** (`webapp/`) - handles OIDC auth, S3 presigned URLs, DynamoDB metadata
- **gpx.studio frontend** (`gpx-studio/`) - vendored open-source GPX editor
- **Build script** (`build-frontend.sh`) - compiles gpx-studio and copies to webapp/public/studio

## Prerequisites

- Node.js 22+
- Docker
- AWS credentials configured

## Setup

```bash
# Install webapp dependencies
cd webapp && npm install
```

## Development

**Important:** You must build the gpx-studio frontend before running the dev server.

```bash
# Build the gpx-studio frontend (from apps/run.gpx/)
./build-frontend.sh

# Then start the dev server
cd webapp
npm run dev
```

Local development runs at `http://localhost:3003`

The `build-frontend.sh` script:
1. Applies patches to gpx-studio source
2. Installs dependencies for gpx-studio and its gpx library
3. Builds the SvelteKit frontend
4. Copies output to `webapp/public/studio/`

Re-run `./build-frontend.sh` whenever you modify files in `gpx-studio/`.

## Build & Deploy

Build the Docker image:

```bash
# Build frontend first
./build-frontend.sh

# Then build Docker image (from apps/ directory)
cd ..
./build.sh webapp run.gpx
```

Deploy to ECS:

```bash
cd apps
./deploy.sh run.gpx
```

## Cloud Storage Dialog Modes

The Cloud Storage dialog operates in three modes:
- **Save mode** (`File > Save As...` or Ctrl+Shift+K): Layers expanded, for saving local files to cloud
- **Open mode** (`File > Open Remote...` or Ctrl+Shift+O): Remote files expanded, for batch opening cloud files
- **Browse mode** (`View > Cloud Storage`): Both sections expanded, for general cloud file management

# run.gpx - GPX Studio Service

Self-hosted GPX editor at `gpxstudio.defcon.run` with OIDC authentication and S3 storage.

## Architecture

- **Next.js wrapper** (`webapp/`) - handles OIDC auth, S3 presigned URLs, DynamoDB metadata
- **gpx.studio frontend** (`gpx-studio/`) - modified open-source GPX editor (git submodule)
- **Patches** (`patches/`) - modifications for auth integration, storage adapter, branding

## Prerequisites

- Node.js 22+
- Docker
- AWS credentials configured
- gpx.studio submodule initialized

## Setup

```bash
# Initialize submodule
git submodule update --init --recursive

# Install webapp dependencies
cd webapp && npm install
```

## Development

```bash
cd webapp
npm run dev
```

Local development runs at `http://localhost:3002`

## Build

Uses shared build script in `apps/build.sh`:

```bash
cd apps
./build.sh webapp run.gpx
```

## Deploy

Uses shared deploy script in `apps/deploy.sh`:

```bash
cd apps
./deploy.sh run.gpx
```

## OpenSpec

See `openspec/changes/add-gpxstudio-service/` for full proposal and design.

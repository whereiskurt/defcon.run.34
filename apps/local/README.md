# Local Development Infrastructure

This folder contains Docker Compose configurations for local development services.

## Services

### DynamoDB Local (`dynamodb/`)

Local DynamoDB instance for auth, human, and gpx services.

```bash
cd dynamodb
docker compose up -d
```

- **Port**: 8888 (maps to internal 8000)
- **Tables**: run-auth-electro, run-auth-authjs, run-human-electro, run-human-authjs, run-gpx-electro
- **Credentials**: `local` / `local`

#### Utility Scripts

**Set user services** (grant access to services like gpxstudio, cms):
```bash
cd dynamodb
./set-user-services.sh whereiskurt@gmail.com auth run strava gpxstudio cms
```

### MinIO S3 (`s3/`)

S3-compatible object storage for file uploads (GPX files, etc.).

```bash
cd s3
docker compose up -d
```

- **S3 API Port**: 9000
- **Console UI Port**: 9001 (http://localhost:9001)
- **Buckets**: run-gpx-uploads
- **Credentials**: `minioadmin` / `minioadmin`

## Quick Start

Start all local services:

```bash
# From apps/local directory
cd dynamodb && docker compose up -d && cd ..
cd s3 && docker compose up -d && cd ..
```

## Environment Variables

Each webapp has a `.env` file configured for local development:

| Service | DynamoDB Endpoint | S3 Endpoint |
|---------|-------------------|-------------|
| run.auth | http://localhost:8888 | - |
| run.human | http://localhost:8888 | - |
| run.gpx | http://localhost:8888 | http://localhost:9000 |

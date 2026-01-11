# BRouter Service Design

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CloudFront                              │
│                 brouter.defcon.run (optional)                │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                        ALB                                   │
│              (internal or public)                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   ECS Fargate                                │
│              brouter/brouter:latest                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  BRouter Server (Java)                                  │ │
│  │  - Port 17777 (HTTP API)                               │ │
│  │  - Routing profiles: bike, hike, car, etc.             │ │
│  └────────────────────────────────────────────────────────┘ │
│                         │                                    │
│  ┌──────────────────────▼─────────────────────────────────┐ │
│  │  EFS Mount: /brouter/segments4                          │ │
│  │  - Pre-loaded OSM routing segments                      │ │
│  │  - ~500MB for Southwest US                              │ │
│  │  - ~2GB for full North America                          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. BRouter Container

**Image**: `brouter/brouter:latest` or custom build

**Configuration**:
- Port: 17777
- Memory: 512MB-1GB
- CPU: 0.5 vCPU
- Health check: `GET /brouter?lonlats=-115.1,36.1|-115.2,36.2&profile=trekking&format=geojson`

**Environment**:
```
JAVA_OPTS=-Xmx512m
```

### 2. Routing Data (Segments)

BRouter uses pre-computed "segments" derived from OSM data.

**Data Source**: http://brouter.de/brouter/segments4/

**Storage Options**:

| Option | Size | Coverage |
|--------|------|----------|
| Southwest US only | ~200MB | NV, AZ, CA, UT |
| Western US | ~500MB | West of Rockies |
| Full North America | ~2GB | US, Canada, Mexico |
| Global | ~10GB | Worldwide |

**Recommendation**: Start with Western US (~500MB), expand if needed.

**Storage**: EFS volume mounted to container, pre-populated during deployment.

### 3. Routing Profiles

BRouter includes standard profiles:
- `trekking` - Hiking/walking
- `fastbike` - Road cycling
- `MTB` - Mountain biking
- `car-eco` - Driving

Custom profiles can be added for DEF CON-specific needs (urban walking, etc.).

## Integration with gpx-studio

### Option A: Internal Only (Recommended)

gpx-studio backend proxies to BRouter (no public exposure):

```
gpx-studio frontend
    → /api/brouter (Next.js rewrite)
    → http://brouter.internal:17777/brouter
```

**Pros**: Simple, secure, no additional DNS/certs
**Cons**: All requests go through gpx-studio

### Option B: Public Endpoint

Expose BRouter at `brouter.defcon.run`:

```
gpx-studio frontend
    → https://brouter.defcon.run/brouter
```

**Pros**: Direct access, could be used by other tools
**Cons**: More infrastructure, needs rate limiting

## Data Pipeline

### Initial Setup
1. Download segment files from brouter.de
2. Upload to S3 bucket
3. EFS sync from S3 on container startup (or pre-populate EFS)

### Updates
- OSM data updates weekly at brouter.de
- For DEF CON: Pre-load before event, no updates during
- Post-event: Consider automation if service continues

## Fallback Strategy

If self-hosted BRouter fails:
1. gpx-studio detects error
2. Falls back to public `brouter.gpx.studio`
3. Log/alert for investigation

```typescript
const brouterUrls = [
  '/api/brouter',           // Our proxy to self-hosted
  'https://brouter.gpx.studio'  // Public fallback
];
```

## Security Considerations

1. **No authentication needed** - Read-only routing queries
2. **Rate limiting** - Add if public, not needed if internal
3. **Input validation** - BRouter handles malformed requests gracefully
4. **No sensitive data** - Only geographic coordinates

## Cost Estimate

| Resource | Specification | Monthly Cost |
|----------|--------------|--------------|
| ECS Fargate | 0.5 vCPU, 1GB RAM | ~$15 |
| EFS Storage | 500MB | ~$0.15 |
| Data Transfer | Internal only | $0 |
| **Total** | | ~$15/month |

## Open Questions

1. **Region coverage**: Las Vegas only or broader area?
2. **Public endpoint**: Worth the extra complexity?
3. **Custom profiles**: Any DEF CON-specific routing needs?
4. **Multi-region**: Deploy in both us-east-1 and ca-central-1?

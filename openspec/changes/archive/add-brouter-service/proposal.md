# Add Self-Hosted BRouter Service

## Summary

Add a self-hosted BRouter routing engine to provide route planning capabilities for gpx-studio without depending on external services.

## Problem

The gpx-studio service currently relies on `brouter.gpx.studio`, a public BRouter instance:

1. **External dependency** - Service availability during DEF CON is not guaranteed
2. **CORS issues** - Required proxy workaround for local development
3. **No control** - Can't customize routing profiles or data coverage
4. **Privacy** - Route requests go to third-party server

## Solution

Deploy a self-hosted BRouter instance as part of the defcon.run infrastructure:

- Run BRouter in a container alongside other services
- Pre-load OSM routing data for relevant regions (North America / Las Vegas area)
- Configure gpx-studio to use our instance instead of public one
- Optional: Expose as `brouter.defcon.run` or keep internal-only

## Impact

| Area | Impact |
|------|--------|
| Infrastructure | New ECS service + S3 for routing data |
| gpx-studio | Update routing URL to use our instance |
| Storage | ~500MB-10GB depending on region coverage |
| Cost | Minimal (single small container) |

## Alternatives Considered

1. **Keep using public instance** - Simpler but external dependency
2. **Use different routing engine** - OSRM, Valhalla - more complex, overkill
3. **Disable routing** - Degrades user experience significantly

## Decision

Proceed with self-hosted BRouter for reliability during the event. Start with regional data (Las Vegas / Nevada / Southwest US) to minimize storage requirements.

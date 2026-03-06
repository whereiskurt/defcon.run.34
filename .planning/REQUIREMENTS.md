# Requirements: DEF CON Run 34

**Defined:** 2026-03-05
**Core Value:** Participants and organizers have a seamless digital experience for DCR34 — from device setup to event discovery to route navigation — all through the browser.

## v1.2 Requirements

Requirements for User Checkins milestone. Each maps to roadmap phases.

### Data Layer

- [ ] **CHKN-01**: CheckIn ElectroDB entity with GPS samples, average coordinates, best accuracy, distance, duration, privacy flag, and timestamps
- [ ] **CHKN-02**: By-user-recent and by-global-recent indexes for paginated access patterns
- [ ] **CHKN-03**: User entity checkInCount and lastCheckInAt updated as side effects of create/delete

### API

- [ ] **API-01**: User can create a check-in by submitting GPS samples, with quota enforcement and privacy flag
- [ ] **API-02**: User can list their own check-ins with cursor-based pagination
- [ ] **API-03**: User can toggle public/private on an individual check-in they own
- [ ] **API-04**: User can delete their own check-in (decrements checkInCount)

### UI

- [ ] **UI-01**: CheckInModal collects 3 GPS samples over 2 seconds with progress bar, privacy toggle, and quota display
- [ ] **UI-02**: "GPS Check-in" entry in header user dropdown opens the CheckInModal
- [ ] **UI-03**: Profile page shows paginated check-in list with Leaflet map, numbered markers, and accuracy circles
- [ ] **UI-04**: User can set default check-in privacy preference (public/private)

## Future Requirements

### Check-in Types

- **TYPE-01**: OTP check-in type (6-digit code + 5 GPS samples)
- **TYPE-02**: Flag check-in type (20-char text + 5 GPS samples)
- **TYPE-03**: Manual map-click check-in type (Leaflet picker)

### Integration

- **INTG-01**: Meshtastic radio as check-in source
- **INTG-02**: Movement analysis (distance, velocity, movement type detection)
- **INTG-03**: Global check-in leaderboard

## Out of Scope

| Feature | Reason |
|---------|--------|
| OTP check-in type | Simplifying for v1.2, add later if needed |
| Flag check-in type | Simplifying for v1.2 |
| Manual map-click type | Simplifying for v1.2 |
| Meshtastic source | Not integrating radio check-ins yet |
| Movement analysis | DCR33 feature, defer to future |
| Global leaderboard | Separate milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHKN-01 | Phase 10 | Pending |
| CHKN-02 | Phase 10 | Pending |
| CHKN-03 | Phase 10 | Pending |
| API-01 | Phase 11 | Pending |
| API-02 | Phase 11 | Pending |
| API-03 | Phase 11 | Pending |
| API-04 | Phase 11 | Pending |
| UI-01 | Phase 12 | Pending |
| UI-02 | Phase 12 | Pending |
| UI-03 | Phase 13 | Pending |
| UI-04 | Phase 11 | Pending |

**Coverage:**
- v1.2 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after roadmap creation*

# Phase 12: CheckInModal + Header Integration - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can trigger a GPS check-in from anywhere in the app via the header dropdown. A modal collects 3 GPS samples over 2 seconds with progress feedback, displays quota usage, and allows privacy control before submitting. No check-in history UI (Phase 13).

</domain>

<decisions>
## Implementation Decisions

### GPS sampling UX
- Animated HeroUI Progress bar fills over 2 seconds, showing "Collecting GPS..." with sample count (e.g., "2/3")
- GPS collection starts immediately when modal opens -- no intermediate "Start" button
- After 3 samples collected, show best accuracy (e.g., "Location captured (+/-4m)") before submit
- If GPS permission denied or unavailable: show inline error in modal with Retry button ("Location unavailable -- enable GPS and try again"). Modal stays open.

### Modal layout & flow
- Two-phase modal design:
  - Phase 1 (collecting): Progress bar with sample count, minimal content
  - Phase 2 (ready to submit): Success confirmation with accuracy, privacy toggle, quota display, Cancel/Check In buttons
- Content transitions smoothly between phases (not a page change)
- HeroUI Switch component for privacy toggle with dynamic label ("Public" or "Private"), pre-set to user's default `checkinPreference`
- Quota display as small muted text below privacy toggle: "3 of 10 check-ins used today"
- Modal uses HeroUI Modal with `backdrop="blur"` and `placement="center"` (matches existing QR and Logout modals)

### Header dropdown integration
- New dropdown item: "GPS Check-in" with a location pin icon (FaMapMarkerAlt from react-icons)
- Placed in its own DropdownSection, above the QR section
- Before opening modal, check quota -- if exhausted, show disabled state or tooltip: "Check-in limit reached for today". Never start GPS collection when quota is used up.

### Success/failure feedback
- On successful POST: show success state ("Checked in!") with updated quota count for 1.5 seconds, then auto-close modal
- On network/server error (non-quota): show inline error in modal with Retry button. GPS samples remain in memory -- no re-collection needed. "Something went wrong -- [Retry] [Cancel]"
- Submit button uses HeroUI `isLoading` state during POST to prevent double-submit (matches ConfirmDialog pattern)

### Claude's Discretion
- Exact transition animation between collection and review phases
- GPS sampling interval timing (e.g., every 667ms for 3 samples over 2s)
- How to fetch quota count before modal open (pre-fetch on dropdown open, or on mount)
- Error message wording details
- Component file organization (single file vs split)

</decisions>

<specifics>
## Specific Ideas

- The two-phase modal should feel quick -- user taps "GPS Check-in", sees progress bar fill for 2 seconds, reviews privacy/quota, taps "Check In". Whole flow under 5 seconds.
- Quota prevention at the dropdown level means users never waste time collecting GPS when they can't check in
- POST response includes `{quota: {remaining}}` -- use this for the success state's updated count rather than re-fetching

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dropdown-user.tsx`: Already has HeroUI Modal + useDisclosure pattern (LogoutModal, QRModal) -- CheckInModal follows same pattern
- `ConfirmDialog.tsx`: Reusable modal with `isLoading` prop -- reference for loading state pattern
- HeroUI `Progress`, `Switch`, `Modal`, `Button` components already imported/available
- `apiUrl('/api/checkins')` for POST endpoint, `apiUrl('/api/user')` for fetching checkinPreference
- `react-icons/fa` already imported (FaUserAlt, FaTrophy) -- add FaMapMarkerAlt

### Established Patterns
- Modal pattern: function components (LogoutModal, QRModal) rendered inline with `{ModalFn(isOpen, onClose)}` syntax
- useDisclosure hook for modal open/close state
- `fetchUserDetails()` already fetches user data on mount -- can piggyback for checkinPreference and quota info
- `apiUrl()` helper for base path-aware API calls

### Integration Points
- `dropdown-user.tsx`: Add new DropdownSection + DropdownItem for "GPS Check-in", new useDisclosure for CheckInModal
- POST to `/api/checkins` with GPS samples array, optional `isPrivate` boolean
- GET quota info via existing user fetch or dedicated quota endpoint
- `navigator.geolocation.watchPosition()` or `getCurrentPosition()` for GPS sampling (new -- no existing geolocation code)

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 12-checkinmodal-header-integration*
*Context gathered: 2026-03-06*

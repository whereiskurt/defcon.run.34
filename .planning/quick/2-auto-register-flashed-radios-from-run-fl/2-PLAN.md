---
phase: quick
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/run.flash/webapp/src/lib/meshtastic.ts
  - apps/run.flash/webapp/src/hooks/use-configure.ts
  - apps/run.flash/webapp/src/app/api/register-radio/route.ts
  - apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
autonomous: true
requirements: [QUICK-2]

must_haves:
  truths:
    - "After flash+configure, the radio's node ID and private key are auto-registered in run.human"
    - "Re-flashing the same radio updates the private key instead of creating a duplicate"
    - "Registration fails gracefully without breaking the flash flow"
  artifacts:
    - path: "apps/run.flash/webapp/src/lib/meshtastic.ts"
      provides: "Captures myNodeNum and security privateKey during configure handshake"
    - path: "apps/run.flash/webapp/src/hooks/use-configure.ts"
      provides: "POSTs captured radio info to register-radio after successful config push"
    - path: "apps/run.flash/webapp/src/app/api/register-radio/route.ts"
      provides: "Server-side proxy from run.flash to run.human internal API"
    - path: "apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts"
      provides: "Internal endpoint to create/update radio registration by OIDC sub"
  key_links:
    - from: "apps/run.flash/webapp/src/lib/meshtastic.ts"
      to: "apps/run.flash/webapp/src/hooks/use-configure.ts"
      via: "connectMeshtasticDevice() returns DeviceRegistrationInfo"
      pattern: "connectMeshtasticDevice.*DeviceRegistrationInfo"
    - from: "apps/run.flash/webapp/src/hooks/use-configure.ts"
      to: "apps/run.flash/webapp/src/app/api/register-radio/route.ts"
      via: "fetch POST /api/register-radio"
      pattern: "fetch.*register-radio"
    - from: "apps/run.flash/webapp/src/app/api/register-radio/route.ts"
      to: "apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts"
      via: "server-to-server fetch with x-internal-secret"
      pattern: "x-internal-secret"
---

<objective>
Auto-register flashed radios from run.flash into run.human's meshtastic radio system.

Purpose: After a user flashes and configures a radio via run.flash, their radio should automatically appear in their run.human meshtastic radios list -- verified, with impersonate enabled, and private key stored. This eliminates manual radio registration for flashed devices.

Output: Four modified/new files forming the registration pipeline: device info capture -> client POST -> server proxy -> internal API.
</objective>

<execution_context>
@/Users/khundeck/.claude/get-shit-done/workflows/execute-plan.md
@/Users/khundeck/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@apps/run.flash/webapp/src/lib/meshtastic.ts
@apps/run.flash/webapp/src/hooks/use-configure.ts
@apps/run.flash/webapp/src/app/api/config/route.ts
@apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts
@apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
@apps/run.human/webapp/src/entities/run-user.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From apps/run.flash/webapp/src/lib/meshtastic.ts:
```typescript
// Current return type -- will change to include registration info
export async function connectMeshtasticDevice(): Promise<MeshDevice>

// Device events available during configure handshake:
// device.events.onMyNodeInfo: SimpleEventDispatcher<Protobuf.Mesh.MyNodeInfo>
//   - fires with { myNodeNum: number } (uint32 node number)
// device.events.onConfigPacket: SimpleEventDispatcher<Protobuf.Config.Config>
//   - fires with { payloadVariant: { case: "security", value: { privateKey: Uint8Array, publicKey: Uint8Array, ... } } }
```

From apps/run.flash/webapp/src/app/api/config/route.ts:
```typescript
// Existing pattern for server-to-server calls:
const RUN_HUMAN_INTERNAL_URL = process.env.RUN_HUMAN_INTERNAL_URL;
const AUTH_INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;
// Uses session.user.id as OIDC subject
```

From apps/run.human/webapp/src/entities/run-user.ts:
```typescript
export type MeshtasticRadio = {
  id: string; nodeId: string; privateKey: string;
  impersonate?: boolean; verificationCode: string;
  verified: boolean; createdAt: number;
  verifiedAt?: number; verificationAttempts?: number; resendAttempts?: number;
};
export async function getRunUser(userId: string): Promise<RunUserItem | null>;
export async function updateMeshtasticRadios(userId: string, radios: MeshtasticRadio[]): Promise<void>;
```

From apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts:
```typescript
// Pattern for internal API auth:
const secret = req.headers.get("x-internal-secret");
if (!secret || secret !== config.auth.internalSecret) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
// OIDC sub -> adapter userId resolution via DynamoDB GSI1 query
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Capture device info during configure + create run.human internal endpoint</name>
  <files>
    apps/run.flash/webapp/src/lib/meshtastic.ts
    apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
  </files>
  <action>
**meshtastic.ts changes:**

1. Export a new type `DeviceRegistrationInfo` with fields: `nodeId: string` (hex format `!abcd1234`), `privateKey: string` (base64-encoded).

2. Modify `connectMeshtasticDevice()` return type from `Promise<MeshDevice>` to `Promise<{ device: MeshDevice; registrationInfo: DeviceRegistrationInfo }>`.

3. Inside `configureWithRetry()` (or in `connectMeshtasticDevice()` after `configureWithRetry` returns), subscribe to two events BEFORE calling `device.configure()`:

   a. `device.events.onMyNodeInfo` -- capture `info.myNodeNum` (uint32). Convert to hex node ID: `"!" + myNodeNum.toString(16).padStart(8, "0")`.

   b. `device.events.onConfigPacket` -- check if `config.payloadVariant.case === "security"`. If so, capture `config.payloadVariant.value.privateKey` (Uint8Array). Convert to base64: use `btoa(String.fromCharCode(...bytes))` or similar browser-safe encoding.

   Both subscriptions should capture into local variables. After `configureWithRetry()` resolves (device is fully configured), the events will have fired during the config dump. Unsubscribe after configure completes.

4. Return the combined `{ device, registrationInfo }` object. If myNodeNum was not captured (unlikely edge case), log a warning and return `registrationInfo` with empty strings.

**Important implementation details:**
- The events fire DURING the configure() handshake (the device dumps its full config). Subscribe BEFORE `device.configure()` is called inside `configureWithRetry()`.
- The cleanest approach: move the subscription setup into `configureWithRetry()` itself, or create a wrapper that subscribes before calling `configureWithRetry()` and unsubscribes after.
- `configureWithRetry()` will need to change its return type to include the captured info, or accept mutable refs that get populated.
- Update all callers -- `connectMeshtasticDevice()` is called in `use-configure.ts` (handled in Task 2).

**run.human internal endpoint (`/api/internal/meshtastic-radios/route.ts`):**

Create a new POST endpoint following the exact pattern of `/api/internal/user/[oidcSub]/route.ts`:

1. Verify `x-internal-secret` header against `config.auth.internalSecret`. Return 403 if invalid.

2. Parse request body: `{ oidcSub: string, nodeId: string, privateKey: string }`. Validate all fields present, return 400 if missing.

3. Resolve OIDC sub to adapter userId using the same DynamoDB GSI1 query pattern from `[oidcSub]/route.ts`:
   ```typescript
   const accountResult = await dynamodbClient.query({
     TableName: DYNAMODB_TABLE,
     IndexName: "GSI1",
     KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
     ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
     ExpressionAttributeValues: {
       ":gsi1pk": "ACCOUNT#run.defcon.run",
       ":gsi1sk": `ACCOUNT#${oidcSub}`,
     },
   });
   ```

4. Get RunUser via `getRunUser(adapterUserId)`. Return 404 if not found.

5. Check for existing radio with same nodeId in `user.meshtasticRadios`:
   - If exists: UPDATE that radio's `privateKey` field (idempotent for re-flashes). Keep existing `id`, `verified`, `verifiedAt`, etc. Return 200 with `{ radio, updated: true }`.
   - If not exists: CREATE new radio with `verified: true`, `impersonate: true`, `verificationCode: ""` (not needed -- auto-verified), consume quota via `consumeQuota()`. Return 201 with `{ radio, updated: false }`.

6. Use `updateMeshtasticRadios()` to persist. Import `checkQuota`, `consumeQuota` from `@/lib/quota-client` and `getUserTier` from `@/lib/quota-middleware` (same pattern as the existing meshtastic-radios route).

7. If quota exceeded on new radio creation, return 403 with `{ error: "Radio quota exceeded" }`.

8. Import `config` from `@/config` for `config.auth.internalSecret`.
  </action>
  <verify>
    <automated>cd apps/run.flash/webapp && npx tsc --noEmit 2>&1 | head -30; cd ../../../run.human/webapp && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - connectMeshtasticDevice() returns { device, registrationInfo } with nodeId and privateKey captured from device events
    - /api/internal/meshtastic-radios POST endpoint accepts { oidcSub, nodeId, privateKey }, resolves user, creates or updates radio
    - Both files compile without TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire up registration flow in use-configure hook + create run.flash proxy route</name>
  <files>
    apps/run.flash/webapp/src/hooks/use-configure.ts
    apps/run.flash/webapp/src/app/api/register-radio/route.ts
  </files>
  <action>
**use-configure.ts changes:**

1. Update the `connectMeshtasticDevice()` call to destructure the new return type:
   ```typescript
   const { device, registrationInfo } = await connectMeshtasticDevice();
   ```

2. After `await pushDeviceConfig(device, config, onStageComplete)` succeeds (after the "All done" comment, before setting stage to "complete"), add a fire-and-forget POST to register the radio:
   ```typescript
   // Auto-register radio -- fire-and-forget, don't block completion
   if (registrationInfo.nodeId) {
     fetch(`${basePath}/api/register-radio`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         nodeId: registrationInfo.nodeId,
         privateKey: registrationInfo.privateKey,
       }),
     }).catch((err) => {
       console.warn("[configure] Radio auto-registration failed:", err);
     });
   }
   ```

   This is intentionally fire-and-forget (no await) -- registration failure must NOT block the user from seeing the "Done" screen. The radio is already flashed and working regardless.

3. No new progress stage needed for registration -- it happens silently in the background.

**register-radio/route.ts (new file):**

Create a server-side proxy route following the exact pattern of `/api/config/route.ts`:

1. Import `auth` from `@/config/auth` and `NextResponse` from `next/server`.

2. Authenticate the user via `const session = await auth()`. Return 401 if no session.

3. Read `RUN_HUMAN_INTERNAL_URL` and `AUTH_INTERNAL_SECRET` from `process.env` (same vars used by `/api/config`).

4. Parse request body: `{ nodeId, privateKey }` from `req.json()`.

5. POST to `${RUN_HUMAN_INTERNAL_URL}/api/internal/meshtastic-radios` with:
   - Body: `{ oidcSub: session.user.id, nodeId, privateKey }`
   - Headers: `{ "Content-Type": "application/json", "x-internal-secret": AUTH_INTERNAL_SECRET }`

6. Return the run.human response (pass through status code and body).

7. Wrap in try/catch, return 500 on error. In dev without `RUN_HUMAN_INTERNAL_URL`, log a warning and return 200 with `{ registered: false, reason: "run.human not available in dev" }`.
  </action>
  <verify>
    <automated>cd apps/run.flash/webapp && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - use-configure.ts destructures new connectMeshtasticDevice return type correctly
    - After successful config push, fires POST to /api/register-radio (fire-and-forget)
    - /api/register-radio proxies authenticated request to run.human internal API
    - Registration failure does not block the flash completion UI
    - TypeScript compiles without errors
  </done>
</task>

</tasks>

<verification>
1. TypeScript compilation passes in both apps: `cd apps/run.flash/webapp && npx tsc --noEmit` and `cd apps/run.human/webapp && npx tsc --noEmit`
2. Existing flash flow still works -- connectMeshtasticDevice return type change is properly handled in use-configure.ts
3. No import errors or missing module references
</verification>

<success_criteria>
- run.flash captures nodeId (hex from myNodeNum) and privateKey (base64 from security config) during the Meshtastic configure handshake
- After successful config push, run.flash POSTs radio info to its own /api/register-radio (fire-and-forget)
- run.flash /api/register-radio proxies to run.human /api/internal/meshtastic-radios with auth
- run.human internal endpoint creates radio as verified+impersonate, or updates privateKey if radio exists (idempotent)
- Registration failure never blocks the user's flash completion experience
</success_criteria>

<output>
After completion, create `.planning/quick/2-auto-register-flashed-radios-from-run-fl/2-SUMMARY.md`
</output>

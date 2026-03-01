---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/run.flash/webapp/tailwind.config.js
  - apps/run.flash/webapp/src/styles/globals.css
  - apps/run.flash/webapp/src/components/connect/connect-step.tsx
  - apps/run.flash/webapp/src/components/flash/flash-step.tsx
  - apps/run.flash/webapp/src/components/configure/configure-step.tsx
  - apps/run.flash/webapp/src/components/done/done-step.tsx
autonomous: true
requirements: [QUICK-01]

must_haves:
  truths:
    - "ConnectStep, FlashStep (complete/idle), ConfigureStep (complete), and DoneStep all display a device image in the same position (right side of panel)"
    - "All actionable CTA buttons (Continue, Flash, Flash Another) appear at bottom-center of their respective panels"
    - "When a step is ready to advance (connect done, flash done, config done), the CTA button pulses/glows to draw attention"
  artifacts:
    - path: "apps/run.flash/webapp/src/styles/globals.css"
      provides: "cta-pulse CSS animation class"
      contains: "cta-pulse"
    - path: "apps/run.flash/webapp/src/components/connect/connect-step.tsx"
      provides: "Consistent layout with bottom-center button and pulse animation"
    - path: "apps/run.flash/webapp/src/components/flash/flash-step.tsx"
      provides: "Consistent complete-state layout with bottom-center button and pulse animation"
    - path: "apps/run.flash/webapp/src/components/configure/configure-step.tsx"
      provides: "Device image added, bottom-center button with pulse animation"
    - path: "apps/run.flash/webapp/src/components/done/done-step.tsx"
      provides: "Consistent button with pulse animation"
  key_links:
    - from: "globals.css"
      to: "all step components"
      via: "cta-pulse class"
      pattern: "cta-pulse"
---

<objective>
Standardize the wizard step panels so they share a consistent visual structure -- same device image placement, same button position, and an animated pulse/glow on the CTA button when the step is ready to advance.

Purpose: The five wizard steps currently have inconsistent layouts (some show device images, some don't; buttons appear in different locations). This creates visual jarring as users move through the wizard. Making them uniform improves perceived quality and user orientation.

Output: Updated step components with consistent layout pattern and a new CTA pulse animation.
</objective>

<execution_context>
@/Users/khundeck/.claude/get-shit-done/workflows/execute-plan.md
@/Users/khundeck/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@apps/run.flash/webapp/src/components/wizard/wizard-container.tsx
@apps/run.flash/webapp/src/components/connect/connect-step.tsx
@apps/run.flash/webapp/src/components/flash/flash-step.tsx
@apps/run.flash/webapp/src/components/configure/configure-step.tsx
@apps/run.flash/webapp/src/components/done/done-step.tsx
@apps/run.flash/webapp/src/styles/globals.css
@apps/run.flash/webapp/tailwind.config.js

<interfaces>
<!-- Current layout patterns across steps -->

ConnectStep layout (the "good" template for complete states):
- glass-card wrapper with teal border glow when connected
- 3-column grid: grid-cols-[1fr_auto_1fr]
- Left: status info
- Center: action button
- Right: device image (140x100 container) + name + arch chip

FlashStep complete layout:
- Matches ConnectStep: same 3-column grid with left status, center button, right image

ConfigureStep complete layout (NEEDS UPDATE):
- ConfigPipeline + centered success card + centered button
- Missing: device image entirely
- Button: flex justify-center (correct position but no image context)

DoneStep layout (NEEDS UPDATE):
- Celebration header + config summary card + next steps card + centered button
- Missing: device image
- "Flash Another Device" button at bottom center (correct)

WizardContainer passes selectedDevice to ConnectStep and FlashStep but NOT to ConfigureStep or DoneStep.
ConfigureStep needs: selectedDevice prop added
DoneStep needs: selectedDevice prop added
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add CTA pulse animation and standardize button positions with pulse on ready-to-advance states</name>
  <files>
    apps/run.flash/webapp/src/styles/globals.css
    apps/run.flash/webapp/src/components/connect/connect-step.tsx
    apps/run.flash/webapp/src/components/flash/flash-step.tsx
    apps/run.flash/webapp/src/components/configure/configure-step.tsx
    apps/run.flash/webapp/src/components/done/done-step.tsx
    apps/run.flash/webapp/src/components/wizard/wizard-container.tsx
  </files>
  <action>
**1. Add CTA pulse animation to globals.css:**

Add a new `.cta-pulse` class after the existing `.cyber-border` block in globals.css. This should create a pulsing teal glow around buttons to draw attention when the step is ready to advance:

```css
/* CTA pulse: draws attention when step is ready to advance */
.cta-pulse {
  animation: cta-glow 2s ease-in-out infinite;
  position: relative;
}

@keyframes cta-glow {
  0%, 100% {
    box-shadow: 0 0 8px #00d4aa30, 0 0 16px #00d4aa15;
  }
  50% {
    box-shadow: 0 0 16px #00d4aa50, 0 0 32px #00d4aa25;
  }
}
```

Also add a light-mode variant:
```css
html.light .cta-pulse {
  animation: cta-glow-light 2s ease-in-out infinite;
}

@keyframes cta-glow-light {
  0%, 100% {
    box-shadow: 0 0 8px #00a88830, 0 0 16px #00a88815;
  }
  50% {
    box-shadow: 0 0 16px #00a88850, 0 0 32px #00a88825;
  }
}
```

**2. ConnectStep (connect-step.tsx):**

The layout is currently a 3-column grid `[status | button | image]`. Refactor to put the device image + status info inside the glass-card panel at top, and move the action button to a `flex justify-center` below the panel. Apply `cta-pulse` class to the "Continue to Flash" button when connected.

Specifically:
- Keep the glass-card panel with the 3-column grid for the status display (left: connection state, center: can be empty or a connecting indicator, right: device image).
- Move ALL action buttons (Connect Device, Continue to Flash, Try Again, Connecting...) to a new `<div className="flex justify-center">` BELOW the glass-card.
- Add `cta-pulse` class to the "Continue to Flash" button (the one shown when `isConnected && !chipMismatch`).
- Keep all existing functionality -- the chip mismatch warning, bootloader help, etc.

**3. FlashStep (flash-step.tsx):**

For the **idle** state: Keep the warning bar and device details panel as-is (they serve a different purpose -- pre-flash confirmation info). No image needed here as the user just saw the device.

For the **complete** state: The current 3-column grid layout is good. Move the "Continue to Configure" button from inside the grid to a `<div className="flex justify-center">` BELOW the glass-card panel. Add `cta-pulse` class to the button.

For the **error** state: The retry button is already bottom-center. No change needed except keep it consistent.

**4. ConfigureStep (configure-step.tsx):**

Add `device: DeviceHardware | null` prop to the `ConfigureStepProps` interface. Import `DeviceHardware` type from `@/types/device`, and `getDeviceImagePath`, `getArchLabel` from `@/config/devices`, and `Chip` from `@heroui/react`.

For the **complete** state: Replace the current centered success card with a glass-card panel using the same 3-column grid pattern as ConnectStep/FlashStep complete:
- Left: success icon + "Configuration Complete!" text + description
- Center: empty (or remove center column -- use `grid-cols-[1fr_1fr]` or `grid-cols-[1fr_auto]` with image right)
- Right: device image (140x100 container) + device name + arch chip

Actually, to stay consistent with ConnectStep/FlashStep complete, use the exact same `grid-cols-[1fr_auto_1fr]` pattern:
- Left: CheckCircle2 icon + "Configuration Complete!" heading + description
- Center: (empty spacer)
- Right: device image block (same 140x100 pattern)

Below the glass-card, add the "Continue" button in `<div className="flex justify-center">` with `cta-pulse` class.

For other states (connecting, configuring, error): Leave as-is. The connecting and configuring states are transient and don't need the image.

**5. DoneStep (done-step.tsx):**

Add `device: DeviceHardware | null` prop to `DoneStepProps`. Import `getDeviceImagePath`, `getArchLabel` from `@/config/devices`, `Chip` from `@heroui/react`, and `DeviceHardware` type.

In the celebration header area (the first section with CheckCircle2 icon and "Setup Complete!" heading): Add the device image to the right side. Use a flex layout with the celebration content on the left and device image on the right, or keep centered celebration but add image below it. Best approach: wrap the celebration header in a glass-card panel using the same grid pattern:
- Left: CheckCircle2 icon + "Setup Complete!" text + description
- Right: device image (140x100) + device name + arch chip

Add `cta-pulse` class to the "Flash Another Device" button (this is the primary CTA on this step).

**6. WizardContainer (wizard-container.tsx):**

Pass `selectedDevice` to ConfigureStep and DoneStep:

```tsx
{currentStep === "configure" && (
  <ConfigureStep
    device={selectedDevice}         // ADD THIS
    configureState={configureState}
    disconnectTransport={serial.disconnect}
    onContinue={advance}
    onRetry={...}
  />
)}

{currentStep === "done" && (
  <DoneStep
    device={selectedDevice}          // ADD THIS
    configPayload={configureState.configPayload}
    onFlashAnother={resetWizard}
  />
)}
```

**Consistent device image block pattern to reuse across all steps:**
```tsx
{device && (
  <div className="flex flex-col items-center gap-2 justify-self-end">
    <div className="w-[140px] h-[100px] flex items-center justify-center rounded-lg bg-default-100/5">
      <img
        src={getDeviceImagePath(device)}
        alt={device.displayName}
        className="max-h-full max-w-full object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]"
      />
    </div>
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-sm text-default-500">
        {device.displayName}
      </span>
      <Chip size="sm" variant="flat" color={archColor or "success"}>
        {getArchLabel(device)}
      </Chip>
    </div>
  </div>
)}
```

**Critical: Do NOT change DeviceGrid.** The pick-device step is inherently different (it IS the device selection grid) and does not need an image in the same pattern. Its "Continue with {device}" button at the top is fine for its purpose -- it should NOT get the pulse animation since the user needs to scroll the grid to pick a device first.
  </action>
  <verify>
    <automated>cd /Users/khundeck/working/defcon.run.34/apps/run.flash/webapp && npx next build 2>&1 | tail -20</automated>
  </verify>
  <done>
    - All four step components (ConnectStep, FlashStep, ConfigureStep, DoneStep) display the selected device image in the same right-side position within their completion/success panels
    - All CTA buttons that advance the wizard appear at bottom-center below their respective panels
    - The cta-pulse animation class exists in globals.css and is applied to: "Continue to Flash" (ConnectStep when connected), "Continue to Configure" (FlashStep when complete), "Continue" (ConfigureStep when complete), "Flash Another Device" (DoneStep)
    - WizardContainer passes selectedDevice to ConfigureStep and DoneStep
    - Next.js build compiles without errors
  </done>
</task>

</tasks>

<verification>
1. `cd apps/run.flash/webapp && npx next build` compiles without errors
2. Visual inspection: each wizard step shows device image consistently on the right side of completion panels
3. Visual inspection: CTA buttons pulse with teal glow when step is ready to advance
4. Visual inspection: buttons are consistently bottom-center below panels
</verification>

<success_criteria>
- All step components share the same device image placement pattern (right side, 140x100 container, device name + arch chip below)
- CTA buttons consistently positioned at bottom-center of each step
- Pulse/glow animation on CTA buttons when ready to advance (4 buttons across 4 steps)
- No regressions: all existing functionality preserved (chip mismatch, bootloader help, error recovery, config summary, next steps)
- Build passes
</success_criteria>

<output>
After completion, create `.planning/quick/1-wizard-panel-consistency-uniform-image-b/1-SUMMARY.md`
</output>

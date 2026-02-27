# UI Redesign: "Signal & Noise"

**Date**: 2026-02-27
**Scope**: run.auth + run.human frontend redesign
**Stack**: Next.js 16, React 19, HeroUI, Tailwind 4 (unchanged)

## Design Direction

Refined dark-first aesthetic for DEF CON 34. Clean interfaces emerging from atmospheric, textured backgrounds. Terminal-inspired accents without cyberpunk cosplay.

## Color System

```
Background:     #0a0a0f    Surface:        #111118
Surface-raised: #1a1a24    Border:         #2a2a3a
Primary:        #00d4aa    Primary-glow:   #00d4aa20
Secondary:      #f59e0b    Accent:         #8b5cf6
Text-primary:   #e4e4ef    Text-secondary: #8888a0
Text-tertiary:  #555570    Danger:         #ef4444
Success:        #22c55e
```

## Typography

- Display: Museo Moderno (bigger, bolder usage)
- Body: Atkinson Hyperlegible (stays)
- Mono: Fira Code (more prominent for technical data)

## Visual Treatments

- Dot-grid background pattern (CSS only)
- Noise texture overlay at 2-3% opacity
- Card glow borders on hover
- Gradient mesh on login page
- Glassmorphic navbar

## Animation

- Staggered fade-up on page mount (150ms delay per card)
- Card hover glow + translate-y(-1px)
- Nav underline slide-in
- Login form slide-up entrance
- CSS-first, framer-motion for stagger

## Pages

### run.auth /login
- Gradient mesh background, "defcon.run" wordmark above card
- Frosted glass card, terminal-style inputs, OAuth as styled pills

### run.auth / (dashboard)
- Identity hero card, inline provider dots, compact services

### run.auth /profile
- Identity hero + tabbed/two-column layout for providers/services/security

### run.human header
- Glassmorphic, text nav links (no button wrappers), teal active underline

### run.human /dashboard
- Welcome greeting, two-column grid (desktop), icon+text quick actions

### run.human /profile
- Quotas with progress bars, better number styling

### run.human footer
- Compact, dark, version + nav + event info

## Phases

1. Foundation: color system, globals, card/button treatments
2. run.auth pages: login, dashboard, profile
3. run.human chrome: navbar, footer, animations
4. run.human pages: dashboard, profile

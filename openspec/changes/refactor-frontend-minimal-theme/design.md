# Design: Minimal Professional Theme

## Technical Approach

### Color Palette

Use HeroUI's built-in semantic tokens with a neutral base. Avoid custom color definitions where possible.

**Light Mode:**
- Background: `bg-background` (HeroUI default white)
- Foreground: `text-foreground` (HeroUI default slate-900)
- Primary accent: `primary` (HeroUI blue-600, can customize later)
- Secondary: `default` (HeroUI neutral grays)
- Borders: `divider` (HeroUI default)

**Dark Mode:**
- Background: `bg-background` (HeroUI zinc-900)
- Foreground: `text-foreground` (HeroUI zinc-50)
- Same semantic tokens, HeroUI handles the switching

### Typography

Keep existing font stack, remove decorative usage:

| Use Case | Font | Weight | Tailwind Class |
|----------|------|--------|----------------|
| Headings | Inter | 600 (semibold) | `font-sans font-semibold` |
| Body | Atkinson Hyperlegible | 400 | `font-atkinson` |
| Code/Mono | Fira Code | 400 | `font-mono` |

**Remove:**
- Museo Moderno (display font with decorative feel)
- Rainbow text cycling
- Glitch before/after pseudo-elements
- Gradient text effects

### Component Changes

#### Header (`src/components/header/header.tsx`)

**Current:**
- Bunny logo with theme switching
- Rainbow/gradient navigation text
- Complex dropdown with icons

**New:**
- Text logo "defcon.run" or simple wordmark
- Plain navigation links with subtle hover
- Clean dropdown using HeroUI defaults

```tsx
// Before
<LogoIcon size={35} />
<RainbowText>Session</RainbowText>

// After
<span className="font-semibold text-lg">defcon.run</span>
<span>Dashboard</span>
```

#### Footer (`src/components/footer.tsx`)

**Current:**
- "Casual Ultra + NeverDNF + You" branding
- Backdrop blur effects

**New:**
- Simple copyright/links
- Optional: remove blur, use solid background

```tsx
// Simplified footer
<footer className="border-t bg-background py-4">
  <div className="container mx-auto flex justify-between text-sm text-muted-foreground">
    <span>defcon.run 34</span>
    <nav className="space-x-4">
      <Link href="/faq">FAQ</Link>
      <Link href="/credits">Credits</Link>
    </nav>
  </div>
</footer>
```

#### Background

**Current:**
- `BlurPulseBackground.tsx` with animated bunny tiles
- Used on login and dashboard pages

**New:**
- Solid background color from theme
- Optional: subtle gradient or single static pattern

```tsx
// Before
<BlurPulseBackground />

// After
// Just use bg-background, no component needed
```

### Files to Delete

| File | Reason |
|------|--------|
| `src/components/text-effects/RainbowText.tsx` | Decorative effect |
| `src/components/text-effects/GlitchLabel.tsx` | Decorative effect |
| `src/components/BlurPulseBackground.tsx` | Animated background |
| `src/components/header/logo-icon.tsx` | Bunny logo |
| `public/header/Bunny-*.svg` | Bunny assets |
| `public/logo/Bunny-*.svg` | Bunny assets |

### Files to Modify

| File | Changes |
|------|---------|
| `tailwind.config.js` | Remove glitch/blurPulse keyframes, simplify safelist |
| `src/components/primitives.ts` | Remove gradient variants or simplify to solid colors |
| `src/components/header/header.tsx` | Replace logo, simplify nav styling |
| `src/components/footer.tsx` | Simplify layout and copy |
| `src/components/theme-switch.tsx` | Remove fire mode easter egg |
| `src/app/(protected)/dashboard/page.tsx` | Remove RainbowText, BlurPulseBackground |
| `src/app/(public)/page.tsx` | Remove BlurPulseBackground |

### HeroUI Theme Configuration

Create explicit theme in `providers.tsx` or `tailwind.config.js`:

```tsx
// src/app/providers.tsx
<HeroUIProvider
  themes={{
    light: {
      colors: {
        background: "#ffffff",
        foreground: "#0f172a",
        primary: { DEFAULT: "#2563eb", foreground: "#ffffff" },
      }
    },
    dark: {
      colors: {
        background: "#09090b",
        foreground: "#fafafa",
        primary: { DEFAULT: "#3b82f6", foreground: "#ffffff" },
      }
    }
  }}
>
```

### Responsive Behavior (Preserved)

The current responsive patterns are good - keep them:

- Desktop: Full header with nav items visible
- Mobile (<sm): Hamburger menu, collapsed footer
- Max-width container: 900px (already set)
- Breakpoint usage via Tailwind `sm:`, `md:`, `lg:`

### Testing Considerations

After implementation, verify:
1. Light mode renders correctly
2. Dark mode renders correctly
3. Mobile responsive works (hamburger menu)
4. All navigation links function
5. Theme toggle switches properly
6. No console errors from removed components
7. Page performance (should improve with removed animations)

Can use Playwright or browser DevTools to validate:
- Color contrast ratios (WCAG AA)
- Layout at various breakpoints
- Theme persistence across navigation

## Migration Path for run.auth

Once run.human theme is finalized:

1. Extract shared theme config to a package or copy
2. Apply same `tailwind.config.js` simplifications
3. Use same header/footer patterns (run.auth has fewer pages)
4. run.auth pages: Login, Strava sync, profile reading pages

The minimal style naturally fits run.auth's limited scope.

## Decisions to Confirm

Before implementation:

1. **Logo**: Text wordmark "defcon.run" or design a simple icon?
2. **Accent color**: Keep HeroUI blue or choose another (e.g., emerald, indigo)?
3. **Footer content**: What text/links to show?
4. **Complete removal vs archive**: Delete bunny assets or keep in repo?

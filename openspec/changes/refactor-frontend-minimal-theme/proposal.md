# Change: Refactor Frontend to Minimal Professional Theme

## Why
The current UI features playful DEF CON-themed elements (rainbow text, bunny mascots, glitch effects, animated backgrounds) that don't align with the goal of a clean, professional application. A minimal enterprise-style theme will improve readability, reduce visual distraction, and create a consistent experience across run.human and run.auth while maintaining brand identity.

## What Changes

### Remove Playful Elements
- **REMOVE** Rainbow text component (`RainbowText.tsx`) and usage
- **REMOVE** Glitch text effect component (`GlitchLabel.tsx`) and animations
- **REMOVE** Blur pulse animated background (`BlurPulseBackground.tsx`)
- **REMOVE** Fire mode / Matrix mode easter eggs
- **REMOVE** Bunny mascot imagery from headers and backgrounds
- **REMOVE** Gradient color variants from primitives.ts

### Add Professional Theme System
- **NEW** Clean color palette with primary accent (slate/zinc base, subtle accent color)
- **NEW** Consistent dark/light mode with proper HeroUI theme tokens
- **UPDATED** Typography system using existing fonts (Inter, Atkinson Hyperlegible) without decorative effects
- **UPDATED** Header with simpler navigation, professional logo placeholder
- **UPDATED** Footer with cleaner layout

### Preserve Working Patterns
- **KEEP** Responsive header/footer collapse behavior
- **KEEP** HeroUI component library and Tailwind 4
- **KEEP** Current layout structure (max-width containers, flex layouts)
- **KEEP** Theme toggle (dark/light mode)
- **KEEP** Mobile hamburger menu pattern

## Design Principles

1. **Minimal**: Remove decorative elements that don't serve function
2. **Professional**: Enterprise-app aesthetic, clean lines, readable typography
3. **Consistent**: Same patterns apply to run.human and run.auth
4. **Accessible**: High contrast, readable fonts (keep Atkinson Hyperlegible)
5. **Maintainable**: Fewer custom components, more HeroUI defaults

## Impact

- **Affected specs**: None (UI/styling only, no functional changes)
- **Affected code**:
  - `apps/run.human/webapp/src/components/` - Remove effects, update header/footer
  - `apps/run.human/webapp/src/styles/globals.css` - Add theme variables
  - `apps/run.human/webapp/tailwind.config.js` - Remove animations, simplify safelist
  - `apps/run.human/webapp/src/components/primitives.ts` - Simplify or remove gradients
  - `apps/run.human/webapp/public/` - Replace bunny assets with professional logo
- **Future extension**: Same theme applied to run.auth

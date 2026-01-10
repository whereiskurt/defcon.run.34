# Change: Refactor run.auth Frontend to Minimal Professional Theme

## Why
The run.auth UI features playful DEF CON-themed elements (rainbow text on form labels, glitch effects, animated bunny backgrounds) that don't align with the goal of a clean, professional authentication experience. A minimal enterprise-style theme will improve usability and create consistency with the already-updated run.human application.

## What Changes

### Remove Playful Elements
- **REMOVE** RainbowText component and usage on form labels
- **REMOVE** GlitchLabel component and usage on invite code field
- **REMOVE** BlurPulseBackground animated bunny tiles
- **REMOVE** Fire mode / Matrix mode easter eggs from theme switch
- **REMOVE** Bunny SVG assets from public/logo/
- **REMOVE** Custom glitch/blurPulse animations from Tailwind config

### Update Components
- **UPDATE** Login page to use plain labels and HeroUI semantic colors
- **UPDATE** Dashboard page to remove rainbow text
- **UPDATE** Cards to use `bg-content1` instead of hardcoded conditional colors
- **UPDATE** Verify page styling for consistency

### Preserve Working Patterns
- **KEEP** HeroUI component library and Tailwind
- **KEEP** Dark/light mode toggle (simplified)
- **KEEP** Form validation and CAPTCHA integration
- **KEEP** OAuth provider buttons (Discord, GitHub)

## Impact
- **Affected specs**: None (UI/styling only)
- **Affected code**:
  - `apps/run.auth/webapp/src/components/` - Remove decorative components
  - `apps/run.auth/webapp/src/app/(authlogin)/` - Update pages
  - `apps/run.auth/webapp/tailwind.config.js` - Remove animations
  - `apps/run.auth/webapp/public/logo/` - Remove bunny assets

# Tasks: Refactor Frontend to Minimal Professional Theme

## 1. Remove Decorative Components

- [x] 1.1 Delete `src/components/text-effects/RainbowText.tsx`
- [x] 1.2 Delete `src/components/text-effects/GlitchLabel.tsx`
- [x] 1.3 Delete `src/components/BlurPulseBackground.tsx`
- [x] 1.4 Delete `src/components/header/logo-icon.tsx`
- [x] 1.5 Remove bunny SVG assets from `public/header/` and `public/logo/`
- [x] 1.6 Update any component index files that export deleted components

## 2. Clean Up Tailwind Configuration

- [x] 2.1 Remove `glitch-1` and `glitch-2` keyframe animations from `tailwind.config.js`
- [x] 2.2 Remove `blurPulse` keyframe animation
- [x] 2.3 Simplify or remove the color safelist (red, orange, yellow, green, blue, indigo, purple)
- [x] 2.4 Verify HeroUI plugin configuration is correct

## 3. Simplify Typography and Primitives

- [x] 3.1 Update `src/components/primitives.ts` - remove gradient variants
- [x] 3.2 Review `src/components/text-effects/Common.tsx` - keep Heading/Text, remove decorative usage
- [x] 3.3 Remove Museo font if not needed (update `src/config/fonts.ts`)

## 4. Update Header Component

- [x] 4.1 Replace bunny logo with text wordmark "defcon.run" in `src/components/header/header.tsx`
- [x] 4.2 Simplify navigation link styling (remove any gradient/color effects)
- [x] 4.3 Update `src/components/header/dropdown-menu.tsx` to use simpler styling
- [x] 4.4 Ensure mobile hamburger menu still functions correctly

## 5. Update Footer Component

- [x] 5.1 Simplify `src/components/footer.tsx` layout and content
- [x] 5.2 Remove or simplify backdrop blur effects
- [x] 5.3 Update footer copy as needed

## 6. Update Theme Switch

- [x] 6.1 Remove fire mode / matrix mode easter egg from `src/components/theme-switch.tsx`
- [x] 6.2 Keep simple sun/moon toggle functionality

## 7. Update Page Components

- [x] 7.1 Update `src/app/(protected)/dashboard/page.tsx` - remove RainbowText and BlurPulseBackground
- [x] 7.2 Update `src/app/(public)/page.tsx` (login page) - remove BlurPulseBackground
- [x] 7.3 Search for and update any other pages using removed components
- [x] 7.4 Replace decorative headings with plain text headings

## 8. Configure Theme Properly

- [x] 8.1 Review/update `src/app/providers.tsx` HeroUI theme configuration
- [x] 8.2 Ensure dark/light mode works correctly with new styling
- [x] 8.3 Update `src/styles/globals.css` if needed for base styles

## 9. Testing and Validation

- [x] 9.1 Run `npm run dev` and verify no import errors
- [x] 9.2 Test light mode appearance
- [x] 9.3 Test dark mode appearance
- [x] 9.4 Test mobile responsive behavior (header collapse, hamburger menu)
- [x] 9.5 Test all navigation links work
- [x] 9.6 Run `npm run lint` and fix any issues
- [x] 9.7 Run `npm run build` to ensure production build succeeds

## 10. Documentation

- [x] 10.1 Update any component documentation if present
- [x] 10.2 Note any theme customization patterns for run.auth migration

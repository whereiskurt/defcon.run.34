# Tasks: Refactor Frontend to Minimal Professional Theme

## 1. Remove Decorative Components

- [ ] 1.1 Delete `src/components/text-effects/RainbowText.tsx`
- [ ] 1.2 Delete `src/components/text-effects/GlitchLabel.tsx`
- [ ] 1.3 Delete `src/components/BlurPulseBackground.tsx`
- [ ] 1.4 Delete `src/components/header/logo-icon.tsx`
- [ ] 1.5 Remove bunny SVG assets from `public/header/` and `public/logo/`
- [ ] 1.6 Update any component index files that export deleted components

## 2. Clean Up Tailwind Configuration

- [ ] 2.1 Remove `glitch-1` and `glitch-2` keyframe animations from `tailwind.config.js`
- [ ] 2.2 Remove `blurPulse` keyframe animation
- [ ] 2.3 Simplify or remove the color safelist (red, orange, yellow, green, blue, indigo, purple)
- [ ] 2.4 Verify HeroUI plugin configuration is correct

## 3. Simplify Typography and Primitives

- [ ] 3.1 Update `src/components/primitives.ts` - remove gradient variants
- [ ] 3.2 Review `src/components/text-effects/Common.tsx` - keep Heading/Text, remove decorative usage
- [ ] 3.3 Remove Museo font if not needed (update `src/config/fonts.ts`)

## 4. Update Header Component

- [ ] 4.1 Replace bunny logo with text wordmark "defcon.run" in `src/components/header/header.tsx`
- [ ] 4.2 Simplify navigation link styling (remove any gradient/color effects)
- [ ] 4.3 Update `src/components/header/dropdown-menu.tsx` to use simpler styling
- [ ] 4.4 Ensure mobile hamburger menu still functions correctly

## 5. Update Footer Component

- [ ] 5.1 Simplify `src/components/footer.tsx` layout and content
- [ ] 5.2 Remove or simplify backdrop blur effects
- [ ] 5.3 Update footer copy as needed

## 6. Update Theme Switch

- [ ] 6.1 Remove fire mode / matrix mode easter egg from `src/components/theme-switch.tsx`
- [ ] 6.2 Keep simple sun/moon toggle functionality

## 7. Update Page Components

- [ ] 7.1 Update `src/app/(protected)/dashboard/page.tsx` - remove RainbowText and BlurPulseBackground
- [ ] 7.2 Update `src/app/(public)/page.tsx` (login page) - remove BlurPulseBackground
- [ ] 7.3 Search for and update any other pages using removed components
- [ ] 7.4 Replace decorative headings with plain text headings

## 8. Configure Theme Properly

- [ ] 8.1 Review/update `src/app/providers.tsx` HeroUI theme configuration
- [ ] 8.2 Ensure dark/light mode works correctly with new styling
- [ ] 8.3 Update `src/styles/globals.css` if needed for base styles

## 9. Testing and Validation

- [ ] 9.1 Run `npm run dev` and verify no import errors
- [ ] 9.2 Test light mode appearance
- [ ] 9.3 Test dark mode appearance
- [ ] 9.4 Test mobile responsive behavior (header collapse, hamburger menu)
- [ ] 9.5 Test all navigation links work
- [ ] 9.6 Run `npm run lint` and fix any issues
- [ ] 9.7 Run `npm run build` to ensure production build succeeds

## 10. Documentation

- [ ] 10.1 Update any component documentation if present
- [ ] 10.2 Note any theme customization patterns for run.auth migration

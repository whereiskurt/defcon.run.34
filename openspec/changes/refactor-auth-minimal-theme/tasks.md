# Tasks: Refactor run.auth Frontend to Minimal Professional Theme

## 1. Remove Decorative Components
- [ ] 1.1 Delete `src/components/RainbowText.tsx`
- [ ] 1.2 Delete `src/components/GlitchLabel.tsx`
- [ ] 1.3 Delete `src/components/BlurPulseBackground.tsx`
- [ ] 1.4 Remove bunny SVG assets from `public/logo/`

## 2. Clean Up Tailwind Configuration
- [ ] 2.1 Remove `glitch-1` and `glitch-2` keyframe animations
- [ ] 2.2 Remove `blurPulse` keyframe animation
- [ ] 2.3 Remove rainbow color safelist

## 3. Update Theme Switch
- [ ] 3.1 Remove fire mode / matrix mode easter egg
- [ ] 3.2 Keep simple sun/moon toggle

## 4. Update Login Page
- [ ] 4.1 Remove RainbowText from email label
- [ ] 4.2 Remove GlitchLabel from invite code field
- [ ] 4.3 Remove BlurPulseBackground
- [ ] 4.4 Use HeroUI semantic colors for cards (`bg-content1`)
- [ ] 4.5 Simplify heading to plain text

## 5. Update Dashboard Page
- [ ] 5.1 Remove RainbowText from "Session" heading
- [ ] 5.2 Remove BlurPulseBackground
- [ ] 5.3 Use semantic colors for cards

## 6. Update Verify Page
- [ ] 6.1 Ensure consistent styling with other pages

## 7. Testing and Validation
- [ ] 7.1 Test dark mode appearance
- [ ] 7.2 Test light mode appearance
- [ ] 7.3 Run lint and build

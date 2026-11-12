# Triply — Premium UI/UX Redesign Plan & Instructions

> **SUPERSEDED (2026-11-13):** the brand stays **Fixli** (owner decision O4 default; all logos, app config and docs 00–22 use Fixli). Do NOT rename anything to Triply. Keep this file only for its UI/UX guidance.

> **Context:** The project has been rebranded from *Fixli* to **Triply**. This document outlines the absolute highest-tier UI/UX requirements for Triply, inspired by Apple's Human Interface Guidelines, and serves as a direct instruction manual for any AI or developer continuing the work.

---

## 1. Brand Identity & Rebranding
**Project Name:** Triply (formerly Fixli)
**Mission:** A premium, hyper-efficient marketplace. The app must feel like a native Apple flagship application—calm, robust, and flawlessly smooth.

### Immediate Rebranding Steps Required
1. **Name Replacement:** Replace all user-facing instances of "Fixli" with "Triply" (App.tsx, index.html, i18n/index.ts, etc.).
2. **Icons & Splash:** 
   - Extract the new logo and icon files provided by the design team.
   - Use `expo-splash-screen` to create a seamless, non-flickering transition from the OS boot screen to the first React component.
   - The splash screen background should perfectly match the app's `background` token (`#F2F2F7` for light, `#0A1228` for dark).
   - Centered `Triply` logo mark (no text below it for maximum minimalism).

---

## 2. The "Apple-Like" Premium Design System

To achieve the "Apple design" look, the following principles are strictly enforced across the codebase:

### 2.1 Visual Language
- **Light-Mode First:** iOS natively defaults to a clean, grouped light mode. The app must use soft grey backgrounds (`#F2F2F7`) and pure white cards (`#FFFFFF`) to create depth, avoiding harsh borders.
- **Frosted Glass (Material):** Use `expo-blur` heavily for the Tab Bar, sticky headers, and bottom sheets. The UI should feel like layers of glass, not flat color blocks.
- **Typography:** Rely on `Inter` (or system SF Pro). Use **Large Titles** (34pt, bold) for top-level navigation, and 17pt for body text. **Never** use font sizes below 15pt for readable content.
- **Micro-interactions:** Every button press must have a scale down animation (`transform: scale(0.97)`) using `react-native-reanimated` and a subtle haptic feedback tap (`expo-haptics`).

### 2.2 Component Specifications
- **Grouped Lists:** Settings and forms must use iOS-style inset-grouped lists (rounded corners, white background, hairline separators). 
- **Modals & Sheets:** Never use full-screen navigation pushes for transient tasks (e.g., "Add Address" or "Filter"). Use `@gorhom/bottom-sheet` with a spring configuration that matches iOS (`damping: 20`, `stiffness: 250`).
- **Icons:** Use thin, outline-style vectors (e.g., `Ionicons` outline variants or `Lucide`). Only fill icons when they represent the active state (e.g., active tab).

---

## 3. UI/UX Implementation Instructions for AI/Developers

If you are an agent tasked with continuing the Triply development, follow this exact sequence:

### Phase A: Asset Integration & Renaming
1. Overwrite `apps/mobile/assets/images/icon.png`, `splash.png`, and `adaptive-icon.png` with the new Triply assets.
2. Run a global search and replace in `apps/mobile/app.json`, `package.json`, and `apps/web/index.html` to change "Fixli" to "Triply".
3. Update `apps/mobile/src/i18n/index.ts` to reflect the new app name in English, Arabic, and Urdu.

### Phase B: Splash Screen & Boot Sequence
1. Configure `app.json` for the new splash screen:
   ```json
   "splash": {
     "image": "./assets/images/splash.png",
     "resizeMode": "contain",
     "backgroundColor": "#F2F2F7",
     "dark": {
       "image": "./assets/images/splash-dark.png",
       "backgroundColor": "#0A1228"
     }
   }
   ```
2. Ensure `SplashScreen.preventAutoHideAsync()` is called before routing, and only hidden *after* fonts, translations, and auth state are fully resolved to prevent UI pop-in.

### Phase C: Premium Polish
1. Audit all screens and ensure `useTheme()` is dictating all colors.
2. Replace all basic `Alert.alert()` calls with custom Apple-style Toast notifications or Bottom Sheets.
3. Verify that the Smart-Forms (`VoiceField`) scale correctly on small devices and support VoiceOver (Accessibility labels).

---

## 4. End-State Vision

When Triply is complete, a user opening the app will:
1. See a perfectly smooth splash screen that fades into a Glassmorphism Tab Bar.
2. Be greeted by large, legible typography and high-contrast, rounded cards.
3. Be able to book a service using voice or a photo with zero typing.
4. Feel a haptic click confirming every major action.

> **Save this document to context before continuing any UI development.**

import preset from '@healthy-aahar/config/tailwind';
import type { Config } from 'tailwindcss';

export default {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Overrides the preset's font-family *values* only (still the same
      // typefaces the design tokens specify) with next/font's generated CSS
      // variables, so this app's fonts are actually loaded/optimized rather
      // than falling back to the system font the token name never resolves
      // to on its own (apps/marketing/src/app/layout.tsx).
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
} satisfies Config;

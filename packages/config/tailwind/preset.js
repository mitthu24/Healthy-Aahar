import colors from '../tokens/colors.json' with { type: 'json' };
import spacing from '../tokens/spacing.json' with { type: 'json' };
import radius from '../tokens/radius.json' with { type: 'json' };
import elevation from '../tokens/elevation.json' with { type: 'json' };
import typography from '../tokens/typography.json' with { type: 'json' };
import motion from '../tokens/motion.json' with { type: 'json' };

const fontSize = Object.fromEntries(
  Object.entries(typography.scale).map(([name, v]) => [
    name,
    [v.size, { lineHeight: v.lineHeight, fontWeight: String(v.weight) }],
  ]),
);

/**
 * Shared Tailwind preset generated from the design tokens.
 *
 * Components must never hard-code a hex value — the token file is the single
 * source of truth (docs/17-DESIGN-SYSTEM.md section 10).
 */
export const healthyAaharPreset = {
  theme: {
    extend: {
      colors,
      spacing,
      borderRadius: radius,
      boxShadow: elevation,
      fontFamily: {
        display: typography.fontFamily.display,
        body: typography.fontFamily.body,
        sans: typography.fontFamily.body,
      },
      fontSize,
      transitionDuration: motion.duration,
      transitionTimingFunction: motion.easing,
    },
  },
};

export default healthyAaharPreset;

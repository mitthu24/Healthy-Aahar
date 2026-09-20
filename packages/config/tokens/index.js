import colors from './colors.json' with { type: 'json' };
import typography from './typography.json' with { type: 'json' };
import spacing from './spacing.json' with { type: 'json' };
import radius from './radius.json' with { type: 'json' };
import elevation from './elevation.json' with { type: 'json' };
import motion from './motion.json' with { type: 'json' };

export { colors, typography, spacing, radius, elevation, motion };
export const tokens = { colors, typography, spacing, radius, elevation, motion };
export default tokens;

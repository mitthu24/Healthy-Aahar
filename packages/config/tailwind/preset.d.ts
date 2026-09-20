import type { Config } from 'tailwindcss';

/**
 * The preset is authored in JavaScript so it can be consumed by Tailwind's
 * own config loader without a build step. This declaration gives TypeScript
 * consumers the precise type, rather than the widened shape it would infer
 * from the JSON token files.
 */
declare const healthyAaharPreset: Partial<Config>;

export { healthyAaharPreset };
export default healthyAaharPreset;

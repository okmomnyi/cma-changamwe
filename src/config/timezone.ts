/**
 * Imported first, before anything that reads the clock. A bare
 * `process.env.TZ ??=` in an entry file does not run first: ES modules evaluate
 * every import before the body. Nothing currently depends on it, since Luxon
 * gets an explicit zone and the pool sets `-c timezone`.
 */
process.env.TZ ??= 'Africa/Nairobi';
export const TZ = process.env.TZ;

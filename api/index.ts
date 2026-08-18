import { createApp } from '../src/app.js';
process.env.TZ ??= 'Africa/Nairobi';
const app = createApp();
export default app;

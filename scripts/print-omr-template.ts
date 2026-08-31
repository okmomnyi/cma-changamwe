import { ROWS_PER_PAGE, templateDescriptor } from '../src/omr/template.js';

/**
 * The sheet geometry, as the detection service receives it.
 *
 * The service is stateless about layout, so calibrating against real
 * photographs needs the same descriptor the API would send. This prints one
 * for a full page:
 *
 *   npm run omr:template > omr/template.json
 */
process.stdout.write(`${JSON.stringify(templateDescriptor(ROWS_PER_PAGE), null, 2)}\n`);

import 'server-only';

import { parseServerEnvironment, type ServerEnvironment } from './server-schema.ts';

/**
 * Server-side configuration. The `server-only` import makes Next.js fail the
 * build if a Client Component ever imports this module.
 */
export const serverEnv: ServerEnvironment = parseServerEnvironment(process.env);

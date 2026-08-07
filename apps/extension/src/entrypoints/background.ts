import { SCHEMA_VERSION } from '@vigie/contract';

/**
 * Service worker. Orchestration only — capture layers register here from phase 4 onward.
 *
 * MV3 terminates it after roughly 30 seconds idle and drops every global, so nothing durable
 * may live in this module scope. Listener registration has to stay top-level: it is what makes
 * the browser wake the worker back up.
 */
export default defineBackground(() => {
  console.info('[vigie] service worker started, contract schema v%d', SCHEMA_VERSION);
});

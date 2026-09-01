// Secrets set via `wrangler secret put` — not present in wrangler.jsonc,
// so `wrangler types` can't see them. Declared here to extend the
// generated global `Env` interface from worker-configuration.d.ts.
interface Env {
  APP_PATTERN: string;
  SESSION_SECRET: string;
  SUPERUSER_PASSWORD: string;
}

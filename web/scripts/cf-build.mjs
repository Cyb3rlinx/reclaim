// Builds the Cloudflare bundle WITHOUT local .env files, so no secret gets baked into the
// worker code. Secrets are set separately with `wrangler secret put` (see scripts/cf-secrets.mjs).
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";

const files = [".env", ".env.local", ".env.production", ".env.production.local"].filter((f) => existsSync(f));
for (const f of files) renameSync(f, `${f}.cf-hidden`);
try {
  execSync("npx opennextjs-cloudflare build", { stdio: "inherit" });
} finally {
  for (const f of files) renameSync(`${f}.cf-hidden`, f);
}

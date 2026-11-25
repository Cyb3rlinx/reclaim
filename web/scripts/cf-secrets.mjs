// Copies the server-side settings from .env.local into Cloudflare Worker secrets,
// piping each value through stdin so it is never printed or written elsewhere.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEYS = ["BSC_TESTNET_RPC", "AGENT_PRIVATE_KEY", "ORACLE_PRIVATE_KEY", "TOURIST_DEMO_PRIVATE_KEY", "ANTHROPIC_API_KEY", "CMC_API_KEY"];
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
for (const k of KEYS) {
  if (!env[k]) {
    console.log(`skip ${k} (not set in .env.local)`);
    continue;
  }
  execSync(`npx wrangler secret put ${k}`, { input: env[k], stdio: ["pipe", "ignore", "inherit"] });
  console.log(`set ${k}`);
}

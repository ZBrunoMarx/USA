import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
const env = {...process.env, SKYTILE_CHROMIUM: process.env.SKYTILE_CHROMIUM || chromium.executablePath()};
for (const script of ['test-job-workspace-browser.mjs','test-admin-setup.mjs']) {
  const result = spawnSync(process.execPath,[new URL(script,import.meta.url).pathname],{env,stdio:'inherit',timeout:150000});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

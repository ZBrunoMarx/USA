import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../scripts/configure-free-cloud.mjs';
test('public free-cloud configuration accepts only Supabase HTTPS and publishable keys', () => {
  assert.deepEqual(validateConfig('https://example.supabase.co', 'sb_publishable_public_test'), { provider: 'supabase', url: 'https://example.supabase.co', publishableKey: 'sb_publishable_public_test', siteOrigin: 'https://zbrunomarx.github.io' });
  for (const url of ['http://example.supabase.co', 'https://example.supabase.co/', 'https://example.supabase.co.evil.test', 'https://example.test', 'https://user:pass@example.supabase.co']) assert.throws(() => validateConfig(url, 'sb_publishable_public_test'));
  for (const key of ['sk-test', 'sb_secret_test', 'eyJhbGciOiJIUzI1NiJ9.service_role', '']) assert.throws(() => validateConfig('https://example.supabase.co', key));
  for (const site of ['http://example.test', 'https://example.test/', 'https://example.test/path', 'https://u:p@example.test']) assert.throws(() => validateConfig('https://example.supabase.co', 'sb_publishable_test', site));
});

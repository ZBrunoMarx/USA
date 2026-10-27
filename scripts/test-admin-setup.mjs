import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(), 'field-report-admin-')), db = new PGlite();
let child, browser;
try {
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'test', PORT: '0', SKYTILE_AUTH: 'demo', SKYTILE_DATA_DIR: dir, SKYTILE_AI_KEY: '', OPENAI_API_KEY: '' } });
  const base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } }); child.once('error', reject); });
  browser = await chromium.launch({ executablePath: process.env.SKYTILE_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/relatorio/configurar.html'); await page.locator('#copy-sql').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), readFileSync(new URL('../deploy/supabase/01-schema.sql', import.meta.url), 'utf8'));
  await page.goto(base + '/relatorio/atualizar.html'); await page.locator('#copy-sql').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), readFileSync(new URL('../deploy/supabase/04-job-workspace.sql', import.meta.url), 'utf8'));
  await page.goto(base + '/relatorio/acesso.html');
  await page.evaluate(() => navigator.clipboard.writeText('UNCHANGED'));
  await page.locator('#copy-sql').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'UNCHANGED');
  const email = "bruno.o'connor@example.test", name = "Bruno $$ 'SEU_EMAIL_AQUI' \\ O'Connor", company = "Example $$; drop schema public cascade; -- $field_report_admin$ \\ & Co's";
  await page.locator('[name=email]').fill(email); await page.locator('[name=displayName]').fill(name); await page.locator('[name=company]').fill(company); await page.locator('#copy-sql').click();
  const sql = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(sql, await page.locator('#setup-sql').inputValue());
  const id = randomUUID();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,email text);
    create table public.fr_companies(id uuid primary key default gen_random_uuid(),name text);
    create table public.fr_members(id uuid primary key,company_id uuid,display_name text,role text);`);
  await db.query('insert into auth.users values($1,$2)', [id, email]);
  await db.exec(sql);
  const member = (await db.query('select * from public.fr_members')).rows[0]; assert.equal(member.id, id); assert.equal(member.display_name, name); assert.equal(member.role, 'admin');
  assert.equal((await db.query('select name from public.fr_companies')).rows[0].name, company);
  assert.equal((await db.query('select count(*)::integer as n from auth.users')).rows[0].n, 1);
  await db.exec(sql); assert.equal((await db.query('select count(*)::integer as n from public.fr_companies')).rows[0].n, 1);
  await page.locator('[name=email]').fill('missing@example.test'); await page.locator('#copy-sql').click();
  const missingSQL = await page.evaluate(() => navigator.clipboard.readText());
  await assert.rejects(() => db.exec(missingSQL), error => error.code === 'P0001' && error.message.includes('Crie primeiro'));
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Clipboard blocked for test'); } }));
  await page.locator('#copy-sql').click(); assert.equal(await page.locator('#sql-details').evaluate(element => element.open), true);
  assert.equal(await page.locator('#setup-sql').evaluate(element => element.selectionEnd - element.selectionStart), missingSQL.length);
  assert.equal(await page.locator('input[type=password]').count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  // Load exact public assets at the intended origin without external network access.
  // This checks origin binding and the real public configuration, not a provider login.
  const publicContext = await browser.newContext({ serviceWorkers: 'block' }), publicPage = await publicContext.newPage(), outbound = [];
  publicPage.on('pageerror', error => errors.push(error.message));
  await publicPage.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://zbrunomarx.github.io') { outbound.push(url.origin); return route.abort(); }
    const name = url.pathname.endsWith('/') ? 'index.html' : url.pathname.split('/').pop();
    const file = new URL('../public/relatorio/' + name, import.meta.url);
    if (!/^[a-z0-9.-]+$/.test(name) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const contentType = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ contentType, body: readFileSync(file) });
  });
  await publicPage.goto('https://zbrunomarx.github.io/USA/relatorio/');
  await publicPage.locator('#cloud-login').waitFor({ state: 'visible' });
  assert.equal(await publicPage.locator('#login-label').innerText(), 'Seu e-mail');
  assert.equal(await publicPage.locator('#cloud-login [name=login]').getAttribute('type'), 'email');
  assert.equal(await publicPage.locator('#cloud-account').isVisible(), false); assert.deepEqual(outbound, []); assert.deepEqual(errors, []);
  console.log('PASS setup: complete schema copied, required fields, native clipboard, SQL escaping and dollar delimiters execute safely in PostgreSQL, idempotent admin bootstrap, missing-user error, fallback selection, no password/storage collection, public-origin email login. Provider writes were not performed.');
} finally {
  await browser?.close(); await db.close();
  if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  rmSync(dir, { recursive: true, force: true });
}

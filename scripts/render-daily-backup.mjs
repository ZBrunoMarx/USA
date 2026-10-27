// Recovery path: render a user's exported report backup with the same template.
// Local assets only; no API, credential, upload server, or generated photo content.
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
if (!process.argv[2] || !process.argv[3]) {
  console.error('Uso: node scripts/render-daily-backup.mjs registro.json video.mp4');
  process.exit(1);
}
const input = resolve(process.argv[2]), output = resolve(process.argv[3]);
if (statSync(input).size > 40 * 1024 * 1024) throw new Error('Cópia maior que 40 MB.');
const backup = JSON.parse(readFileSync(input, 'utf8'));
if (backup.format !== 'field-report-backup' || backup.version !== 1) throw new Error('Formato de cópia inválido.');
const files = { '/relatorio/': ['index.html', 'text/html; charset=utf-8'], '/relatorio/index.html': ['index.html', 'text/html; charset=utf-8'], '/relatorio/report.js': ['report.js', 'text/javascript; charset=utf-8'], '/relatorio/report.css': ['report.css', 'text/css; charset=utf-8'], '/relatorio/sw.js': ['sw.js', 'text/javascript; charset=utf-8'] };
for (const name of ['workspace.js', 'library.js', 'sync.js', 'cloud-config.js', 'supabase-vendor.js', 'supabase-sync.js']) files['/relatorio/' + name] = [name, 'text/javascript; charset=utf-8'];
const server = http.createServer((request, response) => {
  const file = files[new URL(request.url, 'http://localhost').pathname];
  if (request.method !== 'GET' || !file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
  response.end(readFileSync(new URL('../public/relatorio/' + file[0], import.meta.url)));
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.SKYTILE_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ acceptDownloads: true }), page = await context.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/relatorio/');
  await page.waitForFunction(() => !document.querySelector('#report-fields').disabled);
  await page.locator('#restore').setInputFiles(input);
  await page.locator('.photo-tile').first().waitFor();
  if (await page.locator('#export').isDisabled()) throw new Error('Este ambiente de renderização não oferece MP4.');
  await page.locator('#export').click();
  await page.locator('#result').waitFor({ state: 'visible', timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
  mkdirSync(dirname(output), { recursive: true }); await download.saveAs(output);
  const bytes = readFileSync(output);
  if (bytes.length < 1000 || !bytes.subarray(0, 128).includes(Buffer.from('ftyp'))) throw new Error('O arquivo não é um MP4 válido.');
  console.log('MP4 gerado a partir da cópia local: ' + output);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

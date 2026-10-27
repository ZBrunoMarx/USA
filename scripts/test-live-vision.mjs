// Explicit opt-in only. This technical smoke test makes ONE billable API request.
// Its generated image is NOT a real job, and it does not measure visual accuracy.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { deflateSync } from 'node:zlib';

if (!process.argv.includes('--confirm-api-usage')) {
  console.error('Este teste usa a API real e pode gerar cobrança. Execute com --confirm-api-usage.');
  process.exit(1);
}
if (!process.env.SKYTILE_AI_KEY && !process.env.OPENAI_API_KEY) {
  console.error('Configure a chave pelo campo seguro do servidor antes do teste.');
  process.exit(1);
}

// PNG made from geometric color blocks, with no customer files or metadata.
function syntheticImage() {
  const width = 384, height = 256;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (1 + width * 3) + 1 + x * 3;
    const color = x < width / 2 ? [40, 130, 165] : [230, 230, 230];
    pixels.set(color, at);
  }
  const crc32 = buffer => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = mkdtempSync(join(tmpdir(), 'skytile-live-vision-'));
let child;
try {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'test', SKYTILE_AUTH: 'demo', SKYTILE_PUBLIC_ORIGIN: '', SKYTILE_BOOTSTRAP_PASSWORD: '', SKYTILE_HOST: '127.0.0.1', PORT: '0', SKYTILE_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor de teste não iniciou.')), 10000);
    child.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Não foi possível iniciar o teste.')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Servidor de teste encerrou antes de iniciar.')); });
  });
  const request = async (path, body) => {
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Skytile-User': 'thiago' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(75000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha no teste integrado.');
    return data;
  };
  const image = await request('/upload', { name: 'TESTE-ARTIFICIAL-sem-obra.png', type: 'image/png', data: syntheticImage().toString('base64') });
  const job = await request('/jobs', { name: 'TESTE TÉCNICO — não é uma obra', address: 'Sem endereço real', rooms: [{ name: 'Ambiente de teste', services: ['Tile no piso'] }] });
  const record = await request(`/jobs/${job.id}/entries`, { roomId: job.rooms[0].id, service: 'Tile no piso', phase: 'update', progress: 'review', note: 'Imagem artificial com blocos de cor para testar integração. Não representa obra nem permite confirmar instalação, avanço ou conclusão.', photos: [image] });
  const { analysis } = await request(`/jobs/${job.id}/entries/${record.createdEntryId}/analyze`, {});
  assert.equal(analysis.status, 'complete'); assert.equal(analysis.provider, 'OpenAI'); assert.equal(analysis.basis, 'current_only');
  assert.equal(analysis.currentPhotos.length, 1); assert.equal(analysis.referencePhotos.length, 0);
  const saved = (await request('/state')).jobs.find(item => item.id === job.id).entries.find(item => item.id === record.createdEntryId);
  assert.equal(saved.progress, 'review'); assert.equal(saved.photos.length, 1);
  console.log(JSON.stringify({ result: 'passed', provider: analysis.provider, model: analysis.model, image: 'synthetic', analysisStatus: analysis.status, reportedProgressPreserved: true, accuracyValidated: false, storage: 'isolated temporary directory, removed after test' }));
} catch (error) {
  // Server errors are curated by the application; no raw provider response is logged.
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  rmSync(dir, { recursive: true, force: true });
}

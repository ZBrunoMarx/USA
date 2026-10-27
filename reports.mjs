import { createHash } from 'node:crypto';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const identifier = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const limits = { title: 70, date: 10, author: 45, scope: 90, language: 2, percent: 3, company: 55, completed: 220, remaining: 220 };
export function createReportStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS field_reports (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS field_report_images (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS report_job ON field_reports(job_id);`);
  const read = id => { const row = db.prepare('SELECT * FROM field_reports WHERE id=?').get(id); return row ? { ...JSON.parse(row.payload), id: row.id, jobId: row.job_id, ownerId: row.owner_id, revision: row.revision, updatedAt: row.updated_at } : null; };
  const visible = (report, state) => report && state.jobs.some(job => job.id === report.jobId);
  const subscribers = new Set();
  const event = (client, name, data) => client.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const notify = report => { for (const client of subscribers) { if (client.valid()) event(client, 'change', { id: report.id, revision: report.revision }); else client.res.end(); } };
  function fields(input) {
    if (!input || typeof input !== 'object') fail('Informe os dados do relatório.');
    const result = {};
    for (const [name, max] of Object.entries(limits)) { if (typeof input[name] !== 'string' || input[name].length > max) fail('Campo inválido: ' + name); result[name] = input[name].trim(); }
    if (!result.title) fail('Informe o nome do serviço.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0, 10) !== result.date) fail('Data inválida.');
    if (!['en', 'pt'].includes(result.language)) fail('Idioma inválido.');
    if (result.percent !== '' && (!/^\d{1,3}$/.test(result.percent) || Number(result.percent) > 100)) fail('Percentual inválido.');
    return result;
  }
  function imageRef(item, user, previousRefs) {
    if (!item || !identifier(item.id) || typeof item.imageId !== 'string' || !/^[a-f0-9]{64}$/.test(item.imageId)) fail('Foto inválida.');
    const image = db.prepare('SELECT id,owner_id FROM field_report_images WHERE id=?').get(item.imageId);
    if (!image || (image.owner_id !== user.id && user.role !== 'admin' && !previousRefs.has(item.imageId))) fail('Envie a foto antes de salvar o relatório.');
    return { id: item.id, imageId: item.imageId, name: String(item.name || 'Foto').slice(0, 120) };
  }
  return {
    list(state, user) {
      return db.prepare('SELECT id FROM field_reports ORDER BY updated_at DESC').all().map(row => read(row.id)).filter(report => visible(report, state)).map(report => ({ id: report.id, jobId: report.jobId, ownerId: report.ownerId, revision: report.revision, updatedAt: report.updatedAt, status: report.status, fields: report.fields, photoCount: Object.values(report.photos).reduce((sum, list) => sum + list.length, 0), canEdit: user.role === 'admin' || user.id === report.ownerId }));
    },
    get(id, state, user) { const report = read(id); if (!visible(report, state)) fail('Relatório não encontrado.', 404); return { ...report, canEdit: user.role === 'admin' || user.id === report.ownerId }; },
    image(id, user, state) {
      const image = db.prepare('SELECT * FROM field_report_images WHERE id=?').get(id);
      if (!image) fail('Foto não encontrada.', 404);
      const attached = db.prepare('SELECT id FROM field_reports').all().some(row => { const report = read(row.id); return visible(report, state) && [...Object.values(report.photos).flat(), report.logo].some(item => item?.imageId === id); });
      if (image.owner_id !== user.id && !attached) fail('Foto não disponível.', 403);
      return image;
    },
    upload(input, user) {
      if (!['image/jpeg', 'image/png'].includes(input.type) || typeof input.data !== 'string' || input.data.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) fail('Envie uma imagem JPG ou PNG de até 3 MB.');
      const bytes = Buffer.from(input.data, 'base64');
      const correct = input.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!correct || !bytes.length || bytes.length > 3 * 1024 * 1024) fail('Imagem inválida.');
      // Scope hashes to the uploader; another user cannot claim unpublished images by guessing a hash.
      const id = createHash('sha256').update(user.id + ':' + input.type + ':').update(bytes).digest('hex');
      db.prepare('INSERT OR IGNORE INTO field_report_images VALUES(?,?,?,?,?)').run(id, user.id, input.type, bytes, new Date().toISOString());
      return { imageId: id };
    },
    put(id, input, state, user) {
      if (!identifier(id) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('Revisão inválida.');
      const previous = read(id);
      if (previous && !visible(previous, state)) fail('Relatório não encontrado.', 404);
      if (previous && previous.ownerId !== user.id && user.role !== 'admin') fail('Você pode editar somente seus próprios relatórios.', 403);
      if ((previous?.revision || 0) !== input.expectedRevision) fail('Outra pessoa atualizou este relatório. Sua cópia local foi preservada. Abra a versão do servidor antes de continuar.', 409);
      const job = state.jobs.find(job => job.id === input.jobId);
      if (!job || (previous && input.jobId !== previous.jobId)) fail('Selecione uma obra existente.');
      if (!['active', 'archived'].includes(input.status)) fail('Status inválido.');
      if (job.status === 'delivered' && input.status !== 'archived') fail('Peça ao administrador para reabrir a obra antes de publicar novas atualizações.');
      const data = fields(input.fields), oldRefs = new Set(previous ? [...Object.values(previous.photos).flat(), previous.logo].filter(Boolean).map(item => item.imageId) : []);
      const photos = {};
      for (const key of ['before', 'after', 'pending']) { if (!Array.isArray(input.photos?.[key]) || input.photos[key].length > 4) fail('Envie até 4 fotos por etapa.'); photos[key] = input.photos[key].map(item => imageRef(item, user, oldRefs)); }
      const logo = input.logo ? imageRef(input.logo, user, oldRefs) : null;
      const ids = [...Object.values(photos).flat(), logo].filter(Boolean).map(item => item.id);
      if (new Set(ids).size !== ids.length) fail('Fotos duplicadas no relatório.');
      const payload = { fields: data, photos, logo, status: input.status }, updatedAt = new Date().toISOString(), revision = input.expectedRevision + 1;
      db.prepare('INSERT INTO field_reports VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,payload=excluded.payload').run(id, job.id, previous?.ownerId || user.id, revision, updatedAt, JSON.stringify(payload));
      const result = this.get(id, state, user); notify(result); return result;
    },
    subscribe(req, res, user, valid) {
      if ([...subscribers].filter(client => client.userId === user.id).length >= 6) fail('Há muitas abas abertas. Feche uma e tente novamente.', 429);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const client = { res, userId: user.id, valid }; subscribers.add(client); event(client, 'connected', { ok: true });
      const timer = setInterval(() => { if (!valid()) { res.end(); return; } res.write(': heartbeat\n\n'); }, 10000); timer.unref();
      res.on('close', () => { clearInterval(timer); subscribers.delete(client); });
    },
    close() { for (const client of subscribers) client.res.end(); subscribers.clear(); },
  };
}

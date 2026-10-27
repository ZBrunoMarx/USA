import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createVision, prepareEvidence } from './vision.mjs';
import { createAuth } from './auth.mjs';
import { createReportStore } from './reports.mjs';
const vision = createVision();
const visionRequests = new Map();
import './public/progress.js';
import './public/team.js';
import './public/finance.js';
import './public/assistant.js';
const finance = globalThis.SkytileFinance;
const { jobProgress, completionScope } = globalThis.SkytileProgress;
const { defaultUsers, migrateTeam, validateProfile, nextCode, validateAssignment } = globalThis.SkytileTeam;

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = process.env.SKYTILE_DATA_DIR || join(root, '.local');
if (process.env.NODE_ENV === 'production' && !process.env.SKYTILE_DATA_DIR) throw new Error('Configure SKYTILE_DATA_DIR em um volume persistente para publicar.');
mkdirSync(join(dataDir, 'uploads'), { recursive: true });
const db = new DatabaseSync(join(dataDir, 'skytile.sqlite'));
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
`);
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const now = () => new Date().toISOString();
const users = defaultUsers();
function seed() {
  return { users, jobs: [
    { id: 'demo-manhattan', name: 'Apartamento · Manhattan', address: 'Manhattan, NY · endereço de demonstração', description: 'Preparação da sala e instalação de cerâmica nos banheiros.', status: 'active', createdAt: now(), deliveredAt: null, plan: null, cover: null, demo: true,
      rooms: [
        { id: 'sala', name: 'Sala principal', services: ['Self-level', 'Tile no piso'], region: null },
        { id: 'banheiro-1', name: 'Banheiro 01', services: ['Tile na parede', 'Tile no piso', 'Rejunte'], region: null },
        { id: 'banheiro-2', name: 'Banheiro 02', services: ['Tile na parede', 'Rejunte'], region: null },
      ], assignments: [], events: [{ id: randomUUID(), type: 'created', at: now(), author: 'Thiago', note: 'Obra de exemplo criada para explorar a plataforma.' }], entries: [
        { id: 'demo-entry-1', roomId: 'sala', service: 'Self-level', phase: 'end', date: day(), at: now(), authorId: 'diego', author: 'Diego', note: 'Aplicação inicial registrada. Aguardar avaliação da base antes de liberar a próxima etapa.', progress: 'review', photos: [], audio: null, demo: true },
        { id: 'demo-entry-2', roomId: 'banheiro-1', service: 'Tile na parede', phase: 'end', date: day(), at: now(), authorId: 'johnny', author: 'Johnny', note: 'Preparação iniciada. Instalação da cerâmica ainda não começou.', progress: 'started', photos: [], audio: null, demo: true },
      ] },
    { id: 'demo-newark', name: 'Banheiro residencial', address: 'Newark, NJ · endereço de demonstração', description: 'Renovação de um banheiro. Escopo inicial combinado com o cliente.', status: 'planned', createdAt: now(), deliveredAt: null, plan: null, cover: null, demo: true,
      rooms: [{ id: 'banheiro', name: 'Banheiro', services: ['Tile no piso', 'Tile na parede', 'Rejunte'], region: null }], assignments: [], entries: [], events: [{ id: randomUUID(), type: 'created', at: now(), author: 'Thiago', note: 'Aguardando início.' }] },
    { id: 'demo-hoboken', name: 'Cozinha · Hoboken', address: 'Hoboken, NJ · endereço de demonstração', description: 'Instalação de cerâmica e rejunte.', status: 'delivered', createdAt: now(), deliveredAt: now(), plan: null, cover: null, demo: true,
      rooms: [{ id: 'cozinha', name: 'Cozinha', services: ['Tile no piso', 'Rejunte'], region: null }], assignments: [], entries: [], events: [{ id: randomUUID(), type: 'delivered', at: now(), author: 'Thiago', note: 'Entrega de demonstração. Histórico preservado.' }] },
  ], chat: [] };
}
if (!db.prepare('SELECT id FROM state WHERE id=1').get()) db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify(seed()));
const load = () => JSON.parse(db.prepare('SELECT payload FROM state WHERE id=1').get().payload);
const save = state => db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(state));
const initialState = load();
const teamChanged = migrateTeam(initialState);
let interruptedAnalysis = false;
for (const j of initialState.jobs) for (const e of j.entries) if (e.analysis?.status === 'running') { e.analysis.status='error'; e.analysis.message='A análise foi interrompida pelo reinício do servidor. Tente novamente.'; interruptedAnalysis=true; }
if (finance.migrate(initialState) || teamChanged || interruptedAnalysis) save(initialState);
const auth = await createAuth(db, initialState.users);
const reports = createReportStore(db);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.webm': 'audio/webm', '.mp4': 'audio/mp4', '.ogg': 'audio/ogg', '.heic': 'image/heic', '.webmanifest':'application/manifest+json' };
const allowedTypes = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heic', 'application/pdf': '.pdf', 'audio/webm': '.webm', 'audio/mp4': '.mp4', 'audio/ogg': '.ogg' };
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const text = (value, name, max = 5000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}: informe um texto válido de até ${max} caracteres.`);
  return value.trim();
};
const uploadRef = (value, kind = 'any') => {
  if (!value) return null;
  if (typeof value !== 'object' || !/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp|gif|pdf|webm|mp4|ogg|heic)$/.test(value.url || '')) fail('Arquivo inválido.');
  if (!existsSync(join(dataDir, value.url))) fail('Arquivo não encontrado.');
  const extension = extname(value.url);
  if (kind === 'image' && !['.jpg', '.png', '.webp', '.gif', '.heic'].includes(extension)) fail('Selecione uma imagem.');
  if (kind === 'audio' && !['.webm', '.mp4', '.ogg'].includes(extension)) fail('Selecione um áudio.');
  if (kind === 'plan' && !['.jpg', '.png', '.webp', '.gif', '.pdf'].includes(extension)) fail('A planta deve ser imagem ou PDF.');
  return { url: value.url, name: String(value.name || 'Arquivo').slice(0, 200), type: mime[extension] };
};
async function body(req) {
  let parts = [], size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 18 * 1024 * 1024) fail('Arquivo muito grande. Limite: 12 MB por arquivo.', 413); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { fail('Dados inválidos.'); }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (auth.enabled) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (auth.origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let state = load();
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, storage: 'sqlite', mode: auth.enabled ? 'authenticated' : 'local' });
      if (req.method === 'GET' && url.pathname === '/api/auth/session') return send(200, { enabled: auth.enabled, userId: auth.enabled ? auth.account(req, state.users)?.id || null : null });
      if (auth.enabled) {
        auth.checkOrigin(req);
        if (req.method === 'POST' && url.pathname === '/api/auth/login') return send(200, await auth.login(req, res, await body(req), load().users));
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') { auth.logout(req, res); return send(200, { ok: true }); }
      }
      const user = auth.enabled ? auth.account(req, state.users) : state.users.find(u => u.id === req.headers['x-skytile-user']);
      if (!user) fail(auth.enabled ? 'Entre para acessar a Skytile.' : 'Selecione um perfil de demonstração.', 401);
      if (user.active === false) fail('Este perfil foi arquivado.', 403);
      if (url.pathname.startsWith('/api/field-report')) {
        if (!auth.enabled) fail('O compartilhamento exige login individual no servidor.', 503);
        if (req.method === 'GET' && url.pathname === '/api/field-reports/events') return reports.subscribe(req, res, user, () => !!auth.account(req, load().users));
        if (req.method === 'GET' && url.pathname === '/api/field-reports') return send(200, { reports: reports.list(state, user), jobs: state.jobs.map(job => ({ id: job.id, name: job.name, status: job.status })), user: { id: user.id, name: user.name, role: user.role } });
        const imageMatch = url.pathname.match(/^\/api\/field-report-images\/([a-f0-9]{64})$/);
        if (req.method === 'GET' && imageMatch) { const image = reports.image(imageMatch[1], user, state); res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'private, no-store' }); return res.end(Buffer.from(image.bytes)); }
        const reportMatch = url.pathname.match(/^\/api\/field-reports\/([a-f0-9-]{36})$/);
        if (req.method === 'GET' && reportMatch) return send(200, reports.get(reportMatch[1], state, user));
        if (req.method === 'POST' && url.pathname === '/api/field-report-images') return send(201, reports.upload(await body(req), user));
        if (req.method === 'PUT' && reportMatch) { const input = await body(req); return send(200, reports.put(reportMatch[1], input, load(), user)); }
        fail('Operação de relatório não encontrada.', 404);
      }
      const admin = () => { if (user.role !== 'admin') fail('Esta ação está disponível para Thiago e Flavio.', 403); };
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, { ...finance.stateView(state, user, day()), ai: vision.status(), auth: { enabled: auth.enabled, userId: auth.enabled ? user.id : null } });
      if (user.active === false) fail('Este perfil foi arquivado. Selecione um profissional ativo.', 403);
      const b = await body(req);
      if (auth.enabled && req.method === 'POST' && url.pathname === '/api/auth/access') {
        admin();
        const target = load().users.find(u => u.id === b.userId && u.active !== false);
        if (!target) fail('Profissional ativo não encontrado.', 404);
        await auth.setPassword(target.id, b.password);
        return send(200, { ok: true });
      }
      state = load(); finance.migrate(state); // Read after the asynchronous body to preserve concurrent submissions.
      const analysisMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/entries\/([^/]+)\/(analyze|analysis-review)$/);
      if (req.method === 'POST' && analysisMatch) {
        const job=state.jobs.find(j=>j.id===analysisMatch[1]);const entry=job?.entries.find(e=>e.id===analysisMatch[2]);
        if(!entry)fail('Registro não encontrado.',404);
        if(analysisMatch[3]==='analysis-review') {
          admin();if(entry.analysis?.status!=='complete')fail('Aguarde uma análise concluída antes de revisar.');
          if(!['agree','needs_check','disagree'].includes(b.decision))fail('Selecione uma decisão válida.');
          const note=String(b.note||'').trim();if(note.length>1500)fail('Observação muito longa.');
          const review={decision:b.decision,note,by:user.name,at:now()};entry.analysis.reviews ||= [];entry.analysis.reviews.push(review);entry.analysis.review=review;save(state);return send(200,{analysis:entry.analysis});
        }
        if(user.role!=='admin' && entry.authorId!==user.id)fail('Você pode solicitar análise apenas dos seus registros.',403);
        if(entry.analysis?.status==='complete')return send(200,{analysis:entry.analysis});
        if(visionRequests.has(entry.id))return send(202,{analysis:entry.analysis});
        if(!vision.status().available)fail('Cadastre a chave de IA nas configurações seguras do servidor para ativar a análise real.',503);
        if(visionRequests.size>=2)fail('Duas análises estão em andamento. Aguarde um instante.',429);
        const evidence=prepareEvidence(job,entry,join(dataDir,'uploads'));
        const attemptId=randomUUID();entry.analysis={id:attemptId,status:'running',at:now(),requestedBy:user.name,model:vision.status().model,provider:'OpenAI',reportedProgress:entry.progress,basis:evidence.basis,currentPhotos:evidence.currentPhotos,referencePhotos:evidence.referencePhotos,referenceEntryId:evidence.referenceEntryId,photosOmitted:evidence.photosOmitted};
        save(state);visionRequests.set(entry.id,attemptId);
        try {
          const result=await vision.analyze(evidence);
          const fresh=load();const target=fresh.jobs.find(j=>j.id===job.id)?.entries.find(e=>e.id===entry.id);
          if(!target || target.analysis?.id!==attemptId)fail('O registro mudou durante a análise. Atualize a página.',409);
          target.analysis={...target.analysis,...result,status:'complete',completedAt:now(),reviews:[]};save(fresh);return send(200,{analysis:target.analysis});
        } catch(error) {
          const fresh=load();const target=fresh.jobs.find(j=>j.id===job.id)?.entries.find(e=>e.id===entry.id);
          if(target?.analysis?.id===attemptId){target.analysis.status='error';target.analysis.message=error.status?error.message:'Não foi possível analisar as fotos.';save(fresh);}
          throw error;
        } finally {visionRequests.delete(entry.id);}
      }
      if (req.method === 'POST') {
        const result = finance.handle(state, url.pathname.slice(4), b, user, { today: day(), now, id: randomUUID, receipt: p => uploadRef(p, 'image') });
        if (result) { save(state); return send(200, result); }
      }
      if (req.method === 'POST' && url.pathname === '/api/users') {
        admin(); const fields = validateProfile(b);
        const person = { id: randomUUID(), code: nextCode(state.users), ...fields, role: 'worker', active: true, createdAt: now() };
        if (Object.hasOwn(b, 'dailyRateCents')) finance.setRate(state, person.id, b.dailyRateCents);
        state.users.push(person); save(state); return send(201, person);
      }
      const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
      if (req.method === 'PATCH' && userMatch) {
        admin(); const person = state.users.find(u => u.id === userMatch[1] && u.active !== false);
        if (!person) fail('Profissional não encontrado.', 404);
        const fields = validateProfile(b, person);
        if (Object.hasOwn(b, 'dailyRateCents')) finance.setRate(state, person.id, b.dailyRateCents);
        Object.assign(person, fields); save(state); return send(200, person);
      }
      if (req.method === 'POST' && url.pathname === '/api/upload') {
        const type = String(b.type || '').split(';')[0]; const extension = allowedTypes[type];
        if (!extension) fail('Formato não suportado. Use JPG, PNG, WebP, HEIC, PDF ou áudio WebM/MP4/OGG.');
        if (typeof b.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)) fail('Arquivo inválido.');
        const bytes = Buffer.from(b.data, 'base64');
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) fail('Cada arquivo deve ter entre 1 byte e 12 MB.');
        const name = randomUUID() + extension;
        writeFileSync(join(dataDir, 'uploads', name), bytes);
        return send(201, { url: '/uploads/' + name, name: String(b.name || 'Arquivo').slice(0, 200), type });
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        admin();
        if (!Array.isArray(b.rooms) || b.rooms.length < 1 || b.rooms.length > 100) fail('Cadastre pelo menos um ambiente.');
        const rooms = b.rooms.map(r => ({ id: randomUUID(), name: text(r.name, 'Ambiente', 120), services: Array.isArray(r.services) && r.services.length ? r.services.map(s => text(s, 'Serviço', 120)) : ['Serviço geral'], region: null }));
        if (b.initialPhotos && (!Array.isArray(b.initialPhotos) || b.initialPhotos.length > 12)) fail('Envie até 12 fotos iniciais.');
        const j = { id: randomUUID(), name: text(b.name, 'Nome', 160), address: text(b.address, 'Endereço', 300), description: String(b.description || '').slice(0, 5000), status: 'planned', createdAt: now(), deliveredAt: null, cover: uploadRef(b.cover, 'image'), initialPhotos: (b.initialPhotos || []).map(p => uploadRef(p, 'image')), plan: uploadRef(b.plan, 'plan'), demo: false, rooms, entries: [], assignments: [], events: [{ id: randomUUID(), type: 'created', at: now(), author: user.name, note: 'Obra cadastrada.' }] };
        state.jobs.unshift(j); finance.migrate(state); save(state); return send(201, j);
      }
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(status|entries|assignments|rooms|plan|regions))?$/);
      if (match) {
        const job = state.jobs.find(j => j.id === match[1]); if (!job) fail('Obra não encontrada.', 404);
        const action = match[2]; let createdEntryId = null;
        if (req.method === 'POST' && action === 'status') {
          admin(); if (!['planned', 'active', 'delivered'].includes(b.status)) fail('Status inválido.');
          if (job.status === 'delivered' && b.status !== 'delivered') text(b.reason, 'Motivo da reabertura', 1000);
          if (b.status !== job.status) {
            const type = job.status === 'delivered' ? 'reopened' : b.status === 'delivered' ? 'delivered' : 'status';
            if (type === 'reopened') { const previous = [...job.events].reverse().find(e => e.type === 'delivered'); if (previous && !previous.scope) previous.scope = completionScope(job); }
            job.events.push({ id: randomUUID(), type, at: now(), author: user.name, ...(type === 'delivered' ? { scope: completionScope(job) } : {}), note: type === 'reopened' ? b.reason.trim() : b.status === 'delivered' ? 'Obra entregue. Histórico preservado.' : 'Execução iniciada.' });
            job.status = b.status; job.deliveredAt = b.status === 'delivered' ? now() : null;
          }
        } else if (req.method === 'POST' && action === 'entries') {
          if (job.status === 'delivered') fail('Peça a um administrador para reabrir a obra antes de registrar um ajuste.');
          const room = job.rooms.find(r => r.id === b.roomId); if (!room) fail('Ambiente inválido.');
          if (!room.services.includes(b.service)) fail('Serviço inválido.');
          if (!(b.progress === 'review' || Object.hasOwn(globalThis.SkytileProgress.stages, b.progress))) fail('Avanço inválido.');
          const note = String(b.note || '').trim(); if (note.length > 5000) fail('Relato muito longo.');
          if (!Array.isArray(b.photos) || b.photos.length > 12) fail('Envie até 12 fotos por registro.');
          const photos = b.photos.map(p => uploadRef(p, 'image')); const audio = uploadRef(b.audio, 'audio');
          if (!note && !photos.length && !audio) fail('Adicione uma foto, um relato ou um áudio.');
          if (!['start', 'end', 'update'].includes(b.phase)) fail('Momento inválido.');
          createdEntryId = randomUUID();
          job.entries.push({ id: createdEntryId, at: now(), date: day(), roomId: room.id, service: b.service, phase: b.phase, progress: b.progress, note, authorId: user.id, author: user.name, photos, audio });
          if (job.status === 'planned') { job.status = 'active'; job.events.push({ id: randomUUID(), type: 'status', at: now(), author: user.name, note: 'Execução iniciada com o primeiro registro.' }); }
        } else if (req.method === 'POST' && action === 'assignments') {
          admin(); if (job.status === 'delivered') fail('Reabra a obra antes de definir uma equipe.');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0, 10) !== b.date) fail('Data inválida.');
          const previous = job.assignments.find(a => a.date === b.date);
          const a = { date: b.date, userIds: validateAssignment(state.users, b.userIds, previous), by: user.name, at: now() };
          job.events.push({ id: randomUUID(), type: 'assignment', at: now(), author: user.name, note: `Equipe para ${b.date}: ${a.userIds.map(id => state.users.find(u => u.id === id).name).join(', ') || 'não definida'}.`, previous: previous || null });
          job.assignments = job.assignments.filter(a => a.date !== b.date); job.assignments.push(a);
        } else if (req.method === 'POST' && action === 'rooms') {
          admin(); if (job.status === 'delivered') fail('Reabra a obra antes de adicionar um ambiente.');
          job.rooms.push({ id: randomUUID(), name: text(b.name, 'Ambiente', 120), services: Array.isArray(b.services) && b.services.length ? b.services.map(s => text(s, 'Serviço', 120)) : ['Serviço geral'], region: null });
        } else if (req.method === 'POST' && action === 'plan') {
          admin(); job.plan = uploadRef(b.plan, 'plan'); job.rooms.forEach(r => r.region = null);
        } else if (req.method === 'POST' && action === 'regions') {
          admin(); const room = job.rooms.find(r => r.id === b.roomId); if (!room) fail('Ambiente inválido.');
          if (!job.plan || job.plan.type === 'application/pdf') fail('Use uma planta em imagem para marcar ambientes.');
          if (!Array.isArray(b.region) || b.region.length !== 4 || b.region.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || b.region[2] < .01 || b.region[3] < .01 || b.region[0] + b.region[2] > 1.001 || b.region[1] + b.region[3] > 1.001) fail('Área inválida.');
          room.region = b.region;
        } else fail('Operação não encontrada.', 404);
        save(state); return send(200, { ...finance.jobView(job, user), ...(createdEntryId ? { createdEntryId } : {}) });
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        admin(); const question = text(b.question, 'Pergunta', 2000);
        const answer = { id: randomUUID(), at: now(), author: user.name, question, ...globalThis.SkytileAssistant.respond(state, question, b.jobId, day()) };
        state.chat.push(answer); save(state); return send(200, answer);
      }
      if (req.method === 'POST' && url.pathname === '/api/chat/audio') {
        admin(); const audio = uploadRef(b.audio, 'audio'); if (!audio) fail('Grave um áudio.');
        const message = { id: randomUUID(), at: now(), author: user.name, question: 'Mensagem de áudio', audio, answer: 'Áudio salvo localmente. Este protótipo não transcreve nem interpreta gravações. Digite sua pergunta para consultar os registros.', sources: [], mode: 'local' };
        state.chat.push(message); save(state); return send(201, message);
      }
      fail('Operação não encontrada.', 404);
    }
    if (!['GET', 'HEAD'].includes(req.method)) fail('Método inválido.', 405);
    let file;
    if (/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp|gif|pdf|webm|mp4|ogg|heic)$/.test(url.pathname)) {
      if (auth.enabled) {
        const state = load(), viewer = auth.account(req, state.users);
        if (!viewer) fail('Entre para visualizar este arquivo.', 401);
        const receipts = state.jobs.flatMap(j => j.finance?.expenses || []).filter(e => e.receipt?.url === url.pathname);
        if (viewer.role !== 'admin' && receipts.length && !receipts.some(e => e.authorId === viewer.id)) fail('Este comprovante não está disponível para seu perfil.', 403);
      }
      file = join(dataDir, url.pathname);
    }
    else {
      const pathname = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      file = resolve(root, 'public', '.' + decodeURIComponent(pathname));
      if (!file.startsWith(resolve(root, 'public') + '/')) fail('Acesso inválido.', 403);
    }
    if (!existsSync(file)) fail('Arquivo não encontrado.', 404);
    if (statSync(file).isDirectory()) { res.writeHead(302, { Location: url.pathname + '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': auth.enabled ? 'private, no-store' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (e) { if (!res.headersSent) send(e.status || 500, { error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' }); else res.end(); if (!e.status) console.error(e); }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, process.env.SKYTILE_HOST || '127.0.0.1', () => console.log(`Skytile local: http://127.0.0.1:${server.address().port} · dados em ${dataDir}`));
process.on('SIGTERM', () => { reports.close(); server.close(async () => { await vision.close(); db.close(); process.exit(0); }); });

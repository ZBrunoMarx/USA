import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import '../public/finance.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const source = process.env.SKYTILE_PREVIEW_SOURCE || 'http://127.0.0.1:3000';
const response = await fetch(new URL('/api/state', source), { headers: { 'X-Skytile-User': 'thiago' }, signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('Inicie npm start antes de gerar a prévia.');
const state = await response.json();
// Export only demo data. Actual job photos and messages must not leak into a shareable preview.
state.jobs = state.jobs.filter(j => j.demo).map(j => ({ ...j, assignments: [], entries: j.entries.filter(e => e.demo).map(({analysis,...e})=>e), initialPhotos: [], cover: null, plan: null, events: j.events.filter(e => ['created', 'delivered'].includes(e.type)) }));
state.chat = [];
state.auth={enabled:false,userId:null};
state.ai={available:false,mode:'standalone',provider:'OpenAI'};
globalThis.SkytileFinance.demo(state, state.today);
const safeScript = s => s.replace(/<\/script/gi, '<\\/script');
const seed = JSON.stringify(state).replace(/</g, '\\u003c');
const css = readFileSync(join(root, 'public/style.css'), 'utf8');
const adapter = readFileSync(join(root, 'public/local-preview.js'), 'utf8');
const photoCapture = readFileSync(join(root, 'public/photo-capture.js'), 'utf8');
const application = readFileSync(join(root, 'public/app.js'), 'utf8');
const progress = readFileSync(join(root, 'public/progress.js'), 'utf8');
const assistant = readFileSync(join(root, 'public/assistant.js'), 'utf8');
const finance = readFileSync(join(root, 'public/finance.js'), 'utf8');
const team = readFileSync(join(root, 'public/team.js'), 'utf8');
// A cached screenshot shell can contain real job names and amounts. Keep the
// non-interactive fallback generic; the interactive view renders only the export seed.
const shell = '<main class="boot"><h1>Skytile · obras e equipe</h1><p>Cada obra, um passo à frente.</p><p>Ativando obras, ambientes, equipe e custos. Se a faixa continuar em modo visual, abra o HTML no navegador fora da prévia.</p></main>';
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111c2b"><title>Skytile · prévia interativa</title><style>${css}</style></head><body><div id="preview-status" class="preview-status" data-mode="visual" role="status"><strong>Modo visual · v0.3.2</strong> — os comandos ainda não foram ativados. Se esta mensagem continuar, abra o HTML no Safari fora da prévia do chat.</div><div id="app"><div id="preview-snapshot" inert aria-hidden="true">${shell}</div></div><div id="modal-root"></div><div id="toast" role="status" aria-live="polite"></div><noscript><div class="notice">Este visualizador bloqueia JavaScript. Baixe o arquivo Skytile.html e abra no navegador para usar os controles.</div></noscript><script>window.SKYTILE_PREVIEW_SEED=${seed};window.addEventListener('error',function(event){var status=document.getElementById('preview-status');if(status.dataset.mode==='visual'){status.dataset.mode='error';status.textContent='Não foi possível ativar esta prévia: '+event.message+'. Abra o arquivo HTML no navegador.';}});</script><script>${safeScript(progress)}</script><script>${safeScript(team)}</script><script>${safeScript(finance)}</script><script>${safeScript(assistant)}</script><script>${safeScript(adapter)}</script><script>${safeScript(photoCapture)}</script><script>${safeScript(application)}</script></body></html>`;
writeFileSync(process.env.SKYTILE_PREVIEW_OUTPUT || join(root, 'Skytile.html'), html);
console.log('Skytile.html gerado: interface, consultas, fotos e armazenamento no navegador. Sem conexão com o servidor.');

'use strict';
const $ = selector => document.querySelector(selector);
const form = $('#report-form'), fields = $('#report-fields');
const groups = [
  { id: 'before', title: 'Início do dia', hint: 'Uma visão geral e um detalhe criam a referência.' },
  { id: 'after', title: 'Fim do dia', hint: 'Mostre o resultado do trabalho, mesmo que ainda esteja incompleto.' },
  { id: 'pending', title: 'O que ficou pendente', hint: 'Opcional: mostre as partes que ainda precisam de trabalho.' },
];
const names = ['title', 'date', 'author', 'scope', 'language', 'percent', 'company', 'completed', 'remaining'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const defaults = () => ({ title: '', date: today(), author: cloudData?.user?.name || 'Bruno', scope: 'Grouting', language: 'en', percent: '', company: '', completed: '', remaining: '' });
let photos = { before: [], after: [], pending: [] }, logo = null, library = null, saveTimer, saveChain = Promise.resolve();
let busy = false, importing = false, controller = null, videoFile = null, videoURL = null, wakeLock = null;
let recordId = crypto.randomUUID(), localRevision = 0, recordStatus = 'active', cloud = null;
let cloudData = null, remoteReports = [], syncTimer, publishing = false, conflict = false, libraryVisible = false;
let syncError = '', queueRunning = false;
const inFlightRecords = new Set();
let libraryList = [], cloudAvailable = false, remoteRefreshing = false;
const cloudConfig = globalThis.FIELD_REPORT_CLOUD;
const SyncProvider = cloudConfig?.provider === 'supabase' && (!cloudConfig.siteOrigin || cloudConfig.siteOrigin === location.origin) ? FieldReportSupabaseSync : FieldReportSync;
const sync = SyncProvider === FieldReportSync ? new SyncProvider(change => refreshShared(change), text => { $('#connection-status').textContent = text; }) : new SyncProvider(globalThis.FIELD_REPORT_CLOUD, change => refreshShared(change), text => { $('#connection-status').textContent = text; });
const urls = new Set();
const canEdit = () => cloud?.canEdit !== false;
const lockFields = () => { fields.disabled = busy || importing || !canEdit() || recordStatus === 'archived'; };

const objectURL = blob => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
const revoke = url => { if (url) { URL.revokeObjectURL(url); urls.delete(url); } };
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const values = () => Object.fromEntries(names.map(name => [name, form.elements[name].value]));
const countPhotos = () => groups.reduce((sum, group) => sum + photos[group.id].length, 0);
function message(text, error = false) {
  const element = $('#message'); element.textContent = text; element.className = 'notice' + (error ? ' error' : ''); element.hidden = !text;
}
function warning(text) { $('#storage-warning').textContent = text; $('#storage-warning').hidden = !text; }
function invalidate(changed = true) {
  if (changed && cloud) { cloud.dirty = true; syncError = ''; $('#sync-status').textContent = 'Alterações aguardando envio'; }
  if (videoURL) { $('#result-video').pause(); $('#result-video').removeAttribute('src'); revoke(videoURL); videoURL = null; }
  videoFile = null; $('#result').hidden = true;
}
function setValues(data) {
  for (const name of names) {
    const element = form.elements[name], limit = element.maxLength > 0 ? element.maxLength : 220;
    element.value = typeof data[name] === 'string' ? data[name].slice(0, limit) : defaults()[name];
  }
  if (!['en', 'pt'].includes(form.elements.language.value)) form.elements.language.value = 'en';
}
const contentKey = record => JSON.stringify([record.fields, record.status, Object.values(record.photos).map(items => items.map(item => item.id)), record.logo?.id || null]);
function snapshot() { return { id: recordId, version: 1, fields: values(), photos: Object.fromEntries(groups.map(group => [group.id, [...photos[group.id]]])), logo, status: recordStatus, cloud: cloud ? { ...cloud } : null, savedAt: Date.now() }; }
function saveNow() {
  clearTimeout(saveTimer);
  const data = snapshot();
  if (!library) { $('#save-status').textContent = 'Só nesta aba · salve uma cópia'; return Promise.resolve(false); }
  $('#save-status').textContent = 'Salvando neste navegador…';
  const task = saveChain.catch(() => {}).then(async () => {
    if (recordId === data.id && data.cloud && cloud) data.cloud = { ...cloud, dirty: data.cloud.dirty || cloud.dirty };
    const saved = await library.save(data, localRevision);
    if (recordId === data.id) localRevision = saved.localRevision;
    $('#save-status').textContent = 'Salvo neste navegador';
    scheduleSync(); if (cloudData) void flushPending(); return true;
  }).catch(error => { $('#save-status').textContent = 'Não foi possível salvar'; warning(error.message || 'Use Salvar cópia do registro antes de fechar.'); return false; });
  saveChain = task; return task;
}
function scheduleSave() { $('#save-status').textContent = 'Salvando neste navegador…'; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
function codec() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  return ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || null;
}
function slides(data) {
  const list = [{ type: 'intro', duration: 2 }];
  for (const group of groups) for (const photo of photos[group.id]) list.push({ type: 'photo', group: group.id, photo, duration: 2.2 });
  list.push({ type: 'outro', duration: 3 });
  let time = 0; for (const slide of list) { slide.start = time; time += slide.duration; }
  return { list, duration: time, data };
}
function update() {
  const number = countPhotos(), plan = slides(values());
  $('#film-summary').textContent = number ? number + ' foto(s) · cerca de ' + Math.ceil(plan.duration) + ' segundos · vertical 720p' : 'Adicione suas fotos para preparar a apresentação.';
  $('#preview').disabled = busy || importing || !number;
  $('#export').disabled = busy || importing || !number || !codec();
  $('#backup').disabled = busy || importing;
  $('#new-report').disabled = busy || importing;
  $('#restore').disabled = busy || importing;
  for (const name of ['show-services', 'save-service', 'new-service', 'archive-report', 'remove-local', 'cloud-logout']) $('#' + name).disabled = busy || importing || publishing;
  $('#archive-report').disabled ||= !canEdit();
  $('#cloud-logout').disabled ||= queueRunning;
  $('#archive-report').textContent = recordStatus === 'archived' ? 'Reabrir serviço' : 'Arquivar serviço';
  $('#record-state').textContent = recordStatus === 'archived' ? 'Serviço arquivado' : 'Serviço em andamento';
  $('#publish-report').disabled = busy || importing || publishing || !cloudData || !canEdit() || conflict;
  $('#cloud-job').disabled = !!cloud?.revision || publishing || !canEdit();
  $('#reload-remote').disabled = busy || importing || publishing;
  $('#readonly-notice').hidden = canEdit();
  lockFields();
  $('#language-hint').textContent = form.elements.language.value === 'en' ? 'As legendas fixas serão em inglês. Escreva os textos abaixo em inglês, se quiser incluí-los.' : 'As legendas fixas e os textos do vídeo podem ficar em português.';
  const differentDay = values().date && values().date !== today();
  $('#date-notice').hidden = !differentDay;
  $('#date-notice').textContent = differentDay ? 'Confira a data: este registro está em ' + values().date + ', diferente de hoje. Para outro dia de trabalho, inicie um Novo relatório. O serviço atual continuará na sua lista.' : '';
}
function renderPhotos() {
  for (const url of [...urls]) if (url !== videoURL) revoke(url);
  $('#photo-groups').innerHTML = groups.map(group => {
    const items = photos[group.id];
    return '<section class="photo-group"><div class="group-heading"><h3>' + group.title + '</h3><span>' + items.length + '/4</span></div><p>' + group.hint + '</p><div class="actions"><button type="button" class="secondary camera" data-group="' + group.id + '">Tirar foto</button><label class="button secondary">Escolher fotos<input class="gallery" data-group="' + group.id + '" type="file" accept="image/*,.heic,.heif" multiple hidden></label><input class="camera-input" data-group="' + group.id + '" type="file" accept="image/*" capture="environment" hidden></div><div class="photo-list">' +
      items.map((photo, index) => '<div class="photo-tile"><img src="' + objectURL(photo.blob) + '" alt="' + group.title + ' · foto ' + (index + 1) + '"><div><span>Foto ' + (index + 1) + '</span>' + (index ? '<button type="button" data-up="' + photo.id + '" data-group="' + group.id + '" aria-label="Mover foto ' + (index + 1) + ' para antes">↑</button>' : '') + '<button type="button" class="remove" data-remove="' + photo.id + '" data-group="' + group.id + '" aria-label="Remover foto ' + (index + 1) + ' de ' + group.title + '">Remover</button></div></div>').join('') + '</div></section>';
  }).join('');
  $('#logo-preview').innerHTML = logo ? '<img src="' + objectURL(logo.blob) + '" alt="Logo da empresa selecionada">' : '';
  $('#remove-logo').hidden = !logo;
  document.querySelectorAll('.camera').forEach(button => button.onclick = () => document.querySelector('.camera-input[data-group="' + button.dataset.group + '"]').click());
  document.querySelectorAll('.gallery,.camera-input').forEach(input => input.onchange = () => { const files = [...input.files]; input.value = ''; void importPhotos(input.dataset.group, files); });
  document.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { photos[button.dataset.group] = photos[button.dataset.group].filter(photo => photo.id !== button.dataset.remove); invalidate(); renderPhotos(); void saveNow(); });
  document.querySelectorAll('[data-up]').forEach(button => button.onclick = () => { const list = photos[button.dataset.group], index = list.findIndex(photo => photo.id === button.dataset.up); if (index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]]; invalidate(); renderPhotos(); void saveNow(); });
  update();
}
async function loadImage(blob) {
  const url = URL.createObjectURL(blob), image = new Image();
  try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; }); return image; }
  finally { URL.revokeObjectURL(url); }
}
async function prepareImage(file, isLogo = false) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name)) throw new Error('Escolha uma imagem.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Essa imagem é muito grande. Escolha uma foto de até 30 MB.');
  let image; try { image = await loadImage(file); } catch { throw new Error('O navegador não abriu essa foto. No iPhone, tente uma cópia JPG ou uma captura de tela.'); }
  const max = isLogo ? 420 : 1280, scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d'); if (!isLogo) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, isLogo ? 'image/png' : 'image/jpeg', .84));
  canvas.width = 0; canvas.height = 0;
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  return { id: crypto.randomUUID(), name: String(file.name || 'Foto').slice(0, 120), blob };
}
async function importPhotos(group, files) {
  if (busy || importing || !files.length) return;
  if (photos[group].length + files.length > 4) { message('Escolha até 4 fotos por etapa.', true); return; }
  importing = true; fields.disabled = true; update();
  try {
    for (const [index, file] of files.entries()) {
      $('#photo-status').textContent = 'Preparando foto ' + (index + 1) + ' de ' + files.length + '…';
      try { photos[group].push(await prepareImage(file)); invalidate(); await saveNow(); } catch (error) { message(error.message, true); }
    }
  } finally { importing = false; lockFields(); $('#photo-status').textContent = ''; renderPhotos(); }
}
const words = {
  en: { report: 'DAILY WORK REPORT', before: 'START OF DAY', after: 'END OF DAY', pending: 'REMAINING WORK', closing: 'END-OF-DAY SUMMARY', reported: 'REPORTED COMPLETION', done: 'Work recorded today', remaining: 'Remaining work', note: 'Progress reported for the scope shown', by: 'Prepared by', noPercent: 'WORK UPDATE', pendingPhotos: 'See remaining-work photos in this report' },
  pt: { report: 'RELATÓRIO DO DIA', before: 'INÍCIO DO DIA', after: 'FIM DO DIA', pending: 'TRABALHO PENDENTE', closing: 'RESUMO DO DIA', reported: 'CONCLUSÃO INFORMADA', done: 'Trabalho registrado hoje', remaining: 'Pendências', note: 'Avanço informado para o serviço apresentado', by: 'Preparado por', noPercent: 'ATUALIZAÇÃO DO SERVIÇO', pendingPhotos: 'Veja as fotos de pendências neste relatório' },
};
const ease = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
function wrapped(context, text, x, y, width, lineHeight, maxLines = 3) {
  const tokens = String(text || '').split(/\s+/), lines = []; let line = '';
  for (const token of tokens) {
    if (!token) continue;
    if (context.measureText(line + (line ? ' ' : '') + token).width > width && line) { lines.push(line); line = ''; }
    let rest = token;
    while (context.measureText(rest).width > width && rest.length > 1) {
      let split = rest.length - 1; while (split > 1 && context.measureText(rest.slice(0, split)).width > width) split--;
      if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, split)); rest = rest.slice(split);
    }
    line += (line ? ' ' : '') + rest;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) { let last = shown[maxLines - 1]; while (context.measureText(last + '…').width > width && last.length) last = last.slice(0, -1); shown[maxLines - 1] = last + '…'; }
  shown.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
  return shown.length * lineHeight;
}
function dateText(data) { return new Intl.DateTimeFormat(data.language === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(data.date + 'T12:00:00')); }
function percent(data) { return data.percent !== '' && Number.isInteger(Number(data.percent)) && Number(data.percent) >= 0 && Number(data.percent) <= 100 ? Number(data.percent) : null; }
function drawSlide(context, slide, progress, data, images) {
  const w = words[data.language] || words.en, accent = slide.group === 'pending' ? '#edbf79' : '#7ed4b7';
  const gradient = context.createLinearGradient(0, 0, 720, 1280); gradient.addColorStop(0, '#183d45'); gradient.addColorStop(1, '#0d232b');
  context.fillStyle = gradient; context.fillRect(0, 0, 720, 1280);
  context.textBaseline = 'alphabetic'; context.fillStyle = '#b5d0d0'; context.font = '600 20px -apple-system, sans-serif'; context.fillText(dateText(data), 48, 66);
  if (images.logo) {
    context.fillStyle = '#fff'; context.fillRect(566, 27, 106, 70);
    const scale = Math.min(94 / images.logo.naturalWidth, 58 / images.logo.naturalHeight);
    context.drawImage(images.logo, 619 - images.logo.naturalWidth * scale / 2, 62 - images.logo.naturalHeight * scale / 2, images.logo.naturalWidth * scale, images.logo.naturalHeight * scale);
  }
  if (slide.type === 'intro') {
    context.strokeStyle = '#ffffff0c'; context.lineWidth = 1;
    for (let x = -100; x < 900; x += 90) { context.beginPath(); context.moveTo(x, 200); context.lineTo(x + 220, 1000); context.stroke(); }
    context.fillStyle = '#7ed4b7'; context.font = '700 21px -apple-system, sans-serif'; context.fillText(w.report, 48, 360);
    context.save(); context.translate(0, 16 * (1 - ease(progress * 2)));
    context.fillStyle = '#fff'; context.font = '700 57px -apple-system, sans-serif'; const height = wrapped(context, data.title, 48, 440, 624, 68, 4);
    context.fillStyle = '#c3d8d8'; context.font = '400 29px -apple-system, sans-serif'; wrapped(context, data.scope, 48, 470 + height, 624, 40, 3); context.restore();
    context.fillStyle = '#fff'; context.font = '600 27px -apple-system, sans-serif'; wrapped(context, data.company, 48, 1030, 624, 37, 2);
    context.fillStyle = '#91b4b7'; context.font = '400 23px -apple-system, sans-serif'; if (data.author) context.fillText(w.by + ' ' + data.author, 48, 1170);
    return;
  }
  context.fillStyle = '#fff'; context.font = '650 30px -apple-system, sans-serif'; wrapped(context, data.title, 48, 145, 624, 38, 2);
  if (slide.type === 'photo') {
    context.fillStyle = accent; context.font = '700 22px -apple-system, sans-serif'; context.fillText(w[slide.group], 48, 245);
    context.fillStyle = '#091c23'; context.fillRect(34, 282, 652, 752);
    const image = images[slide.photo.id], fit = Math.min(628 / image.naturalWidth, 724 / image.naturalHeight), zoom = .97 + .03 * ease(progress);
    const width = image.naturalWidth * fit * zoom, height = image.naturalHeight * fit * zoom;
    context.drawImage(image, 360 - width / 2, 658 - height / 2, width, height);
    context.fillStyle = '#c4dcdc'; context.font = '400 27px -apple-system, sans-serif'; wrapped(context, data.scope, 48, 1090, 624, 37, 2);
    context.fillStyle = '#85a8ae'; context.font = '400 20px -apple-system, sans-serif'; wrapped(context, data.company || data.author, 48, 1210, 624, 27, 1);
    return;
  }
  context.fillStyle = '#7ed4b7'; context.font = '700 21px -apple-system, sans-serif'; context.fillText(w.closing, 48, 260);
  const value = percent(data);
  if (value !== null) {
    context.fillStyle = '#fff'; context.font = '700 112px -apple-system, sans-serif'; context.fillText(value + '%', 48, 410);
    context.fillStyle = '#b4d2d2'; context.font = '600 20px -apple-system, sans-serif'; context.fillText(w.reported, 48, 455);
    context.fillStyle = '#ffffff20'; context.fillRect(48, 485, 624, 12); context.fillStyle = '#7ed4b7'; context.fillRect(48, 485, 624 * value / 100 * ease(progress * 2), 12);
  } else { context.fillStyle = '#fff'; context.font = '700 42px -apple-system, sans-serif'; context.fillText(w.noPercent, 48, 395); }
  let y = 568;
  for (const [label, text] of [[w.done, data.completed], [w.remaining, data.remaining || (photos.pending.length ? w.pendingPhotos : '')]]) {
    if (!text) continue;
    context.fillStyle = '#7ed4b7'; context.font = '600 22px -apple-system, sans-serif'; context.fillText(label, 48, y); y += 40;
    context.fillStyle = '#fff'; context.font = '400 28px -apple-system, sans-serif'; y += wrapped(context, text, 48, y, 624, 37, 4) + 48;
  }
  context.fillStyle = '#9dbbc0'; context.font = '400 20px -apple-system, sans-serif'; wrapped(context, data.scope, 48, 1085, 624, 29, 2); context.fillText(w.note, 48, 1170);
}
function paint(context, plan, time, images) {
  const index = Math.max(0, plan.list.findIndex((slide, i) => time < slide.start + slide.duration || i === plan.list.length - 1));
  const slide = plan.list[index], local = time - slide.start, progress = Math.max(0, Math.min(1, local / slide.duration));
  context.save(); context.globalAlpha = 1;
  if (index && local < .28) { drawSlide(context, plan.list[index - 1], 1, plan.data, images); context.globalAlpha = ease(local / .28); }
  drawSlide(context, slide, progress, plan.data, images); context.restore();
}
async function play(record) {
  if (busy || importing || !form.reportValidity() || !countPhotos()) return;
  if (record && !codec()) { message('Este navegador não oferece gravação MP4. Abra esta página no Safari atualizado e teste novamente.', true); return; }
  await saveNow(); invalidate(false); message('');
  busy = true; fields.disabled = true; controller = new AbortController(); update();
  $('#cancel-render').hidden = false; $('#render-progress').hidden = false; $('#render-progress').value = 0;
  $('#film-canvas').hidden = false; $('#render-status').textContent = record ? 'Preparando o MP4. Mantenha esta página aberta…' : 'Prévia da apresentação…';
  const canvas = $('#film-canvas'), context = canvas.getContext('2d'), plan = slides(values()), images = {};
  document.activeElement?.blur();
  canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
  let recorder, stream, stopPromise, failure = null;
  const hide = () => { if (document.hidden) { failure = new Error('A geração foi interrompida ao sair da página. Volte ao Safari e gere novamente mantendo esta página aberta.'); controller?.abort(); } };
  const visibility = () => hide();
  document.addEventListener('visibilitychange', visibility);
  try {
    for (const group of groups) for (const photo of photos[group.id]) images[photo.id] = await loadImage(photo.blob);
    if (logo) images.logo = await loadImage(logo.blob);
    if (controller.signal.aborted) throw new Error('cancelled');
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Foreground instructions remain visible. */ }
    paint(context, plan, 0, images);
    const chunks = [];
    if (record) {
      stream = canvas.captureStream(24);
      recorder = new MediaRecorder(stream, { mimeType: codec(), videoBitsPerSecond: 2400000 });
      stopPromise = new Promise((resolve, reject) => {
        recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }));
        recorder.onerror = () => { failure = new Error('O navegador interrompeu a gravação. Tente novamente com menos fotos.'); controller.abort(); reject(failure); };
      });
      stopPromise.catch(() => {});
      recorder.start(1000);
    }
    await new Promise((resolve, reject) => {
      const start = performance.now();
      const frame = now => {
        if (controller.signal.aborted) { reject(failure || new Error('cancelled')); return; }
        const elapsed = Math.min(plan.duration, (now - start) / 1000);
        paint(context, plan, elapsed, images); $('#render-progress').value = Math.round(elapsed / plan.duration * 100);
        if (elapsed >= plan.duration) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    if (record) {
      recorder.stop(); const blob = await stopPromise;
      const header = new TextDecoder().decode(await blob.slice(0, 128).arrayBuffer());
      if (blob.size < 1000 || !header.includes('ftyp')) throw new Error('O navegador não produziu um MP4 válido. Não foi criado um arquivo com formato diferente.');
      const slug = plan.data.title.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 45);
      videoFile = new File([blob], 'work-report-' + plan.data.date + '-' + slug + '.mp4', { type: 'video/mp4' });
      videoURL = objectURL(videoFile); $('#result-video').src = videoURL; $('#download').href = videoURL; $('#download').download = videoFile.name;
      $('#video-info').textContent = 'MP4 · ' + Math.ceil(plan.duration) + ' s · ' + (blob.size / 1024 / 1024).toFixed(1) + ' MB';
      $('#result').hidden = false; $('#render-status').textContent = 'Vídeo pronto. Confira e salve ou compartilhe.';
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else $('#render-status').textContent = 'Prévia concluída. Toque em Gerar MP4 para criar o arquivo.';
  } catch (error) {
    $('#render-status').textContent = controller.signal.aborted && !failure ? 'Operação cancelada. Seu rascunho permanece salvo.' : (failure?.message || error.message || 'Não foi possível gerar o vídeo.');
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } finally {
    stream?.getTracks().forEach(track => track.stop()); try { await wakeLock?.release(); } catch {} wakeLock = null;
    document.removeEventListener('visibilitychange', visibility); controller = null; busy = false; lockFields();
    $('#cancel-render').hidden = true; $('#render-progress').hidden = true; update();
  }
}
async function backup() {
  if (busy || importing) return;
  await saveNow();
  try {
    const encode = async item => ({ id: item.id, name: item.name, type: item.blob.type, data: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(item.blob); }) });
    const payload = { format: 'field-report-backup', version: 1, fields: values(), photos: {}, logo: logo ? await encode(logo) : null };
    for (const group of groups) payload.photos[group.id] = await Promise.all(photos[group.id].map(encode));
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'work-report-' + values().date + '-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('Cópia preparada para salvar nos Arquivos. Ela contém as fotos; guarde com o mesmo cuidado do registro.');
  } catch { message('Não foi possível preparar a cópia. Mantenha esta página aberta e tente novamente.', true); }
}
async function restore(file) {
  if (!file || busy || importing) return;
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error('size');
    const data = JSON.parse(await file.text());
    if (data.format !== 'field-report-backup' || data.version !== 1 || !data.fields || !data.photos) throw new Error('format');
    const decode = item => {
      if (!item || !['image/jpeg', 'image/png'].includes(item.type) || typeof item.data !== 'string' || item.data.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('image');
      const bytes = Uint8Array.from(atob(item.data), char => char.charCodeAt(0));
      return { id: crypto.randomUUID(), name: String(item.name || 'Foto').slice(0, 120), blob: new Blob([bytes], { type: item.type }) };
    };
    const restored = {};
    for (const group of groups) { const list = data.photos[group.id]; if (!Array.isArray(list) || list.length > 4) throw new Error('photos'); restored[group.id] = list.map(decode); }
    const restoredLogo = data.logo ? decode(data.logo) : null;
    if (!await newRecord(false)) return;
    photos = restored; logo = restoredLogo; setValues(data.fields); invalidate(); renderPhotos(); await saveNow(); message('Registro recuperado da cópia salva.');
  } catch { message('Não foi possível abrir essa cópia. Escolha o arquivo JSON exportado por esta página.', true); }
}
function activate(record) {
  clearTimeout(saveTimer); clearTimeout(syncTimer);
  recordId = record.id; localRevision = record.localRevision || 0; recordStatus = record.status || 'active'; cloud = record.cloud || null; conflict = cloud?.conflict === true; syncError = '';
  setValues(record.fields || defaults()); photos = { before: [], after: [], pending: [] };
  for (const group of groups) if (Array.isArray(record.photos?.[group.id])) photos[group.id] = record.photos[group.id].filter(item => item.blob instanceof Blob).slice(0, 4);
  logo = record.logo?.blob instanceof Blob ? record.logo : null;
  invalidate(false); renderPhotos(); showEditor(); refreshCloudControls();
}
function showEditor() { libraryVisible = false; $('#editor').hidden = false; $('#service-library').hidden = true; }
async function showLibrary() {
  if (busy || importing || publishing) return;
  if (!await saveNow()) return;
  libraryVisible = true; $('#editor').hidden = true; $('#service-library').hidden = false;
  await renderLibrary(); window.scrollTo(0, 0);
}
async function newRecord(ask = false) {
  if (busy || importing || publishing) return false;
  if (!await saveNow()) return false;
  // Starting a report keeps the old one. Confirmation only explains the changed behavior.
  if (ask && !confirm('Seu serviço atual será mantido na lista. Iniciar outro relatório?')) return false;
  activate({ id: crypto.randomUUID(), fields: defaults(), photos: {}, status: 'active' });
  const saved = await saveNow(); if (!saved) return false;
  message('Novo serviço criado. O anterior continua na lista de Serviços.'); window.scrollTo(0, 0); return true;
}
async function renderLibrary() {
  libraryList = library ? await library.list() : [];
  const combined = new Map(libraryList.map(item => [item.id, { ...item, local: true }]));
  for (const remote of remoteReports) {
    const local = combined.get(remote.id);
    if (!local || !local.cloud?.dirty) combined.set(remote.id, { id: remote.id, title: remote.fields.title, date: remote.fields.date, scope: remote.fields.scope, percent: remote.fields.percent, status: remote.status, savedAt: Date.parse(remote.updatedAt), photoCount: remote.photoCount, local: !!local, shared: true, cloud: { jobId: remote.jobId, revision: remote.revision } });
    else local.shared = true;
  }
  const filter = $('#service-filter').value, query = $('#service-search').value.trim().toLocaleLowerCase();
  const jobFilter = $('#service-job').value;
  const list = [...combined.values()].filter(item => item.hasContent !== false && (!jobFilter || item.cloud?.jobId === jobFilter) && (filter === 'all' || item.status === filter) && (item.title + ' ' + item.scope).toLocaleLowerCase().includes(query)).sort((a, b) => b.savedAt - a.savedAt);
  $('#library-status').textContent = list.length + ' serviço(s)' + (cloudData ? ' · aparelho e companhia' : ' · neste navegador');
  $('#service-list').innerHTML = list.map(item => '<article class="service-item"><span class="badge">' + (item.status === 'archived' ? 'Arquivado' : 'Em andamento') + '</span><h3>' + escapeHTML(item.title || 'Serviço sem nome') + '</h3><p>' + escapeHTML(item.scope || 'Sem ambiente informado') + ' · ' + escapeHTML(item.date || '') + '</p><p>' + item.photoCount + ' foto(s)' + (item.percent !== '' ? ' · ' + escapeHTML(item.percent) + '% informado' : '') + '</p><p>' + (item.cloud?.conflict ? 'Outra pessoa atualizou · sua cópia está preservada' : item.cloud?.dirty ? 'Alterações aguardando envio' : item.shared || item.cloud ? 'Salvo na companhia' : 'Somente neste aparelho') + '</p><div class="actions"><button class="primary" data-open-record="' + item.id + '" type="button">Abrir serviço</button>' + (item.local ? '<button class="secondary danger" data-remove-record="' + item.id + '" type="button">Remover do aparelho</button>' : '') + '</div></article>').join('') || '<p>Nenhum serviço nesta seleção.</p>';
  document.querySelectorAll('[data-open-record]').forEach(button => button.onclick = () => void runTask(() => openRecord(button.dataset.openRecord)));
  document.querySelectorAll('[data-remove-record]').forEach(button => button.onclick = () => void runTask(() => removeRecord(button.dataset.removeRecord)));
}
async function runTask(action) { try { await action(); } catch (error) { message(error.message || 'Não foi possível concluir. Tente novamente.', true); } }
async function openRecord(id, forceRemote = false) {
  if (busy || importing || publishing || !library) return;
  if (inFlightRecords.has(id)) { message('Este serviço está sendo enviado. Aguarde alguns segundos e abra novamente.'); return; }
  if (!await saveNow()) return;
  const local = await library.get(id), remote = remoteReports.find(item => item.id === id);
  let record = local;
  if (cloudData && remote && (forceRemote || !local || (!local.cloud?.dirty && remote.revision > (local.cloud?.revision || 0)))) {
    const incoming = await sync.download(id);
    // A network request must not overwrite edits made while the photos were downloading.
    await saveChain;
    const latest = await library.get(id);
    if (!forceRemote && latest?.cloud?.dirty) { record = latest; }
    else record = await library.save(incoming, latest?.localRevision || 0);
  }
  if (!record) throw new Error('Serviço não encontrado.');
  if (record.cloud && cloudData) record.cloud.canEdit = cloudData.user.role === 'admin' || record.cloud.ownerId === cloudData.user.id;
  activate(record); await library.select(id); scheduleSync(); message(''); window.scrollTo(0, 0);
}
async function removeRecord(id) {
  if (busy || importing || publishing || !library || inFlightRecords.has(id)) return;
  if (id === recordId && !await saveNow()) return;
  const record = await library.get(id); if (!record) return;
  if (record.cloud?.dirty) { message('Publique as alterações antes de remover a cópia local. As fotos que ainda não foram enviadas serão preservadas.', true); return; }
  const text = record.cloud ? 'Remover as fotos deste aparelho? O relatório já enviado permanece no servidor e pode ser aberto novamente com login.' : 'Este serviço só existe neste aparelho. Salve uma cópia JSON antes de remover. Remover o registro e suas fotos deste navegador?';
  if (!confirm(text)) return;
  await library.remove(id);
  if (id === recordId) {
    clearTimeout(saveTimer); clearTimeout(syncTimer); invalidate(false); photos = { before: [], after: [], pending: [] }; logo = null; cloud = null; localRevision = 0; recordStatus = 'active'; conflict = false; recordId = crypto.randomUUID(); setValues(defaults()); renderPhotos();
    libraryVisible = true; $('#editor').hidden = true; $('#service-library').hidden = false;
  }
  await renderLibrary(); message('Cópia removida deste aparelho. Arquivos MP4 salvos em Fotos ou Arquivos são gerenciados pelo próprio iPhone.');
}
function refreshCloudControls() {
  $('#cloud-tools').hidden = !cloudData;
  $('#create-cloud-job').hidden = !cloudData || cloudData.user.role !== 'admin' || sync.kind !== 'supabase';
  $('#company-app-link').hidden = sync.kind === 'supabase';
  if (!cloudData) return;
  const selected = cloud?.jobId || $('#cloud-job').value;
  $('#cloud-job').innerHTML = '<option value="">Selecione uma obra</option>' + cloudData.jobs.filter(job => job.status !== 'delivered' || job.id === selected).map(job => '<option value="' + escapeHTML(job.id) + '">' + escapeHTML(job.name) + '</option>').join('');
  $('#cloud-job').value = selected;
  const filterJob = $('#service-job').value;
  $('#service-job-label').hidden = false;
  $('#service-job').innerHTML = '<option value="">Todas as obras e registros locais</option>' + cloudData.jobs.map(job => '<option value="' + escapeHTML(job.id) + '">' + escapeHTML(job.name) + '</option>').join('');
  $('#service-job').value = filterJob;
  $('#sync-status').textContent = conflict ? 'Outra pessoa alterou o relatório. Sua cópia foi preservada.' : publishing ? 'Enviando fotos e registro…' : syncError ? syncError : cloud?.dirty ? 'Salvo no aparelho · aguardando envio' : cloud?.revision ? 'Salvo no servidor · ' + new Date(cloud.syncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Escolha a obra e publique para compartilhar este serviço.';
  $('#reload-remote').hidden = !conflict;
  $('#storage-explanation').textContent = 'Fotos enviadas ficam no servidor da companhia. Use Remover deste aparelho para liberar a cópia local após a confirmação do envio. Registros só locais precisam de cópia de segurança. Esta página não analisa fotos por IA.';
  update();
}
async function flushPending() {
  if (queueRunning || !cloudData || !library || !navigator.onLine) return;
  queueRunning = true; update();
  try {
    for (const item of await library.list()) {
      if (item.id === recordId || !item.cloud?.dirty || item.cloud.conflict || (item.cloud.backendId && item.cloud.backendId !== sync.backendId) || inFlightRecords.has(item.id) || (cloudData.user.role !== 'admin' && item.cloud.ownerId !== cloudData.user.id)) continue;
      inFlightRecords.add(item.id);
      try {
        const sent = await library.get(item.id);
        const result = await sync.publish(sent, sent.cloud.jobId);
        await library.synced(item.id, sent.localRevision, { jobId: result.jobId, revision: result.revision, ownerId: result.ownerId, canEdit: result.canEdit, syncedAt: result.updatedAt, backendId: sync.backendId });
      } catch (error) {
        if (error.status === 409) { const latest = await library.get(item.id); if (latest) { latest.cloud.conflict = true; await library.save(latest, latest.localRevision); } }
        if (error.status === 401 || !navigator.onLine) break;
      } finally { inFlightRecords.delete(item.id); }
    }
    if (libraryVisible) await renderLibrary();
  } finally { queueRunning = false; update(); }
}
function scheduleSync() {
  clearTimeout(syncTimer);
  if (cloudData && cloud?.jobId && cloud.dirty && !conflict && canEdit()) syncTimer = setTimeout(() => void publishRecord(false), 1600);
}
async function publishRecord(explicit = true) {
  if (!cloudData || publishing || busy || importing || conflict || !canEdit()) { if (!explicit) scheduleSync(); return; }
  if (cloud?.backendId && cloud.backendId !== sync.backendId) { if (explicit) message('Este registro pertence a outro projeto. Exporte uma cópia JSON e abra-a como um novo serviço antes de publicar aqui.', true); return; }
  const jobId = cloud?.jobId || $('#cloud-job').value;
  if (!jobId || !values().title.trim()) { if (explicit) message('Informe o nome do serviço e selecione a obra para publicar.', true); return; }
  if (!navigator.onLine) { $('#sync-status').textContent = 'Sem conexão · alterações guardadas no aparelho'; return; }
  if (!cloud) cloud = { jobId, revision: 0, ownerId: cloudData.user.id, canEdit: true, dirty: true, backendId: sync.backendId };
  syncError = ''; publishing = true; clearTimeout(syncTimer); refreshCloudControls();
  try {
    if (!await saveNow()) throw new Error('Salve uma cópia antes de continuar.');
    clearTimeout(syncTimer);
    const sent = await library.get(recordId), id = recordId;
    const result = await sync.publish(sent, jobId);
    await saveChain;
    const synced = await library.synced(id, sent.localRevision, { jobId, revision: result.revision, ownerId: result.ownerId, canEdit: result.canEdit, syncedAt: result.updatedAt, backendId: sync.backendId });
    if (recordId === id) { cloud = synced.cloud; localRevision = synced.localRevision; if (contentKey(snapshot()) !== contentKey(sent)) { cloud.dirty = true; await saveNow(); } }
    if (explicit) message('Atualização salva no servidor da companhia.');
  } catch (error) {
    if (error.status === 409) conflict = true;
    if (error.status === 401) { sync.stop(); $('#connection-status').textContent = 'Sessão encerrada. Entre novamente para enviar.'; $('#cloud-login').hidden = false; }
    syncError = error.message || 'Falha de conexão · registro preservado no aparelho';
    $('#sync-status').textContent = syncError;
    if (explicit || conflict) message(error.message || 'Não foi possível enviar. Seu registro local permanece salvo.', true);
  } finally { publishing = false; refreshCloudControls(); if (cloud?.dirty && !conflict && !syncError) scheduleSync(); }
}
async function refreshShared(change) {
  if (remoteRefreshing || !cloudData) return;
  remoteRefreshing = true;
  try {
    cloudData = await sync.list(); remoteReports = cloudData.reports;
    const current = remoteReports.find(item => item.id === recordId);
    if (current && cloud && current.revision > cloud.revision && !publishing && !busy && !importing) {
      if (cloud.dirty) conflict = true;
      else if (!libraryVisible) {
        const expectedId = recordId, expectedRevision = localRevision, incoming = await sync.download(recordId);
        if (recordId === expectedId && localRevision === expectedRevision && !cloud?.dirty && !busy && !importing) { const saved = await library.save(incoming, localRevision); activate(saved); }
      }
    }
    refreshCloudControls(); if (libraryVisible) await renderLibrary();
  } catch (error) { $('#connection-status').textContent = error.status === 401 ? 'Entre novamente para acompanhar a companhia' : 'Sem conexão com a companhia · dados locais preservados'; if (error.status === 401) { sync.stop(); $('#cloud-login').hidden = false; } }
  finally { remoteRefreshing = false; }
}
async function enterShared() {
  cloudData = await sync.list(); remoteReports = cloudData.reports;
  $('#cloud-login').hidden = true; $('#cloud-account').hidden = false; $('#cloud-user').textContent = cloudData.user.name;
  $('#connection-title').textContent = 'Registros da companhia'; $('#connection-description').textContent = 'Usuários autenticados desta companhia acompanham as mesmas obras. Cada profissional publica seus registros; administradores podem revisar e editar.';
  if (cloud) cloud.canEdit = cloudData.user.role === 'admin' || cloud.ownerId === cloudData.user.id;
  if (!values().title.trim() && !countPhotos() && !values().completed && !values().remaining) { form.elements.author.value = cloudData.user.name; await saveNow(); }
  refreshCloudControls(); sync.watch();
  const requested = new URLSearchParams(location.search).get('report'); if (requested && remoteReports.some(item => item.id === requested)) await openRecord(requested);
  const requestedJob = new URLSearchParams(location.search).get('job');
  if (requestedJob && cloudData.jobs.some(job => job.id === requestedJob) && !requested) { $('#service-job').value = requestedJob; $('#cloud-job').value = requestedJob; await showLibrary(); }
  scheduleSync(); void flushPending();
}
async function startShared() {
  try { cloudAvailable = await sync.detect(); } catch (error) { $('#connection-status').textContent = error.message; return; }
  if (!cloudAvailable) { $('#connection-description').textContent = cloud ? 'Sem acesso ao servidor: este serviço permanece neste aparelho. As alterações aguardam conexão e login para envio.' : 'Modo local: serviços e fotos ficam neste navegador, separados por registro. Este link ainda não compartilha atualizações entre aparelhos. Salve uma cópia antes de remover dados locais.'; return; }
  $('#connection-title').textContent = 'Acesse sua companhia'; $('#connection-description').textContent = 'Entre para compartilhar fotos e acompanhar as atualizações das obras.';
  if (sync.kind === 'supabase') { $('#login-label').textContent = 'Seu e-mail'; $('#cloud-login').elements.login.type = 'email'; }
  $('#cloud-login').hidden = false;
  try { await enterShared(); } catch (error) { $('#connection-status').textContent = error.status === 401 ? (sync.kind === 'supabase' ? 'Entre com seu e-mail e senha.' : 'Entre com seu ID e senha.') : error.message; }
}
function wireWorkspace() {
  $('#create-cloud-job').onclick = () => { $('#cloud-job-form').reset(); $('#job-form-status').textContent = ''; $('#job-dialog').showModal(); };
  $('#cancel-cloud-job').onclick = () => $('#job-dialog').close();
  $('#cloud-job-form').onsubmit = event => { event.preventDefault(); void runTask(async () => {
    const form = $('#cloud-job-form'), button = form.querySelector('[type=submit]'); button.disabled = true; $('#job-form-status').textContent = 'Salvando obra…';
    try { const job = await sync.createJob(form.elements.name.value, form.elements.address.value); await refreshShared(); $('#cloud-job').value = job.id; $('#job-dialog').close(); message('Obra cadastrada. Agora você pode vincular o serviço e publicar as fotos.'); }
    catch (error) { $('#job-form-status').textContent = error.message; } finally { button.disabled = false; }
  }); };
  $('#show-services').onclick = $('#save-service').onclick = () => void runTask(showLibrary);
  $('#new-service').onclick = () => void runTask(() => newRecord(false));
  $('#service-search').oninput = $('#service-filter').onchange = $('#service-job').onchange = () => void runTask(renderLibrary);
  $('#archive-report').onclick = () => void runTask(async () => { if (busy || importing || publishing || !canEdit()) return; recordStatus = recordStatus === 'archived' ? 'active' : 'archived'; if (cloud) cloud.dirty = true; await saveNow(); update(); refreshCloudControls(); message(recordStatus === 'archived' ? 'Serviço arquivado. Ele continua disponível no filtro Arquivados. Arquivar não altera o percentual nem confirma a entrega da obra.' : 'Serviço reaberto. Histórico e fotos preservados.'); });
  $('#remove-local').onclick = () => void runTask(() => removeRecord(recordId));
  $('#publish-report').onclick = () => void publishRecord(true);
  $('#cloud-login').onsubmit = event => { event.preventDefault(); void runTask(async () => { const element = $('#cloud-login'); await sync.login(element.elements.login.value, element.elements.password.value); element.elements.password.value = ''; await enterShared(); }); };
  $('#cloud-logout').onclick = () => void runTask(async () => {
    if (busy || importing || publishing || !library) return;
    if (!await saveNow()) return;
    const list = await library.list(); if (list.some(item => item.cloud?.dirty)) { message('Há alterações compartilhadas ainda não enviadas. Publique ou salve uma cópia antes de sair.', true); return; }
    if (!confirm('Sair e remover as cópias compartilhadas deste aparelho? Os registros enviados permanecem no servidor. Serviços só locais serão mantidos.')) return;
    await sync.logout();
    for (const item of list) if (item.cloud) await library.remove(item.id);
    cloudData = null; remoteReports = []; cloud = null; activate({ id: crypto.randomUUID(), fields: defaults(), photos: {}, status: 'active' }); await saveNow();
    $('#cloud-login').hidden = false; $('#cloud-account').hidden = true; $('#cloud-tools').hidden = true; $('#service-job-label').hidden = true; $('#service-job').value = ''; $('#connection-title').textContent = 'Acesse sua companhia'; $('#connection-status').textContent = 'Sessão encerrada · cópias compartilhadas removidas'; await showLibrary();
  });
  $('#reload-remote').onclick = () => void runTask(async () => {
    if (!conflict || !cloud || publishing || busy || importing) return;
    if (!await saveNow()) return;
    const originalId = recordId, original = await library.get(recordId);
    const copy = { ...original, id: crypto.randomUUID(), cloud: null, fields: { ...original.fields, title: (original.fields.title + ' · cópia local').slice(0, 70) } };
    await library.save(copy, 0);
    await openRecord(originalId, true); message('Sua edição foi preservada como outro serviço local. A versão atual do servidor está aberta.');
  });
  window.addEventListener('online', () => { if (!cloudData) void startShared(); else { void refreshShared(); scheduleSync(); void flushPending(); } });
  window.addEventListener('offline', () => { if (cloud) $('#sync-status').textContent = 'Sem conexão · alterações guardadas no aparelho'; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshShared(); });
}
async function boot() {
  setValues(defaults());
  try {
    library = await FieldReportLibrary.open();
    library.db.onversionchange = () => { library.db.close(); library = null; warning('Atualização em outra aba. Salve uma cópia e reabra a página.'); };
    const current = await library.current(), draft = current ? await library.get(current) : null;
    if (draft) activate(draft);
    $('#save-status').textContent = draft ? 'Serviço recuperado deste navegador' : 'Novo serviço · salvo ao preencher';
    if (!draft) await saveNow();
  } catch { library = null; $('#save-status').textContent = 'Só nesta aba'; warning('O armazenamento não está disponível. Salve uma cópia antes de fechar. A troca entre serviços precisa do armazenamento do navegador.'); }
  lockFields(); renderPhotos();
  wireWorkspace();
  void startShared();
  const supported = !!codec();
  $('#compatibility').textContent = supported ? 'Este navegador informa suporte a MP4. Faça um vídeo de teste hoje antes de depender da exportação em campo.' : 'MP4 não está disponível neste navegador. Use o Safari atualizado no iPhone e teste a exportação.';
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (event.target.type !== 'file') { invalidate(); update(); scheduleSave(); } });
  $('#company-logo').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || busy || importing) return;
    importing = true; fields.disabled = true; update();
    try { logo = await prepareImage(file, true); invalidate(); await saveNow(); } catch (error) { message(error.message, true); }
    finally { importing = false; lockFields(); renderPhotos(); }
  };
  $('#remove-logo').onclick = () => { logo = null; invalidate(); renderPhotos(); void saveNow(); };
  $('#preview').onclick = () => void play(false); $('#export').onclick = () => void play(true);
  $('#cancel-render').onclick = () => controller?.abort(); $('#backup').onclick = () => void backup();
  $('#new-report').onclick = () => void newRecord(true);
  $('#restore').onchange = event => { const file = event.target.files[0]; event.target.value = ''; void restore(file); };
  $('#share').onclick = async () => {
    if (!videoFile) return;
    try {
      if (navigator.canShare?.({ files: [videoFile] })) await navigator.share({ files: [videoFile], title: values().title });
      else message('Use Salvar MP4. Depois, abra o arquivo nos Arquivos ou Fotos e compartilhe pelo iPhone.');
    } catch (error) { if (error.name !== 'AbortError') message('O compartilhamento não foi concluído. Use Salvar MP4 e compartilhe o arquivo pelo iPhone.', true); }
  };
  if ('serviceWorker' in navigator && isSecureContext) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready; $('#offline-status').textContent = 'Página preparada para reabrir sem conexão';
      const prompt = () => { if (registration.waiting) $('#update-notice').hidden = false; };
      prompt(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', prompt));
      $('#apply-update').onclick = async () => { if (busy || importing) { message('Aguarde o fim da operação antes de atualizar.'); return; } await saveNow(); if (registration.waiting) { navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); registration.waiting.postMessage('ACTIVATE_UPDATE'); } else location.reload(); };
    } catch { $('#offline-status').textContent = navigator.serviceWorker.controller ? 'Página disponível pelo acesso sem conexão já preparado' : 'Reabrir a página pode exigir conexão'; }
  } else $('#offline-status').textContent = 'Reabrir a página exige conexão';
}
void boot();

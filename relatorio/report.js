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
const defaults = () => ({ title: '', date: today(), author: 'Bruno', scope: 'Grouting', language: 'en', percent: '', company: '', completed: '', remaining: '' });
let photos = { before: [], after: [], pending: [] }, logo = null, db = null, saveTimer, saveChain = Promise.resolve();
let busy = false, importing = false, controller = null, videoFile = null, videoURL = null, wakeLock = null;
const urls = new Set();
const objectURL = blob => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
const revoke = url => { if (url) { URL.revokeObjectURL(url); urls.delete(url); } };
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const values = () => Object.fromEntries(names.map(name => [name, form.elements[name].value]));
const countPhotos = () => groups.reduce((sum, group) => sum + photos[group.id].length, 0);
function message(text, error = false) {
  const element = $('#message'); element.textContent = text; element.className = 'notice' + (error ? ' error' : ''); element.hidden = !text;
}
function warning(text) { $('#storage-warning').textContent = text; $('#storage-warning').hidden = !text; }
function invalidate() {
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
function snapshot() { return { version: 1, fields: values(), photos, logo, savedAt: Date.now() }; }
function openDB() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error('storage timeout')); }, 1800);
    let request;
    try { request = indexedDB.open('field-report-v1', 1); } catch (error) { clearTimeout(timer); reject(error); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onsuccess = () => { if (finished) { request.result.close(); return; } finished = true; clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { if (!finished) { finished = true; clearTimeout(timer); reject(request.error); } };
  });
}
function readDB() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('draft', 'readonly').objectStore('draft').get('current');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function saveNow() {
  clearTimeout(saveTimer);
  const data = snapshot();
  if (!db) { $('#save-status').textContent = 'Rascunho só nesta aba · salve uma cópia'; return Promise.resolve(); }
  $('#save-status').textContent = 'Salvando neste navegador…';
  saveChain = saveChain.catch(() => {}).then(() => new Promise((resolve, reject) => {
    let transaction;
    try { transaction = db.transaction('draft', 'readwrite'); transaction.objectStore('draft').put(data, 'current'); }
    catch (error) { reject(error); return; }
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  })).then(() => { $('#save-status').textContent = 'Salvo neste navegador'; }).catch(() => {
    $('#save-status').textContent = 'Não foi possível salvar o rascunho';
    warning('O navegador não conseguiu guardar as fotos. Use “Salvar cópia do registro” antes de fechar esta aba.');
  });
  return saveChain;
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
  $('#language-hint').textContent = form.elements.language.value === 'en' ? 'As legendas fixas serão em inglês. Escreva os textos abaixo em inglês, se quiser incluí-los.' : 'As legendas fixas e os textos do vídeo podem ficar em português.';
  const differentDay = values().date && values().date !== today();
  $('#date-notice').hidden = !differentDay;
  $('#date-notice').textContent = differentDay ? 'Confira a data: este registro está em ' + values().date + ', diferente de hoje. Para outro dia de trabalho, você pode iniciar um Novo relatório após salvar sua cópia.' : '';
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
  } finally { importing = false; fields.disabled = false; $('#photo-status').textContent = ''; renderPhotos(); }
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
  await saveNow(); invalidate(); message('');
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
    document.removeEventListener('visibilitychange', visibility); controller = null; busy = false; fields.disabled = false;
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
    if (countPhotos() && !confirm('Abrir esta cópia substitui o rascunho atual neste navegador. Deseja continuar?')) return;
    photos = restored; logo = restoredLogo; setValues(data.fields); invalidate(); renderPhotos(); await saveNow(); message('Registro recuperado da cópia salva.');
  } catch { message('Não foi possível abrir essa cópia. Escolha o arquivo JSON exportado por esta página.', true); }
}
async function boot() {
  setValues(defaults());
  try {
    db = await openDB(); db.onversionchange = () => { db.close(); db = null; warning('O armazenamento foi atualizado em outra aba. Salve uma cópia e reabra esta página.'); };
    const draft = await readDB();
    if (draft?.version === 1 && draft.fields && draft.photos) {
      setValues(draft.fields);
      for (const group of groups) if (Array.isArray(draft.photos[group.id])) photos[group.id] = draft.photos[group.id].filter(item => item.blob instanceof Blob).slice(0, 4);
      if (draft.logo?.blob instanceof Blob) logo = draft.logo;
    }
    $('#save-status').textContent = draft ? 'Rascunho recuperado deste navegador' : 'Rascunho salvo neste navegador';
  } catch { db = null; $('#save-status').textContent = 'Rascunho só nesta aba'; warning('O armazenamento não está disponível. Use “Salvar cópia do registro” antes de fechar ou trocar de aparelho.'); }
  fields.disabled = false; renderPhotos();
  const supported = !!codec();
  $('#compatibility').textContent = supported ? 'Este navegador informa suporte a MP4. Faça um vídeo de teste hoje antes de depender da exportação em campo.' : 'MP4 não está disponível neste navegador. Use o Safari atualizado no iPhone e teste a exportação.';
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (event.target.type !== 'file') { invalidate(); update(); scheduleSave(); } });
  $('#company-logo').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || busy || importing) return;
    importing = true; fields.disabled = true; update();
    try { logo = await prepareImage(file, true); invalidate(); await saveNow(); } catch (error) { message(error.message, true); }
    finally { importing = false; fields.disabled = false; renderPhotos(); }
  };
  $('#remove-logo').onclick = () => { logo = null; invalidate(); renderPhotos(); void saveNow(); };
  $('#preview').onclick = () => void play(false); $('#export').onclick = () => void play(true);
  $('#cancel-render').onclick = () => controller?.abort(); $('#backup').onclick = () => void backup();
  $('#new-report').onclick = async () => {
    if (busy || importing) return;
    if (!confirm('Iniciar um novo relatório substitui este rascunho. Salve o MP4 e uma cópia do registro se quiser manter as fotos. Continuar?')) return;
    photos = { before: [], after: [], pending: [] }; logo = null; setValues(defaults()); invalidate(); renderPhotos(); await saveNow();
    message('Novo relatório iniciado. O rascunho anterior só permanece nas cópias que você salvou.'); window.scrollTo(0, 0);
  };
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

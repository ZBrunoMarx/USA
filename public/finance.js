// Shared rules for the server and standalone prototype. USD values are integer cents.
(function () {
  const categories = Object.freeze({ materials: 'Materiais', travel: 'Deslocamento / pedágio', parking: 'Estacionamento', other: 'Outros' });
  const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
  const money = cents => cents === null || cents === undefined ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(cents / 100);
  function cents(value, optional = true) {
    if (optional && (value === null || value === undefined || value === '')) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000000000) fail('Informe um valor válido em centavos de dólar.');
    return value;
  }
  function parseMoney(value) {
    const s = String(value ?? '').trim(); if (!s) return null;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) fail('Use um valor como 250,00 ou 250.00, sem separador de milhares.');
    const [whole, decimals = ''] = s.replace(',', '.').split('.');
    return cents(Number(whole) * 100 + Number(decimals.padEnd(2, '0')), false);
  }
  function validDate(value, optional = false) {
    if (optional && !value) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Informe uma data válida.');
    return value;
  }
  const emptySettings = () => ({ contractCents: null, budgetCents: null, remainingCents: null, deadline: null, expectedFinish: null, estimatedCommitmentCents: null });
  function migrate(state) {
    let changed = false;
    if (!state.finance) { state.finance = { rates: {} }; changed = true; }
    for (const j of state.jobs) if (!j.finance) { j.finance = { settings: emptySettings(), expenses: [], labor: [], history: [] }; changed = true; }
    return changed;
  }
  function totals(job) {
    const f = job.finance || { expenses: [], labor: [] };
    const approved = f.expenses.filter(e => e.status === 'approved').reduce((n, e) => n + e.amountCents, 0);
    const labor = f.labor.reduce((n, d) => n + d.people.reduce((s, p) => s + p.amountCents, 0), 0);
    const pending = f.expenses.filter(e => e.status === 'pending').reduce((n, e) => n + e.amountCents, 0);
    return { approved, labor, confirmed: approved + labor, pending, pendingCount: f.expenses.filter(e => e.status === 'pending').length };
  }
  function summary(job, today) {
    const t = totals(job), settings = job.finance?.settings || emptySettings();
    const commitment = t.confirmed + t.pending;
    const projected = settings.remainingCents === null ? null : commitment + settings.remainingCents;
    const stale = projected !== null && settings.estimatedCommitmentCents !== commitment;
    const budgetStatus = settings.budgetCents === null ? 'unknown' : t.confirmed > settings.budgetCents ? 'exceeded' : projected !== null && !stale && projected > settings.budgetCents ? 'risk' : stale ? 'review' : 'within';
    const deliveredDate = job.deliveredAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(job.deliveredAt)) : null;
    const due = settings.deadline, finish = deliveredDate || settings.expectedFinish;
    const schedule = !due ? 'unknown' : deliveredDate ? deliveredDate > due ? 'delivered_late' : 'delivered_on_time' : today > due ? 'late' : !finish ? 'unestimated' : finish > due ? 'risk' : finish < due ? 'ahead' : 'on_time';
    // A planned team is not proof of attendance. Show unconfirmed past/today scales.
    const referenceDays = new Set([...(job.assignments || []).filter(a => a.date <= today && a.userIds.length).map(a => a.date), ...(job.entries || []).filter(e => e.date <= today).map(e => e.date)]);
    const unconfirmedDays = [...referenceDays].filter(date => !job.finance?.labor.some(d => d.date === date)).length;
    return { ...t, projected, stale, budgetStatus, schedule, unconfirmedDays, ...settings,
      projectedResult: projected !== null && settings.contractCents !== null ? settings.contractCents - projected : null };
  }
  function jobView(job, user) {
    if (user.role === 'admin') return job;
    const { finance, ...publicJob } = job;
    return { ...publicJob, myExpenses: (finance?.expenses || []).filter(e => e.authorId === user.id).map(({ reviewedBy, ...e }) => e) };
  }
  function stateView(state, user, today) {
    if (user.role === 'admin') return { ...state, today };
    const { finance, chat, ...publicState } = state;
    return { ...publicState, today, chat: [], jobs: state.jobs.map(j => jobView(j, user)) };
  }
  function setRate(state, userId, value) { migrate(state); state.finance.rates[userId] = cents(value); }
  function handle(state, path, body, user, context) {
    const match = path.match(/^\/jobs\/([^/]+)\/(finance|labor|expenses)(?:\/([^/]+)\/review)?$/);
    if (!match) return null;
    const job = state.jobs.find(j => j.id === match[1]); if (!job) fail('Obra não encontrada.', 404);
    const f = job.finance; const admin = () => { if (user.role !== 'admin') fail('Somente administradores podem gerenciar os custos.', 403); };
    const log = (action, before, after) => f.history.push({ id: context.id(), at: context.now(), author: user.name, action, before: structuredClone(before), after: structuredClone(after) });
    if (match[2] === 'finance') {
      admin(); if (match[3]) fail('Operação inválida.');
      const settings = { contractCents: cents(body.contractCents), budgetCents: cents(body.budgetCents), remainingCents: cents(body.remainingCents), deadline: validDate(body.deadline, true), expectedFinish: validDate(body.expectedFinish, true), estimatedCommitmentCents: totals(job).confirmed + totals(job).pending, updatedAt: context.now(), updatedBy: user.name };
      log('Referências de custo e prazo atualizadas', f.settings, settings); f.settings = settings;
    } else if (match[2] === 'expenses' && !match[3]) {
      if (job.status === 'delivered' && user.role !== 'admin') fail('Peça a um administrador para lançar um gasto da obra entregue.');
      const amountCents = cents(body.amountCents, false); if (!amountCents) fail('O gasto precisa ser maior que zero.');
      if (!Object.hasOwn(categories, body.category)) fail('Selecione uma categoria de gasto.');
      const date = validDate(body.date); if (date > context.today) fail('Registre gastos ocorridos até hoje.');
      const note = String(body.note || '').trim(); if (note.length > 1000) fail('Descrição muito longa.');
      const expense = { id: context.id(), at: context.now(), date, amountCents, category: body.category, note, receipt: context.receipt(body.receipt), authorId: user.id, author: user.name, status: user.role === 'admin' ? 'approved' : 'pending' };
      if (user.role === 'admin') { expense.reviewedBy = user.name; expense.reviewedAt = context.now(); }
      f.expenses.push(expense); log('Gasto registrado', null, expense);
    } else if (match[2] === 'expenses') {
      admin(); const expense = f.expenses.find(e => e.id === match[3]); if (!expense) fail('Gasto não encontrado.', 404);
      if (!['approved', 'rejected', 'voided'].includes(body.status)) fail('Decisão inválida.');
      if (body.status === expense.status) return jobView(job, user);
      if (!((expense.status === 'pending' && ['approved', 'rejected'].includes(body.status)) || (expense.status === 'approved' && body.status === 'voided'))) fail('Esta decisão não pode ser alterada. Lance uma correção separada.');
      const reason = String(body.reason || '').trim(); if (reason.length > 1000 || (body.status !== 'approved' && !reason)) fail('Informe o motivo da decisão.');
      const before = structuredClone(expense); Object.assign(expense, { status: body.status, reason, reviewedAt: context.now(), reviewedBy: user.name }); log('Gasto conferido', before, expense);
    } else if (match[2] === 'labor') {
      admin(); if (match[3]) fail('Operação inválida.');
      const date = validDate(body.date); if (date > context.today) fail('Confirme somente dias que já aconteceram.');
      if (!Array.isArray(body.people) || body.people.length > 100 || new Set(body.people.map(p => p.userId)).size !== body.people.length) fail('Selecione cada profissional apenas uma vez.');
      const prior = f.labor.find(d => d.date === date);
      const people = body.people.map(p => {
        const person = state.users.find(u => u.id === p.userId); if (!person || (person.active === false && !prior?.people.some(v => v.userId === p.userId))) fail('Profissional inválido.');
        if (![.5, 1].includes(p.fraction)) fail('Escolha meia diária ou uma diária.');
        const used = state.jobs.filter(j => j.id !== job.id).flatMap(j => j.finance.labor.filter(d => d.date === date).flatMap(d => d.people.filter(v => v.userId === p.userId))).reduce((n, p) => n + p.fraction, 0);
        if (used + p.fraction > 1) fail(`${person.name} já tem diária confirmada em outra obra neste dia. Ajuste a divisão entre as obras.`);
        const rateCents = cents(p.rateCents, false);
        return { userId: person.id, name: person.name, fraction: p.fraction, rateCents, amountCents: Math.round(rateCents * p.fraction) };
      });
      const record = { id: prior?.id || context.id(), date, people, confirmedAt: context.now(), confirmedBy: user.name };
      log('Diárias confirmadas', prior || null, record); f.labor = f.labor.filter(d => d.date !== date); f.labor.push(record);
    }
    return jobView(job, user);
  }
  function demo(state, today) {
    // Replace, never copy, actual financial data into a shareable standalone HTML.
    state.finance = { rates: {} };
    for (const j of state.jobs) j.finance = { settings: emptySettings(), expenses: [], labor: [], history: [] };
    const job = state.jobs.find(j => j.id === 'demo-manhattan');
    if (job) {
      job.finance.settings = { ...emptySettings(), contractCents: 1000000, budgetCents: 700000, remainingCents: 340000, estimatedCommitmentCents: 420000, deadline: today, expectedFinish: today };
      job.finance.expenses = [{ id: 'demo-expense-materials', date: today, at: today + 'T12:00:00Z', category: 'materials', note: 'Compra fictícia para demonstrar o controle de custos.', amountCents: 420000, status: 'approved', authorId: 'thiago', author: 'Thiago', receipt: null, demo: true }];
    }
  }
  globalThis.SkytileFinance = Object.freeze({ categories, money, cents, parseMoney, validDate, migrate, totals, summary, jobView, stateView, setRate, handle, demo });
})();

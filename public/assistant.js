// Local queries only: no language model or media interpretation.
(function () {
const { jobProgress } = globalThis.SkytileProgress;
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const progressNames = { not_started: 'Não iniciado', started: 'Iniciado', ongoing: 'Em andamento', almost: 'Quase concluído', review: 'Aguardando avaliação', done: 'Conclusão relatada' };
function respond(state, question, jobId, today) {
  const q = normalize(question);
  if (!jobId) {
    const named = state.jobs.filter(j => q.includes(normalize(j.name)));
    if (named.length === 1) jobId = named[0].id;
  }
  const all = jobId ? state.jobs.filter(j => j.id === jobId) : state.jobs;
  if (jobId && !all.length) fail('Obra não encontrada.', 404);
  const active = all.filter(j => j.status !== 'delivered');
  const scope = jobId ? all : active;
  const links = [];
  const link = (j, entry = null) => { links.push({ jobId: j.id, jobName: j.name, roomId: entry?.roomId || null, entryId: entry?.id || null, label: entry ? `${j.name} · ${entry.author} · ${entry.date}` : j.name }); };
  let answer;
  if (/estoque|ferrament/.test(q)) {
    answer = 'Este protótipo ainda não registra estoque ou ferramentas. Para custos, posso consultar gastos, diárias confirmadas, orçamento e valor contratado.';
  } else if (/custo|gast|despesa|orcam|receita|valor.*(contrat|obra)|resultado|lucro|financeir/.test(q)) {
    const F = globalThis.SkytileFinance;
    answer = 'Custos registrados por obra (USD):\n\n' + scope.map(j => {
      link(j); const s = F.summary(j, today);
      return `${j.name}\nValor contratado: ${F.money(s.contractCents)} (não indica recebimento).\nOrçamento de custos: ${F.money(s.budgetCents)}.\nGasto confirmado: ${F.money(s.confirmed)}; diárias confirmadas: ${F.money(s.labor)}.\nGastos aguardando conferência: ${F.money(s.pending)} (${s.pendingCount}).\nEstimativa adicional: ${F.money(s.remainingCents)}.\nCusto final previsto: ${F.money(s.projected)}${s.stale ? ' — revise a estimativa após os novos gastos' : ''}.\nResultado estimado antes de despesas gerais: ${F.money(s.projectedResult)}.\n${s.budgetStatus === 'exceeded' ? 'O gasto confirmado já excedeu o orçamento.' : s.budgetStatus === 'risk' ? 'A previsão final excede o orçamento.' : s.budgetStatus === 'unknown' ? 'Orçamento ainda não informado.' : s.stale ? 'Previsão precisa de revisão.' : 'Gasto confirmado dentro do orçamento.'}${s.unconfirmedDays ? ` ${s.unconfirmedDays} dia(s) de escala até hoje sem diárias confirmadas.` : ''}`;
    }).join('\n\n') + '\n\nGastos registrados podem estar incompletos. A previsão inclui os gastos enviados para conferência e o restante estimado pelo administrador. Recebimentos e despesas gerais não são controlados nesta versão.';
  } else if (/prazo|adiant|previsao.*(termin|entreg)|atraso|atrasad/.test(q)) {
    const labels = { unknown: 'prazo não informado', unestimated: 'previsão de término não informada', late: 'data combinada ultrapassada', risk: 'risco de atraso', ahead: 'previsão de entrega antecipada', on_time: 'previsão dentro do prazo', delivered_late: 'entregue após a data combinada', delivered_on_time: 'entregue dentro do prazo' };
    answer = 'Prazos das obras:\n\n' + scope.map(j => { link(j); const s = globalThis.SkytileFinance.summary(j,today); return `${j.name}: ${labels[s.schedule]}. Entrega combinada: ${s.deadline || 'não informada'}; previsão de término: ${s.expectedFinish || 'não informada'}.`; }).join('\n') + '\n\nA previsão é informada pelo administrador. O percentual de avanço não calcula automaticamente a data de término.';
  } else if (/material/.test(q)) {
    answer = 'Os gastos com materiais podem ser registrados por obra. Estoque e quantidades disponíveis ainda não são controlados. Experimente “Como estão os custos das obras?”.';
  } else if ((/cadastr/.test(q) && /profission|equipe|colabor|pessoa|guys/.test(q)) || /funcao|habilidad|especial|helper|ajudant|instalador|grout/.test(q) || (/profission/.test(q) && !/hoje|ontem|amanha|\d{4}-\d{2}-\d{2}|escal/.test(q))) {
    const people = state.users.filter(u => u.active !== false);
    const named = people.filter(u => new RegExp('(?:^|[^a-z0-9])' + normalize(u.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])').test(q));
    const subset = named.length ? named : /helper|ajudant/.test(q) ? people.filter(u => u.position === 'helper') : /grout|especial.*rejunte/.test(q) ? people.filter(u => u.position === 'grout') : /instalador/.test(q) ? people.filter(u => u.position === 'installer') : people;
    answer = subset.length ? 'Profissionais cadastrados:\n\n' + subset.map(u => `${u.name} (${u.code}) — ${globalThis.SkytileTeam.positions[u.position] || u.specialty}. ${u.skills?.length ? 'Etapas informadas: ' + u.skills.join(', ') + '.' : 'Etapas ainda não informadas.'}`).join('\n') : 'Nenhum profissional cadastrado para essa função.';
    links.push({ kind: 'team', label: 'Cadastro da equipe' });
  } else if (/percent|porcent|conclusao/.test(q)) {
    answer = 'Avanço das obras:\n\n' + scope.map(j => {
      const p = jobProgress(j); link(j);
      return `${j.name}: ${p.percent}% — ${p.confirmed ? 'entrega confirmada' : `estimativa; ${p.known} de ${p.total} serviços com estimativa${p.review ? '; avaliação pendente' : ''}`}.`;
    }).join('\n') + '\n\nMédia dos serviços com o mesmo peso, arredondada a 5 pontos. Serviços sem estimativa contribuem com 0%. Não considera metragem ou duração.';
  } else if (/equipe|quem|profission|trabalh|escal/.test(q) && !/avanc|progres/.test(q)) {
    let targetDate = today;
    const requestedDate = q.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (requestedDate) targetDate = requestedDate;
    else if (/ontem|amanha/.test(q)) { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (q.includes('ontem') ? -1 : 1)); targetDate = d.toISOString().slice(0, 10); }
    answer = `Equipe registrada para ${targetDate}:\n\n` + scope.map(j => {
      const a = j.assignments.find(a => a.date === targetDate); link(j);
      return `${j.name}: ${a?.userIds.length ? a.userIds.map(id => state.users.find(u => u.id === id)?.name).join(', ') : 'nenhuma equipe anotada para esta data'}.`;
    }).join('\n') + '\n\nA escala é diária e não restringe o acesso às obras. Relatos enviados não comprovam a presença durante toda a diária.';
  } else if (/pend|bloque|atras|avali|falta|aguard/.test(q)) {
    const found = [];
    for (const j of scope) for (const room of j.rooms) {
      for (const service of room.services) {
        const e = [...j.entries].reverse().find(e => e.roomId === room.id && e.service === service);
        if (e && (e.progress === 'review' || /aguard|falt|impedi|bloque|pend|atras/i.test(e.note) || (e.analysis?.status==='complete'&&e.analysis.verdict!=='compatible'&&(!e.analysis.review||e.analysis.review.decision==='needs_check')))) { found.push(`${j.name} / ${room.name} / ${service}: ${e.note || progressNames[e.progress]}${e.analysis?.status==='complete'?' · Observação visual da IA: '+e.analysis.summary:''}`); link(j, e); }
      }
    }
    answer = found.length ? 'Pendências identificadas nos últimos relatos de cada serviço:\n\n' + found.join('\n\n') : 'Não encontrei pendências explícitas nos últimos relatos dos serviços deste recorte. Isso não confirma que todos os serviços estão liberados.';
  } else if (/finaliz|entreg|encerr/.test(q) && !jobId) {
    const delivered = all.filter(j => j.status === 'delivered'); delivered.forEach(j => link(j));
    answer = delivered.length ? 'Obras entregues:\n\n' + delivered.map(j => `${j.name} — histórico preservado; pode ser reaberta para ajuste.`).join('\n') : 'Não há obras entregues registradas.';
  } else if (/obra|abert/.test(q) && !/resum|avanc|progres|hoje|relat|situac/.test(q) && !jobId) {
    active.forEach(j => link(j)); answer = `${active.length} obra(s) aberta(s):\n\n` + active.map(j => `${j.name} — ${j.status === 'planned' ? 'Planejada' : 'Em andamento'}; ${j.rooms.length} ambiente(s).`).join('\n');
  } else if (/resum|avanc|progres|hoje|relat|situac|acontec|status/.test(q)) {
    answer = 'Resumo dos registros disponíveis:\n\n' + scope.map(j => {
      const latest = j.rooms.flatMap(room => room.services.map(service => {
        const e = [...j.entries].reverse().find(e => e.roomId === room.id && e.service === service && (!q.includes('hoje') || e.date === today));
        if (!e) return `${room.name} / ${service}: sem registro${q.includes('hoje') ? ' hoje' : ' de avanço'}.`;
        link(j, e); return `${room.name} / ${e.service}: ${progressNames[e.progress]}. ${e.note || 'Registro sem relato escrito.'} (${e.author}, ${e.date})`;
      })); if (!links.some(s => s.jobId === j.id)) link(j);
      const p = jobProgress(j); return `${j.name} — ${p.percent}% (${p.confirmed ? 'entrega confirmada' : 'avanço estimado'})\n${latest.join('\n')}`;
    }).join('\n\n') + '\n\nResumo local dos relatos. Análises visuais, quando disponíveis nos registros, são estimativas para revisão humana e não validam tecnicamente o serviço.';
  } else {
    answer = 'No modo local, consigo consultar: obras abertas ou entregues, resumo de avanço, pendências e equipe de hoje. Também consulto custos e prazos. Experimente “Quais são as pendências?” ou selecione uma obra e peça um resumo. Interpretação livre por IA e transcrição de áudio ainda não estão conectadas.';
  }
  if (!scope.length && !links.length && !/material|ferrament|estoque|custo|gast|despesa/.test(q)) answer = 'Não há obras abertas neste recorte. Você pode consultar as obras entregues ou cadastrar uma nova obra.';
  return { answer, sources: links, mode: 'local' };
}
globalThis.SkytileAssistant = { respond };
})();

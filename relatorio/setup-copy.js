'use strict';
const setupCode = document.querySelector('#setup-sql');
const setupStatus = document.querySelector('#copy-status');
function selectSetupCode() {
  document.querySelector('#sql-details').open = true;
  setupCode.focus(); setupCode.select(); setupCode.setSelectionRange(0, setupCode.value.length);
  setupStatus.textContent = 'Código selecionado. No Mac, pressione ⌘ + C para copiar. Depois cole no SQL Editor com ⌘ + V.';
}
document.querySelector('#copy-sql').onclick = async () => {
  try {
    await navigator.clipboard.writeText(setupCode.value);
    setupStatus.textContent = 'Código completo copiado. Abra o SQL Editor, cole com ⌘ + V no Mac e toque em Run.';
  } catch { selectSetupCode(); }
};
document.querySelector('#select-sql').onclick = selectSetupCode;

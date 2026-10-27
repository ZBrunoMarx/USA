'use strict';
const adminSetupForm = document.querySelector('#admin-setup-form');
const adminSQLTemplate = document.querySelector('#admin-sql-template').value;
// Explicit PostgreSQL escape strings preserve apostrophes/backslashes as data.
const postgresLiteral = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
globalThis.prepareSetupSQL = () => {
  if (!adminSetupForm.reportValidity()) return false;
  const email = adminSetupForm.elements.email.value.trim();
  const name = adminSetupForm.elements.displayName.value.trim();
  const company = adminSetupForm.elements.company.value.trim();
  if (!email || !name || !company) { document.querySelector('#copy-status').textContent = 'Preencha seu e-mail, nome e companhia.'; return false; }
  const values = { admin_email: email, admin_name: name, company_name: company };
  let delimiter = '$field_report_admin$', suffix = 0;
  while (Object.values(values).some(value => value.includes(delimiter))) delimiter = '$field_report_admin_' + (++suffix) + '$';
  // Protect the outer DO body as well as SQL string literals. Replace declarations
  // in one pass so inserted data can never be mistaken for another placeholder.
  document.querySelector('#setup-sql').value = adminSQLTemplate
    .replace('do $$', () => 'do ' + delimiter).replace('end $$;', () => 'end ' + delimiter + ';')
    .replace(/(admin_email|admin_name|company_name) text := '[^']*';/g, (_match, key) => key + ' text := ' + postgresLiteral(values[key]) + ';');
  return true;
};
adminSetupForm.onsubmit = event => event.preventDefault();
adminSetupForm.oninput = () => { document.querySelector('#setup-sql').value = ''; document.querySelector('#copy-status').textContent = 'Confira os dados e copie o código do administrador.'; };

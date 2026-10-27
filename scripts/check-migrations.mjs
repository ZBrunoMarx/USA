import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function checkMigrations(directory, changes = '') {
  const names = readdirSync(new URL(directory)).sort(), versions = new Set();
  if (!names.length) throw new Error('Nenhuma migração versionada.');
  for (const name of names) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Nome de migração inválido: ' + name);
    const version = name.slice(0,14); if (versions.has(version)) throw new Error('Versão de migração duplicada.'); versions.add(version);
    const sql = readFileSync(new URL(name, directory.endsWith('/') ? directory : directory + '/'), 'utf8');
    if (!sql.trim() || /SEU_EMAIL_AQUI|sk-proj-[\w-]{20,}|sb_secret_[\w-]{20,}/.test(sql)) throw new Error('Revise o conteúdo da migração: ' + name);
    if (/^\s*(?:begin|commit)\s*;\s*$/im.test(sql)) throw new Error('Deixe a transação externa a cargo do CLI: ' + name);
  }
  for (const line of changes.split('\n').filter(Boolean)) {
    const [status,path] = line.split('\t');
    if (path?.startsWith('supabase/migrations/') && status !== 'A') throw new Error('Migrações publicadas são imutáveis. Crie uma nova: ' + path);
  }
  return names;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..',import.meta.url));
  const base = process.env.MIGRATION_BASE_SHA;
  let changes = '';
  if (base && !/^0+$/.test(base)) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Referência de comparação inválida.');
    changes = execFileSync('git',['diff','--no-renames','--name-status',base,'HEAD','--','supabase/migrations/'],{cwd:root,encoding:'utf8'});
  }
  console.log('Migrações válidas: ' + checkMigrations(new URL('../supabase/migrations/',import.meta.url).href,changes).join(', '));
}

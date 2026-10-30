import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const providerCertificatePath = fileURLToPath(new URL('../deploy/certs/supabase-prod-ca-2021.crt',import.meta.url));
export function databaseTarget(raw, projectRef, localTest = false) {
  let url; try { url = new URL(raw); } catch { throw new Error('Cadastre SUPABASE_DB_URL nos secrets do GitHub.'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.password || url.pathname !== '/postgres' || url.hash) throw new Error('A conexão deve ser uma URI PostgreSQL completa para o banco postgres.');
  if (localTest && ['127.0.0.1','localhost'].includes(url.hostname)) return url.toString();
  if (!/^[a-z0-9]{20}$/.test(projectRef || '')) throw new Error('Referência do projeto inválida.');
  const direct = url.hostname === 'db.' + projectRef + '.supabase.co' && url.username === 'postgres';
  const pool = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.username === 'postgres.' + projectRef;
  if ((!direct && !pool) || (url.port && url.port !== '5432')) throw new Error('Use a conexão Direct ou Session pooler do projeto esperado, na porta 5432.');
  url.searchParams.set('sslmode','verify-full');
  url.searchParams.set('sslrootcert',providerCertificatePath);
  return url.toString();
}
export function redact(text, raw) {
  const values = [raw];
  try { const url = new URL(raw); values.push(url.password, decodeURIComponent(url.password)); } catch {}
  for (const value of values.filter(Boolean).sort((a,b)=>b.length-a.length)) text = text.split(value).join('[redacted]');
  return text;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..',import.meta.url));
  const raw = process.env.SUPABASE_DB_URL || '';
  try {
    const local = process.argv.includes('--local-test') && process.env.NODE_ENV === 'test';
    const url = databaseTarget(raw,process.env.SUPABASE_PROJECT_REF,local);
    const certificate = new X509Certificate(readFileSync(providerCertificatePath));
    if (!certificate.ca || Date.parse(certificate.validTo) <= Date.now()) throw new Error('Atualize o certificado público do Supabase antes de publicar.');
    const cli = fileURLToPath(new URL('../node_modules/.bin/supabase',import.meta.url));
    const home = fileURLToPath(new URL('../.local/supabase-cli',import.meta.url)); mkdirSync(home,{recursive:true});
    const env = {...process.env,SUPABASE_HOME:home,SUPABASE_NO_UPDATE_NOTIFIER:'1',SUPABASE_TELEMETRY_DISABLED:'true',PGSSLROOTCERT:providerCertificatePath};
    delete env.SUPABASE_DB_URL;
    const args = ['db','push','--db-url',url,'--skip-vault','--yes'];
    if (process.argv.includes('--dry-run')) args.push('--dry-run');
    const result = spawnSync(cli,args,{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
    process.stdout.write(redact((result.stdout || '') + (result.stderr || ''),raw));
    if (result.error) throw new Error(result.error.code === 'ETIMEDOUT' ? 'O banco não respondeu dentro do prazo.' : 'Não foi possível executar o CLI instalado.');
    process.exitCode = result.status || (result.signal ? 1 : 0);
  } catch (error) { console.error(redact(error.message,raw)); process.exitCode = 1; }
}

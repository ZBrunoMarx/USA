// Uses an isolated local PostgreSQL container, never the hosted project.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { managedSchemas } from '../tests/helpers/supabase-fixture.mjs';
const name='field-report-ci-'+randomUUID().slice(0,8), root=new URL('..',import.meta.url);
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const docker=(args,input)=>execFileSync('docker',[...dockerArgs,...args],{env,encoding:'utf8',input,stdio:['pipe','pipe','pipe']}).trim();
let id;
try{
 id=docker(['run','-d','--name',name,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=local-migration-test-only','-p','127.0.0.1::5432','postgres:17']);
 let ready=false;for(let attempt=0;attempt<60;attempt++){try{docker(['exec',id,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
 assert.ok(ready,'Postgres startup');
 const port=docker(['port',id,'5432/tcp']).split(':').pop();
 const psql=sql=>docker(['exec','-i',id,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],sql);
 psql(managedSchemas);
 psql(readFileSync(new URL('../deploy/supabase/01-schema.sql',import.meta.url),'utf8'));
 psql("insert into public.fr_companies(name) values('Retained company');insert into public.fr_jobs(company_id,name) select id,'Retained job' from public.fr_companies;");
 const cliEnv={...process.env,CI:'true',NODE_ENV:'test',SUPABASE_DB_URL:'postgresql://postgres:local-migration-test-only@127.0.0.1:'+port+'/postgres?sslmode=disable'};
 const run=(flags=[])=>{const result=spawnSync(process.execPath,['scripts/deploy-database.mjs','--local-test',...flags],{cwd:root,env:cliEnv,encoding:'utf8',timeout:180000});assert.equal(result.status,0,(result.stdout||'')+(result.stderr||''));return result.stdout;};
 const plan=run(['--dry-run']);assert.match(plan,/20261026000000/);
 assert.equal(psql("select count(*) from information_schema.tables where table_schema='public' and table_name='fr_tasks';"),'0');
 run();
 assert.equal(psql("select version from supabase_migrations.schema_migrations;"),'20261026000000');
 assert.equal(psql('select name from public.fr_jobs;'),'Retained job');
 assert.equal(psql("select count(*) from information_schema.tables where table_schema='public' and table_name='fr_tasks';"),'1');
 const second=run();assert.match(second,/up.to.date|no.*migration|nothing.*apply/i);
 assert.equal(psql('select count(*) from supabase_migrations.schema_migrations;'),'1');
 console.log('PASS actual Supabase CLI + isolated PostgreSQL 17: dry-run leaves schema untouched, pending migration applies, history is recorded, existing job survives, second run does not reapply. No hosted writes.');
}finally{if(id)docker(['rm','-f',id]);}

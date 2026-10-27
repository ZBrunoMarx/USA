import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url),dir=mkdtempSync(join(tmpdir(),'skytile-publication-'));
let child;
async function start() {
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,NODE_ENV:'production',SKYTILE_AUTH:'required',SKYTILE_PUBLIC_ORIGIN:'https://pilot.skytile.test',SKYTILE_BOOTSTRAP_PASSWORD:'Test-only-publication-password',SKYTILE_HOST:'127.0.0.1',SKYTILE_DATA_DIR:join(dir,'volume'),PORT:'0',SKYTILE_AI_KEY:'',OPENAI_API_KEY:''}});
  return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.stderr.on('data',b=>{clearTimeout(timer);reject(new Error(b.toString()));});child.once('error',reject);});
}
async function stop() { if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;} }
try {
  execFileSync(process.execPath,['scripts/build-deploy.mjs'],{cwd:root,stdio:'pipe'});
  cpSync(new URL('../.local/publication',import.meta.url),dir,{recursive:true});
  assert.equal(existsSync(join(dir,'.local')),false);assert.equal(existsSync(join(dir,'docs')),false);
  execFileSync('npm',['ci','--omit=dev','--no-audit','--no-fund','--cache',join(dir,'npm-cache')],{cwd:dir,stdio:'pipe'});
  assert.equal(existsSync(join(dir,'node_modules/playwright')),false);
  let base=await start();assert.equal((await fetch(base+'/api/state',{headers:{'X-Skytile-User':'thiago'}})).status,401);
  const logged=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://pilot.skytile.test'},body:JSON.stringify({login:'thiago',password:'Test-only-publication-password'})});
  assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];
  let state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.auth.enabled,true);assert.equal(state.ai.available,false);
  const created=await fetch(base+'/api/jobs',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://pilot.skytile.test'},body:JSON.stringify({name:'Teste isolado do pacote',address:'NJ',rooms:[{name:'Banheiro',services:['Rejunte']}]})});
  assert.equal(created.status,201);const job=await created.json();
  await stop();base=await start();state=await(await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.ok(state.jobs.some(j=>j.id===job.id));
  console.log('PASS extracted publication package: production-only dependencies, mandatory login, session and job persisted across restart; no real records or AI credentials. This uses a local server, not a public HTTPS deployment.');
} finally {await stop();rmSync(dir,{recursive:true,force:true});}

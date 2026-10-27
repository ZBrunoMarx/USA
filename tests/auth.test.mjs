import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../auth.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'skytile-auth-'));
const password = 'Only-a-test-password-2026';
let child, base, cookie, workerCookie, photo;
async function start() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: {
    ...process.env, PORT:'0', NODE_ENV:'test', SKYTILE_AUTH:'required', SKYTILE_PUBLIC_ORIGIN:'https://skytile.test',
    SKYTILE_DATA_DIR:dataDir, SKYTILE_BOOTSTRAP_PASSWORD:password, SKYTILE_AI_KEY:'', OPENAI_API_KEY:'',
  } });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timed out')), 10000);
    child.stdout.on('data', b => { const m = b.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if(m){clearTimeout(timer); resolve(m[0]);} });
    child.stderr.on('data', b => { clearTimeout(timer); reject(new Error(b.toString())); }); child.once('error', reject);
  });
}
async function stop() { const done=once(child,'exit'); child.kill('SIGTERM'); await done; }
async function request(path, {method='GET', body, session=cookie, origin='https://skytile.test', extra={}}={}) {
  const r = await fetch(base + path, { method, headers:{ 'Content-Type':'application/json', Origin:origin, ...(session?{Cookie:session}:{}), ...extra }, ...(body?{body:JSON.stringify(body)}:{}) });
  return { status:r.status, data:await r.json(), cookie:r.headers.get('set-cookie'), headers:r.headers };
}
before(start); after(async()=>{await stop();rmSync(dataDir,{recursive:true,force:true});});

test('anonymous state and uploads are denied; login issues a secure session, not a selectable profile', async()=>{
  assert.equal((await request('/api/health',{session:''})).status,200);
  assert.equal((await request('/api/state',{session:'',extra:{'X-Skytile-User':'thiago'}})).status,401);
  assert.equal((await request('/uploads/aaaa.png',{session:''})).status,401);
  assert.deepEqual((await request('/api/auth/session',{session:''})).data,{enabled:true,userId:null});
  const bad=await request('/api/auth/login',{method:'POST',body:{login:'thiago',password:'wrong'},session:''}); assert.equal(bad.status,401);
  const good=await request('/api/auth/login',{method:'POST',body:{login:'thiago',password},session:''}); assert.equal(good.status,200);
  assert.match(good.cookie,/^__Host-skytile=/); for(const field of ['HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(good.cookie.includes(field));
  cookie=good.cookie.split(';')[0];
  const state=await request('/api/state'); assert.equal(state.data.auth.userId,'thiago'); assert.equal(state.data.auth.enabled,true);
  assert.ok(!JSON.stringify(state.data).includes(password)); assert.ok(!JSON.stringify(state.data).includes('digest'));
});
test('cross-origin mutations fail; admins grant worker access and spoofed admin headers do not elevate it', async()=>{
  assert.equal((await request('/api/auth/access',{method:'POST',origin:'https://evil.invalid',body:{userId:'bruno',password}})).status,403);
  assert.equal((await request('/api/auth/access',{method:'POST',body:{userId:'bruno',password:'short'}})).status,400);
  assert.equal((await request('/api/auth/access',{method:'POST',body:{userId:'bruno',password}})).status,200);
  const state=(await request('/api/state')).data;const code=state.users.find(u=>u.id==='bruno').code;
  const logged=await request('/api/auth/login',{method:'POST',session:'',body:{login:code,password}});assert.equal(logged.status,200);workerCookie=logged.cookie.split(';')[0];
  const worker=await request('/api/state',{session:workerCookie,extra:{'X-Skytile-User':'thiago'}});
  assert.equal(worker.data.auth.userId,'bruno');assert.equal(worker.data.finance,undefined);
  assert.equal((await request('/api/jobs',{method:'POST',session:workerCookie,body:{name:'Forbidden'},extra:{'X-Skytile-User':'thiago'}})).status,403);
  assert.equal((await request('/api/auth/access',{method:'POST',session:workerCookie,body:{userId:'thiago',password}})).status,403);
  const receipt=await request('/api/upload',{method:'POST',body:{name:'parking.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII='}});
  assert.equal(receipt.status,201);
  assert.equal((await request('/api/jobs/demo-manhattan/expenses',{method:'POST',body:{amountCents:1200,category:'parking',date:state.today,receipt:receipt.data}})).status,200);
  assert.equal((await fetch(base+receipt.data.url,{headers:{Cookie:workerCookie}})).status,403);
  assert.equal((await fetch(base+receipt.data.url,{headers:{Cookie:cookie}})).status,200);
});
test('photos, sessions and credentials survive restart; password reset and logout revoke access',async()=>{
  const upload=await request('/api/upload',{method:'POST',session:workerCookie,body:{name:'camera.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII='}}); assert.equal(upload.status,201);photo=upload.data.url;
  assert.equal((await fetch(base+photo,{headers:{Cookie:workerCookie}})).status,200);
  await stop();await start();assert.equal((await request('/api/state',{session:workerCookie})).status,200);
  assert.equal((await fetch(base+photo,{headers:{Cookie:workerCookie}})).status,200);
  assert.equal((await request('/api/auth/access',{method:'POST',body:{userId:'bruno',password:password+'new'}})).status,200);
  assert.equal((await request('/api/state',{session:workerCookie})).status,401);
  assert.equal((await fetch(base+photo,{headers:{Cookie:workerCookie}})).status,401);
  assert.equal((await request('/api/auth/logout',{method:'POST',body:{}})).status,200);
  assert.equal((await request('/api/state')).status,401);
});
test('production requires HTTPS and cannot disable login; login attempts are bounded and passwords are hashed', async()=>{
  const db=new DatabaseSync(':memory:');try{
    const users=[{id:'thiago',role:'admin'}];
    await assert.rejects(createAuth(db,users,{NODE_ENV:'production',SKYTILE_AUTH:'demo'}),/demonstração/);
    await assert.rejects(createAuth(db,users,{NODE_ENV:'production'}),/HTTPS/);
    await assert.rejects(createAuth(db,users,{NODE_ENV:'production',SKYTILE_PUBLIC_ORIGIN:'http://skytile.test'}),/HTTPS/);
    const auth=await createAuth(db,users,{SKYTILE_AUTH:'required',SKYTILE_BOOTSTRAP_PASSWORD:password});
    const credential=db.prepare('SELECT * FROM credentials').get();assert.notEqual(credential.digest,password);assert.equal(credential.digest.length,128);
    const req={socket:{remoteAddress:'test'},headers:{}};const res={setHeader(){}};
    for(let i=0;i<10;i++)await assert.rejects(auth.login(req,res,{login:'unknown',password:'wrong'},users),e=>e.status===401);
    await assert.rejects(auth.login(req,res,{login:'unknown',password:'wrong'},users),e=>e.status===429);
  }finally{db.close();}
});

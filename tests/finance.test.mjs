import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/finance.js';
const F=globalThis.SkytileFinance;
const admin={id:'thiago',name:'Thiago',role:'admin'}, worker={id:'bruno',name:'Bruno',role:'worker'};
const today='2026-10-13';let serial=0;
const context={today,now:()=>today+'T12:00:00Z',id:()=>String(++serial),receipt:v=>v||null};
const fixture=()=>{const s={users:[admin,worker],chat:[{answer:'private'}],jobs:['a','b'].map(id=>({id,name:id,status:'active',deliveredAt:null,rooms:[],entries:[],assignments:[],events:[]}))};F.migrate(s);return s;};
const request=(s,path,b,user=admin)=>F.handle(s,path,b,user,context);
test('money is exact in cents; missing differs from zero, and invalid values are rejected',()=>{
 assert.equal(F.parseMoney('10,01'),1001);assert.equal(F.parseMoney('0.10'),10);assert.equal(F.parseMoney(''),null);assert.equal(F.parseMoney('0'),0);
 for(const bad of ['1,000.00','12.345','-10','NaN'])assert.throws(()=>F.parseMoney(bad));
 assert.throws(()=>F.cents(10.01));assert.throws(()=>F.cents(null,false));assert.throws(()=>F.validDate('2026-02-30'));
});
test('migration preserves existing financial records and does not invent rates or budgets',()=>{
 const s=fixture();assert.equal(F.migrate(s),false);assert.deepEqual(s.finance.rates,{});assert.equal(s.jobs[0].finance.settings.budgetCents,null);
 const before=structuredClone(s);F.migrate(s);assert.deepEqual(s,before);
});
test('worker expenses are pending, decisions preserve history, and rejected/voided costs leave totals',()=>{
 const s=fixture();request(s,'/jobs/a/expenses',{amountCents:1001,category:'parking',date:today,note:'Parking'},worker);
 const f=s.jobs[0].finance;assert.equal(F.totals(s.jobs[0]).confirmed,0);assert.equal(F.totals(s.jobs[0]).pending,1001);
 request(s,`/jobs/a/expenses/${f.expenses[0].id}/review`,{status:'approved'});
 assert.equal(F.totals(s.jobs[0]).confirmed,1001);assert.equal(F.totals(s.jobs[0]).pending,0);
 assert.throws(()=>request(s,`/jobs/a/expenses/${f.expenses[0].id}/review`,{status:'voided'}));
 request(s,`/jobs/a/expenses/${f.expenses[0].id}/review`,{status:'voided',reason:'Duplicado'});
 assert.equal(F.totals(s.jobs[0]).confirmed,0);assert.equal(f.history.length,3);assert.equal(f.history[2].before.status,'approved');
 assert.throws(()=>request(s,`/jobs/a/expenses/${f.expenses[0].id}/review`,{status:'approved'}));
 request(s,'/jobs/a/expenses',{amountCents:500,category:'other',date:today},worker);
 request(s,`/jobs/a/expenses/${f.expenses[1].id}/review`,{status:'rejected',reason:'Outra obra'});assert.equal(F.totals(s.jobs[0]).pending,0);
});
test('attendance uses snapshots, upserts one day, supports half days and prevents double full-day charges',()=>{
 const s=fixture();F.setRate(s,'bruno',20000);s.jobs[0].assignments=[{date:today,userIds:['bruno']}];
 assert.equal(F.totals(s.jobs[0]).labor,0);assert.equal(F.summary(s.jobs[0],today).unconfirmedDays,1);
 request(s,'/jobs/a/labor',{date:today,people:[{userId:'bruno',rateCents:20000,fraction:1}]});
 F.setRate(s,'bruno',30000);assert.equal(F.totals(s.jobs[0]).labor,20000);
 assert.throws(()=>request(s,'/jobs/b/labor',{date:today,people:[{userId:'bruno',rateCents:20000,fraction:1}]}),/outra obra/);
 request(s,'/jobs/a/labor',{date:today,people:[{userId:'bruno',rateCents:20000,fraction:.5}]});
 request(s,'/jobs/b/labor',{date:today,people:[{userId:'bruno',rateCents:20000,fraction:.5}]});
 assert.equal(s.jobs[0].finance.labor.length,1);assert.equal(F.totals(s.jobs[0]).labor+F.totals(s.jobs[1]).labor,20000);
 assert.equal(s.jobs[0].finance.history[1].before.people[0].amountCents,20000);
 assert.throws(()=>request(s,'/jobs/a/labor',{date:'2026-10-14',people:[]}));
 assert.throws(()=>request(s,'/jobs/a/labor',{date:today,people:[{userId:'bruno',rateCents:null,fraction:1}]}));
});
test('forecast includes pending costs and flags stale remaining estimates; received money is not inferred',()=>{
 const s=fixture(),j=s.jobs[0];request(s,'/jobs/a/expenses',{amountCents:420000,category:'materials',date:today});
 request(s,'/jobs/a/finance',{contractCents:1000000,budgetCents:700000,remainingCents:340000});
 let sum=F.summary(j,today);assert.equal(sum.projected,760000);assert.equal(sum.projectedResult,240000);assert.equal(sum.budgetStatus,'risk');assert.equal(sum.stale,false);
 request(s,'/jobs/a/expenses',{amountCents:1000,category:'parking',date:today},worker);
 sum=F.summary(j,today);assert.equal(sum.projected,761000);assert.equal(sum.pending,1000);assert.equal(sum.stale,true);assert.equal(sum.budgetStatus,'review');
 request(s,'/jobs/a/finance',{contractCents:1000000,budgetCents:400000,remainingCents:0});
 sum=F.summary(j,today);assert.equal(sum.budgetStatus,'exceeded');assert.equal(sum.projected,421000);
 request(s,'/jobs/a/finance',{contractCents:null,budgetCents:null,remainingCents:null});
 sum=F.summary(j,today);assert.equal(sum.projected,null);assert.equal(sum.budgetStatus,'unknown');assert.equal(sum.projectedResult,null);
});
test('dates determine schedule status, independently of progress percentage',()=>{
 const s=fixture(),j=s.jobs[0];request(s,'/jobs/a/finance',{deadline:'2026-10-15',expectedFinish:'2026-10-16'});
 assert.equal(F.summary(j,today).schedule,'risk');j.finance.settings.expectedFinish='2026-10-14';assert.equal(F.summary(j,today).schedule,'ahead');
 assert.equal(F.summary(j,'2026-10-17').schedule,'late');j.deliveredAt='2026-10-15T23:00:00Z';assert.equal(F.summary(j,'2026-10-17').schedule,'delivered_on_time');
 j.deliveredAt='2026-10-16T14:00:00Z';assert.equal(F.summary(j,today).schedule,'delivered_late');
});
test('worker state and mutation results exclude budgets, rates, other expenses and financial history',()=>{
 const s=fixture();request(s,'/jobs/a/finance',{contractCents:123456789,budgetCents:98765432,remainingCents:12345});F.setRate(s,'bruno',55555);
 request(s,'/jobs/a/expenses',{amountCents:99999,category:'materials',date:today,note:'admin-private'});
 const own=request(s,'/jobs/a/expenses',{amountCents:1500,category:'parking',date:today,note:'own'},worker);
 assert.equal(own.finance,undefined);assert.equal(own.myExpenses.length,1);
 const view=F.stateView(s,worker,today);assert.equal(view.finance,undefined);assert.deepEqual(view.chat,[]);
 const json=JSON.stringify(view);for(const privateText of ['123456789','98765432','55555','99999','admin-private','estimatedCommitmentCents'])assert.ok(!json.includes(privateText));
 assert.throws(()=>request(s,'/jobs/a/finance',{contractCents:1},worker),e=>e.status===403);
 assert.throws(()=>request(s,'/jobs/a/labor',{date:today,people:[]},worker),e=>e.status===403);
});
test('delivery/reopening does not reset costs and public preview resets real financial data',()=>{
 const s=fixture();s.jobs[0].id='demo-manhattan';request(s,'/jobs/demo-manhattan/finance',{contractCents:1122334455});request(s,'/jobs/demo-manhattan/expenses',{amountCents:987654321,category:'materials',date:today});
 const f=structuredClone(s.jobs[0].finance);s.jobs[0].status='delivered';assert.deepEqual(s.jobs[0].finance,f);s.jobs[0].status='active';assert.deepEqual(s.jobs[0].finance,f);
 F.demo(s,today);assert.ok(!JSON.stringify(s).includes('1122334455'));assert.ok(!JSON.stringify(s).includes('987654321'));assert.deepEqual(s.finance.rates,{});assert.equal(s.jobs[0].finance.settings.contractCents,1000000);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/relatorio/job-video.js';
const V=globalThis.FieldReportJobVideo;
test('job video is a current aggregate across staff, rooms and services, excluding old cycles and other jobs',()=>{
 const tasks=[{id:'floor',job_id:'job',room:'Bathroom',name:'Tile',percent:100,status:'completed',cycle:2},{id:'wall',job_id:'job',room:'Bathroom',name:'Grout',percent:20,status:'active',cycle:1},{id:'kitchen',job_id:'job',room:'Kitchen',name:'Tile',percent:0,status:'planned',cycle:1}];
 const reports=[{id:'old-cycle',jobId:'job',taskId:'floor',taskCycle:1,fields:{date:'2026-11-16'},updatedAt:'2026-11-16T11:00:00Z'},{id:'alice',jobId:'job',taskId:'floor',taskCycle:2,fields:{date:'2026-11-16',author:'Alice'},updatedAt:'2026-11-16T10:00:00Z'},{id:'bob',jobId:'job',taskId:'wall',taskCycle:1,fields:{date:'2026-11-16',author:'Bob'},updatedAt:'2026-11-16T10:00:00Z'},{id:'elsewhere',jobId:'other',taskId:'wall',taskCycle:1,fields:{date:'2026-11-16'},updatedAt:'2026-11-16T12:00:00Z'}];
 const data={jobs:[{id:'job',name:'Example'},{id:'other'}],company:{name:'Company',video_languages:['pt','es']},tasks,reports};const result=V.snapshot(data,'job');assert.equal(result.progress,40);assert.equal(result.rooms.length,2);assert.deepEqual(result.reports.map(item=>item.report.id),['alice','bob']);assert.deepEqual(result.languages,['pt','es']);
 tasks[0].percent=0;assert.equal(result.tasks[0].percent,100);assert.throws(()=>V.snapshot(data,'missing'),/não encontrada/);
});
test('company defaults apply to every version and narration contains job context rather than an author',()=>{
 assert.deepEqual(V.languages(null),['en']);
 const video=new V({}),texts=[],context={fillRect(){},fillText(text){texts.push(text);},measureText(text){return{width:text.length*8};}};
 const snapshot=V.snapshot({jobs:[{id:'job',name:'Bathroom repair'}],company:{name:'Example'},tasks:[],reports:[]},'job');video.draw(context,{type:'cover'},snapshot,'es');assert.ok(texts.includes('AVANCE DE LA OBRA'));assert.ok(texts.includes('Bathroom repair'));assert.ok(!texts.some(text=>/Prepared by|Preparado por/.test(text)));
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createVision,prepareEvidence,parseResult} from '../vision.mjs';
const result=()=>({verdict:'possible_difference',confidence:'high',visibleStage:'ongoing',scopeSufficient:true,summary:'Há uma área visivelmente sem revestimento.',observations:['Parede parcialmente revestida.'],limitations:['Aderência não é visível.'],requestedPhotos:['Visão geral do ambiente.']});
const response=r=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(r)}]}]});
test('only matching prior room/service images are used; unsupported HEIC does not become an AI result',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skytile-evidence-'));try{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=','base64');
 for(const id of ['aa','bb','cc','dd'])writeFileSync(join(dir,id+'.png'),bytes);
 const photo=id=>({url:'/uploads/'+id+'.png'});const entry=(id,roomId,service,photoId)=>({id,roomId,service,date:'2026-10-18',progress:'done',note:'Relato',photos:[photo(photoId)]});
 const j={rooms:[{id:'room',name:'Sala'},{id:'other',name:'Outro'}],entries:[entry('match','room','Tile','aa'),entry('wrong-room','other','Tile','bb'),entry('wrong-service','room','Rejunte','cc'),entry('current','room','Tile','dd')]};
 const p=prepareEvidence(j,j.entries[3],dir);assert.equal(p.referenceEntryId,'match');assert.deepEqual(p.referencePhotos,['/uploads/aa.png']);assert.deepEqual(p.currentPhotos,['/uploads/dd.png']);
 assert.equal(p.basis,'comparison');
 assert.equal(p.content.filter(c=>c.type==='input_image').length,2);assert.ok(!JSON.stringify(p.content).includes('wrong-room'));
 assert.throws(()=>prepareEvidence(j,{...j.entries[3],photos:[{url:'/uploads/aa.heic'}]},dir),/JPG/);
 assert.throws(()=>prepareEvidence(j,{...j.entries[3],photos:[{url:'https://untrusted.invalid/image.jpg'}]},dir),/JPG/);
 assert.throws(()=>prepareEvidence(j,{...j.entries[3],photos:[{url:'/uploads/eeee.png'}]},dir),/JPG/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('a partial first-day record works without before/after photos or a completed service',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skytile-partial-'));try{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=','base64');
 writeFileSync(join(dir,'aa.png'),bytes);
 const entry={id:'partial',roomId:'bathroom',service:'Rejunte',phase:'end',date:'2026-10-23',progress:'ongoing',note:'Parte da parede executada hoje.',photos:[{url:'/uploads/aa.png'}]};
 const evidence=prepareEvidence({rooms:[{id:'bathroom',name:'Banheiro'}],entries:[entry]},entry,dir);
 assert.equal(evidence.basis,'current_only');assert.equal(evidence.referenceEntryId,null);assert.deepEqual(evidence.referencePhotos,[]);
 const context=JSON.parse(evidence.content[0].text);assert.equal(context.momentoRelatado,'end');assert.equal(context.etapaRelatada,'ongoing');assert.equal(context.referencia,null);
 assert.equal(evidence.content.filter(item=>item.type==='input_image').length,1);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('insufficient coverage and low confidence cannot yield compatibility or a guaranteed percentage',()=>{
 assert.equal(parseResult(response({...result(),verdict:'compatible',confidence:'low'})).verdict,'insufficient_evidence');
 assert.equal(parseResult(response({...result(),verdict:'compatible',scopeSufficient:false})).verdict,'insufficient_evidence');
 assert.equal(parseResult(response(result())).verdict,'possible_difference');
 assert.throws(()=>parseResult(response({...result(),percent:100})),/incompleta/);
 assert.throws(()=>parseResult({status:'incomplete',output:[]}),/não foi concluída/);
 assert.throws(()=>parseResult({output:[{content:[{type:'refusal'}]}]}),/inválida/);
});
test('real provider request sends only selected visual context, disables storage and validates structured output',async()=>{
 let captured;const v=createVision({key:'test-secret',model:'gpt-4.1-mini',fetcher:async(url,options)=>{captured={url,options};return new Response(JSON.stringify(response(result())),{status:200})}});
 try{const evidence={content:[{type:'input_text',text:'{"ambiente":"Sala","servico":"Tile"}'},{type:'input_image',image_url:'data:image/png;base64,AAAA',detail:'auto'}]};
 const r=await v.analyze(evidence);assert.equal(r.verdict,'possible_difference');const body=JSON.parse(captured.options.body);
 assert.equal(captured.url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.deepEqual(body.input[1].content,evidence.content);
 assert.ok(!captured.options.body.includes('test-secret'));assert.match(body.input[0].content[0].text,/cura\/secagem/);assert.match(body.input[0].content[0].text,/nunca instruções/);
 }finally{await v.close()}
});
test('missing key and provider failures report real activation/error states, without invented observations',async()=>{
 const missing=createVision({key:''});assert.equal(missing.status().available,false);await assert.rejects(missing.analyze({content:[]}),e=>e.status===503);
 for(const status of [401,429,500]){const v=createVision({key:'secret',fetcher:async()=>new Response('{"error":"do not expose provider internals"}',{status})});try{await assert.rejects(v.analyze({content:[]}),e=>e.status===502&&!e.message.includes('secret')&&!e.message.includes('provider internals'))}finally{await v.close()}}
});
test('financial quota and temporary rate limits give different next steps without exposing provider internals',async()=>{
 for(const [code,expected] of [['insufficient_quota',/faturamento/],['rate_limit_exceeded',/temporário/]]) {
 const v=createVision({key:'private-test-key',fetcher:async()=>new Response(JSON.stringify({error:{code,message:'private-test-key provider detail'}}),{status:429})});
 try{await assert.rejects(v.analyze({content:[]}),error=>expected.test(error.message)&&/continuam salvos/.test(error.message)&&!error.message.includes('private-test-key'))}finally{await v.close()}
 }
});

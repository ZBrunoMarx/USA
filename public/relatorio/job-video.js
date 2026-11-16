'use strict';
// A company-defined output of the current job, never an individual daily report.
globalThis.FieldReportJobVideo = class {
  constructor(hooks) { this.h=hooks; this.busy=false; this.controller=null; this.files=[]; this.urls=[]; }
  static languages(company) { const items=company?.video_languages; return Array.isArray(items)&&items.length ? [...new Set(items.filter(id=>['en','pt','es'].includes(id)))] : ['en']; }
  static snapshot(data,jobId) {
    const job=data.jobs.find(item=>item.id===jobId);if(!job)throw new Error('Obra não encontrada.');
    const tasks=(data.tasks||[]).filter(task=>task.job_id===jobId).map(task=>({...task}));
    const progress=tasks.length?(tasks.every(task=>task.status==='completed')?100:Math.min(99,Math.round(tasks.reduce((sum,task)=>sum+Number(task.percent||0),0)/tasks.length))):null;
    const reports=tasks.map(task=>({task,report:data.reports.filter(report=>report.jobId===jobId&&report.taskId===task.id&&report.taskCycle===task.cycle).sort((a,b)=>b.fields.date.localeCompare(a.fields.date)||b.updatedAt.localeCompare(a.updatedAt))[0]})).filter(item=>item.report);
    const rooms=new Map();for(const task of tasks){const name=task.room||'Área geral';if(!rooms.has(name))rooms.set(name,[]);rooms.get(name).push(task);}
    return {job:{...job},company:{...data.company},tasks,progress,reports,rooms:[...rooms].map(([name,tasks])=>({name,tasks})),at:new Date(),languages:this.languages(data.company)};
  }
  labels(language) { return ({
    en:{title:'JOB PROGRESS',overall:'OVERALL PROGRESS',done:'services completed',planned:'planned services',photos:'CURRENT PHOTOS',closing:'CURRENT JOB STATUS',noProgress:'PLANNING',more:'More services in the app'},
    pt:{title:'ANDAMENTO DA OBRA',overall:'AVANÇO GERAL',done:'serviços concluídos',planned:'serviços previstos',photos:'FOTOS ATUAIS',closing:'SITUAÇÃO ATUAL DA OBRA',noProgress:'PLANEJAMENTO',more:'Mais serviços no aplicativo'},
    es:{title:'AVANCE DE LA OBRA',overall:'AVANCE GENERAL',done:'servicios completados',planned:'servicios previstos',photos:'FOTOS ACTUALES',closing:'ESTADO ACTUAL DE LA OBRA',noProgress:'PLANIFICACIÓN',more:'Más servicios en la aplicación'}
  })[language]; }
  clear() { for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];this.files=[]; }
  hide() { this.controller?.abort();document.getElementById('job-video-panel').hidden=true;document.getElementById('job-workspace').hidden=false;this.clear(); }
  codec() { return ['video/mp4;codecs=avc1.42E01F','video/mp4;codecs=avc1','video/mp4'].find(type=>globalThis.MediaRecorder?.isTypeSupported(type)); }
  text(c,text,x,y,width,size=28,max=3) {
    c.font='600 '+size+'px -apple-system, sans-serif';const lines=[];let line='';
    for(const token of String(text||'').split(/\s+/)){if(c.measureText(line+' '+token).width>width&&line){lines.push(line);line='';}line+=(line?' ':'')+token;}
    if(line)lines.push(line);lines.slice(0,max).forEach((line,i)=>c.fillText(line,x,y+i*(size+12),width));return Math.min(lines.length,max)*(size+12);
  }
  draw(c,slide,snapshot,language) {
    const w=this.labels(language);c.fillStyle='#112931';c.fillRect(0,0,720,1280);c.fillStyle='#7ed4b7';this.text(c,w.title,48,72,624,22,1);
    c.fillStyle='#fff';this.text(c,snapshot.job.name,48,150,624,40,3);
    c.fillStyle='#b5d0d0';this.text(c,snapshot.company.name||'',48,1190,624,23,2);
    this.text(c,new Intl.DateTimeFormat(language==='pt'?'pt-BR':language==='es'?'es-US':'en-US',{dateStyle:'medium',timeZone:'America/New_York'}).format(snapshot.at),48,1240,624,19,1);
    if(slide.type==='cover'||slide.type==='closing'){
      c.fillStyle='#7ed4b7';this.text(c,slide.type==='cover'?w.overall:w.closing,48,365,624,27,2);
      c.fillStyle='#fff';this.text(c,snapshot.progress===null?w.noProgress:snapshot.progress+'%',48,545,624,100,1);
      c.fillStyle='#b5d0d0';this.text(c,snapshot.tasks.filter(t=>t.status==='completed').length+' / '+snapshot.tasks.length+' '+w.done,48,655,624,26,2);
      this.text(c,snapshot.rooms.length+' '+(language==='pt'?'ambientes':language==='es'?'ambientes':'rooms'),48,765,624,27,1);
      if(snapshot.omitted)this.text(c,w.more,48,900,624,23,2);
      if(snapshot.logo){const image=snapshot.logo,scale=Math.min(180/image.naturalWidth,100/image.naturalHeight);c.drawImage(image,48,1030,image.naturalWidth*scale,image.naturalHeight*scale);}
    }else if(slide.type==='room'){
      c.fillStyle='#7ed4b7';this.text(c,slide.name,48,330,624,34,2);
      slide.tasks.forEach((task,index)=>{const y=465+index*125;c.fillStyle='#fff';this.text(c,task.name,48,y,500,25,2);c.fillStyle='#7ed4b7';this.text(c,Number(task.percent||0)+'%',560,y,120,27,1);c.fillStyle='#ffffff20';c.fillRect(48,y+52,624,9);c.fillStyle='#7ed4b7';c.fillRect(48,y+52,624*Number(task.percent||0)/100,9);});
    }else{
      c.fillStyle='#7ed4b7';this.text(c,slide.task.room||w.photos,48,325,624,29,2);
      const image=slide.image,scale=Math.min(624/image.naturalWidth,630/image.naturalHeight);c.drawImage(image,360-image.naturalWidth*scale/2,690-image.naturalHeight*scale/2,image.naturalWidth*scale,image.naturalHeight*scale);
      c.fillStyle='#fff';this.text(c,slide.task.name+' · '+Number(slide.task.percent||0)+'%',48,1080,624,25,2);
    }
  }
  async image(blob) { const url=URL.createObjectURL(blob);try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Não foi possível abrir uma foto da obra.'));image.src=url;});return image;}finally{URL.revokeObjectURL(url);} }
  async generate(jobId) {
    if(this.busy||this.h.busy())return;
    if(!this.codec()){this.h.message('Este navegador não gera MP4. Use um navegador compatível para gerar o vídeo da obra.',true);return;}
    const data=this.h.data();if(data?.user.role!=='admin')return;
    this.clear();this.busy=true;this.controller=new AbortController();
    const panel=document.getElementById('job-video-panel');document.getElementById('job-workspace').hidden=true;panel.hidden=false;panel.innerHTML='<button id="back-from-job-video" class="secondary" type="button">← Obra</button><section class="card"><h2>Vídeo de andamento da obra</h2><p id="job-video-status" role="status">Reunindo as atualizações da equipe…</p><progress id="job-video-progress" max="100" value="0" aria-label="Geração do vídeo da obra"></progress><button id="job-video-cancel" class="secondary" type="button">Cancelar geração</button><canvas id="job-video-canvas" width="720" height="1280" aria-label="Vídeo geral da obra"></canvas><div id="job-video-results"></div></section>';
    panel.querySelector('#back-from-job-video').onclick=()=>{this.hide();void this.h.refresh?.();};
    panel.querySelector('#job-video-cancel').onclick=()=>this.controller?.abort();panel.scrollIntoView({behavior:'smooth',block:'start'});
    const status=panel.querySelector('#job-video-status'),canvas=panel.querySelector('canvas'),c=canvas.getContext('2d');
    let wakeLock;const hidden=()=>{if(document.hidden)this.controller?.abort(new Error('A geração foi interrompida ao sair da página. Tente novamente mantendo a página aberta.'));};document.addEventListener('visibilitychange',hidden);
    try{
      const snapshot=FieldReportJobVideo.snapshot(await this.h.sync.list(),jobId),list=[{type:'cover',duration:2}];let pages=0;
      for(const room of snapshot.rooms)for(let offset=0;offset<room.tasks.length;offset+=5){if(pages++<6)list.push({type:'room',name:room.name,tasks:room.tasks.slice(offset,offset+5),duration:3});else snapshot.omitted=true;}
      const logo=await this.h.sync.companyLogo(snapshot.company);if(logo)snapshot.logo=await this.image(logo.blob);
      let photoCount=0;
      for(const item of [...snapshot.reports].sort((a,b)=>b.report.updatedAt.localeCompare(a.report.updatedAt))){
        if(photoCount>=8)break;const report=await this.h.sync.download(item.report.id);if(report.cloud?.revision!==item.report.revision)throw new Error('A obra recebeu uma atualização durante a preparação. Gere novamente para incluir o estado mais recente.');const photos=report.photos.after.length?report.photos.after:report.photos.before;
        for(const photo of photos.slice(0,2)){if(photoCount++>=8)break;list.push({type:'photo',image:await this.image(photo.blob),task:item.task,duration:2.2});}
      }
      list.push({type:'closing',duration:3});const duration=list.reduce((sum,slide)=>sum+slide.duration,0),names={en:'Inglês',pt:'Português',es:'Espanhol'};
      try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}
      for(const [version,language]of snapshot.languages.entries()){
        if(this.controller.signal.aborted)throw this.controller.signal.reason||new Error('cancelled');
        status.textContent='Gerando vídeo da obra · '+names[language]+' ('+(version+1)+'/'+snapshot.languages.length+')';
        const stream=canvas.captureStream(24),chunks=[],recorder=new MediaRecorder(stream,{mimeType:this.codec(),videoBitsPerSecond:1800000});
        try{
          const finished=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/mp4'}));recorder.onerror=()=>reject(new Error('O navegador interrompeu o vídeo. Tente novamente.'));});finished.catch(()=>{});
          recorder.start(1000);
          await new Promise((resolve,reject)=>{const start=performance.now();const frame=now=>{if(this.controller.signal.aborted){reject(this.controller.signal.reason||new Error('cancelled'));return;}let elapsed=Math.min(duration,(now-start)/1000),at=0,slide=list.at(-1);for(const candidate of list){at+=candidate.duration;if(elapsed<at){slide=candidate;break;}}this.draw(c,slide,snapshot,language);panel.querySelector('progress').value=100*(version+elapsed/duration)/snapshot.languages.length;if(elapsed>=duration)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
          recorder.stop();const blob=await finished;if(blob.size<1000||!new TextDecoder().decode(await blob.slice(0,128).arrayBuffer()).includes('ftyp'))throw new Error('Não foi possível gerar um MP4 válido.');
          const slug=snapshot.job.name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').slice(0,45),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(snapshot.at),file=new File([blob],'obra-'+slug+'-'+date+'-'+language+'.mp4',{type:'video/mp4'}),url=URL.createObjectURL(file);this.files.push(file);this.urls.push(url);
        }finally{if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());}
      }
      status.textContent='Vídeo da obra pronto · situação em '+snapshot.at.toLocaleString('pt-BR')+'.';const results=panel.querySelector('#job-video-results');
      const share=document.createElement('button');share.className='primary';share.textContent=this.files.length>1?'Compartilhar vídeos':'Compartilhar vídeo';share.onclick=async()=>{try{if(navigator.canShare?.({files:this.files}))await navigator.share({files:this.files,title:snapshot.job.name});else this.h.message('Salve os vídeos abaixo e compartilhe os arquivos pelo seu aparelho.');}catch(error){if(error.name!=='AbortError')this.h.message('Não foi possível compartilhar. Salve os vídeos abaixo.',true);}};results.append(share);
      this.files.forEach((file,index)=>{const item=document.createElement('div');item.className='job-video-file';const preview=document.createElement('video');preview.controls=true;preview.playsInline=true;preview.preload='metadata';this.draw(c,{type:'cover'},snapshot,snapshot.languages[index]);preview.poster=canvas.toDataURL('image/jpeg',.75);preview.src=this.urls[index];const link=document.createElement('a');link.className='button secondary';link.href=this.urls[index];link.download=file.name;link.dataset.videoLanguage=snapshot.languages[index];link.textContent='Salvar vídeo · '+names[snapshot.languages[index]];item.append(preview,link);results.append(item);});
    }catch(error){this.clear();status.textContent=this.controller.signal.aborted&&error.name==='AbortError'?'Geração cancelada. Os registros da obra foram preservados.':error.message||'Não foi possível gerar o vídeo.';}
    finally{try{await wakeLock?.release();}catch{}document.removeEventListener('visibilitychange',hidden);this.busy=false;this.controller=null;panel.querySelector('#job-video-cancel').hidden=true;panel.querySelector('canvas').hidden=true;panel.querySelector('progress').hidden=true;}
  }
};

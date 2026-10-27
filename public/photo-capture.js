// Browser-side preparation for mobile capture. The original record is independent of AI.
(function () {
  async function prepare(file) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) throw new Error('Selecione uma foto.');
    const url=URL.createObjectURL(file);const img=new Image();
    try {
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));canvas.width=0;canvas.height=0;
      if(!blob)throw new Error('conversion');
      return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
    } catch {
      if(file.size>12*1024*1024)throw new Error('Não foi possível preparar '+file.name+'. Escolha uma foto JPG menor.');
      return file; // HEIC remains a valid saved attachment if this browser cannot decode it.
    } finally {img.src='';URL.revokeObjectURL(url);}
  }
  function bind(form,{onError=()=>{},onChange=()=>{}}={}) {
    let selected=[],pending=0,disposed=false,queue=Promise.resolve();const list=form.querySelector('#entry-file-list');const save=form.querySelector('[type=submit]');
    const draw=()=>{
      if(disposed)return;list.innerHTML='';
      for(const [index,p] of selected.entries()){
        const row=document.createElement('div');row.className='photo-selection';
        const image=document.createElement('img');image.src=p.url;image.alt='Foto selecionada';row.append(image);
        const text=document.createElement('span');text.textContent=p.file.name+' · '+Math.ceil(p.file.size/1024)+' KB';row.append(text);
        const remove=document.createElement('button');remove.type='button';remove.className='button ghost';remove.textContent='Remover';remove.setAttribute('aria-label','Remover foto '+(index+1));remove.onclick=()=>{URL.revokeObjectURL(p.url);selected.splice(index,1);draw();};row.append(remove);list.append(row);
      }
      const status=form.querySelector('#photo-preparation');status.textContent=pending?'Preparando fotos…':selected.length?`${selected.length} foto(s) pronta(s) para enviar.`:'';
      save.disabled=pending>0 || form.getAttribute('aria-busy')==='true';
      onChange({files:selected.map(p=>p.file),preparing:pending>0});
    };
    const add=files=>{
      if(selected.length+pending+files.length>12){onError('Selecione até 12 fotos por registro.');return;}
      pending+=files.length;draw();
      queue=queue.then(async()=>{
        for(const f of files){try{const file=await prepare(f);if(!disposed)selected.push({file,url:URL.createObjectURL(file)});}catch(e){if(!disposed)onError(e.message);}finally{pending--;if(!disposed)draw();}}
      });
    };
    for(const id of ['entry-photos','entry-camera'])form.querySelector('#'+id).onchange=e=>{const files=[...e.target.files];e.target.value='';add(files);};
    form.querySelector('#take-photo').onclick=()=>form.querySelector('#entry-camera').click();
    draw();
    return {files:()=>selected.map(p=>p.file),preparing:()=>pending>0,dispose(){disposed=true;for(const p of selected)URL.revokeObjectURL(p.url);selected=[];}};
  }
  globalThis.SkytilePhotos={prepare,bind};
})();

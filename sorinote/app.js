'use strict';
(() => {
  const {LANGUAGES,splitSentences,normalizeOCR,validateBackup}=StudyCore;
  const $=id=>document.getElementById(id);
  const synth=window.speechSynthesis;
  let db,notes=[],activeId=null,dirty=false,image=null,imageJob=0,ocrTask=null,scriptPromise=null;
  let sentences=[],cursor=0,playing=false,paused=false,serial=0,timer=null,utterance=null,pendingNext=null,availableVoices=[];
  let toastTimer;
  const language=()=>document.querySelector('input[name="language"]:checked').value;
  const currentNote=()=>notes.find(n=>n.id===activeId);
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
  function ask(title,description){return new Promise(resolve=>{const d=$('confirm-dialog');if(d.open)return resolve(false);$('dialog-title').textContent=title;$('dialog-description').textContent=description;d.returnValue='cancel';d.addEventListener('close',()=>resolve(d.returnValue==='ok'),{once:true});d.showModal();});}
  function markDirty(){dirty=true;$('save-state').textContent='아직 저장하지 않은 변경 사항이 있습니다.';updateCount();}
  function updateCount(){$('char-count').textContent=$('source-text').value.length.toLocaleString()+' / 30,000자';}
  function busy(){if(ocrTask){toast('글자 인식을 마치거나 취소한 뒤 이동해주세요.');return true;}return false;}
  async function mayDiscard(){return !dirty||await ask('변경 사항을 닫을까요?','저장하지 않은 내용은 사라집니다. 내용을 남기려면 취소 후 저장해주세요.');}
  function openDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(new Error('저장 미지원'));const req=indexedDB.open('sorinote-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('notes',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('다른 탭이 저장 공간을 사용 중입니다.'));});}
  function readAll(){return new Promise((resolve,reject)=>{const req=db.transaction('notes').objectStore('notes').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  function writeNotes(items,deleteId){return new Promise((resolve,reject)=>{if(!db)return reject(new Error('저장 공간을 사용할 수 없습니다.'));const tx=db.transaction('notes','readwrite'),store=tx.objectStore('notes');if(deleteId)store.delete(deleteId);items.forEach(item=>store.put(item));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('저장 취소'));});}
  function saveFailure(){toast('저장하지 못했습니다. 브라우저 저장 허용과 여유 공간을 확인해주세요. 기존 자료는 전체 백업으로 내보낼 수 있습니다.');}
  function renderLibrary(){
    const query=$('search').value.trim().toLowerCase();$('library-count').textContent=notes.length;
    const list=notes.filter(n=>(n.title+' '+n.text).toLowerCase().includes(query)).sort((a,b)=>b.updatedAt-a.updatedAt);
    $('library').replaceChildren();
    if(!list.length){const p=document.createElement('p');p.className='library-empty';p.textContent=notes.length?'검색 결과가 없습니다.':'아직 비어 있는 노트예요.\n첫 문장을 담아보세요.';$('library').append(p);}
    list.forEach(note=>{const b=document.createElement('button');b.className='note-item'+(note.id===activeId?' selected':'');b.setAttribute('aria-pressed',String(note.id===activeId));const title=document.createElement('strong');title.textContent=note.title;const meta=document.createElement('small');meta.textContent=LANGUAGES[note.lang].name+' · '+splitSentences(note.text,note.lang).length+'문장 · '+new Date(note.updatedAt).toLocaleDateString('ko-KR');b.append(title,meta);b.addEventListener('click',()=>loadNote(note));$('library').append(b);});
  }
  function setTab(name){const edit=name==='edit';$('editor').hidden=!edit;$('reader').hidden=edit;for(const [id,on] of [['edit-tab',edit],['read-tab',!edit]]){$(id).setAttribute('aria-selected',String(on));$(id).tabIndex=on?0:-1;}if(edit)stopSpeech();$('workspace').scrollIntoView({block:'start',behavior:'instant'});}
  function displayImage(){const exists=!!image;$('image-preview').hidden=!exists;$('upload-placeholder').hidden=exists;if(exists)$('image-preview').src=image;else $('image-preview').removeAttribute('src');$('rotate').disabled=!exists;$('remove-image').disabled=!exists;$('recognize').disabled=!exists;}
  function fillEditor(note){$('title').value=note?.title||'';$('source-text').value=note?.text||'';document.querySelector('input[name="language"][value="'+(note?.lang||language())+'"]').checked=true;image=note?.image||null;displayImage();updateCount();dirty=false;$('save-state').textContent=note?'수정한 뒤 다시 저장하면 반영됩니다.':'내용을 확인하고 저장하면 듣기 연습을 시작합니다.';}
  async function newNote(){if(busy()||!await mayDiscard())return;stopSpeech();activeId=null;sentences=[];cursor=0;imageJob++;fillEditor(null);renderLibrary();setTab('edit');$('title').focus();}
  async function loadNote(note){if(busy()||!await mayDiscard())return;stopSpeech();activeId=note.id;imageJob++;fillEditor(note);sentences=splitSentences(note.text,note.lang);cursor=Math.max(0,Math.min(note.cursor||0,sentences.length-1));renderLibrary();renderReader();setTab('read');}
  async function saveNote(){
    if(busy())return;const text=$('source-text').value.trim();if(!text){toast('듣기 연습할 본문을 입력하거나 사진에서 추출해주세요.');$('source-text').focus();return;}
    if(text.length>30000){toast('본문은 30,000자까지 저장할 수 있습니다.');return;}
    if(!activeId&&notes.length>=500){toast('자료는 최대 500개입니다. 기존 자료를 백업하고 정리해주세요.');return;}
    $('save').disabled=true;const previous=currentNote(),now=Date.now(),lang=language();
    const note={id:activeId||crypto.randomUUID(),title:$('title').value.trim()||text.slice(0,35),text,lang,image,createdAt:previous?.createdAt||now,updatedAt:now,cursor:previous&&previous.text===text&&previous.lang===lang?cursor:0};
    try{await writeNotes([note]);stopSpeech();notes=notes.filter(n=>n.id!==note.id);notes.push(note);activeId=note.id;cursor=note.cursor;sentences=splitSentences(text,lang);dirty=false;$('title').value=note.title;$('save-state').textContent='이 브라우저에 저장했습니다.';renderLibrary();renderReader();setTab('read');toast('저장했습니다. 재생 버튼으로 듣기 연습을 시작하세요.');}
    catch{saveFailure();}finally{$('save').disabled=false;}
  }
  function renderReader(){
    const note=currentNote();if(!note)return;
    $('reader-title').textContent=note.title;$('reader-language').textContent=LANGUAGES[note.lang].native+' / LISTENING PRACTICE';$('sentence-count').textContent=sentences.length+'문장';$('sentences').replaceChildren();
    sentences.forEach((sentence,i)=>{const li=document.createElement('li');li.className='sentence';li.dataset.index=i;const button=document.createElement('button');button.className='sentence-play';button.setAttribute('aria-label',(i+1)+'번 문장 재생');const number=document.createElement('span');number.className='sentence-number';number.textContent=String(i+1).padStart(2,'0');const text=document.createElement('span');text.className='sentence-body';text.lang=note.lang;button.append(number,text);button.addEventListener('click',()=>startSpeech(i));const reveal=document.createElement('button');reveal.className='secondary reveal';reveal.textContent='문장 보기';reveal.setAttribute('aria-expanded','false');reveal.addEventListener('click',()=>{li.classList.toggle('revealed');renderSentenceVisibility();});li.append(button,reveal);$('sentences').append(li);});
    renderSentenceVisibility();highlight(false);refreshVoices();$('play-state').textContent='재생 준비 · 문장을 눌러 시작할 수 있어요.';updatePlayButtons();
  }
  function renderSentenceVisibility(){const hidden=$('hide-text').checked;$('hide-hint').hidden=!hidden;document.querySelectorAll('.sentence').forEach((li,i)=>{const concealed=hidden&&!li.classList.contains('revealed'),text=li.querySelector('.sentence-body'),reveal=li.querySelector('.reveal');text.textContent=concealed?'듣고 따라 읽어보세요.':sentences[i];text.classList.toggle('concealed',concealed);reveal.hidden=!hidden;reveal.textContent=concealed?'문장 보기':'다시 가리기';reveal.setAttribute('aria-expanded',String(!concealed));});}
  function highlight(scroll){const rows=[...document.querySelectorAll('.sentence')];rows.forEach((row,i)=>{row.classList.toggle('active',i===cursor);row.querySelector('.sentence-play').setAttribute('aria-current',i===cursor?'step':'false');});$('position').textContent=(sentences.length?cursor+1:0)+' / '+sentences.length+' 문장';$('reading-progress').max=sentences.length||1;$('reading-progress').value=sentences.length?cursor+1:0;if(scroll&&rows[cursor])rows[cursor].scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});}
  function persistCursor(){const note=currentNote();if(!note)return;note.cursor=cursor;writeNotes([note]).catch(()=>{});}
  function updatePlayButtons(){$('pause').textContent=paused?'계속 듣기':'일시정지';$('pause').disabled=!playing;$('play').disabled=!synth||playing||!sentences.length;$('prev').disabled=!synth||cursor<=0;$('next').disabled=!synth||cursor>=sentences.length-1;}
  function stopSpeech(){serial++;clearTimeout(timer);timer=null;playing=false;paused=false;pendingNext=null;utterance=null;if(synth)synth.cancel();$('play-state').textContent='정지 · 현재 문장부터 다시 들을 수 있어요.';updatePlayButtons();}
  function refreshVoices(){const lang=currentNote()?.lang||language(),selected=$('voice').value;availableVoices=synth?synth.getVoices().filter(v=>v.lang.toLowerCase().split(/[-_]/)[0]===lang):[];const fallback=document.createElement('option');fallback.value='';fallback.textContent='기본 '+LANGUAGES[lang].name+' 목소리';$('voice').replaceChildren(fallback);availableVoices.forEach((v,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=v.name+' ('+v.lang+')';$('voice').append(option);});if(availableVoices[Number(selected)]&&selected!=='')$('voice').value=selected;$('voice-hint').textContent=!synth?'이 브라우저는 음성 읽기를 지원하지 않습니다. Chrome, Edge 또는 Safari에서 열어주세요.':availableVoices.length?'이 기기에서 제공하는 목소리입니다. 기기에 따라 음질과 발음이 다를 수 있습니다.':'선택 언어의 목소리를 찾지 못했습니다. 기기 설정에서 해당 언어의 음성을 설치한 뒤 다시 열어주세요. 기본 음성으로 재생을 시도할 수 있습니다.';$('play').disabled=!synth||playing;}
  function startSpeech(index=cursor){
    if(!synth||!sentences.length){toast('이 브라우저에서 재생할 수 없습니다. 지원되는 브라우저를 사용해주세요.');return;}stopSpeech();cursor=Math.max(0,Math.min(index,sentences.length-1));playing=true;const token=serial;updatePlayButtons();speakCurrent(token);
  }
  function speakCurrent(token){
    if(token!==serial||!playing||paused)return;
    const note=currentNote();if(!note)return stopSpeech();highlight(true);persistCursor();$('play-state').textContent=(cursor+1)+'번 문장을 듣고 있어요.';
    const u=new SpeechSynthesisUtterance(sentences[cursor]);utterance=u;u.lang=LANGUAGES[note.lang].locale;u.rate=Number($('rate').value);const chosen=$('voice').value;if(chosen!==''&&availableVoices[Number(chosen)])u.voice=availableVoices[Number(chosen)];
    u.onend=()=>{if(token!==serial||!playing)return;utterance=null;const repeat=$('repeat').value;let next=repeat==='sentence'?cursor:cursor+1;if(next>=sentences.length){if(repeat==='all')next=0;else{playing=false;paused=false;$('play-state').textContent='끝까지 들었어요. 첫 문장으로 돌아가 다시 연습해보세요.';updatePlayButtons();return;}}pendingNext=next;timer=setTimeout(()=>{if(token!==serial||paused||!playing)return;cursor=pendingNext;pendingNext=null;speakCurrent(token);},450);};
    u.onerror=e=>{if(token!==serial||!playing)return;stopSpeech();$('play-state').textContent='음성을 재생하지 못했습니다: '+e.error;toast('기기의 '+LANGUAGES[note.lang].name+' 음성 설치와 인터넷 연결을 확인하고 다시 재생해주세요.');};
    if(synth.paused)synth.resume();synth.speak(u);updatePlayButtons();
  }
  function togglePause(){if(!playing||!synth)return;if(paused){paused=false;if(pendingNext!==null){cursor=pendingNext;pendingNext=null;speakCurrent(serial);}else{synth.resume();$('play-state').textContent=(cursor+1)+'번 문장 재생 중';}}else{paused=true;clearTimeout(timer);synth.pause();$('play-state').textContent='일시정지';}updatePlayButtons();}
  async function acceptImage(file){
    if(busy()||!file)return;
    if(file.size>15*1024*1024){toast('사진은 15MB 이하로 선택해주세요.');return;}
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)){toast('JPG, PNG, WebP 사진을 선택해주세요. 아이폰 HEIC 사진은 JPG로 변환해주세요.');return;}
    const job=++imageJob;const url=URL.createObjectURL(file);
    try{const img=new Image();img.src=url;await img.decode();if(job!==imageJob)return;const factor=Math.min(1,2400/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*factor);canvas.height=Math.round(img.height*factor);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);image=canvas.toDataURL('image/jpeg',.92);displayImage();markDirty();toast('사진을 불러왔습니다. 학습 언어를 확인하고 글자를 추출하세요.');}catch{toast('사진을 열지 못했습니다. 다른 JPG 또는 PNG 파일로 시도해주세요.');}finally{URL.revokeObjectURL(url);}
  }
  async function rotateImage(){if(busy()||!image)return;const job=++imageJob,img=new Image();img.src=image;await img.decode();if(job!==imageJob)return;const canvas=document.createElement('canvas');canvas.width=img.height;canvas.height=img.width;const ctx=canvas.getContext('2d');ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(Math.PI/2);ctx.drawImage(img,-img.width/2,-img.height/2);image=canvas.toDataURL('image/jpeg',.94);displayImage();markDirty();}
  function loadOCR(){if(window.Tesseract)return Promise.resolve();if(scriptPromise)return scriptPromise;scriptPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';script.crossOrigin='anonymous';const timeout=setTimeout(()=>{script.remove();reject(new Error('인식 엔진 다운로드 시간 초과'));},30000);script.onload=()=>{clearTimeout(timeout);if(window.Tesseract)resolve();else reject(new Error('인식 엔진 초기화 실패'));};script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('인식 엔진 다운로드 실패'));};document.head.append(script);}).catch(e=>{scriptPromise=null;throw e;});return scriptPromise;}
  function lockOCR(on){$('recognize').disabled=on||!image;$('cancel-ocr').hidden=!on;$('ocr-progress').hidden=!on;['image-input','camera-input','rotate','remove-image','source-text','sample','title','save','join-lines'].forEach(id=>$(id).disabled=on);document.querySelectorAll('input[name="language"]').forEach(el=>el.disabled=on);if(!on)displayImage();}
  async function recognize(){
    if(busy()||!image)return;if($('source-text').value.trim()&&!await ask('본문을 추출 결과로 바꿀까요?','현재 입력된 본문은 사진에서 추출한 글로 교체됩니다. 저장된 자료는 다시 저장하기 전까지 유지됩니다.'))return;
    const task={cancelled:false,worker:null,rejectAbort:null};const abort=new Promise((_,reject)=>{task.rejectAbort=()=>reject(new Error('인식을 취소했습니다.'));});ocrTask=task;const lang=language(),input=image,join=$('join-lines').checked;lockOCR(true);$('progress').value=0;$('ocr-status').textContent='인식 엔진을 준비합니다. 처음에는 다운로드가 필요합니다.';
    let deadline;
    try{
      await Promise.race([loadOCR(),abort]);if(task.cancelled)return;
      const run=async()=>{const worker=await Tesseract.createWorker(LANGUAGES[lang].ocr,1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',logger:m=>{if(ocrTask!==task||task.cancelled)return;const recognition=m.status==='recognizing text';$('progress').value=recognition ? (0.2+0.8*(m.progress||0)) : 0.1;const labels={'loading tesseract core':'인식 엔진을 내려받고 있습니다','initializing tesseract':'인식 엔진을 시작합니다','loading language traineddata':LANGUAGES[lang].name+' 언어 파일을 내려받고 있습니다','initializing api':'언어 인식을 준비합니다','recognizing text':'사진에서 글자를 읽고 있습니다'};$('ocr-status').textContent=(labels[m.status]||'인식 준비 중')+(recognition?' · '+Math.round((m.progress||0)*100)+'%':'')+'…';}});task.worker=worker;if(task.cancelled){await worker.terminate();return null;}return await worker.recognize(input);};
      const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>{task.cancelled=true;if(task.worker)task.worker.terminate().catch(()=>{});reject(new Error('인식 시간이 초과되었습니다. 사진을 한 페이지씩 작게 잘라 다시 시도해주세요.'));},180000);});
      const result=await Promise.race([run(),timeout,abort]);if(task.cancelled||!result)return;
      const text=normalizeOCR(result.data.text,lang,join);if(!text){toast('글자를 찾지 못했습니다. 밝고 선명한 사진으로 다시 시도하거나 직접 입력해주세요.');return;}if(text.length>30000){toast('추출한 글이 30,000자를 넘습니다. 사진을 나누어 다시 올려주세요.');return;}
      $('source-text').value=text;markDirty();toast('글자를 추출했습니다. 틀린 글자와 문장부호를 확인하고 저장하세요.');
    }catch(e){if(!task.cancelled||String(e.message).includes('초과'))toast('글자 인식 실패: '+e.message+' 인터넷 연결을 확인하거나 본문을 직접 입력해주세요.');}
    finally{clearTimeout(deadline);if(task.worker)await task.worker.terminate().catch(()=>{});if(ocrTask===task){ocrTask=null;lockOCR(false);}}
  }
  function download(name,content){const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportBackup(){if(!notes.length){toast('백업할 학습 자료가 없습니다. 먼저 자료를 저장해주세요.');return;}if(dirty&&!await ask('저장된 자료를 백업할까요?','아직 저장하지 않은 수정 내용은 백업에 포함되지 않습니다. 저장된 자료만 내보내려면 계속을 누르세요.'))return;let payload=JSON.stringify({format:'sorinote',version:1,exportedAt:new Date().toISOString(),notes});if(new Blob([payload]).size>49*1024*1024){if(!await ask('사진을 제외하고 백업할까요?','사진을 포함한 백업이 50MB를 넘어 가져올 수 없습니다. 본문·언어·학습 위치만 백업하면 듣기 연습은 그대로 사용할 수 있습니다.'))return;payload=JSON.stringify({format:'sorinote',version:1,exportedAt:new Date().toISOString(),notes:notes.map(n=>({...n,image:null}))});}download('소리노트_백업_'+new Date().toLocaleDateString('sv-SE')+'.json',payload);toast('백업 파일 다운로드를 시작했습니다. 학습 자료가 포함되므로 개인적으로 보관하세요.');}
  async function importBackup(file){
    if(!file||busy())return;if(file.size>50*1024*1024){toast('백업은 50MB 이하 파일만 가져올 수 있습니다.');return;}
    try{const imported=validateBackup(JSON.parse(await file.text()));if(!imported.length){toast('빈 백업 파일입니다.');return;}const merged=new Map(notes.map(n=>[n.id,n]));imported.forEach(n=>merged.set(n.id,n));if(merged.size>500)throw new Error('합친 자료가 500개를 넘습니다.');const overlaps=imported.filter(n=>notes.some(v=>v.id===n.id)).length;if(!await ask('학습 자료 '+imported.length+'개를 가져올까요?',(overlaps?overlaps+'개 자료는 같은 ID의 기존 자료를 덮어씁니다.\n':'기존 자료에 추가합니다.\n')+(dirty?'저장하지 않은 편집 내용은 닫힙니다.\n':'')+'사진과 본문은 이 브라우저에 저장됩니다.'))return;await writeNotes(imported);stopSpeech();notes=[...merged.values()];dirty=false;activeId=null;fillEditor(null);renderLibrary();setTab('edit');toast(imported.length+'개 자료를 가져왔습니다. 보관함에서 선택하세요.');}
    catch(e){toast('가져오지 못했습니다: '+(e.name==='SyntaxError'?'올바른 JSON 파일이 아닙니다.':e.message));}
  }
  $('new-note').addEventListener('click',newNote);$('search').addEventListener('input',renderLibrary);$('save').addEventListener('click',saveNote);
  ['title','source-text'].forEach(id=>$(id).addEventListener('input',markDirty));
  document.querySelectorAll('input[name="language"]').forEach(el=>el.addEventListener('change',()=>{markDirty();toast('학습 언어를 '+LANGUAGES[language()].name+'로 변경했습니다. 본문은 자동 번역되지 않습니다.');}));
  $('sample').addEventListener('click',async()=>{if($('source-text').value.trim()&&!await ask('본문을 예문으로 바꿀까요?','현재 편집 중인 본문을 선택 언어의 예문으로 교체합니다.'))return;$('source-text').value=LANGUAGES[language()].sample;if(!$('title').value)$('title').value=LANGUAGES[language()].name+' 첫 연습';markDirty();});
  $('edit-tab').addEventListener('click',()=>setTab('edit'));$('read-tab').addEventListener('click',()=>{if(busy())return;if(!currentNote()){toast('먼저 본문을 입력하고 ‘저장하고 듣기 시작’을 눌러주세요.');return;}if(dirty){toast('변경 내용을 듣기 전에 먼저 저장해주세요.');return;}setTab('read');});
  for(const id of ['edit-tab','read-tab'])$(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const target=e.key==='Home'?'edit-tab':e.key==='End'?'read-tab':id==='edit-tab'?'read-tab':'edit-tab';$(target).focus();$(target).click();}});
  $('edit-note').addEventListener('click',()=>setTab('edit'));
  for(const id of ['image-input','camera-input'])$(id).addEventListener('change',e=>{acceptImage(e.target.files[0]);e.target.value='';});
  document.querySelectorAll('.file-button').forEach(label=>label.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();label.querySelector('input').click();}}));
  $('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragover');});$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('dragover'));$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');acceptImage(e.dataTransfer.files[0]);});
  document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
  $('rotate').addEventListener('click',()=>rotateImage().catch(()=>toast('사진을 회전하지 못했습니다. 다시 올려주세요.')));$('remove-image').addEventListener('click',()=>{imageJob++;image=null;displayImage();markDirty();});$('recognize').addEventListener('click',recognize);
  $('cancel-ocr').addEventListener('click',()=>{if(!ocrTask)return;ocrTask.cancelled=true;ocrTask.rejectAbort();if(ocrTask.worker)ocrTask.worker.terminate().catch(()=>{});toast('글자 인식을 취소했습니다.');});
  $('play').addEventListener('click',()=>startSpeech());$('pause').addEventListener('click',togglePause);$('stop').addEventListener('click',()=>{stopSpeech();persistCursor();});
  $('prev').addEventListener('click',()=>startSpeech(Math.max(0,cursor-1)));$('next').addEventListener('click',()=>startSpeech(Math.min(sentences.length-1,cursor+1)));$('restart').addEventListener('click',()=>{stopSpeech();cursor=0;highlight(false);persistCursor();$('play-state').textContent='첫 문장부터 재생할 준비가 됐어요.';updatePlayButtons();});
  $('hide-text').addEventListener('change',()=>{document.querySelectorAll('.sentence').forEach(row=>row.classList.remove('revealed'));renderSentenceVisibility();});
  $('delete-note').addEventListener('click',async()=>{const note=currentNote();if(!note||!await ask('이 자료를 삭제할까요?',note.title+'\n삭제하면 이 브라우저에서 복구할 수 없습니다. 필요하면 먼저 백업해주세요.'))return;try{await writeNotes([],note.id);notes=notes.filter(n=>n.id!==note.id);dirty=false;await newNote();toast('자료를 삭제했습니다.');}catch{saveFailure();}});
  $('export').addEventListener('click',exportBackup);$('import').addEventListener('change',e=>{importBackup(e.target.files[0]);e.target.value='';});$('import-label').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('import').click();}});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>{if(synth)synth.cancel();});
  if(synth)synth.addEventListener('voiceschanged',refreshVoices);
  async function initialize(){renderLibrary();refreshVoices();try{db=await openDB();notes=await readAll();renderLibrary();db.onversionchange=()=>{db.close();db=null;toast('저장 공간이 변경됐습니다. 페이지를 새로고침해주세요.');};}catch{$('save-state').textContent='저장 공간을 열지 못했습니다. 브라우저의 사이트 데이터 허용 설정을 확인해주세요.';toast('브라우저 저장 공간을 사용할 수 없습니다. 사이트 데이터 저장을 허용한 뒤 새로고침해주세요.');}updatePlayButtons();}
  initialize();
})();

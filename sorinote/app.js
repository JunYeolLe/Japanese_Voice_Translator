'use strict';
(() => {
  const { LANGUAGES, ocrPlan, rasterSize, splitParagraphs, documentFromOCR, uncertainLines, preferLine, sentenceRanges, createPlayback } = StudyCore;
  const { rubySegments, hiragana, plainCopy, createFuriganaController } = StudyReading;
  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis;
  let paragraphs = [], annotations = [], photo = null, revision = 0, ocrTask = null, scriptPromise = null;
  let toastTimer = null, lastActiveParagraph = -1, lastSentenceKey = '';
  let initializationGate = Promise.resolve();
  let showFurigana = false, furiganaTokens = null, readingOverrides = [], readingTarget = null;
  let furiganaWorker = null, furiganaRequest = 0, furiganaPending = new Map();
  let cropState = null, cropDrag = null, cropResume = false;
  let workspace = null;
  let sourceMode = 'photo', editorPurpose = 'edit', pasteDraft = '', beforeSentenceSplit = null;
  const selectedVoices = {};
  let voicePreview = null;
  const voiceSettings=document.createElement('div');voiceSettings.className='voice-settings';
  voiceSettings.innerHTML='<label for="voice-select">읽어주는 목소리</label><select id="voice-select" aria-describedby="voice-note"><option value="">자동 선택</option></select><button id="voice-preview" class="secondary" type="button">짧게 들어보기</button><p id="voice-note">기기·브라우저에 따라 목소리가 달라요. 일부 음성은 인터넷 연결이 필요해요.</p>';
  document.querySelector('.settings-panel').append(voiceSettings);
  const settingsClose=document.createElement('button');settingsClose.type='button';settingsClose.className='text-button settings-close';settingsClose.textContent='닫기';settingsClose.setAttribute('aria-label','읽기 설정 닫기');settingsClose.onclick=()=>{$('reading-settings').open=false;};document.querySelector('.settings-panel').prepend(settingsClose);
  document.addEventListener('click',event=>{if(!$('reading-settings').contains(event.target))$('reading-settings').open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')$('reading-settings').open=false;});
  const qualityPanel=document.createElement('div');qualityPanel.id='photo-quality';qualityPanel.className='photo-quality';qualityPanel.hidden=true;
  qualityPanel.innerHTML='<p id="quality-summary" role="status"></p><details id="quality-details"><summary>사진 상태 자세히</summary><ul id="quality-reasons"></ul><p>기기 안에서 밝기·선명도·기울기를 추정해요. 글 잘림과 인식 정확도를 보장하지 않으며, 작은 후리가나는 지우지 않아요.</p></details><button id="quality-continue" type="button" class="secondary" hidden>이 사진 그대로 읽기</button>';
  $('photo-preview').after(qualityPanel);
  const language = () => document.querySelector('input[name="language"]:checked').value;
  const layout = () => language() === 'ja' ? $('layout').value : 'horizontal';
  const scrollTo = element => element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function error(message) {
    $('error-text').textContent = message; $('error-panel').hidden = false;
    $('retry').hidden = !photo;
  }
  function voiceFor(lang) {
    const voices = synth ? synth.getVoices().filter(voice => voice.lang.toLowerCase().split(/[-_]/)[0] === lang) : [];
    return voices.find(voice => voice.voiceURI === selectedVoices[lang]) || voices.find(voice => voice.default) || voices.find(voice => voice.localService) || voices[0] || null;
  }
  function updateVoiceWarning() {
    const select=$('voice-select'),voices=synth?synth.getVoices().filter(v=>v.lang.toLowerCase().split(/[-_]/)[0]===language()):[];
    select.replaceChildren(new Option('자동 선택',''));
    for(const voice of voices)select.add(new Option(voice.name+' · '+voice.lang,voice.voiceURI));
    select.value=voices.some(v=>v.voiceURI===selectedVoices[language()])?selectedVoices[language()]:'';
    select.disabled=!voices.length;$('voice-preview').disabled=!synth;
    const warning = !synth ? '이 브라우저에서는 음성 읽기를 사용할 수 없어요. Chrome·Edge·Safari에서 열어주세요.'
      : !voiceFor(language()) ? '이 기기에서 '+LANGUAGES[language()].name+' 목소리를 찾지 못했어요. 소리가 나지 않으면 기기 설정에서 해당 언어 음성을 설치해주세요.' : '';
    $('voice-warning').textContent = warning; $('voice-warning').hidden = !warning;
    $('play-all').disabled = !synth;
    document.querySelectorAll('.paragraph-play,.paragraph-repeat').forEach(button => { button.disabled = !synth; });
  }
  function renderPlayback(state) {
    if (workspace?.view() === 'practice') return;
    const active = state.status === 'playing' || state.status === 'paused';
    const allActive = active && state.scope === 'all';
    $('all-label').textContent = allActive ? (state.status === 'paused' ? '이어서 듣기' : '잠깐 멈춤') : '전체 듣기';
    $('all-symbol').textContent = allActive && state.status === 'playing' ? 'Ⅱ' : '▶';
    $('stop').disabled = !active;
    $('status-dot').classList.toggle('playing', state.status === 'playing');
    $('play-status').textContent = active ? (state.paragraph+1)+' / '+paragraphs.length+' 단락 · '+(state.status === 'paused' ? '잠깐 멈췄어요' : state.repeat ? '반복 '+state.cycle+'회째' : '듣고 있어요')
      : state.status === 'finished' ? (state.scope === 'all' ? '끝까지 들었어요. 다시 들어볼까요?' : '이 단락을 다 들었어요.') : '듣고 싶은 단락을 골라보세요.';
    const cards = [...$('paragraphs').querySelectorAll('.paragraph')];
    cards.forEach((card, i) => {
      const current = active && i === state.paragraph;
      card.classList.toggle('active', current);
      const button = card.querySelector('.paragraph-play');
      const individual = current && state.scope === 'paragraph';
      const playing = individual && state.status === 'playing';
      button.textContent = playing ? 'Ⅱ' : '▶';
      button.setAttribute('aria-label', (i+1)+'번 단락 '+(playing ? '일시정지' : individual ? '이어서 듣기' : '듣기'));
      button.setAttribute('aria-pressed', String(current));
      const repeat = card.querySelector('.paragraph-repeat');
      if (repeat) { repeat.setAttribute('aria-pressed',String(current && state.repeat)); repeat.setAttribute('aria-label',(i+1)+'번 단락 '+(current && state.repeat ? '반복 끄기' : '반복 듣기')); }
      card.querySelectorAll('.sentence').forEach(sentence => {
        const speaking = current && Number(sentence.dataset.start) < state.rangeEnd && Number(sentence.dataset.end) > state.rangeStart;
        sentence.classList.toggle('speaking',speaking);
        if (speaking) sentence.setAttribute('aria-current','true'); else sentence.removeAttribute('aria-current');
      });
    });
    const key = active ? state.paragraph+':'+state.rangeStart : '';
    if (active && key !== lastSentenceKey && cards[state.paragraph] && !$('reading-settings').open && !document.querySelector('dialog[open]')) {
      const target = cards[state.paragraph].querySelector('.sentence.speaking') || cards[state.paragraph],rect = target.getBoundingClientRect();
      const lower = Math.min(window.innerHeight-20,$('player-bar').getBoundingClientRect().top-15);
      if (rect.top < 20 || rect.bottom > lower) target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
    lastSentenceKey = key;
    lastActiveParagraph = active ? state.paragraph : -1;
  }
  const player = createPlayback({
    synth,
    makeUtterance: text => new SpeechSynthesisUtterance(text),
    getRate: () => Number($('rate').value),
    getVoice: voiceFor,
    onChange: renderPlayback,
    onError: () => toast('음성을 재생하지 못했어요. 기기의 음성 설치와 소리 설정을 확인하고 다시 눌러주세요.')
  });
  function updateRateDisplay() {
    const input=$('rate'),value=Number(input.value);
    $('rate-value').textContent=value.toFixed(2)+'×';
    input.setAttribute('aria-valuetext',value.toFixed(2)+'배속');
    input.style.setProperty('--speed-fill',((value-Number(input.min))/(Number(input.max)-Number(input.min))*100)+'%');
  }
  function paintParagraph(index) {
    const body = $('paragraphs').querySelectorAll('.paragraph-text')[index]; if (!body) return;
    const text = paragraphs[index]; body.replaceChildren();
    const parts = showFurigana && furiganaTokens ? rubySegments(text,furiganaTokens[index],readingOverrides[index]) : [{base:text,reading:'',start:0,end:text.length}];
    const words=workspace?.words(index)||[];
    const groups=words.length?words:[{start:0,end:text.length,selectable:false}];
    let wordCursor=0,partCursor=0;
    for (const sentence of sentenceRanges(text,language())) {
      const span = document.createElement('span'); span.className = 'sentence'; span.dataset.start = sentence.start; span.dataset.end = sentence.end;
      while(wordCursor<groups.length&&groups[wordCursor].end<=sentence.start)wordCursor++;
      for(let wi=wordCursor;wi<groups.length&&groups[wi].start<sentence.end;wi++){
        const word=groups[wi];
        const from=Math.max(sentence.start,word.start),to=Math.min(sentence.end,word.end);if(to<=from)continue;
        const wrapper=document.createElement('span');wrapper.dataset.start=from;wrapper.dataset.end=to;
        if(word.selectable){wrapper.className='lookup-word';wrapper.tabIndex=0;wrapper.setAttribute('role','button');wrapper.setAttribute('aria-label',word.surface+' 단어 뜻 보기');
          const lookup=()=>workspace.openWord(index,word);wrapper.addEventListener('click',event=>{event.stopPropagation();lookup();});wrapper.addEventListener('keydown',event=>{if(event.target===wrapper&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();lookup();}});
        }
      while(partCursor<parts.length&&parts[partCursor].end<=from)partCursor++;
      for (let pi=partCursor;pi<parts.length&&parts[pi].start<to;pi++) {
        const part=parts[pi];
        const start = Math.max(from,part.start), end = Math.min(to,part.end); if (end <= start) continue;
        const base = text.slice(start,end);
        if (!part.reading || start !== part.start || end !== part.end) { wrapper.append(document.createTextNode(base)); continue; }
        const ruby = document.createElement('ruby'), rt = document.createElement('rt');
        ruby.append(document.createTextNode(base)); rt.textContent = part.reading; rt.setAttribute('aria-hidden','true'); ruby.append(rt);
        rt.removeAttribute('aria-hidden');rt.tabIndex = 0; rt.setAttribute('role','button'); rt.setAttribute('aria-label',base+' 읽는 법 수정, '+part.reading); rt.title = '후리가나 수정';
        const edit = () => { player.pause(); readingTarget = {index,start:part.start,base}; $('reading-word').textContent = base; $('reading-value').value = part.reading; $('reading-dialog').showModal(); $('reading-value').focus(); };
        rt.addEventListener('click',event=>{event.stopPropagation();edit();}); rt.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();event.stopPropagation(); edit(); } });
        wrapper.append(ruby);
      }
        if(word.selectable)span.append(wrapper);else span.append(...wrapper.childNodes);
      }
      body.append(span);
    }
    workspace?.highlight(index,body);
  }
  function paintReadings() {
    // Apply ruby line spacing before inserting annotations so the first render
    // has the same layout as subsequent hide/show operations.
    document.body.classList.toggle('has-furigana',showFurigana && Boolean(furiganaTokens));
    paragraphs.forEach((_,index)=>paintParagraph(index));
    const state=furigana.getState(),loading=state.status==='loading';
    $('furigana-toggle').disabled=loading;
    $('furigana-toggle').setAttribute('aria-busy',String(loading));
    $('furigana-toggle').setAttribute('aria-pressed',String(showFurigana && Boolean(furiganaTokens)));
    $('furigana-toggle').textContent = loading ? '후리가나 준비 중…' : showFurigana ? '후리가나 끄기' : state.status==='error' ? '후리가나 다시 시도' : '후리가나 켜기';
    renderPlayback(player.getState());
    workspace?.renderPractice();
  }
  const furigana=createFuriganaController({load:requestFurigana,onChange:state=>{
    showFurigana=state.visible;furiganaTokens=state.tokens;
    $('furigana-status').hidden=state.status==='idle'||(state.status==='ready'&&!state.visible);
    $('furigana-status').textContent=state.status==='loading'
      ? state.stage==='readings' ? '읽는 법을 붙이고 있어요. 완료되면 자동으로 표시됩니다.' : '사전을 준비하고 있어요. 완료되면 자동으로 표시됩니다.'
      : state.status==='error' ? state.error : '작은 읽는 법을 누르면 수정할 수 있어요.';
    paintReadings();
  }});
  function requestFurigana(items,onProgress) {
    if (!furiganaWorker) {
      const worker=new Worker('furigana-worker.js?v=12');furiganaWorker=worker;
      worker.onmessage = event => {
        const pending=furiganaPending.get(event.data.id);if(!pending||pending.worker!==worker)return;
        if(event.data.status){pending.onProgress?.(event.data.status);return;}
        clearTimeout(pending.timer);furiganaPending.delete(event.data.id);
        event.data.error?pending.reject(new Error(event.data.error)):pending.resolve(event.data.tokens);
      };
      worker.onerror = () => {
        for(const [id,pending] of furiganaPending){if(pending.worker!==worker)continue;clearTimeout(pending.timer);furiganaPending.delete(id);pending.reject(new Error('후리가나 사전을 준비하지 못했어요. 다시 시도해주세요.'));}
        worker.terminate();if(furiganaWorker===worker)furiganaWorker=null;
      };
    }
    const id = ++furiganaRequest;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { furiganaPending.delete(id); reject(new Error('후리가나 준비에 시간이 걸려요. 연결을 확인하고 다시 시도해주세요.')); },180000);
      furiganaPending.set(id,{resolve,reject,timer,worker:furiganaWorker,onProgress});furiganaWorker.postMessage({id,paragraphs:items,progress:true});
    });
  }
  function toggleFurigana() {
    if (language() !== 'ja') return;
    return furigana.toggle(paragraphs);
  }
  async function copyAll() {
    const text = plainCopy(paragraphs); if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('본문 전체를 복사했어요. 단락 구분도 함께 담았어요.'); }
    catch { $('copy-text').value = text; $('copy-dialog').showModal(); $('copy-text').select(); }
  }

  function terminateWorker(task) {
    if (task.pageWorker) { task.pageWorker.terminate(); task.pageWorker = null; }
    if (!task.worker) return Promise.resolve();
    if (task.terminated) return task.termination || Promise.resolve();
    task.terminated = true;
    task.termination = Promise.resolve(task.worker.terminate()).catch(() => {});
    return task.termination;
  }
  function cancelOCR() {
    const task = ocrTask;
    if (!task) return;
    ocrTask = null; task.cancelled = true; task.abort(); terminateWorker(task);
    $('ocr-progress').hidden = true; $('rotate').disabled = false;
  }
  function clearResult() {
    workspace?.reset();
    player.stop(); paragraphs = []; annotations = []; lastActiveParagraph = -1;
    furigana.reset();readingOverrides=[];
    readingTarget = null; $('reading-word').textContent = ''; $('reading-value').value = ''; $('copy-text').value = '';
    // Release the dictionary before starting another OCR engine on a phone.
    if (furiganaWorker) { furiganaWorker.terminate(); furiganaWorker = null; }
    for (const pending of furiganaPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('cancelled')); } furiganaPending.clear();
    $('paragraphs').replaceChildren(); $('results').hidden = true; $('player-bar').hidden = true;
    $('source-text').value = ''; $('text-count').textContent = '0자';
    $('text-editor').hidden = true; $('error-panel').hidden = true;
    document.body.classList.remove('has-results');
  }
  function reset({ scroll = true } = {}) {
    workspace?.navigate('read');
    revision++; cancelOCR(); clearResult();
    if ($('crop-dialog').open) $('crop-dialog').close(); cropState = null; cropDrag = null; cropResume = false;
    if ($('reading-dialog').open) $('reading-dialog').close();
    if ($('copy-dialog').open) $('copy-dialog').close(); $('crop-canvas').width = 1; $('crop-canvas').height = 1;
    if (photo) URL.revokeObjectURL(photo.previewURL);
    photo = null;
    qualityPanel.hidden=true;$('quality-continue').hidden=true;$('quality-details').open=false;$('quality-reasons').replaceChildren();$('quality-summary').textContent='';
    $('image-preview').removeAttribute('src'); $('photo-preview').hidden = true;
    $('image-input').value = ''; $('camera-input').value = '';
    $('rate').value = '1'; updateRateDisplay(); $('toast').hidden = true; clearTimeout(toastTimer);
    document.body.classList.remove('has-content');
    sourceMode='photo';editorPurpose='edit';pasteDraft='';beforeSentenceSplit=null;renderIntake();
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showParagraphs(items, notes = [], records = null, keepUndo = false) {
    player.stop(); paragraphs = items; annotations = notes; lastActiveParagraph = -1;
    furigana.reset();readingOverrides=[];
    $('paragraph-count').textContent = items.length+'개'; $('paragraphs').replaceChildren();
    const appendNotes = before => notes.filter(note => note.before === before).forEach(note => {
      const item = document.createElement('li'); item.className = 'reading-note';
      const label = document.createElement('span'); label.textContent = note.kind === 'source' ? '출처 · 듣기에서 제외' : '생략 표시 · 듣기에서 제외';
      const text = document.createElement('p'); text.lang = language(); text.textContent = note.text;
      item.append(label, text); $('paragraphs').append(item);
    });
    items.forEach((text, index) => {
      appendNotes(index);
      const card = document.createElement('li'); card.className = 'paragraph';
      const top = document.createElement('div'); top.className = 'paragraph-top';
      const label = document.createElement('span'); label.className = 'paragraph-label'; label.textContent = 'PARAGRAPH '+String(index+1).padStart(2, '0');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'paragraph-play'; button.textContent = '▶'; button.setAttribute('aria-label', (index+1)+'번 단락 듣기');
      button.addEventListener('click', () => {
        const state = player.getState();
        if (state.scope === 'paragraph' && state.paragraph === index && ['playing', 'paused'].includes(state.status)) {
          if (state.status === 'playing') player.pause(); else player.resume();
        } else player.play(paragraphs, index, 'paragraph', language());
      });
      const repeat = document.createElement('button'); repeat.type = 'button'; repeat.className = 'paragraph-repeat'; repeat.textContent = '↻'; repeat.title = '이 단락 반복 듣기'; repeat.setAttribute('aria-pressed','false'); repeat.setAttribute('aria-label',(index+1)+'번 단락 반복 듣기');
      repeat.addEventListener('click',() => { const state = player.getState(); if (state.paragraph === index && state.repeat && ['playing','paused'].includes(state.status)) player.setRepeat(false); else player.play(paragraphs,index,'paragraph',language(),{repeat:true}); });
      const controls = document.createElement('div'); controls.className = 'paragraph-controls'; controls.append(repeat,button);
      const body = document.createElement('p'); body.className = 'paragraph-text'; body.lang = language(); body.textContent = text;
      top.append(label, controls); card.append(top, body); $('paragraphs').append(card);
    });
    appendNotes(items.length);
    $('source-text').value = items.join('\n\n'); updateTextCount();
    $('results').hidden = false; $('player-bar').hidden = false; $('text-editor').hidden = true;
    document.body.classList.add('has-content', 'has-results');
    workspace?.setDocument(items,records,keepUndo);
    $('furigana-toggle').hidden = language() !== 'ja'; paintReadings();
    updateVoiceWarning(); renderPlayback(player.getState());
    renderIntake();
  }
  function updateTextCount() { $('text-count').textContent = $('source-text').value.length.toLocaleString()+'자'; }
  function renderIntake() {
    const textMode=sourceMode==='text';
    $('photo-mode').setAttribute('aria-selected',String(!textMode));$('photo-mode').tabIndex=textMode?-1:0;
    $('write-text').setAttribute('aria-selected',String(textMode));$('write-text').tabIndex=textMode?0:-1;
    $('photo-source').hidden=textMode;$('layout-field').hidden=textMode||language()!=='ja';
    $('paste-ready').hidden=!textMode||!$('text-editor').hidden;
    $('another-photo').textContent=textMode?'＋ 다른 글 붙여넣기':'＋ 다른 사진으로 새로 시작';
  }
  function chooseSource(mode,{fresh=false}={}) {
    workspace?.stop();
    if(editorPurpose==='paste'&&!$('text-editor').hidden)pasteDraft=$('source-text').value;
    sourceMode=mode;
    if(mode==='text') {if(fresh)pasteDraft='';openEditor('paste');}
    else closeEditor();
    renderIntake();
  }
  function openEditor(purpose='edit') {
    editorPurpose=purpose;beforeSentenceSplit=null;
    $('source-text').value=purpose==='paste'?pasteDraft:paragraphs.join('\n\n');updateTextCount();
    $('editor-title').textContent=purpose==='paste'?'글을 붙여넣어 주세요':'읽을 글 확인하기';
    $('editor-hint').textContent=purpose==='paste'?'복사한 글을 붙여넣거나 직접 입력하세요. 빈 줄 하나가 단락 하나가 됩니다.':'잘못 읽힌 글자를 고쳐주세요. 빈 줄 하나가 단락 하나가 됩니다.';
    $('apply-text').textContent=purpose==='paste'?'▶ 바로 듣기':'이 글로 듣기 →';
    $('paste-options').hidden=purpose!=='paste';$('split-pasted').textContent='문장별로 나누기';
    workspace?.stopPractice();
    if (ocrTask) { cancelOCR(); $('photo-caption').textContent = '사진 인식을 멈췄어요. 다시 읽거나 직접 입력할 수 있어요.'; error('직접 입력으로 전환했어요. 사진을 다시 읽으려면 아래 버튼을 눌러주세요.'); }
    player.stop(); $('text-editor').hidden = false; $('results').hidden = true; $('player-bar').hidden = true;
    document.body.classList.remove('has-results'); document.body.classList.add('has-content');
    renderIntake();scrollTo(purpose==='paste'?$('intake-card'):$('text-editor')); $('source-text').focus({ preventScroll: true });
  }
  function closeEditor() {
    if(editorPurpose==='paste'&&!$('text-editor').hidden)pasteDraft=$('source-text').value;
    $('text-editor').hidden = true;
    $('source-text').value = paragraphs.join('\n\n'); updateTextCount();
    if (paragraphs.length) { $('results').hidden = false; $('player-bar').hidden = false; document.body.classList.add('has-results'); }
    else if (!photo) document.body.classList.remove('has-content');
    if(!paragraphs.length&&sourceMode==='text')sourceMode='photo';renderIntake();
  }
  function applyText() {
    const text = $('source-text').value;
    if (!text.trim()) { toast('읽을 글을 먼저 입력해주세요.'); $('source-text').focus(); return; }
    if (text.length > 30000) { toast('한 번에 30,000자까지 읽을 수 있어요.'); return; }
    $('error-panel').hidden = true;
    const edited = splitParagraphs(text, language());
    revision++; cancelOCR();
    const pasted=editorPurpose==='paste';
    if(pasted){
      pasteDraft=text;clearResult();
      if(photo?.previewURL)URL.revokeObjectURL(photo.previewURL);photo=null;qualityPanel.hidden=true;$('quality-continue').hidden=true;
      $('image-preview').removeAttribute('src');$('photo-preview').hidden=true;
      $('image-input').value='';$('camera-input').value='';
      showParagraphs(edited,[],edited.map(StudyDocument.fresh));
    } else showParagraphs(edited, annotations.map(note => ({ ...note, before: note.kind === 'source' ? edited.length : Math.min(note.before, edited.length) })));
    if(!photo)pasteDraft=edited.join('\n\n');
    $('source-text').blur();
    scrollTo($('results'));
    // Keep speak() in the button's user gesture for mobile browser audio rules.
    if(pasted&&!player.play(paragraphs,0,'all',language()))toast('본문을 준비했어요. 이 브라우저에서는 음성 재생을 사용할 수 없어요.');
  }
  async function acceptPhoto(file) {
    if (!file) return;
    if (file.size > 15*1024*1024) { toast('사진은 15MB 이하로 선택해주세요.'); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('JPG·PNG·WebP 사진을 선택해주세요. HEIC는 JPG로 바꿔주세요.'); return; }
    reset({ scroll: false }); const token = revision;
    document.body.classList.add('has-content');
    $('ocr-progress').hidden = false; $('progress').value = 0; $('ocr-status').textContent = '사진을 준비하고 있어요…';
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (token !== revision) return;
      const source = document.createElement('canvas');
      const sourceScale = Math.min(1,3000/Math.max(img.width,img.height),Math.sqrt(3000000/(img.width*img.height)));
      source.width = Math.max(1,Math.round(img.width*sourceScale)); source.height = Math.max(1,Math.round(img.height*sourceScale));
      const ctx = source.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,source.width,source.height); ctx.drawImage(img,0,0,source.width,source.height);
      photo = { fullSource: source, file, turns: 0, crop: {x:0,y:0,w:1,h:1}, previewURL: null, canvas: null };
      $('ocr-progress').hidden = true;
      await preparePhoto(source,token,photo.crop);
    } catch {
      if (token !== revision) return;
      $('ocr-progress').hidden = true; error('사진을 열지 못했어요. 다른 JPG·PNG 사진을 선택해주세요.');
    } finally { URL.revokeObjectURL(url); }
  }
  async function setPhoto(canvas, token, original = {}) {
    // OCR receives the lossless full canvas. Only the small preview is resized.
    const preview = document.createElement('canvas');
    const scale = Math.min(1, 480/Math.max(canvas.width, canvas.height));
    preview.width = Math.max(1, Math.round(canvas.width*scale)); preview.height = Math.max(1, Math.round(canvas.height*scale));
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    const blob = await new Promise(resolve => preview.toBlob(resolve, 'image/png'));
    if (token !== revision) return false;
    if (!blob) throw new Error('사진을 준비하지 못했어요.');
    if (photo) URL.revokeObjectURL(photo.previewURL);
    photo = { ...photo, canvas, previewURL: URL.createObjectURL(blob), ...original };
    $('image-preview').src = photo.previewURL; $('photo-preview').hidden = false;
    return true;
  }
  async function preparePhoto(source,token,rect){
    const size=rasterSize(source.width,source.height),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingQuality='high';ctx.drawImage(source,size.padding,size.padding,size.contentWidth,size.contentHeight);
    if(!await setPhoto(canvas,token,{source,padding:size.padding,scale:size.contentWidth/source.width,crop:rect,reference:null}))return;
    let result;try{result=PhotoQuality.inspect(source);}catch{result={level:'check',label:'확인이 필요함',issues:['사진 상태를 자동으로 확인하지 못했어요. 사진을 보고 인식을 진행해주세요.']};}
    if(token!==revision)return;photo.quality=result;photo.awaitingQuality=result.level!=='good';
    qualityPanel.hidden=false;qualityPanel.dataset.level=result.level;
    $('quality-summary').textContent=result.label+' · '+(result.issues[0]||'밝기와 선명도가 양호해 보여요.');
    $('quality-summary').title=result.issues.join(' ');$('quality-reasons').replaceChildren();
    for(const message of result.issues){const li=document.createElement('li');li.textContent=message;$('quality-reasons').append(li);}
    $('quality-continue').hidden=!photo.awaitingQuality;
    $('photo-title').textContent='사진을 준비했어요';$('photo-caption').textContent=photo.awaitingQuality?'확인 후 그대로 읽거나 자르기·회전을 해주세요.':'본문을 인식하고 있어요.';
    // Let the compact advisory paint before starting the OCR worker.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(token!==revision)return;
    if(!photo.awaitingQuality)await recognize(token);
  }
  function drawCrop() {
    if (!cropState || !photo?.fullSource) return;
    const canvas = $('crop-canvas'),ctx = canvas.getContext('2d'),r = cropState;
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(photo.fullSource,0,0,canvas.width,canvas.height);
    const x=r.x*canvas.width,y=r.y*canvas.height,w=r.w*canvas.width,h=r.h*canvas.height;
    ctx.fillStyle = '#152d32a8'; ctx.fillRect(0,0,canvas.width,y); ctx.fillRect(0,y+h,canvas.width,canvas.height-y-h); ctx.fillRect(0,y,x,h); ctx.fillRect(x+w,y,canvas.width-x-w,h);
    ctx.strokeStyle = '#a5d66e'; ctx.lineWidth = 2; ctx.strokeRect(x+1,y+1,Math.max(0,w-2),Math.max(0,h-2)); ctx.fillStyle = '#f9fff0';
    for (const [cx,cy] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]) ctx.fillRect(cx-5,cy-5,10,10);
    for (const key of ['x','y','w','h']) $('crop-'+key).value = Math.round(r[key]*100);
  }
  function openCrop() {
    if (!photo?.fullSource) return;
    cropResume = Boolean(ocrTask);
    revision++; cancelOCR(); player.stop();
    cropState = {...photo.crop}; cropDrag = null;
    const canvas = $('crop-canvas'),source = photo.fullSource,scale = Math.min(1,660/source.width,480/source.height);
    canvas.width = Math.max(1,Math.round(source.width*scale)); canvas.height = Math.max(1,Math.round(source.height*scale)); drawCrop();
    if (!$('crop-dialog').open) $('crop-dialog').showModal();
  }
  function cancelCrop() {
    const resume = cropResume; cropResume = false;
    if ($('crop-dialog').open) $('crop-dialog').close(); cropState = null; cropDrag = null;
    if (!photo?.canvas) { reset(); toast('사진 선택을 취소했어요.'); }
    else if (resume) { revision++; recognize(revision); }
  }
  async function sourceFromCrop(info,rect) {
    let image = info.fullSource, url = null;
    try {
      if (info.file) { url = URL.createObjectURL(info.file); image = new Image(); image.src = url; await image.decode(); }
      const turns = info.file ? info.turns || 0 : 0, width = turns%2 ? image.height : image.width, height = turns%2 ? image.width : image.height;
      const x = Math.floor(rect.x*width),y = Math.floor(rect.y*height),w = Math.max(1,Math.min(width-x,Math.round(rect.w*width))),h = Math.max(1,Math.min(height-y,Math.round(rect.h*height)));
      if (w < 25 || h < 25) throw new Error('조금 더 넓게 선택해주세요.');
      const scale = Math.min(1,3000/Math.max(w,h),Math.sqrt(3000000/(w*h)));
      const source = document.createElement('canvas'); source.width = Math.max(1,Math.round(w*scale)); source.height = Math.max(1,Math.round(h*scale));
      const ctx = source.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,source.width,source.height);
      ctx.scale(source.width/w,source.height/h); ctx.translate(-x,-y);
      if (turns === 1) { ctx.translate(width,0); ctx.rotate(Math.PI/2); }
      if (turns === 2) { ctx.translate(width,height); ctx.rotate(Math.PI); }
      if (turns === 3) { ctx.translate(0,height); ctx.rotate(-Math.PI/2); }
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image,0,0); return source;
    } finally { if (url) { image.src = ''; URL.revokeObjectURL(url); } }
  }
  async function useCrop(full = false) {
    if (!photo?.fullSource || !cropState) return;
    const rect = full ? {x:0,y:0,w:1,h:1} : {...cropState};
    $('crop-dialog').close(); cropState = null; cropDrag = null; cropResume = false;
    revision++; cancelOCR(); clearResult(); const token = revision;
    let source;
    try { source = await sourceFromCrop(photo,rect); }
    catch (failure) { if (token === revision) { toast(failure.message || '사진을 준비하지 못했어요.'); openCrop(); } return; }
    if (token !== revision) return;
    await preparePhoto(source,token,rect);
  }
  function cropPoint(event) {
    const rect = $('crop-canvas').getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
  }
  $('crop-canvas').addEventListener('pointerdown',event => {
    if (!cropState) return; event.preventDefault(); const point = cropPoint(event),r = cropState;
    const corners = [['nw',r.x,r.y],['ne',r.x+r.w,r.y],['sw',r.x,r.y+r.h],['se',r.x+r.w,r.y+r.h]];
    const rect = $('crop-canvas').getBoundingClientRect(),corner = corners.find(([,x,y])=>Math.hypot((point.x-x)*rect.width,(point.y-y)*rect.height)<24);
    const inside = point.x>r.x&&point.x<r.x+r.w&&point.y>r.y&&point.y<r.y+r.h;
    cropDrag = {point,rect:{...r},mode:corner?.[0] || (inside && r.w*r.h<.98 ? 'move' : 'new')}; $('crop-canvas').setPointerCapture(event.pointerId);
  });
  $('crop-canvas').addEventListener('pointermove',event => {
    if (!cropDrag || !cropState) return; event.preventDefault(); const point = cropPoint(event),{rect:r,point:p,mode}=cropDrag;
    if (mode === 'move') cropState = {...r,x:Math.max(0,Math.min(1-r.w,r.x+point.x-p.x)),y:Math.max(0,Math.min(1-r.h,r.y+point.y-p.y))};
    else {
      let x0=mode==='new'?p.x:r.x,y0=mode==='new'?p.y:r.y,x1=mode==='new'?point.x:r.x+r.w,y1=mode==='new'?point.y:r.y+r.h;
      if (mode !== 'new') {
        if (mode.includes('w')) x0=Math.min(point.x,x1-.03); if (mode.includes('e')) x1=Math.max(point.x,x0+.03);
        if (mode.includes('n')) y0=Math.min(point.y,y1-.03); if (mode.includes('s')) y1=Math.max(point.y,y0+.03);
      }
      cropState = {x:Math.max(0,Math.min(x0,x1)),y:Math.max(0,Math.min(y0,y1)),w:Math.max(.03,Math.abs(x1-x0)),h:Math.max(.03,Math.abs(y1-y0))};
    }
    drawCrop();
  });
  for (const event of ['pointerup','pointercancel']) $('crop-canvas').addEventListener(event,()=>{cropDrag=null;});
  for (const key of ['x','y','w','h']) $('crop-'+key).addEventListener('input',() => {
    if (!cropState) return; cropState[key]=Number($('crop-'+key).value)/100;
    cropState.x=Math.min(cropState.x,.97);cropState.y=Math.min(cropState.y,.97);cropState.w=Math.max(.03,Math.min(cropState.w,1-cropState.x));cropState.h=Math.max(.03,Math.min(cropState.h,1-cropState.y));drawCrop();
  });
  function loadOCR() {
    if (window.Tesseract) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js'; script.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => { script.remove(); reject(new Error('인식 도구를 내려받지 못했어요.')); }, 30000);
      script.onload = () => { clearTimeout(timeout); window.Tesseract ? resolve() : reject(new Error('인식 도구를 시작하지 못했어요.')); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('인식 도구에 연결하지 못했어요.')); };
      document.head.append(script);
    }).catch(error => { scriptPromise = null; throw error; });
    return scriptPromise;
  }
  function cleanPage(task,canvas,stage,data,direction) {
    if (!task.pageWorker) task.pageWorker = new Worker('image-worker.js?v=5');
    return new Promise((resolve,reject) => {
      const worker = task.pageWorker,context = canvas.getContext('2d'),pixels = context.getImageData(0,0,canvas.width,canvas.height);
      worker.onmessage = event => {
        if (event.data.error) { reject(new Error(event.data.error)); return; }
        if (task.cancelled) { resolve({regions:[],ruby:0,markers:0}); return; }
        context.putImageData(new ImageData(new Uint8ClampedArray(event.data.pixels),canvas.width,canvas.height),0,0); resolve(event.data.stats);
      };
      worker.onerror = () => reject(new Error('사진의 본문 영역을 분석하지 못했어요.'));
      worker.postMessage({id:stage,stage,width:canvas.width,height:canvas.height,pixels:pixels.data.buffer,data,layout:direction},[pixels.data.buffer]);
    });
  }
  async function recognize(token = revision) {
    if (!photo?.canvas) return;
    cancelOCR(); clearResult();
    const input = photo.canvas, original = photo, lang = language(), direction = layout(), plan = ocrPlan(lang, direction);
    // Always start from the selected original. A previous cleanup must not make
    // a retry use stale coordinates or reintroduce raw annotations in rescans.
    const size = rasterSize(original.source.width,original.source.height);
    input.width=size.width; input.height=size.height; original.padding=size.padding; original.scale=size.contentWidth/original.source.width;
    const context=input.getContext('2d'); context.fillStyle='#fff'; context.fillRect(0,0,input.width,input.height); context.imageSmoothingQuality='high'; context.drawImage(original.source,size.padding,size.padding,size.contentWidth,size.contentHeight);
    const reference=document.createElement('canvas');reference.width=input.width;reference.height=input.height;reference.getContext('2d').drawImage(input,0,0);photo.reference=reference;
    const task = { worker: null, pageWorker: null, cancelled: false, terminated: false, abort: null, refining: false };
    const abort = new Promise((_, reject) => { task.abort = () => reject(new Error('cancelled')); });
    ocrTask = task; $('ocr-progress').hidden = false; $('rotate').disabled = true;
    $('ocr-status').textContent = '글자를 읽을 준비를 하고 있어요…'; $('progress').value = 0;
    $('photo-title').textContent = '사진에서 글자를 읽고 있어요';
    let deadline;
    const current = () => ocrTask === task && token === revision && !task.cancelled;
    try {
      $('ocr-status').textContent = '밑줄과 본문 영역을 확인하고 있어요…';
      const rules = await Promise.race([cleanPage(task,input,'rules',null,direction),abort]);
      if (!current()) return;
      await Promise.race([loadOCR(), abort]);
      if (!current()) return;
      const initialize = async () => {
        if (!current()) return null;
        const worker = await Tesseract.createWorker(plan.langs, 1, {
          ...plan.options,
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
          logger: event => {
            if (!current()) return;
            if (task.refining && !task.rereading) return;
            const reading = event.status === 'recognizing text';
            const downloading = event.status === 'loading language traineddata';
            $('progress').value = reading ? task.rereading ? .65 + .2*(event.progress || 0) : .25 + .4*(event.progress || 0) : downloading ? .05 + .2*(event.progress || 0) : .03;
            $('ocr-status').textContent = reading ? (task.rereading ? '본문만 다시 읽어요 · ' : '글자를 읽고 있어요 · ')+Math.round((event.progress || 0)*100)+'%' : downloading ? LANGUAGES[lang].name+(lang === 'ja' ? ' 정밀 모델 준비 · ' : ' 인식 준비 · ')+Math.round((event.progress || 0)*100)+'%' : '사진을 읽을 준비를 하고 있어요…';
          }
        });
        task.worker = worker;
        if (!current()) { await terminateWorker(task); return null; }
        return worker;
      };
      const run = async () => {
        // An unfinished model download cannot be cancelled by Tesseract's public API.
        // Serialize initialization so rapidly changing photos does not start several large engines.
        const creation = initializationGate.catch(() => {}).then(initialize);
        initializationGate = creation.then(() => {}, () => {});
        const worker = await creation;
        if (!worker || !current()) return null;
        await worker.setParameters({ tessedit_pageseg_mode: lang === 'ja' ? Tesseract.PSM.AUTO : Tesseract.PSM.SINGLE_BLOCK, user_defined_dpi: '300', textord_tabfind_vertical_text: plan.verticalText, preserve_interword_spaces: '0' });
        if (!current()) return null;
        let result = await StudyOCRInput.recognize(task,worker,input, { rotateAuto: true }, { text: true, blocks: true });
        if (!current()) return null;
        if (!result.data.text.trim()) {
          await worker.setParameters({ tessedit_pageseg_mode: direction === 'vertical' ? Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT : Tesseract.PSM.SINGLE_BLOCK });
          if (!current()) return null;
          result = await StudyOCRInput.recognize(task,worker,input, { rotateAuto: true }, { text: true, blocks: true });
          if (!current()) return null;
        }
        // Deskew small camera tilts; avoid accepting a large, possibly wrong automatic rotation.
        if (Math.abs(result.data.rotateRadians || 0) > Math.PI/18) result = await StudyOCRInput.recognize(task,worker,input, {}, { text: true, blocks: true });
        if (!current()) return null;
        let rescanSource = original;
        let ruleRegions = rules.regions;
        const angle = result.data.rotateRadians || 0;
        if (lang === 'ja' && Math.abs(angle) >= .005 && Math.abs(angle) <= Math.PI/18) {
          task.refining = true; $('ocr-status').textContent = '사진 기울기를 맞추고 작은 읽는 법을 확인해요…';
          // Get Tesseract's exact rotated raster so all later geometry uses its coordinates.
          const raster = await StudyOCRInput.recognize(task,worker,reference,{rotateRadians:angle},{text:false,imageColor:true});
          if (!current()) return null;
          const image = new Image(); image.src = raster.data.imageColor; await image.decode();
          if (!current()) return null;
          input.width = image.width; input.height = image.height; input.getContext('2d').drawImage(image,0,0);
          reference.width=image.width;reference.height=image.height;reference.getContext('2d').drawImage(image,0,0);image.src = ''; raster.data.imageColor = null;
          const correctedRules = await cleanPage(task,input,'rules',null,direction); ruleRegions=correctedRules.regions;
          if (!current()) return null;
          result.data.rotateRadians = 0; rescanSource = {source:input,padding:0,scale:1,cap:.75};
        }
        if (Math.abs(result.data.rotateRadians || 0) < .001) result.data=OCRClean.suppressRegions(result.data,ruleRegions);
        if (lang === 'ja' && Math.abs(result.data.rotateRadians || 0) < .001) {
          task.refining = true; $('ocr-status').textContent = '인쇄된 후리가나와 작은 문항 표시를 구분해요…';
          const print = await cleanPage(task,input,'layout',result.data,direction);
          if (!current()) return null;
          if (print.regions.length) {
            const before = result.data;
            $('ocr-status').textContent = '작은 읽는 법을 제외하고 본문을 다시 읽어요…';
            task.rereading = true;
            const reread = await StudyOCRInput.recognize(task,worker,input,{}, {text:true,blocks:true});
            task.rereading = false;
            reread.data=OCRClean.suppressRegions(reread.data,ruleRegions);
            if (!current()) return null;
            const han = text => (text.match(/\p{Script=Han}/gu)||[]).length;
            result = han(reread.data.text)>=han(before.text)*.9 && reread.data.confidence>=before.confidence-3 ? reread : {...result,data:OCRClean.suppressRegions(before,print.regions)};
            rescanSource = {source:input,padding:0,scale:1,cap:.75};
          }
          result.data = OCRClean.restoreVerticalPunctuation(result.data,print.punctuation);
        }
        if (lang === 'ja' && direction !== 'vertical' && rescanSource.source && Math.abs(result.data.rotateRadians || 0) < .001) {
          const lines = uncertainLines(result.data);
          if (lines.length) {
            task.refining = true;
            await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE, textord_tabfind_vertical_text: '0' });
            for (const [index,line] of lines.entries()) {
              if (!current()) return null;
              $('ocr-status').textContent = '헷갈리는 글자를 다시 확인해요 · '+(index+1)+' / '+lines.length;
              $('progress').value = .85 + .15*index/lines.length;
              const box = line.bbox, margin = Math.max(4,(box.y1-box.y0)/rescanSource.scale*.25);
              const left = Math.max(0,Math.floor((box.x0-rescanSource.padding)/rescanSource.scale-margin));
              const top = Math.max(0,Math.floor((box.y0-rescanSource.padding)/rescanSource.scale-margin));
              const right = Math.min(rescanSource.source.width,Math.ceil((box.x1-rescanSource.padding)/rescanSource.scale+margin));
              const bottom = Math.min(rescanSource.source.height,Math.ceil((box.y1-rescanSource.padding)/rescanSource.scale+margin));
              if (right <= left || bottom <= top) continue;
              const factors = [Math.min(rescanSource.cap || 1.5,36/Math.max(1,(box.y1-box.y0)/rescanSource.scale))];
              if (/[|｜]/.test(line.text)) factors.push(Math.min(rescanSource.cap ? 1 : 2,48/Math.max(1,(box.y1-box.y0)/rescanSource.scale)));
              for (const factor of factors) {
                if (!current()) return null;
                const crop = document.createElement('canvas'); crop.width = Math.round((right-left)*factor)+20; crop.height = Math.round((bottom-top)*factor)+20;
                const ctx = crop.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,crop.width,crop.height);
                ctx.imageSmoothingQuality = 'high'; ctx.drawImage(rescanSource.source,left,top,right-left,bottom-top,10,10,crop.width-20,crop.height-20);
                let rescanned;
                try { rescanned = await StudyOCRInput.recognize(task,worker,crop, {}, { text: true, blocks: true }); }
                catch { if (!current()) return null; break; } // A failed optional rescan must not discard readable text.
                if (!current()) return null;
                const candidate = { text: rescanned.data.text, confidence: rescanned.data.confidence, words: (rescanned.data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(row => row.words || []))) };
                if (preferLine(line,candidate)) { line.text = candidate.text; line.confidence = candidate.confidence; }
              }
            }
          }
        }
        return result;
      };
      const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('사진을 읽는 데 시간이 오래 걸려요. 본문만 잘라 다시 시도해주세요.')), 180000); });
      const result = await Promise.race([run(), abort, timeout]);
      if (!current() || !result) return;
      result.data.pageWidth = input.width; result.data.pageHeight = input.height;
      const extractedDocument = documentFromOCR(result.data, lang, direction);
      const extracted = extractedDocument.paragraphs;
      if (!extracted.length) throw new Error('글자를 찾지 못했어요. 밝고 선명한 사진을 선택해주세요.');
      if (extracted.join('\n\n').length > 30000) throw new Error('글이 너무 많아요. 사진을 한 페이지씩 나누어주세요.');
      const records=Math.abs(result.data.rotateRadians||0)<.001 ? StudyDocument.fromOCR(extracted,result.data,StudyCore,lang) : extracted.map(StudyDocument.fresh);
      showParagraphs(extracted, extractedDocument.annotations,records);
      $('photo-title').textContent = extracted.length+'개 단락을 찾았어요';
      $('photo-caption').textContent = extractedDocument.annotations.length ? '본문만 읽어요. 생략 표시와 출처는 따로 표시했어요.' : '틀린 글자나 단락은 ‘글 수정’에서 고칠 수 있어요.';
      scrollTo($('results'));
    } catch (failure) {
      if (!current()) return;
      $('photo-title').textContent = '사진을 다시 확인해주세요'; $('photo-caption').textContent = '다시 시도하거나 글을 직접 입력할 수 있어요.';
      const message = String(failure?.message || failure || '');
      error(/^[가-힣]/.test(message) ? message : '사진 인식을 완료하지 못했어요. 인터넷 연결과 글 방향을 확인하고 다시 시도해주세요.');
    } finally {
      clearTimeout(deadline); task.cancelled = true; terminateWorker(task);
      if (ocrTask === task) { ocrTask = null; $('ocr-progress').hidden = true; $('rotate').disabled = false; }
    }
  }
  async function rotatePhoto() {
    if (!photo) return;
    revision++; cancelOCR(); clearResult(); const token = revision;
    try {
      const original = photo;
      const rotate = image => {
        const canvas = document.createElement('canvas'); canvas.width = image.height; canvas.height = image.width;
        const ctx = canvas.getContext('2d'); ctx.translate(canvas.width/2, canvas.height/2); ctx.rotate(Math.PI/2); ctx.drawImage(image, -image.width/2, -image.height/2);
        return canvas;
      };
      photo={...original,fullSource:rotate(original.fullSource),turns:((original.turns||0)+1)%4,crop:{x:Math.max(0,1-original.crop.y-original.crop.h),y:original.crop.x,w:original.crop.h,h:original.crop.w}};
      const source=await sourceFromCrop(photo,photo.crop);if(token!==revision)return;
      await preparePhoto(source,token,photo.crop);
    } catch { if (token === revision) error('사진을 회전하지 못했어요. 다시 선택해주세요.'); }
  }

  async function rescanRegion(source,box,signal) {
    const lang=language(),direction=layout(),plan=ocrPlan(lang,direction);
    const task={worker:null,pageWorker:null,cancelled:false,terminated:false};
    let rejectAbort,deadline;
    const cancelled=new Promise((_,reject)=>{rejectAbort=reject;});
    const abort=()=>{task.cancelled=true;terminateWorker(task);rejectAbort(new DOMException('취소됨','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});
    const check=()=>{if(signal.aborted||task.cancelled)throw new DOMException('취소됨','AbortError');};
    const run=async()=>{
      check();const canvas=document.createElement('canvas'),scale=Math.min(2,Math.sqrt(1500000/(box.w*box.h)));
      canvas.width=Math.round(box.w*scale)+32;canvas.height=Math.round(box.h*scale)+32;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,box.x,box.y,box.w,box.h,16,16,canvas.width-32,canvas.height-32);
      const rules=await cleanPage(task,canvas,'rules',null,direction);check();await loadOCR();check();
      const creation=initializationGate.catch(()=>{}).then(async()=>{check();const worker=await Tesseract.createWorker(plan.langs,1,{...plan.options,workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js'});task.worker=worker;if(task.cancelled){await terminateWorker(task);check();}return worker;});
      initializationGate=creation.then(()=>{},()=>{});const worker=await creation;check();
      const vertical=direction==='vertical'||(lang==='ja'&&box.h>box.w*2);
      await worker.setParameters({tessedit_pageseg_mode:vertical?Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT:Tesseract.PSM.SINGLE_BLOCK,textord_tabfind_vertical_text:vertical?'1':'0',user_defined_dpi:'300'});check();
      let result=await StudyOCRInput.recognize(task,worker,canvas,{}, {text:true,blocks:true});check();
      result.data=OCRClean.suppressRegions(result.data,rules.regions);
      if(lang==='ja'){
        const print=await cleanPage(task,canvas,'layout',result.data,vertical?'vertical':'horizontal');check();
        if(print.regions.length){result=await StudyOCRInput.recognize(task,worker,canvas,{}, {text:true,blocks:true});check();result.data=OCRClean.suppressRegions(result.data,rules.regions);}
        result.data=OCRClean.restoreVerticalPunctuation(result.data,print.punctuation);
      }
      const extracted=documentFromOCR(result.data,lang,vertical?'vertical':'horizontal').paragraphs.join(lang==='ja'?'':' ').trim();
      if(!extracted)throw new Error('選択した範囲に文字が見つかりません。');
      return extracted;
    };
    try{return await Promise.race([run(),cancelled,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('부분 인식 시간이 초과됐어요. 영역을 줄여 다시 시도해주세요.')),120000);})]);}
    catch(error){if(signal.aborted)throw error;throw new Error(/^[가-힣]/.test(error.message)?error.message:'선택 영역을 읽지 못했어요. 조금 넓게 선택해주세요. 기존 글은 그대로예요.');}
    finally{clearTimeout(deadline);task.cancelled=true;signal.removeEventListener('abort',abort);terminateWorker(task);}
  }

  $('reset').addEventListener('click', () => { reset(); toast('깨끗하게 비웠어요. 사진이나 글을 가져와주세요.'); });
  $('take-photo').addEventListener('click', () => $('camera-input').click());
  $('choose-photo').addEventListener('click', () => $('image-input').click());
  $('another-photo').addEventListener('click', () => { if(sourceMode==='text')chooseSource('text',{fresh:true});else {reset();$('image-input').click();} });
  for (const id of ['image-input', 'camera-input']) $(id).addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; acceptPhoto(file); });
  $('photo-mode').addEventListener('click',()=>chooseSource('photo'));
  $('write-text').addEventListener('click',()=>chooseSource('text'));$('paste-again').addEventListener('click',()=>chooseSource('text',{fresh:true}));
  $('edit-text').addEventListener('click',()=>openEditor('edit'));
  for(const id of ['photo-mode','write-text'])$(id).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'photo':event.key==='End'?'text':sourceMode==='photo'?'text':'photo';chooseSource(next);$(next==='photo'?'photo-mode':'write-text').focus();}});
  $('close-editor').addEventListener('click', closeEditor); $('apply-text').addEventListener('click', applyText);
  $('source-text').addEventListener('input',()=>{updateTextCount();beforeSentenceSplit=null;$('split-pasted').textContent='문장별로 나누기';if(editorPurpose==='paste')pasteDraft=$('source-text').value;});
  $('split-pasted').addEventListener('click',()=>{
    if(beforeSentenceSplit!==null){$('source-text').value=beforeSentenceSplit;beforeSentenceSplit=null;$('split-pasted').textContent='문장별로 나누기';}
    else {const text=$('source-text').value;const sentences=splitParagraphs(text,language()).flatMap(p=>sentenceRanges(p,language()).map(s=>p.slice(s.start,s.end).trim()));if(sentences.length<2){toast('두 문장 이상일 때 나눌 수 있어요.');return;}const split=sentences.join('\n\n');if(split.length>30000){toast('문장을 나누면 30,000자를 넘어요. 글을 조금 줄여주세요.');return;}beforeSentenceSplit=text;$('source-text').value=split;$('split-pasted').textContent='원래 단락으로 되돌리기';}
    pasteDraft=$('source-text').value;updateTextCount();
  });
  $('retry').addEventListener('click', () => { revision++; recognize(revision); });
  $('quality-continue').addEventListener('click',()=>{if(!photo?.canvas)return;photo.awaitingQuality=false;$('quality-continue').hidden=true;revision++;recognize(revision);});
  $('rotate').addEventListener('click', rotatePhoto);
  $('crop-photo').addEventListener('click',openCrop);
  $('crop-use').addEventListener('click',()=>useCrop(false)); $('crop-full').addEventListener('click',()=>useCrop(true));
  $('crop-cancel').addEventListener('click',cancelCrop); $('crop-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelCrop();});
  $('furigana-toggle').addEventListener('click',toggleFurigana); $('copy-all').addEventListener('click',copyAll);
  $('font-size').addEventListener('change',()=>document.documentElement.style.setProperty('--reading-size',$('font-size').value+'px'));
  $('reading-cancel').addEventListener('click',()=>{$('reading-dialog').close();readingTarget=null;});
  $('reading-apply').addEventListener('click',()=>{
    if (!readingTarget) return; const value = hiragana($('reading-value').value.trim());
    if (!value || !/^[ぁ-ゖーゔゕゖ\s]+$/u.test(value)) { toast('읽는 법을 히라가나로 입력해주세요.'); $('reading-value').focus(); return; }
    const {index,start,base}=readingTarget; if (!readingOverrides[index]) readingOverrides[index]={}; readingOverrides[index][start]={base,reading:value};
    $('reading-dialog').close(); readingTarget=null; paintReadings();
  });
  $('copy-close').addEventListener('click',()=>$('copy-dialog').close());
  $('cancel-ocr').addEventListener('click', () => {
    revision++; cancelOCR(); $('photo-title').textContent = '사진 인식을 멈췄어요'; $('photo-caption').textContent = '다시 시도하거나 다른 사진을 골라주세요.';
    error('인식을 취소했어요. 사진을 다시 읽거나 직접 입력할 수 있어요.');
  });
  document.querySelectorAll('input[name="language"]').forEach(input => input.addEventListener('change', () => {
    renderIntake();updateVoiceWarning();
    revision++; cancelOCR(); player.stop();
    if (sourceMode==='photo'&&photo?.canvas&&!photo.awaitingQuality) recognize(revision);
    else if (!$('text-editor').hidden) updateVoiceWarning();
    else if (paragraphs.length) showParagraphs(paragraphs,annotations);
  }));
  $('layout').addEventListener('change', () => { revision++; cancelOCR(); player.stop(); if (photo?.canvas&&!photo.awaitingQuality) recognize(revision); });
  $('voice-select').addEventListener('change',()=>{selectedVoices[language()]=$('voice-select').value;workspace.stop();toast('목소리를 바꿨어요. 다음 재생부터 적용해요.');});
  $('voice-preview').addEventListener('click',()=>{
    if(!synth)return;if(voicePreview){workspace.stop();voicePreview=null;$('voice-preview').textContent='짧게 들어보기';return;}workspace.stop();
    const utterance=new SpeechSynthesisUtterance({ja:'こんにちは。この声で、ゆっくり読んでみましょう。',ko:'안녕하세요. 이 목소리로 천천히 들어보세요.',en:'Hello. Let’s listen and practice at your own pace.'}[language()]);
    utterance.lang=LANGUAGES[language()].locale;utterance.voice=voiceFor(language());utterance.rate=Number($('rate').value);voicePreview=utterance;
    $('voice-preview').textContent='미리듣기 정지';const finished=()=>{if(voicePreview===utterance){voicePreview=null;$('voice-preview').textContent='짧게 들어보기';}};
    utterance.onend=finished;utterance.onerror=event=>{if(!['canceled','interrupted'].includes(event.error))toast('미리듣기를 재생하지 못했어요. 다른 목소리를 선택해주세요.');finished();};synth.speak(utterance);
  });
  $('play-all').addEventListener('click', () => {
    if (workspace?.playControl()) return;
    const state = player.getState();
    if (state.scope === 'all' && state.status === 'playing') player.pause();
    else if (state.scope === 'all' && state.status === 'paused') player.resume();
    else player.play(paragraphs, 0, 'all', language());
  });
  $('stop').addEventListener('click', () => workspace.stop());
  $('rate').addEventListener('input', () => { updateRateDisplay(); player.updateRate(); workspace.updateRate(); });
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragover'));
  $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); acceptPhoto(event.dataTransfer.files[0]); });
  document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
  window.addEventListener('pagehide', () => reset({scroll:false}));
  if (synth) synth.addEventListener('voiceschanged', updateVoiceWarning);
  workspace=StudyWorkspace.create({
    get:()=>({paragraphs,annotations,photo,language:language()}),voiceFor,stop:()=>player.stop(),toast,rescan:rescanRegion,
    tokenize:requestFurigana,repaint:paintReadings,
    wordReading:(index,word)=>{if(!furiganaTokens?.[index])return word.reading;return rubySegments(paragraphs[index],furiganaTokens[index],readingOverrides[index]).filter(p=>p.start>=word.start&&p.end<=word.end).map(p=>p.reading||p.base).join('');},
    commit:(records,notes,keepUndo)=>{const restore=showFurigana,overrides=new Map(workspace.records().map((r,i)=>[r.id,readingOverrides[i]]));revision++;cancelOCR();showParagraphs(records.map(r=>r.text),notes,records,keepUndo);readingOverrides=records.map(r=>overrides.get(r.id));if(!photo)pasteDraft=paragraphs.join('\n\n');if(restore&&language()==='ja')toggleFurigana();}
  });
  renderIntake();updateRateDisplay(); updateVoiceWarning(); renderPlayback(player.getState());
})();

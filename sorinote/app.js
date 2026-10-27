'use strict';
(() => {
  const { LANGUAGES, ocrPlan, rasterSize, splitParagraphs, documentFromOCR, uncertainLines, preferLine, sentenceRanges, createPlayback } = StudyCore;
  const { rubySegments, hiragana, plainCopy } = StudyReading;
  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis;
  let paragraphs = [], annotations = [], photo = null, revision = 0, ocrTask = null, scriptPromise = null;
  let toastTimer = null, lastActiveParagraph = -1, lastSentenceKey = '';
  let initializationGate = Promise.resolve();
  let documentVersion = 0, showFurigana = false, furiganaTokens = null, readingOverrides = [], readingTarget = null;
  let furiganaWorker = null, furiganaRequest = 0, furiganaPending = new Map();
  let cropState = null, cropDrag = null, cropResume = false;
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
    return voices.find(voice => voice.default) || voices.find(voice => voice.localService) || voices[0] || null;
  }
  function updateVoiceWarning() {
    const warning = !synth ? '이 브라우저에서는 음성 읽기를 사용할 수 없어요. Chrome·Edge·Safari에서 열어주세요.'
      : !voiceFor(language()) ? '이 기기에서 '+LANGUAGES[language()].name+' 목소리를 찾지 못했어요. 소리가 나지 않으면 기기 설정에서 해당 언어 음성을 설치해주세요.' : '';
    $('voice-warning').textContent = warning; $('voice-warning').hidden = !warning;
    $('play-all').disabled = !synth;
    document.querySelectorAll('.paragraph-play,.paragraph-repeat').forEach(button => { button.disabled = !synth; });
  }
  function renderPlayback(state) {
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
  function paintParagraph(index) {
    const body = $('paragraphs').querySelectorAll('.paragraph-text')[index]; if (!body) return;
    const text = paragraphs[index]; body.replaceChildren();
    const parts = showFurigana && furiganaTokens ? rubySegments(text,furiganaTokens[index],readingOverrides[index]) : [{base:text,reading:'',start:0,end:text.length}];
    for (const sentence of sentenceRanges(text,language())) {
      const span = document.createElement('span'); span.className = 'sentence'; span.dataset.start = sentence.start; span.dataset.end = sentence.end;
      for (const part of parts) {
        const start = Math.max(sentence.start,part.start), end = Math.min(sentence.end,part.end); if (end <= start) continue;
        const base = text.slice(start,end);
        if (!part.reading || start !== part.start || end !== part.end) { span.append(document.createTextNode(base)); continue; }
        const ruby = document.createElement('ruby'), rt = document.createElement('rt');
        ruby.append(document.createTextNode(base)); rt.textContent = part.reading; rt.setAttribute('aria-hidden','true'); ruby.append(rt);
        ruby.tabIndex = 0; ruby.setAttribute('role','button'); ruby.setAttribute('aria-label',base+' 읽는 법 수정, '+part.reading); ruby.title = '후리가나 수정';
        const edit = () => { player.pause(); readingTarget = {index,start:part.start,base}; $('reading-word').textContent = base; $('reading-value').value = part.reading; $('reading-dialog').showModal(); $('reading-value').focus(); };
        ruby.addEventListener('click',edit); ruby.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); } });
        span.append(ruby);
      }
      body.append(span);
    }
  }
  function paintReadings() {
    paragraphs.forEach((_,index)=>paintParagraph(index));
    document.body.classList.toggle('has-furigana',showFurigana && Boolean(furiganaTokens));
    $('furigana-toggle').setAttribute('aria-pressed',String(showFurigana));
    $('furigana-toggle').textContent = showFurigana ? '후리가나 끄기' : '후리가나 켜기';
    renderPlayback(player.getState());
  }
  function requestFurigana(items) {
    if (!furiganaWorker) {
      furiganaWorker = new Worker('furigana-worker.js?v=5');
      furiganaWorker.onmessage = event => { const pending = furiganaPending.get(event.data.id); if (!pending) return; clearTimeout(pending.timer); furiganaPending.delete(event.data.id); event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.tokens); };
      furiganaWorker.onerror = () => {
        for (const pending of furiganaPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('후리가나 사전을 준비하지 못했어요. 다시 켜주세요.')); }
        furiganaPending.clear(); furiganaWorker.terminate(); furiganaWorker = null;
      };
    }
    const id = ++furiganaRequest;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { furiganaPending.delete(id); reject(new Error('후리가나 준비에 시간이 걸려요. 연결을 확인하고 다시 켜주세요.')); },90000);
      furiganaPending.set(id,{resolve,reject,timer}); furiganaWorker.postMessage({id,paragraphs:items});
    });
  }
  async function toggleFurigana() {
    if (language() !== 'ja') return;
    showFurigana = !showFurigana;
    if (!showFurigana) { $('furigana-status').hidden = true; paintReadings(); return; }
    if (furiganaTokens) { $('furigana-status').textContent = '작은 읽는 법을 누르면 수정할 수 있어요.'; $('furigana-status').hidden = false; paintReadings(); return; }
    const version = documentVersion;
    $('furigana-status').textContent = '후리가나 사전을 준비해요. 처음에만 시간이 조금 걸려요.'; $('furigana-status').hidden = false; paintReadings();
    try {
      const tokens = await requestFurigana(paragraphs.slice());
      if (version !== documentVersion) return;
      furiganaTokens = tokens;
      $('furigana-status').textContent = '작은 읽는 법을 누르면 수정할 수 있어요.'; $('furigana-status').hidden = !showFurigana; paintReadings();
    } catch (failure) {
      if (version !== documentVersion || !showFurigana) return;
      showFurigana = false; paintReadings(); $('furigana-status').textContent = failure.message;
    }
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
    player.stop(); paragraphs = []; annotations = []; lastActiveParagraph = -1;
    documentVersion++; furiganaTokens = null; readingOverrides = []; showFurigana = false; document.body.classList.remove('has-furigana'); $('furigana-status').hidden = true;
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
    revision++; cancelOCR(); clearResult();
    if ($('crop-dialog').open) $('crop-dialog').close(); cropState = null; cropDrag = null; cropResume = false;
    if ($('reading-dialog').open) $('reading-dialog').close();
    if ($('copy-dialog').open) $('copy-dialog').close(); $('crop-canvas').width = 1; $('crop-canvas').height = 1;
    if (photo) URL.revokeObjectURL(photo.previewURL);
    photo = null;
    $('image-preview').removeAttribute('src'); $('photo-preview').hidden = true;
    $('image-input').value = ''; $('camera-input').value = '';
    $('rate').value = '1'; $('toast').hidden = true; clearTimeout(toastTimer);
    document.body.classList.remove('has-content');
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showParagraphs(items, notes = []) {
    player.stop(); paragraphs = items; annotations = notes; lastActiveParagraph = -1;
    documentVersion++; furiganaTokens = null; readingOverrides = []; showFurigana = false; document.body.classList.remove('has-furigana'); $('furigana-status').hidden = true;
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
    $('furigana-toggle').hidden = language() !== 'ja'; paintReadings();
    updateVoiceWarning(); renderPlayback(player.getState());
  }
  function updateTextCount() { $('text-count').textContent = $('source-text').value.length.toLocaleString()+'자'; }
  function openEditor() {
    if (ocrTask) { cancelOCR(); $('photo-caption').textContent = '사진 인식을 멈췄어요. 다시 읽거나 직접 입력할 수 있어요.'; error('직접 입력으로 전환했어요. 사진을 다시 읽으려면 아래 버튼을 눌러주세요.'); }
    player.stop(); $('text-editor').hidden = false; $('results').hidden = true; $('player-bar').hidden = true;
    document.body.classList.remove('has-results'); document.body.classList.add('has-content');
    scrollTo($('text-editor')); $('source-text').focus({ preventScroll: true });
  }
  function closeEditor() {
    $('text-editor').hidden = true;
    $('source-text').value = paragraphs.join('\n\n'); updateTextCount();
    if (paragraphs.length) { $('results').hidden = false; $('player-bar').hidden = false; document.body.classList.add('has-results'); }
    else if (!photo) document.body.classList.remove('has-content');
  }
  function applyText() {
    const text = $('source-text').value;
    if (!text.trim()) { toast('읽을 글을 먼저 입력해주세요.'); $('source-text').focus(); return; }
    if (text.length > 30000) { toast('한 번에 30,000자까지 읽을 수 있어요.'); return; }
    $('error-panel').hidden = true;
    const edited = splitParagraphs(text, language());
    showParagraphs(edited, annotations.map(note => ({ ...note, before: note.kind === 'source' ? edited.length : Math.min(note.before, edited.length) })));
    $('source-text').blur();
    scrollTo($('results'));
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
      $('ocr-progress').hidden = true; openCrop();
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
    const width=source.width,height=source.height;
    const size = rasterSize(width,height),canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source,size.padding,size.padding,size.contentWidth,size.contentHeight);
    if (!await setPhoto(canvas,token,{source,padding:size.padding,scale:size.contentWidth/width,crop:rect})) return;
    $('photo-title').textContent = '선택한 본문을 읽고 있어요'; $('photo-caption').textContent = '문항 표시와 인쇄된 후리가나도 확인할게요.';
    await recognize(token);
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
        let result = await worker.recognize(input, { rotateAuto: true }, { text: true, blocks: true });
        if (!current()) return null;
        if (!result.data.text.trim()) {
          await worker.setParameters({ tessedit_pageseg_mode: direction === 'vertical' ? Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT : Tesseract.PSM.SINGLE_BLOCK });
          if (!current()) return null;
          result = await worker.recognize(input, { rotateAuto: true }, { text: true, blocks: true });
          if (!current()) return null;
        }
        // Deskew small camera tilts; avoid accepting a large, possibly wrong automatic rotation.
        if (Math.abs(result.data.rotateRadians || 0) > Math.PI/18) result = await worker.recognize(input, {}, { text: true, blocks: true });
        if (!current()) return null;
        let rescanSource = original;
        let ruleRegions = rules.regions;
        const angle = result.data.rotateRadians || 0;
        if (lang === 'ja' && Math.abs(angle) >= .005 && Math.abs(angle) <= Math.PI/18) {
          task.refining = true; $('ocr-status').textContent = '사진 기울기를 맞추고 작은 읽는 법을 확인해요…';
          // Get Tesseract's exact rotated raster so all later geometry uses its coordinates.
          const raster = await worker.recognize(input,{rotateRadians:angle},{text:false,imageColor:true});
          if (!current()) return null;
          const image = new Image(); image.src = raster.data.imageColor; await image.decode();
          if (!current()) return null;
          input.width = image.width; input.height = image.height; input.getContext('2d').drawImage(image,0,0); image.src = ''; raster.data.imageColor = null;
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
            const reread = await worker.recognize(input,{}, {text:true,blocks:true});
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
                try { rescanned = await worker.recognize(crop, {}, { text: true, blocks: true }); }
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
      showParagraphs(extracted, extractedDocument.annotations);
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
      const source = original.source ? { source: rotate(original.source), padding: original.padding, scale: original.scale, fullSource: rotate(original.fullSource), turns: ((original.turns || 0)+1)%4, crop: {x:1-original.crop.y-original.crop.h,y:original.crop.x,w:original.crop.h,h:original.crop.w} } : {};
      if (!await setPhoto(rotate(original.canvas), token, source)) return;
      await recognize(token);
    } catch { if (token === revision) error('사진을 회전하지 못했어요. 다시 선택해주세요.'); }
  }

  $('reset').addEventListener('click', () => { reset(); toast('깨끗하게 비웠어요. 새 사진을 골라주세요.'); });
  $('take-photo').addEventListener('click', () => $('camera-input').click());
  $('choose-photo').addEventListener('click', () => $('image-input').click());
  $('another-photo').addEventListener('click', () => { reset(); $('image-input').click(); });
  for (const id of ['image-input', 'camera-input']) $(id).addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; acceptPhoto(file); });
  $('write-text').addEventListener('click', openEditor); $('edit-text').addEventListener('click', openEditor);
  $('close-editor').addEventListener('click', closeEditor); $('apply-text').addEventListener('click', applyText);
  $('source-text').addEventListener('input', updateTextCount);
  $('retry').addEventListener('click', () => { revision++; recognize(revision); });
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
    $('layout-field').hidden = language() !== 'ja';
    revision++; cancelOCR(); player.stop();
    if (photo?.canvas) recognize(revision);
    else if (!$('text-editor').hidden) updateVoiceWarning();
    else if (paragraphs.length) showParagraphs(paragraphs);
  }));
  $('layout').addEventListener('change', () => { revision++; cancelOCR(); player.stop(); if (photo?.canvas) recognize(revision); });
  $('play-all').addEventListener('click', () => {
    const state = player.getState();
    if (state.scope === 'all' && state.status === 'playing') player.pause();
    else if (state.scope === 'all' && state.status === 'paused') player.resume();
    else player.play(paragraphs, 0, 'all', language());
  });
  $('stop').addEventListener('click', () => player.stop());
  $('rate').addEventListener('change', () => {
    const state = player.getState();
    if (['playing', 'paused'].includes(state.status)) { player.play(paragraphs, state.paragraph, state.scope, language(),{repeat:state.repeat}); if (state.status === 'paused') player.pause(); }
  });
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragover'));
  $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); acceptPhoto(event.dataTransfer.files[0]); });
  document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
  window.addEventListener('pagehide', () => { revision++; cancelOCR(); player.stop(); });
  if (synth) synth.addEventListener('voiceschanged', updateVoiceWarning);
  updateVoiceWarning(); renderPlayback(player.getState());
})();

'use strict';
(() => {
  const { LANGUAGES, splitParagraphs, paragraphsFromOCR, createPlayback } = StudyCore;
  const $ = id => document.getElementById(id);
  const synth = window.speechSynthesis;
  let paragraphs = [], photo = null, revision = 0, ocrTask = null, scriptPromise = null;
  let toastTimer = null, lastActiveParagraph = -1;
  const language = () => document.querySelector('input[name="language"]:checked').value;
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
    document.querySelectorAll('.paragraph-play').forEach(button => { button.disabled = !synth; });
  }
  function renderPlayback(state) {
    const active = state.status === 'playing' || state.status === 'paused';
    const allActive = active && state.scope === 'all';
    $('all-label').textContent = allActive ? (state.status === 'paused' ? '이어서 듣기' : '잠깐 멈춤') : '전체 듣기';
    $('all-symbol').textContent = allActive && state.status === 'playing' ? 'Ⅱ' : '▶';
    $('stop').disabled = !active;
    $('status-dot').classList.toggle('playing', state.status === 'playing');
    $('play-status').textContent = active ? (state.paragraph+1)+' / '+paragraphs.length+' 단락 · '+(state.status === 'paused' ? '잠깐 멈췄어요' : '듣고 있어요')
      : state.status === 'finished' ? (state.scope === 'all' ? '끝까지 들었어요. 다시 들어볼까요?' : '이 단락을 다 들었어요.') : '듣고 싶은 단락을 골라보세요.';
    const cards = [...$('paragraphs').children];
    cards.forEach((card, i) => {
      const current = active && i === state.paragraph;
      card.classList.toggle('active', current);
      const button = card.querySelector('button');
      const individual = current && state.scope === 'paragraph';
      const playing = individual && state.status === 'playing';
      button.textContent = playing ? 'Ⅱ' : '▶';
      button.setAttribute('aria-label', (i+1)+'번 단락 '+(playing ? '일시정지' : individual ? '이어서 듣기' : '듣기'));
      button.setAttribute('aria-pressed', String(current));
    });
    if (active && state.paragraph !== lastActiveParagraph && cards[state.paragraph]) {
      const rect = cards[state.paragraph].getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight - 130) scrollTo(cards[state.paragraph]);
    }
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

  function terminateWorker(task) {
    if (!task.worker || task.terminated) return;
    task.terminated = true;
    Promise.resolve(task.worker.terminate()).catch(() => {});
  }
  function cancelOCR() {
    const task = ocrTask;
    if (!task) return;
    ocrTask = null; task.cancelled = true; task.abort(); terminateWorker(task);
    $('ocr-progress').hidden = true; $('rotate').disabled = false;
  }
  function clearResult() {
    player.stop(); paragraphs = []; lastActiveParagraph = -1;
    $('paragraphs').replaceChildren(); $('results').hidden = true; $('player-bar').hidden = true;
    $('source-text').value = ''; $('text-count').textContent = '0자';
    $('text-editor').hidden = true; $('error-panel').hidden = true;
    document.body.classList.remove('has-results');
  }
  function reset({ scroll = true } = {}) {
    revision++; cancelOCR(); clearResult(); photo = null;
    $('image-preview').removeAttribute('src'); $('photo-preview').hidden = true;
    $('image-input').value = ''; $('camera-input').value = '';
    $('rate').value = '1'; $('toast').hidden = true; clearTimeout(toastTimer);
    document.body.classList.remove('has-content');
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function showParagraphs(items) {
    player.stop(); paragraphs = items; lastActiveParagraph = -1;
    $('paragraph-count').textContent = items.length+'개'; $('paragraphs').replaceChildren();
    items.forEach((text, index) => {
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
      const body = document.createElement('p'); body.className = 'paragraph-text'; body.lang = language(); body.textContent = text;
      top.append(label, button); card.append(top, body); $('paragraphs').append(card);
    });
    $('source-text').value = items.join('\n\n'); updateTextCount();
    $('results').hidden = false; $('player-bar').hidden = false; $('text-editor').hidden = true;
    document.body.classList.add('has-content', 'has-results');
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
    showParagraphs(splitParagraphs(text, language()));
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
      const scale = Math.min(1, 2400/Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width*scale)); canvas.height = Math.max(1, Math.round(img.height*scale));
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0, canvas.width, canvas.height);
      photo = canvas.toDataURL('image/jpeg', .94); $('image-preview').src = photo; $('photo-preview').hidden = false;
      $('photo-title').textContent = '사진에서 글자를 읽고 있어요'; $('photo-caption').textContent = '준비가 끝나면 단락별로 나누어드릴게요.';
      await recognize(token);
    } catch {
      if (token !== revision) return;
      $('ocr-progress').hidden = true; error('사진을 열지 못했어요. 다른 JPG·PNG 사진을 선택해주세요.');
    } finally { URL.revokeObjectURL(url); }
  }
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
  async function recognize(token = revision) {
    if (!photo) return;
    cancelOCR(); clearResult();
    const input = photo, lang = language();
    const task = { worker: null, cancelled: false, terminated: false, abort: null };
    const abort = new Promise((_, reject) => { task.abort = () => reject(new Error('cancelled')); });
    ocrTask = task; $('ocr-progress').hidden = false; $('rotate').disabled = true;
    $('ocr-status').textContent = '글자를 읽을 준비를 하고 있어요…'; $('progress').value = 0;
    $('photo-title').textContent = '사진에서 글자를 읽고 있어요';
    let deadline;
    const current = () => ocrTask === task && token === revision && !task.cancelled;
    try {
      await Promise.race([loadOCR(), abort]);
      if (!current()) return;
      const run = async () => {
        const worker = await Tesseract.createWorker(LANGUAGES[lang].ocr, 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
          logger: event => {
            if (!current()) return;
            const reading = event.status === 'recognizing text';
            $('progress').value = reading ? .2 + .8*(event.progress || 0) : .1;
            $('ocr-status').textContent = reading ? '글자를 읽고 있어요 · '+Math.round((event.progress || 0)*100)+'%' : event.status === 'loading language traineddata' ? LANGUAGES[lang].name+' 인식을 준비하고 있어요…' : '사진을 읽을 준비를 하고 있어요…';
          }
        });
        task.worker = worker;
        if (!current()) { terminateWorker(task); return null; }
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
        if (!current()) return null;
        return worker.recognize(input, {}, { text: true, blocks: true });
      };
      const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('사진을 읽는 데 시간이 오래 걸려요. 본문만 잘라 다시 시도해주세요.')), 180000); });
      const result = await Promise.race([run(), abort, timeout]);
      if (!current() || !result) return;
      const extracted = paragraphsFromOCR(result.data, lang);
      if (!extracted.length) throw new Error('글자를 찾지 못했어요. 밝고 선명한 사진을 선택해주세요.');
      if (extracted.join('\n\n').length > 30000) throw new Error('글이 너무 많아요. 사진을 한 페이지씩 나누어주세요.');
      showParagraphs(extracted);
      $('photo-title').textContent = extracted.length+'개 단락을 찾았어요';
      $('photo-caption').textContent = '틀린 글자나 단락은 ‘글 수정’에서 고칠 수 있어요.';
      scrollTo($('results'));
    } catch (failure) {
      if (!current()) return;
      $('photo-title').textContent = '사진을 다시 확인해주세요'; $('photo-caption').textContent = '다시 시도하거나 글을 직접 입력할 수 있어요.';
      error(failure.message === 'cancelled' ? '사진 인식을 멈췄어요.' : failure.message+' 인터넷 연결과 선택한 언어도 확인해주세요.');
    } finally {
      clearTimeout(deadline); task.cancelled = true; terminateWorker(task);
      if (ocrTask === task) { ocrTask = null; $('ocr-progress').hidden = true; $('rotate').disabled = false; }
    }
  }
  async function rotatePhoto() {
    if (!photo) return;
    revision++; cancelOCR(); clearResult(); const token = revision;
    const img = new Image(); img.src = photo;
    try {
      await img.decode(); if (token !== revision) return;
      const canvas = document.createElement('canvas'); canvas.width = img.height; canvas.height = img.width;
      const ctx = canvas.getContext('2d'); ctx.translate(canvas.width/2, canvas.height/2); ctx.rotate(Math.PI/2); ctx.drawImage(img, -img.width/2, -img.height/2);
      photo = canvas.toDataURL('image/jpeg', .94); $('image-preview').src = photo; await recognize(token);
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
  $('cancel-ocr').addEventListener('click', () => {
    revision++; cancelOCR(); $('photo-title').textContent = '사진 인식을 멈췄어요'; $('photo-caption').textContent = '다시 시도하거나 다른 사진을 골라주세요.';
    error('인식을 취소했어요. 사진을 다시 읽거나 직접 입력할 수 있어요.');
  });
  document.querySelectorAll('input[name="language"]').forEach(input => input.addEventListener('change', () => {
    revision++; cancelOCR(); player.stop();
    if (photo) recognize(revision);
    else if (!$('text-editor').hidden) updateVoiceWarning();
    else if (paragraphs.length) showParagraphs(paragraphs);
  }));
  $('play-all').addEventListener('click', () => {
    const state = player.getState();
    if (state.scope === 'all' && state.status === 'playing') player.pause();
    else if (state.scope === 'all' && state.status === 'paused') player.resume();
    else player.play(paragraphs, 0, 'all', language());
  });
  $('stop').addEventListener('click', () => player.stop());
  $('rate').addEventListener('change', () => {
    const state = player.getState();
    if (['playing', 'paused'].includes(state.status)) { player.play(paragraphs, state.paragraph, state.scope, language()); if (state.status === 'paused') player.pause(); }
  });
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragover'));
  $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); acceptPhoto(event.dataTransfer.files[0]); });
  document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
  window.addEventListener('pagehide', () => { revision++; cancelOCR(); player.stop(); });
  if (synth) synth.addEventListener('voiceschanged', updateVoiceWarning);
  updateVoiceWarning(); renderPlayback(player.getState());
})();

(function (root) {
  'use strict';
  const LANGUAGES = {
    ja: { name: '일본어', locale: 'ja-JP', ocr: 'jpn' },
    ko: { name: '한국어', locale: 'ko-KR', ocr: 'kor' },
    en: { name: '영어', locale: 'en-US', ocr: 'eng' }
  };
  function cleanText(text, lang) {
    let clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    if (lang === 'ja') clean = clean.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々。、！？「」『』（）])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々。、！？「」『』（）])/gu, '$1');
    return clean;
  }
  function joinLines(text, lang) {
    return cleanText(text, lang).split('\n').map(line => line.trim()).filter(Boolean).join(lang === 'ja' ? '' : ' ');
  }
  function splitParagraphs(text, lang) {
    return String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/).map(paragraph => joinLines(paragraph, lang)).filter(Boolean);
  }
  function paragraphsFromOCR(data, lang) {
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    const paragraphs = blocks.flatMap(block => {
      const entries = Array.isArray(block.paragraphs) ? block.paragraphs : [];
      const fallback = () => entries.map(paragraph => joinLines(paragraph.text || (paragraph.lines || []).map(line => line.text || (line.words || []).map(word => word.text || '').join(' ')).join('\n'), lang)).filter(Boolean);
      const lines = entries.flatMap(paragraph => paragraph.lines || []).map(line => ({
        text: line.text || (line.words || []).map(word => word.text || '').join(' '), bbox: line.bbox
      })).filter(line => line.text.trim());
      if (lines.length < 2 || lines.some(line => !line.bbox || !Number.isFinite(line.bbox.y0) || !Number.isFinite(line.bbox.y1))) return fallback();
      const heights = lines.map(line => Math.max(1, line.bbox.y1-line.bbox.y0)).sort((a,b) => a-b);
      const height = heights[Math.floor(heights.length/2)];
      const pitches = lines.slice(1).map((line,i) => line.bbox.y0-lines[i].bbox.y0).filter(pitch => pitch > 0).sort((a,b) => a-b);
      const normalPitch = Math.min(pitches[Math.floor((pitches.length-1)/4)] || height*1.5, height*1.8);
      const left = Math.min(...lines.map(line => line.bbox.x0));
      const groups = [[]];
      lines.forEach((line, index) => {
        if (index) {
          const previous = lines[index-1];
          const gap = line.bbox.y0-previous.bbox.y0 > Math.max(normalPitch*1.6, height*2.2);
          const indented = line.bbox.x0-left > height*.7 && previous.bbox.x0-left < height*.5 && /[。！？.!?][」』”’\"]?$/.test(previous.text.trim());
          if (gap || indented) groups.push([]);
        }
        groups[groups.length-1].push(line.text);
      });
      return groups.map(group => joinLines(group.join('\n'), lang));
    }).filter(Boolean);
    return paragraphs.length ? paragraphs : splitParagraphs(data?.text || '', lang);
  }
  // Paragraph cards stay intact. Shorter speech chunks improve phone playback.
  function speechChunks(text, lang) {
    const locale = LANGUAGES[lang]?.locale || 'en-US';
    const parts = typeof Intl !== 'undefined' && Intl.Segmenter ? Array.from(new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text), item => item.segment.trim()) : [text];
    return parts.filter(Boolean).flatMap(part => {
      const chunks = [];
      while (Array.from(part).length > 180) {
        const chars = Array.from(part);
        let boundary = lang === 'ja' ? 180 : chars.slice(0, 180).lastIndexOf(' ');
        if (boundary < 70) boundary = 180;
        chunks.push(chars.slice(0, boundary).join('').trim());
        part = chars.slice(boundary).join('').trim();
      }
      if (part) chunks.push(part);
      return chunks;
    });
  }
  function createPlayback({ synth, makeUtterance, onChange = () => {}, onError = () => {}, getRate = () => 1, getVoice = () => null, schedule = setTimeout, unschedule = clearTimeout }) {
    let generation = 0, timer = null, pending = null, liveUtterance = null;
    let groups = [], state = { status: 'idle', paragraph: -1, chunk: 0, scope: 'all', lang: 'ja' };
    const notify = () => onChange({ ...state });
    function stop() {
      generation++;
      if (timer !== null) unschedule(timer);
      timer = null; pending = null; liveUtterance = null;
      if (synth) synth.cancel();
      state = { ...state, status: 'idle', paragraph: -1, chunk: 0 };
      notify();
    }
    function speak(token) {
      if (token !== generation || state.status !== 'playing') return;
      notify();
      const u = makeUtterance(groups[state.paragraph][state.chunk]);
      liveUtterance = u; u.lang = LANGUAGES[state.lang].locale; u.rate = getRate();
      const voice = getVoice(state.lang); if (voice) u.voice = voice;
      u.onend = () => {
        if (token !== generation || !['playing', 'paused'].includes(state.status)) return;
        liveUtterance = null;
        let paragraph = state.paragraph, chunk = state.chunk + 1;
        if (chunk >= groups[paragraph].length) {
          if (state.scope === 'paragraph' || paragraph + 1 >= groups.length) { state.status = 'finished'; notify(); return; }
          paragraph++; chunk = 0;
        }
        pending = { paragraph, chunk };
        if (state.status === 'paused') return;
        timer = schedule(() => {
          timer = null;
          if (token !== generation || state.status !== 'playing' || !pending) return;
          Object.assign(state, pending); pending = null; speak(token);
        }, chunk === 0 ? 380 : 90);
      };
      u.onerror = event => { if (token !== generation) return; stop(); onError(event.error || 'unknown'); };
      try { if (synth.paused) synth.resume(); synth.speak(u); }
      catch { if (token === generation) { stop(); onError('unavailable'); } }
    }
    function play(paragraphs, index, scope, lang) {
      stop();
      if (!synth || !Object.hasOwn(LANGUAGES, lang) || !paragraphs.length) return false;
      groups = paragraphs.map(text => speechChunks(text, lang));
      if (groups.some(group => !group.length)) return false;
      state = { status: 'playing', paragraph: Math.max(0, Math.min(index, groups.length - 1)), chunk: 0, scope, lang };
      speak(generation); return true;
    }
    function pause() {
      if (state.status !== 'playing') return;
      state.status = 'paused';
      if (timer !== null) { unschedule(timer); timer = null; }
      if (liveUtterance) synth.pause();
      notify();
    }
    function resume() {
      if (state.status !== 'paused') return;
      state.status = 'playing';
      if (pending) { Object.assign(state, pending); pending = null; speak(generation); }
      else if (liveUtterance) { synth.resume(); notify(); }
    }
    return { play, pause, resume, stop, getState: () => ({ ...state }) };
  }
  const api = { LANGUAGES, cleanText, splitParagraphs, paragraphsFromOCR, speechChunks, createPlayback };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

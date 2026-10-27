(function (root) {
  'use strict';
  const LANGUAGES = {
    ja: { name: '일본어', locale: 'ja-JP', ocr: 'jpn' },
    ko: { name: '한국어', locale: 'ko-KR', ocr: 'kor' },
    en: { name: '영어', locale: 'en-US', ocr: 'eng' }
  };
  const MODEL_REVISION = 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec';
  function ocrPlan(lang, layout = 'auto') {
    if (lang !== 'ja') return { langs: LANGUAGES[lang].ocr, verticalText: '0', options: {} };
    return {
      langs: layout === 'horizontal' ? 'jpn' : layout === 'vertical' ? 'jpn_vert' : ['jpn', 'jpn_vert'],
      verticalText: layout === 'horizontal' ? '0' : '1',
      options: {
        langPath: 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@' + MODEL_REVISION,
        gzip: false,
        // Never reuse the old compressed/integer model cached under the same language name.
        cachePath: 'sorinote-best-' + MODEL_REVISION.slice(0, 12)
      }
    };
  }
  function rasterSize(width, height) {
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('사진 크기를 확인할 수 없어요.');
    const scale = Math.min(2, 3600 / Math.max(width, height), Math.sqrt(6000000 / (width * height)));
    const contentWidth = Math.max(1, Math.round(width * scale));
    const contentHeight = Math.max(1, Math.round(height * scale));
    const padding = Math.max(16, Math.round(Math.min(contentWidth, contentHeight) * .01));
    return { contentWidth, contentHeight, padding, width: contentWidth + padding * 2, height: contentHeight + padding * 2 };
  }
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
  function paragraphsFromOCR(data, lang, layout = 'auto') {
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    const paragraphs = blocks.flatMap(block => {
      const entries = Array.isArray(block.paragraphs) ? block.paragraphs : [];
      const fallback = () => entries.map(paragraph => joinLines(paragraph.text || (paragraph.lines || []).map(line => line.text || (line.words || []).map(word => word.text || '').join(' ')).join('\n'), lang)).filter(Boolean);
      const rawLines = entries.flatMap((paragraph, paragraphIndex) => (paragraph.lines || []).map(line => ({
        text: line.text || (line.words || []).map(word => word.text || '').join(' '), bbox: line.bbox, words: line.words || [], paragraphIndex
      }))).filter(line => line.text.trim());
      if (rawLines.length < 2 || rawLines.some(line => !line.bbox || !['x0','x1','y0','y1'].every(key => Number.isFinite(line.bbox[key])))) return fallback();
      if (lang === 'ja' && layout === 'auto') {
        const directions = rawLines.map(line => {
          const ratio = (line.bbox.y1-line.bbox.y0)/Math.max(1,line.bbox.x1-line.bbox.x0);
          return ratio > 2 ? 'vertical' : ratio < .5 ? 'horizontal' : null;
        });
        if (directions.includes('vertical') && directions.includes('horizontal')) {
          const runs = [];
          rawLines.forEach((line, index) => {
            const direction = directions[index] || runs[runs.length-1]?.direction || directions.find(Boolean);
            if (runs[runs.length-1]?.direction !== direction) runs.push({ direction, lines: [] });
            runs[runs.length-1].lines.push(line);
          });
          return runs.flatMap(run => paragraphsFromOCR({ blocks: [{ paragraphs: [{ lines: run.lines }] }] }, lang, run.direction));
        }
      }
      const median = values => { const sorted = values.slice().sort((a,b) => a-b); return sorted[Math.floor(sorted.length/2)]; };
      const vertical = lang === 'ja' && (layout === 'vertical' || (layout === 'auto' && median(rawLines.map(line => (line.bbox.y1-line.bbox.y0)/Math.max(1,line.bbox.x1-line.bbox.x0))) > 2));
      // Map vertical columns to the same axes as horizontal lines: advance right-to-left,
      // while paragraph indentation is measured downward from the top of the page.
      const axis = bbox => vertical ? { start: bbox.y0, end: bbox.y1, cross: -bbox.x1, crossEnd: -bbox.x0 } : { start: bbox.x0, end: bbox.x1, cross: bbox.y0, crossEnd: bbox.y1 };
      const lines = rawLines.map(line => ({ ...line, ...axis(line.bbox) }));
      if (vertical) lines.sort((a,b) => a.cross-b.cross);
      const glyphSizes = rawLines.flatMap(line => line.words).filter(word => word.bbox && /[\p{L}\p{N}]/u.test(word.text || '')).map(word => {
        const box = axis(word.bbox); return box.crossEnd-box.cross;
      }).filter(size => size > 0);
      const height = glyphSizes.length ? median(glyphSizes) : median(lines.map(line => Math.max(1,line.crossEnd-line.cross)));
      const pitches = lines.slice(1).map((line,i) => line.cross-lines[i].cross).filter(pitch => pitch > 0).sort((a,b) => a-b);
      const normalPitch = Math.min(pitches[Math.floor((pitches.length-1)/4)] || height*1.5, height*1.9);
      const left = Math.min(...lines.map(line => line.start));
      const span = Math.max(...lines.map(line => line.end-line.start));
      const groups = [[]];
      lines.forEach((line, index) => {
        if (index) {
          const previous = lines[index-1];
          const gap = line.cross-previous.cross > Math.max(normalPitch*1.6, height*2.2);
          const indent = line.start-left;
          const indented = indent > height*.65 && indent < height*2.6 && previous.start-left < height*.5;
          const shortEnding = line.paragraphIndex !== previous.paragraphIndex && previous.end-previous.start < span*.72 && /[。！？.!?][」』”’\"]?$/.test(previous.text.trim());
          if (gap || indented || shortEnding) groups.push([]);
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
  const api = { LANGUAGES, ocrPlan, rasterSize, cleanText, splitParagraphs, paragraphsFromOCR, speechChunks, createPlayback };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

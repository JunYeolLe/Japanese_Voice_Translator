'use strict';
window.StudyWords={create(bridge){
  const V=StudyVocabulary,$=id=>document.getElementById(id);
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls='secondary')=>{const e=node('button',text,cls);e.type='button';e.onclick=fn;return e;};
  let records=[],tokens=[],version=0,loading=null,wordJob=null,selected=null,utterance=null;
  const meanings=new Map();
  const hint=node('p','','result-hint word-hint');hint.id='word-hint';hint.hidden=true;$('paragraphs').before(hint);
  const sheet=node('dialog',undefined,'word-sheet');sheet.id='word-sheet';sheet.setAttribute('aria-labelledby','word-title');
  sheet.innerHTML='<div class="section-heading"><h2 id="word-title" lang="ja"></h2><button id="word-close" class="text-button" type="button">닫기</button></div><dl><dt>읽는 법</dt><dd id="word-reading" lang="ja"></dd><dt>한국어 뜻</dt><dd id="word-meaning" role="status"></dd></dl><p id="word-base" class="workspace-hint"></p><p id="word-provider" class="workspace-hint"></p><div class="word-actions"><button id="word-listen" type="button" class="primary">▶ 이 단어만 듣기</button><button id="word-from" type="button" class="secondary">여기부터 듣기</button><button id="word-retry" type="button" class="secondary" hidden>뜻 다시 확인</button><button id="word-source" type="button" class="text-button" hidden>사진 원본 확인</button></div>';
  document.body.append(sheet);
  function cancelSpeech(){if(utterance){utterance=null;window.speechSynthesis?.cancel();}$('word-listen').textContent='▶ 이 단어만 듣기';}
  function close(){wordJob?.abort();wordJob=null;selected=null;cancelSpeech();if(sheet.open)sheet.close();for(const id of ['word-title','word-reading','word-meaning','word-base','word-provider'])$(id).textContent='';}
  $('word-close').onclick=close;sheet.addEventListener('cancel',e=>{e.preventDefault();close();});
  sheet.addEventListener('click',e=>{if(e.target===sheet){const b=sheet.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)close();}});
  $('word-listen').onclick=()=>{
    if(!selected||!window.speechSynthesis)return;
    if(utterance){cancelSpeech();return;}
    bridge.stop();const speech=new SpeechSynthesisUtterance(selected.word.surface);speech.lang='ja-JP';speech.rate=Number($('rate').value);const voice=bridge.voiceFor('ja');if(voice)speech.voice=voice;
    utterance=speech;$('word-listen').textContent='■ 단어 듣기 멈춤';
    speech.onend=speech.onerror=()=>{if(utterance===speech){utterance=null;$('word-listen').textContent='▶ 이 단어만 듣기';}};window.speechSynthesis.speak(speech);
  };
  $('word-from').onclick=()=>{if(!selected)return;const {index,word}=selected;close();bridge.listenFrom(index,word.start);};
  $('word-source').onclick=()=>{if(!selected)return;const {index,word}=selected;close();bridge.openSource(index,word);};
  const key=word=>word.surface+'|'+word.reading;
  async function meaning(word,signal){
    if(signal.aborted)throw new DOMException('취소됨','AbortError');
    const known=V.local(word);if(known)return known;
    const registered=V.lookup(word.surface);if(registered)return {text:registered,provider:'기본 풀이'};
    if(meanings.has(key(word)))return meanings.get(key(word));
    const result=await bridge.translate(word.surface,signal);
    if(signal.aborted)throw new DOMException('취소됨','AbortError');
    meanings.set(key(word),result);return result;
  }
  async function lookup(){
    wordJob?.abort();const controller=new AbortController();wordJob=controller;const current=selected,token=version;
    if(!current)return;
    $('word-meaning').textContent='뜻을 확인하고 있어요…';$('word-provider').textContent='';$('word-retry').hidden=true;
    try{const result=await meaning(current.word,controller.signal);if(version!==token||selected!==current||controller.signal.aborted)return;
      $('word-meaning').textContent=result.text;$('word-provider').textContent=['기본 풀이','위키낱말사전'].includes(result.provider)?result.provider+' · 대표 뜻 · 문장에 따라 다른 뜻일 수 있어요.':'자동 번역 · '+result.provider+' · 사전의 모든 뜻을 제공하지 않으며 문맥에 따라 틀릴 수 있어요.';
      if(result.provider==='위키낱말사전'){const link=node('a','사전 원문 · 기여 이력');link.href='https://ko.wiktionary.org/wiki/'+encodeURIComponent(result.headword);link.target='_blank';link.rel='noopener noreferrer';$('word-provider').append(document.createTextNode(' '),link);}
    }catch(error){if(version===token&&selected===current&&!controller.signal.aborted){$('word-meaning').textContent=error.message||'뜻을 가져오지 못했어요.';$('word-retry').hidden=false;}}
    finally{if(wordJob===controller)wordJob=null;}
  }
  $('word-retry').onclick=lookup;
  function open(index,word){
    close();bridge.stop();selected={index,word};$('word-title').textContent=word.surface;$('word-reading').textContent=bridge.wordReading(index,word)||word.reading||'읽는 법을 확인해주세요';
    $('word-base').textContent=word.base&&word.base!==word.surface?'기본형: '+word.base:'';
    $('word-source').hidden=!bridge.hasPhoto();$('word-listen').disabled=!window.speechSynthesis;$('word-from').disabled=!window.speechSynthesis;
    sheet.showModal();lookup();
  }
  async function analyze(token){
    hint.replaceChildren(document.createTextNode('단어를 준비하고 있어요. 준비되면 본문에서 눌러볼 수 있어요.'));
    try{
      const result=await bridge.tokenize(records.map(r=>r.text));if(token!==version)return;
      tokens=result;hint.hidden=true;hint.textContent='모르는 단어를 누르면 읽는 법과 한국어 뜻을 볼 수 있어요. 작은 후리가나는 눌러 수정해요.';bridge.repaint();
    }catch{if(token===version){hint.replaceChildren(document.createTextNode('단어 사전을 불러오지 못했어요. '),button('다시 준비',()=>{loading=analyze(version).finally(()=>{loading=null;});},'text-button'));}}
  }
  function setDocument(next){
    version++;close();tokens=[];meanings.clear();records=next;loading=null;
    hint.hidden=bridge.language()!=='ja'||!records.length;
    if(!hint.hidden){const token=version;loading=analyze(token).finally(()=>{if(token===version)loading=null;});}
  }
  return {setDocument,reset(){setDocument([],[]);},words:index=>V.words(records[index]?.text||'',tokens[index]),open,close,
    inspect:()=>({selected}),
    changeWords(index,start,end,parts){
      const record=records[index];if(!record)return;
      const words=V.words(record.text,tokens[index]);
      if(!words.some(w=>w.start===start)||!words.some(w=>w.end===end)||end<=start||!parts.length||parts.some(p=>!p.surface_form)||parts.map(p=>p.surface_form).join('')!==record.text.slice(start,end))throw new Error('원문을 바꾸지 않는 단어 구분만 적용할 수 있어요.');
      wordJob?.abort();version++;
      tokens[index]=words.flatMap(w=>w.start===start?parts:w.start>start&&w.start<end?[]:[{surface_form:w.surface,reading:w.reading||'',basic_form:w.base||w.surface,pos:w.pos||'',pos_detail_1:w.detail||''}]);
      meanings.clear();bridge.repaint();
    },
    isListening:()=>Boolean(utterance),stop:cancelSpeech};
}};

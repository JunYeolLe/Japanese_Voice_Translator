'use strict';
window.StudyWords={create(bridge){
  const V=StudyVocabulary,$=id=>document.getElementById(id);
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls='secondary')=>{const e=node('button',text,cls);e.type='button';e.onclick=fn;return e;};
  let records=[],tokens=[],version=0,loading=null,translated=new Set(),wordJob=null,summaryJob=null,selected=null,utterance=null;
  let expanded=false;
  const meanings=new Map();let items={words:[],grammar:[],total:0};
  const hint=node('p','','result-hint word-hint');hint.id='word-hint';hint.hidden=true;$('paragraphs').before(hint);
  const sheet=node('dialog',undefined,'word-sheet');sheet.id='word-sheet';sheet.setAttribute('aria-labelledby','word-title');
  sheet.innerHTML='<div class="section-heading"><h2 id="word-title" lang="ja"></h2><button id="word-close" class="text-button" type="button">닫기</button></div><dl><dt>읽는 법</dt><dd id="word-reading" lang="ja"></dd><dt>한국어 뜻</dt><dd id="word-meaning" role="status"></dd></dl><p id="word-base" class="workspace-hint"></p><p id="word-provider" class="workspace-hint"></p><div class="word-actions"><button id="word-listen" type="button" class="primary">▶ 이 단어만 듣기</button><button id="word-retry" type="button" class="secondary" hidden>뜻 다시 확인</button><button id="word-source" type="button" class="text-button" hidden>사진 원본 확인</button></div>';
  document.body.append(sheet);
  const summary=node('details',undefined,'study-summary');summary.id='study-summary';summary.hidden=true;
  summary.innerHTML='<summary>한자 단어 · 문법 정리 <span id="study-count"></span></summary><p class="workspace-hint">번역한 단락에서 한자 단어는 처음 24개를 보여주며 더 보기로 나머지를 펼칠 수 있어요. 펼치면 단어 뜻을 준비합니다. 문법은 본문에 나온 표현의 대표 뜻이며 문맥에 따라 달라질 수 있어요.</p><p class="workspace-hint">단어 뜻은 기본 풀이 또는 자동 번역이에요. 외부 번역 사용 시 단어 텍스트도 MyMemory로 전송하며 무료 한도에 포함돼요.</p><p id="study-status" role="status"></p><div id="study-entries"></div><div class="study-actions"><button id="study-more" type="button" class="secondary" hidden>더 보기</button><button id="study-copy" type="button" class="secondary">전체 정리 복사</button><button id="study-retry" type="button" class="text-button" hidden>남은 뜻 준비하기</button></div><textarea id="study-copy-fallback" readonly hidden aria-label="복사할 단어와 문법 정리"></textarea>';
  $('paragraphs').after(summary);
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
    $('word-source').hidden=!bridge.hasPhoto();$('word-listen').disabled=!window.speechSynthesis;
    sheet.showModal();lookup();
  }
  function render(){
    const docs=records.flatMap((r,i)=>translated.has(r.id)&&tokens[i]?[{text:r.text,tokens:tokens[i]}]:[]);
    items=V.collect(docs,Infinity);
    for(const item of items.words){const cached=meanings.get(key(item));if(cached){item.meaning=cached.text;item.automatic=cached.provider!=='기본 풀이';}}
    $('study-more').hidden=expanded||items.words.length<=24;$('study-more').textContent='더 보기 · 나머지 '+Math.max(0,items.words.length-24)+'개';$('study-more').disabled=Boolean(summaryJob);summary.hidden=translated.size===0;
    $('study-count').textContent=docs.length?'· '+docs.length+'개 단락':'';
    const list=$('study-entries');list.replaceChildren();
    for(const [title,group]of [['한자 단어',expanded?items.words:items.words.slice(0,24)],['중요 문법',items.grammar]]){
      if(!group.length)continue;list.append(node('h3',title));
      const ul=node('ul');for(const item of group){const cached=meanings.get(key(item));if(cached){item.meaning=cached.text;item.automatic=cached.provider!=='기본 풀이';}
        const row=node('li');row.append(node('span',item.surface+' : '+(item.reading||'읽는 법 확인 필요'),'study-term'),document.createTextNode(' ( '+(item.meaning||'뜻 준비 전')+' )'));
        if(item.count>1)row.append(node('small',item.count+'회','study-auto'));if(item.automatic)row.append(node('small','자동 번역','study-auto'));ul.append(row);
      }list.append(ul);
    }
    if(!docs.length)$('study-status').textContent=loading?'단어 사전을 준비하고 있어요…':'단어 사전을 준비한 뒤 정리를 볼 수 있어요.';
    else if(!summaryJob)$('study-status').textContent=items.words.length||items.grammar.length?'번역한 단락의 표현만 정리했어요.':'이 단락에서는 정리할 한자 단어나 등록된 문법 표현을 찾지 못했어요.';
    const pending=items.words.some(w=>!w.meaning);
    $('study-copy').disabled=Boolean(summaryJob)||![...items.words,...items.grammar].some(x=>x.meaning);
    $('study-retry').hidden=!pending||Boolean(summaryJob);$('study-copy-fallback').hidden=true;
  }
  async function prepareSummary(all=false){
    if(summaryJob||!summary.open)return;
    const controller=new AbortController(),token=version;summaryJob=controller;
    try{
      if(loading)await loading;
      if(token!==version||controller.signal.aborted)return;
      render();const pending=(all||expanded?items.words:items.words.slice(0,24)).filter(w=>!w.meaning);
      for(let i=0;i<pending.length;i++){
        $('study-status').textContent='단어 뜻 준비 중 · '+(i+1)+' / '+pending.length;
        await meaning(pending[i],controller.signal);
        if(token!==version||controller.signal.aborted)return;render();
      }
      $('study-status').textContent='정리했어요. 자동 풀이와 문법의 대표 뜻은 문맥과 함께 확인해주세요.';
    }catch(error){if(token===version&&!controller.signal.aborted)$('study-status').textContent=error.message+' 준비된 항목은 그대로 남아 있어요.';}
    finally{if(summaryJob===controller){summaryJob=null;$('study-more').disabled=false;$('study-copy').disabled=![...items.words,...items.grammar].some(x=>x.meaning);$('study-retry').hidden=!items.words.some(w=>!w.meaning);}}
  }
  summary.addEventListener('toggle',()=>{if(summary.open)prepareSummary();else{summaryJob?.abort();summaryJob=null;render();}});
  $('study-retry').onclick=()=>prepareSummary();
  $('study-more').onclick=()=>{expanded=true;render();prepareSummary();};
  $('study-copy').onclick=async()=>{
    const token=version;
    if(items.words.some(w=>!w.meaning))await prepareSummary(true);
    if(token!==version)return;
    if(items.words.some(w=>!w.meaning)){bridge.toast('아직 뜻을 준비하지 못한 단어가 있어요. 남은 뜻 준비하기를 누른 뒤 전체 복사를 다시 시도해주세요.');return;}
    const vocabulary=V.format(items.words),grammar=V.format(items.grammar);
    const attribution=items.words.some(w=>w.dictionary)?'사전 풀이: 한국어 위키낱말사전 기여자들 / Kaikki.org, CC BY-SA 4.0 (선별·가공)\nhttps://ko.wiktionary.org/ · https://creativecommons.org/licenses/by-sa/4.0/':'';
    const text=[vocabulary&&'한자 단어\n'+vocabulary,grammar&&'중요 문법\n'+grammar,attribution].filter(Boolean).join('\n\n');if(!text)return;
    try{await navigator.clipboard.writeText(text);bridge.toast(items.words.some(w=>!w.meaning)?'뜻이 준비된 항목만 복사했어요.':'단어와 문법 정리를 복사했어요.');}
    catch{const area=$('study-copy-fallback');area.hidden=false;area.value=text;area.focus();area.select();bridge.toast('아래 글을 선택해 직접 복사해주세요.');}
  };
  async function analyze(token){
    hint.replaceChildren(document.createTextNode('단어를 준비하고 있어요. 준비되면 본문에서 눌러볼 수 있어요.'));
    try{
      const result=await bridge.tokenize(records.map(r=>r.text));if(token!==version)return;
      tokens=result;hint.textContent='모르는 단어를 누르면 읽는 법과 한국어 뜻을 볼 수 있어요. 작은 후리가나는 눌러 수정해요.';bridge.repaint();render();
    }catch{if(token===version){hint.replaceChildren(document.createTextNode('단어 사전을 불러오지 못했어요. '),button('다시 준비',()=>{loading=analyze(version).finally(()=>{loading=null;});},'text-button'));}}
  }
  function setDocument(next,translatedIds){
    version++;expanded=false;close();summaryJob?.abort();summaryJob=null;tokens=[];meanings.clear();records=next;translated=new Set(translatedIds);items={words:[],grammar:[],total:0};summary.open=false;loading=null;
    hint.hidden=bridge.language()!=='ja'||!records.length;summary.hidden=true;$('study-copy-fallback').value='';$('study-entries').replaceChildren();
    if(!hint.hidden){const token=version;loading=analyze(token).finally(()=>{if(token===version)loading=null;});}
  }
  return {setDocument,reset(){setDocument([],[]);},words:index=>V.words(records[index]?.text||'',tokens[index]),open,close,
    inspect:()=>({selected}),
    changeWords(index,start,end,parts){
      const record=records[index];if(!record)return;
      const words=V.words(record.text,tokens[index]);
      if(!words.some(w=>w.start===start)||!words.some(w=>w.end===end)||end<=start||!parts.length||parts.some(p=>!p.surface_form)||parts.map(p=>p.surface_form).join('')!==record.text.slice(start,end))throw new Error('원문을 바꾸지 않는 단어 구분만 적용할 수 있어요.');
      wordJob?.abort();summaryJob?.abort();summaryJob=null;version++;
      tokens[index]=words.flatMap(w=>w.start===start?parts:w.start>start&&w.start<end?[]:[{surface_form:w.surface,reading:w.reading||'',basic_form:w.base||w.surface,pos:w.pos||'',pos_detail_1:w.detail||''}]);
      meanings.clear();bridge.repaint();render();
    },
    translated(id){translated.add(id);render();if(summary.open)prepareSummary();},
    stop:cancelSpeech};
}};

'use strict';
window.StudyWorkspace={create(bridge){
  const $=id=>document.getElementById(id),D=StudyDocument;
  let records=[],epoch=0,view='read',undo=null,sourceIndex=-1,sourceVersion=0,selection=null,viewport=null,drag=null,target=null;
  let translationCache=new Map(),jobs=new Map(),partial=null,consentWait=null,practiceIndex=0,practiceSentence=-1;
  const editDrafts=new Map();let activeEditor=null;
  const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls='secondary')=>{const b=node('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
  const read=node('div');read.id='read-view';read.append(...$('main').childNodes);$('main').append(read);
  const practice=node('section');practice.id='practice-view';practice.hidden=true;
  practice.innerHTML='<span class="eyebrow">ONE SENTENCE AT A TIME</span><h1>문장 연습</h1><p class="workspace-hint">한 문장을 듣고, 쉬는 동안 따라 읽어보세요.</p><div id="practice-toolbar"></div><label class="practice-label" for="practice-paragraph">연습할 단락</label><select id="practice-paragraph"></select><div class="practice-options"><label><input type="checkbox" id="practice-repeat" checked> 문장 반복</label><label>따라 읽기 간격 <select id="practice-gap"><option value="2000">2초</option><option value="3000">3초</option><option value="650">짧게</option></select></label><button id="practice-hide" type="button" class="secondary" aria-pressed="false">원문 가리기</button></div><p id="practice-empty" class="workspace-hint">먼저 본문 가져오기에서 본문을 준비해주세요.</p><ol id="practice-sentences" class="paragraphs"></ol>';
  const guide=node('section');guide.id='guide-view';guide.hidden=true;guide.className='workspace-guide';
  guide.innerHTML='<span class="eyebrow">KEEP IT SIMPLE</span><h1>사용 안내</h1><h2>사진이나 복사한 글로 듣기</h2><p>본문 가져오기에서 사진으로 읽기 또는 글 붙여넣기를 선택하세요. 붙여넣은 뒤 언어를 고르고 바로 듣기를 누르면 재생됩니다. 빈 줄로 나뉜 원래 단락을 유지하며, 필요할 때 문장별로 나누기를 누를 수 있어요.</p><p>사진을 찍거나 선택하고 필요한 본문만 잘라주세요. 가로·세로가 섞인 교재는 자동·혼합을 선택하세요. 사진의 인쇄 후리가나·밑줄·문항 표시는 구분해 제외하지만 인식 오류가 남을 수 있어요.</p><h2>틀린 부분만 확인하기</h2><p>단락의 원본 확인을 누르면 해당 사진 영역을 볼 수 있어요. 옅은 노란 표시도 눌러보세요. 표시가 없는 글자에도 오류가 있을 수 있어요. 사진에서 영역을 고르고 아래 글에서 바꿀 부분을 선택한 다음 다시 인식하세요. 미리보기를 확인한 뒤 반영해야 본문이 바뀝니다.</p><p>단락의 ⋯ 메뉴에서 합치거나 문장 경계에서 나눌 수 있어요. 부분 재인식·합치기·나누기는 한 단계 되돌릴 수 있어요.</p><h2>후리가나와 듣기</h2><p>후리가나를 처음 켤 때 무료 사전을 준비합니다. 한자 위의 읽는 법을 눌러 수정할 수 있어요. 원문 복사와 음성에는 후리가나·번역·출처를 섞지 않아요. 듣기 속도는 현재 말을 끊지 않고 다음 문장 또는 읽기 구간부터 적용돼요.</p><h2>한국어 뜻 보기</h2><p>일본어 단락만 번역할 수 있어요. 지원되는 기기에서는 브라우저 내 번역을 먼저 시도합니다. 번역 모델을 처음 준비할 때 시간이 걸릴 수 있어요. 지원되지 않으면 전송 안내를 확인하고 MyMemory 무료 번역을 사용할 수 있어요. 자동 번역은 문맥에 따라 틀릴 수 있어요.</p><p>MyMemory 익명 사용 한도는 하루 5,000자이며 제공자 정책과 공용 IP 사용량에 따라 달라질 수 있어요. 한도 초과나 연결 실패 시 안내하며 자동 유료 전환은 없어요.</p><h2>자료는 현재 화면에서만</h2><p>메뉴를 이동해도 사진과 본문은 유지하고 음성은 멈춥니다. 처음부터 새로를 누르거나 페이지를 새로고침·닫으면 자료를 비워요. 사진 OCR은 브라우저에서 처리합니다. 외부 번역을 선택하면 해당 단락 또는 단어의 텍스트만 MyMemory로 전송하며, 서비스 정책상 장기 보관·외부 번역 업체 처리 가능성이 있습니다. 여기서 비워도 외부 서비스 기록까지 삭제되지는 않아요.</p><p><a href="https://mymemory.translated.net/terms-and-conditions" target="_blank" rel="noopener noreferrer">MyMemory 처리·보관 정책</a> · <a href="https://mymemory.translated.net/doc/usagelimits.php" target="_blank" rel="noopener noreferrer">무료 한도</a></p>';
  $('main').append(practice,guide);
  const featureGuide=node('section');featureGuide.innerHTML='<h2>사진 상태 확인과 바로 수정</h2><p>사진을 고르면 밝기·선명도·해상도·기울기·가장자리 잘림 가능성을 기기 안에서 확인해요. 읽기 좋음이면 바로 인식하고, 경고가 있으면 그대로 읽기 또는 자르기·회전을 선택할 수 있어요. 상태는 추정이며 OCR 정확도를 보장하지 않아요.</p><p>단락의 ⋯ → 글 수정에서 그 단락만 고치고 저장·취소할 수 있어요. 사진이 있으면 원본 보기를 펼쳐 비교하세요. 수정됨 표시와 한 단계 되돌리기를 제공하고 후리가나·번역·듣기에 새 본문을 반영해요. 저장은 현재 화면에만 적용돼요.</p><h2>내게 맞는 목소리</h2><p>읽기 설정 → 읽어주는 목소리에서 고르고 짧게 들어보기로 비교하세요. 선택은 본문 듣기와 문장 연습에 함께 적용돼요. 목소리를 바꾸면 재생을 멈추며 다음 재생부터 적용해요. 기기·브라우저마다 목록이 다르고 일부 음성은 인터넷이 필요해요. 선택은 새로고침하면 초기화돼요.</p>';guide.append(featureGuide);
  const toolbar=document.querySelector('.reading-toolbar'),toolbarAnchor=node('span');toolbar.before(toolbarAnchor);
  const wordGuide=node('section');wordGuide.innerHTML='<h2>단어 뜻과 학습 정리</h2><p>일본어 본문의 단어를 누르면 아래쪽 창에 읽는 법·한국어 뜻·단어 듣기가 나와요. 후리가나가 꺼져 있어도 사용할 수 있어요. 작은 후리가나를 누르면 읽는 법을 수정합니다. 자동 단어 구분은 이름·복합어에서 틀릴 수 있어요.</p><p>단락을 번역하면 본문 아래에 한자 단어 · 문법 정리가 나타나요. 펼쳐서 처음 24개와 더 보기로 펼치는 나머지 한자 단어와 본문에 나온 등록 문법을 확인하고 복사하세요. 기본 풀이 외의 단어 뜻은 자동 번역이며, 외부 번역에 동의했다면 단어 텍스트도 MyMemory에 보내고 무료 한도에 포함돼요. 원문 전체 복사와 듣기에는 이 정리를 섞지 않습니다.</p>';guide.append(wordGuide);
  const menuButton=button('☰',()=>{menu.hidden=!menu.hidden;menuButton.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('button').focus();},'menu-button');
  menuButton.id='category-toggle';menuButton.setAttribute('aria-label','카테고리 메뉴');menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-controls','category-menu');
  const menu=node('nav');menu.id='category-menu';menu.className='category-menu';menu.hidden=true;menu.setAttribute('aria-label','카테고리');
  for(const [key,label]of [['read','본문 가져오기'],['practice','문장 연습'],['guide','사용 안내']]){const b=button(label,()=>navigate(key));b.dataset.view=key;menu.append(b);}
  const header=document.querySelector('.header');header.prepend(menuButton);header.append(menu);
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();navigate('read');});
  document.querySelector('.guide-link').addEventListener('click',e=>{e.preventDefault();navigate('guide');});
  document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!menuButton.contains(e.target)){menu.hidden=true;menuButton.setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){menu.hidden=true;menuButton.setAttribute('aria-expanded','false');menuButton.focus();}});
  const undoButton=button('↶ 한 단계 되돌리기',()=>{if(!undo)return;const previous=undo;undo=null;bridge.commit(previous.records,previous.notes,true);bridge.toast('직전 변경을 되돌렸어요.');},'text-button');undoButton.id='undo-change';undoButton.hidden=true;toolbar.append(undoButton);
  const disclosure=node('p','옅은 표시는 확인이 필요한 글자예요. 표시가 없어도 인식 오류가 있을 수 있어요.','result-hint');disclosure.id='confidence-hint';$('paragraphs').before(disclosure);
  const speedHint=node('p','속도는 말을 끊지 않고 다음 읽기 구간부터 적용돼요.','speed-note');document.querySelector('.speed').append(speedHint);
  function dialog(id,html,cls='workspace-dialog'){const e=node('dialog');e.id=id;e.className=cls;e.innerHTML=html;document.body.append(e);return e;}
  const consentDialog=dialog('translation-consent','<h2>외부 무료 번역을 사용할까요?</h2><p>선택한 일본어 단락 또는 단어의 텍스트만 <strong>Translated의 MyMemory</strong>로 보냅니다. 사진은 보내지 않아요. 동의 후 이 탭에서 누르는 단어와 펼친 정리의 단어 뜻도 같은 방식으로 조회합니다.</p><p>MyMemory 정책에는 제출된 문장의 장기 보관, IP 등 접속 기록 수집, 외부 기계 번역 업체와의 데이터 처리가 명시되어 있습니다. 소리노트를 초기화해도 외부 서비스의 기록이 삭제되는 것은 아닙니다. 민감한 내용은 전송하지 마세요.</p><p><a href="https://mymemory.translated.net/terms-and-conditions" target="_blank" rel="noopener noreferrer">처리·보관 정책 확인</a> · 익명 무료 한도 하루 5,000자. 유료 전환 없음.</p><details><summary>이번에 보낼 텍스트 확인</summary><p id="consent-text" lang="ja"></p></details><div class="crop-actions"><button id="consent-no" class="secondary" type="button">전송 안 함</button><button id="consent-yes" class="primary" type="button">안내 확인 · 텍스트 전송</button></div>');
  consentDialog.setAttribute('aria-label','외부 번역 전송 안내');
  function finishConsent(value){const pending=consentWait;consentWait=null;if(consentDialog.open)consentDialog.close();$('consent-text').textContent='';pending?.resolve(value);}
  $('consent-no').onclick=()=>finishConsent(false);$('consent-yes').onclick=()=>finishConsent(true);consentDialog.addEventListener('cancel',e=>{e.preventDefault();finishConsent(false);});
  const translator=StudyTranslation.create({
    consent:(text,signal)=>new Promise(resolve=>{finishConsent(false);consentWait={resolve};$('consent-text').textContent=text;consentDialog.showModal();signal?.addEventListener('abort',()=>{if(consentWait?.resolve===resolve)finishConsent(false);},{once:true});}),
    decode:text=>String(text).replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi,entity=>{const decoder=document.createElement('textarea');decoder.innerHTML=entity;return decoder.value;})
  });
  const wordStudy=StudyWords.create({tokenize:bridge.tokenize,repaint:bridge.repaint,wordReading:bridge.wordReading,voiceFor:bridge.voiceFor,stop,toast:bridge.toast,
    language:()=>bridge.get().language,hasPhoto:()=>Boolean(bridge.get().photo?.reference),translate:(text,signal)=>translator.translate(text,signal),
    openSource:(index,word)=>{const line=records[index]?.regions.find(r=>r.start<word.end&&r.end>word.start);openSource(index,line?{...line,start:word.start,end:word.end}:undefined);if(!line)chooseTarget(word);}});
  const sourceDialog=dialog('source-dialog','<div class="section-heading"><h2>원본 확인</h2><button id="source-close" class="text-button" type="button">닫기</button></div><p id="source-hint" class="workspace-hint"></p><div class="source-comparison"><div><p class="small-label">사진 · 드래그하여 한 줄이나 단어 선택</p><canvas id="source-canvas" aria-label="재인식할 사진 영역을 드래그하여 선택"></canvas><div class="source-actions"><button id="source-full" type="button" class="secondary">전체 사진</button><button id="source-zoom" type="button" class="secondary">선택 부분 확대</button></div><details><summary>영역을 숫자로 조절</summary><div class="region-controls"><label>왼쪽 %<input id="region-x" type="range" min="0" max="99" value="0"></label><label>위쪽 %<input id="region-y" type="range" min="0" max="99" value="0"></label><label>너비 %<input id="region-w" type="range" min="1" max="100" value="100"></label><label>높이 %<input id="region-h" type="range" min="1" max="100" value="100"></label></div></details></div><div><label for="source-original">추출된 원문 · 바꿀 글자를 선택하세요</label><textarea id="source-original" readonly lang="ja"></textarea><p class="workspace-hint">아래 줄 버튼을 누르면 사진과 글 범위가 함께 선택돼요. 단어만 바꾸려면 글에서 해당 단어를 선택하세요.</p><div id="source-lines" class="source-lines"></div><p id="source-target" class="selection-status" role="status">바꿀 글자를 먼저 선택해주세요.</p><button id="rescan-region" type="button" class="primary full">선택 영역 다시 인식</button><p id="rescan-status" class="workspace-hint" role="status"></p><div id="rescan-preview" hidden><label for="rescan-text">재인식 결과 · 확인하고 고칠 수 있어요</label><textarea id="rescan-text" maxlength="30000"></textarea><button id="rescan-apply" type="button" class="primary full">선택한 글자만 바꾸기</button></div></div></div>');
  sourceDialog.setAttribute('aria-label','원본과 추출 결과 비교');
  const splitDialog=dialog('split-dialog','<div class="section-heading"><h2>어디에서 나눌까요?</h2><button id="split-close" type="button" class="text-button">닫기</button></div><p class="workspace-hint">다음 단락이 시작할 문장을 골라주세요.</p><div id="split-options" class="split-options"></div>');
  splitDialog.setAttribute('aria-label','문장 경계에서 단락 나누기');$('split-close').onclick=()=>splitDialog.close();
  const practicePlayer=StudyCore.createPlayback({synth:window.speechSynthesis,makeUtterance:text=>new SpeechSynthesisUtterance(text),getRate:()=>Number($('rate').value),getVoice:bridge.voiceFor,onError:()=>bridge.toast('기기 음성을 재생하지 못했어요. 다시 눌러주세요.'),onChange:state=>{
    if(view!=='practice')return;
    const active=['playing','paused'].includes(state.status);
    $('stop').disabled=!active;$('all-label').textContent=active?(state.status==='paused'?'이어서 듣기':'잠깐 멈춤'):'선택 문장 듣기';$('all-symbol').textContent=state.status==='playing'?'Ⅱ':'▶';
    $('play-status').textContent=active?(state.status==='paused'?'잠깐 멈췄어요':state.waiting?'따라 읽을 시간이에요':(practiceSentence+1)+'번 문장 · '+state.cycle+'회째'):'연습할 문장을 눌러주세요.';
    $('status-dot').classList.toggle('playing',state.status==='playing');
    [...$('practice-sentences').children].forEach((row,i)=>row.classList.toggle('active',active&&i===practiceSentence));
  }});
  function stop(){wordStudy.stop();practicePlayer.stop();bridge.stop();}
  function navigate(next){stop();wordStudy.close();view=next;menu.hidden=true;menuButton.setAttribute('aria-expanded','false');read.hidden=next!=='read';practice.hidden=next!=='practice';guide.hidden=next!=='guide';
    for(const b of menu.querySelectorAll('button')){if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
    if(next==='practice'){$('practice-toolbar').append(toolbar);renderPractice();practicePlayer.stop();}else {toolbarAnchor.after(toolbar);bridge.stop();}
    $('player-bar').hidden=next==='guide'||!records.length;
    window.scrollTo({top:0,behavior:'instant'});
  }
  function cancelJobs(){epoch++;for(const job of jobs.values())job.controller.abort();jobs.clear();partial?.abort();partial=null;finishConsent(false);}
  function setDocument(texts,provided,keepUndo=false){
    activeEditor=null;
    cancelJobs();practicePlayer.stop();if(sourceDialog.open)sourceDialog.close();if(splitDialog.open)splitDialog.close();
    clearSource();$('split-options').replaceChildren();
    const reusable=records.slice();records=provided||texts.map(text=>{const at=reusable.findIndex(r=>r.text===text);return at>=0?reusable.splice(at,1)[0]:D.fresh(text);});
    const ids=new Set(records.map(r=>r.id));translationCache=new Map([...translationCache].filter(([id])=>ids.has(id)));
    wordStudy.setDocument(records,translationCache.keys());
    for(const id of editDrafts.keys())if(!ids.has(id))editDrafts.delete(id);
    if(!keepUndo)undo=null;undoButton.hidden=!undo;practiceIndex=Math.min(practiceIndex,Math.max(0,records.length-1));practiceSentence=-1;
    [...$('paragraphs').querySelectorAll('.paragraph')].forEach((card,index)=>decorateCard(card,index));
    disclosure.hidden=!bridge.get().photo;renderPractice();$('player-bar').hidden=view==='guide'||!records.length;
  }
  function clearSource(){sourceIndex=-1;target=null;selection=null;viewport=null;drag=null;$('source-canvas').width=1;$('source-canvas').height=1;$('source-original').value='';$('rescan-text').value='';$('source-lines').replaceChildren();$('source-target').textContent='바꿀 글자를 먼저 선택해주세요.';$('rescan-status').textContent='';$('rescan-preview').hidden=true;}
  function reset(){cancelJobs();wordStudy.reset();records=[];undo=null;translationCache.clear();editDrafts.clear();activeEditor=null;practiceIndex=0;practiceSentence=-1;undoButton.hidden=true;
    if(sourceDialog.open)sourceDialog.close();if(splitDialog.open)splitDialog.close();clearSource();$('split-options').replaceChildren();practice.classList.remove('hide-original');$('practice-hide').setAttribute('aria-pressed','false');$('practice-hide').textContent='원문 가리기';$('practice-repeat').checked=true;$('practice-gap').value='2000';renderPractice();practicePlayer.stop();}
  function mutate(next,notes){undo={records,notes:bridge.get().annotations.map(n=>({...n}))};bridge.commit(next,notes,true);}
  function decorateCard(card,index){
    if(records[index].edited)card.querySelector('.paragraph-label').append(node('span','수정됨','edited-badge'));
    const actions=node('div',undefined,'paragraph-actions');
    const source=button('원본 확인',()=>openSource(index),'text-button');source.hidden=!bridge.get().photo?.reference;actions.append(source);
    if(bridge.get().language==='ja') {
      const toggle=button('한국어 뜻 보기',()=>translate(index,toggle,panel),'text-button');toggle.setAttribute('aria-expanded','false');toggle.id='translation-toggle-'+records[index].id;
      const panel=node('div',undefined,'translation-panel');panel.id='translation-'+records[index].id;panel.hidden=true;panel.lang='ko';panel.setAttribute('role','region');panel.setAttribute('aria-labelledby',toggle.id);toggle.setAttribute('aria-controls',panel.id);
      actions.append(toggle);card.append(panel);
    }
    const more=node('details',undefined,'paragraph-more'),summary=node('summary','⋯');summary.setAttribute('aria-label',(index+1)+'번 단락 정리');more.append(summary);
    const combine=button('아래 단락과 합치기',()=>{const next=records.slice();next.splice(index,2,D.merge(records[index],records[index+1],bridge.get().language));const notes=bridge.get().annotations.map(n=>({...n,before:n.before>index?n.before-1:n.before}));mutate(next,notes);});combine.disabled=index===records.length-1;
    const edit=button('글 수정',()=>{more.open=false;openInlineEditor(card,index);});
    const split=button('문장 경계에서 나누기',()=>openSplit(index));split.disabled=StudyCore.sentenceRanges(records[index].text,bridge.get().language).length<2;more.append(edit,combine,split);actions.append(more);card.append(actions);
  }
  function openInlineEditor(card,index){
    if(activeEditor?.card===card)return;
    activeEditor?.close(false);stop();
    const record=records[index],token=epoch,body=card.querySelector('.paragraph-text'),actions=card.querySelector('.paragraph-actions'),translation=card.querySelector('.translation-panel');
    const translationWasHidden=translation?.hidden;
    const editor=node('div',undefined,'inline-editor'),label=node('label','이 단락의 글 수정'),input=node('textarea'),tools=node('div',undefined,'inline-edit-tools'),status=node('p','','inline-edit-status');
    input.id='paragraph-edit-'+record.id;input.value=editDrafts.get(record.id)??record.text;input.lang=bridge.get().language;input.maxLength=30000;input.spellcheck=false;label.htmlFor=input.id;status.setAttribute('role','status');
    const current=()=>epoch===token&&records[index]===record&&card.isConnected;
    const close=discard=>{if(discard)editDrafts.delete(record.id);else editDrafts.set(record.id,input.value);editor.remove();body.hidden=false;actions.hidden=false;if(translation)translation.hidden=translationWasHidden;card.querySelectorAll('.paragraph-controls button').forEach(b=>b.disabled=!window.speechSynthesis);activeEditor=null;};
    const resize=()=>{input.style.height='auto';input.style.height=Math.max(120,input.scrollHeight+2)+'px';};
    input.addEventListener('input',()=>{editDrafts.set(record.id,input.value);resize();status.textContent='';});
    const image=sourceCanvas();
    if(image){const preview=node('div',undefined,'inline-source');preview.hidden=true;const canvas=node('canvas');canvas.setAttribute('aria-label','수정 중인 단락의 원본 사진');preview.append(canvas);editor.append(preview);
      const show=button('원본 보기',()=>{preview.hidden=!preview.hidden;show.textContent=preview.hidden?'원본 보기':'원본 접기';show.setAttribute('aria-expanded',String(!preview.hidden));if(!preview.hidden){const rect=D.bounds(record.regions,image.width,image.height),scale=Math.min(1,1200/rect.w,1600/rect.h);canvas.width=Math.max(1,Math.round(rect.w*scale));canvas.height=Math.max(1,Math.round(rect.h*scale));canvas.getContext('2d').drawImage(image,rect.x,rect.y,rect.w,rect.h,0,0,canvas.width,canvas.height);if(!record.regions.length&&!preview.querySelector('p'))preview.append(node('p','정확한 단락 위치를 찾지 못해 전체 사진을 보여드려요.','workspace-hint'));}},'text-button');show.setAttribute('aria-expanded','false');editor.append(show);
    }
    const save=button('저장',()=>{if(!current())return;try{const updated=D.edit(record,input.value);if(updated===record){close(true);return;}if(records.reduce((n,r)=>n+r.text.length,0)-record.text.length+updated.text.length>30000)throw new Error('전체 본문은 30,000자까지 사용할 수 있어요.');const next=records.slice();next[index]=updated;editDrafts.delete(record.id);mutate(next,bridge.get().annotations);bridge.toast('이 단락을 수정했어요. 직전 변경은 되돌릴 수 있어요.');const target=$('paragraphs').querySelectorAll('.paragraph')[index];target?.querySelector('.paragraph-more summary')?.focus({preventScroll:true});}catch(error){status.textContent=error.message;}},'primary');
    const cancel=button('취소',()=>{close(true);card.querySelector('.paragraph-more summary').focus({preventScroll:true});});
    const back=button('한 단계 되돌리기',()=>undoButton.click(),'text-button');back.disabled=!undo;
    tools.append(save,cancel,back);editor.append(label,input,status,tools,node('p','현재 화면에만 반영해요. 새로고침하면 사라집니다.','inline-edit-hint'));
    body.hidden=true;actions.hidden=true;if(translation)translation.hidden=true;
    card.querySelectorAll('.paragraph-controls button').forEach(b=>b.disabled=true);body.after(editor);activeEditor={card,close};resize();input.focus({preventScroll:true});
    input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel.click();}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();save.click();}});
  }
  async function translate(index,toggle,panel){
    const record=records[index];if(!record)return;
    if(!panel.hidden){panel.hidden=true;toggle.textContent='한국어 뜻 보기';toggle.setAttribute('aria-expanded','false');return;}
    panel.hidden=false;toggle.textContent='뜻 접기';toggle.setAttribute('aria-expanded','true');
    const cached=translationCache.get(record.id);if(cached){showTranslation(panel,cached);return;}
    if(jobs.has(record.id))return;
    const controller=new AbortController(),token=epoch;const current=()=>token===epoch&&records[index]===record&&!controller.signal.aborted;
    panel.textContent='한국어 뜻을 준비하고 있어요…';panel.setAttribute('aria-busy','true');jobs.set(record.id,{controller});
    try{const result=await translator.translate(record.text,controller.signal,message=>{if(current())panel.textContent=message;});if(!current())return;translationCache.set(record.id,result);showTranslation(panel,result);wordStudy.translated(record.id);}
    catch(error){if(!current())return;panel.replaceChildren(node('p',error.message||'인터넷 연결을 확인하고 다시 시도해주세요.'),button('다시 시도',()=>{panel.hidden=true;translate(index,toggle,panel);},'text-button'));}
    finally{if(current()){jobs.delete(record.id);panel.removeAttribute('aria-busy');}}
  }
  function showTranslation(panel,result){panel.replaceChildren(node('p',result.text),node('small','자동 번역 · '+result.provider+' · 문맥에 따라 틀릴 수 있어요.'));}
  function openSplit(index){stop();$('split-options').replaceChildren();const record=records[index],token=epoch;
    for(const sentence of StudyCore.sentenceRanges(record.text,bridge.get().language).slice(1))$('split-options').append(button(sentence.text||record.text.slice(sentence.start,sentence.end),()=>{if(epoch!==token)return;const next=records.slice();next.splice(index,1,D.slice(record,0,sentence.start),D.slice(record,sentence.start,record.text.length));const notes=bridge.get().annotations.map(n=>({...n,before:n.before>index?n.before+1:n.before}));mutate(next,notes);}));
    splitDialog.showModal();
  }
  function highlight(index,body){
    const record=records[index];if(!record?.uncertain.length)return;
    for(const sentence of body.querySelectorAll('.sentence')){
      let cursor=Number(sentence.dataset.start);
      for(const child of [...sentence.childNodes]){
        if(child.nodeType!==Node.TEXT_NODE&&child.classList.contains('lookup-word')){const a=Number(child.dataset.start),b=Number(child.dataset.end);cursor=b;if(record.uncertain.some(r=>r.start<b&&r.end>a)){child.classList.add('uncertain-ruby');child.title='인식 확인 필요 · 단어 창에서 사진 원본 확인';}continue;}
        const text=child.nodeType===Node.TEXT_NODE?child.textContent:[...child.childNodes].filter(c=>c.nodeName!=='RT').map(c=>c.textContent).join(''),start=cursor;cursor+=text.length;
        const overlaps=record.uncertain.filter(r=>r.start<cursor&&r.end>start);if(!overlaps.length)continue;
        if(child.nodeType!==Node.TEXT_NODE){child.classList.add('uncertain-ruby');child.title='인식 확인 필요 · 원본 확인';child.setAttribute('aria-label',text+' 원본 확인');const open=e=>{e.preventDefault();e.stopImmediatePropagation();openSource(index,overlaps[0]);};child.addEventListener('click',open,{capture:true});child.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open(e);},{capture:true});continue;}
        const fragment=document.createDocumentFragment();let local=0;
        for(const range of overlaps.sort((a,b)=>a.start-b.start)){const a=Math.max(local,range.start-start),b=Math.min(text.length,range.end-start);if(b<=a)continue;fragment.append(document.createTextNode(text.slice(local,a)));const mark=button(text.slice(a,b),()=>openSource(index,range),'uncertain');mark.setAttribute('aria-label',text.slice(a,b)+' 원본 확인');fragment.append(mark);local=b;}
        fragment.append(document.createTextNode(text.slice(local)));child.replaceWith(fragment);
      }
    }
  }
  function sourceCanvas(){return bridge.get().photo?.reference;}
  function openSource(index,range){
    const image=sourceCanvas();if(!image)return;stop();sourceIndex=index;sourceVersion=epoch;target=null;selection=null;$('rescan-preview').hidden=true;$('rescan-status').textContent='';$('source-original').value=records[index].text;$('source-original').lang=bridge.get().language;
    viewport=D.bounds(range?[range]:records[index].regions,image.width,image.height);
    $('source-hint').textContent=records[index].regions.length?'원본 사진과 비교해주세요. 옅은 표시가 없어도 틀린 글자가 있을 수 있어요.':'사진에서 정확한 단락 위치를 찾지 못했어요. 전체 사진에서 해당 부분을 골라주세요.';
    $('source-lines').replaceChildren();for(const [i,line]of records[index].regions.entries())$('source-lines').append(button((i+1)+'번째 줄',()=>{chooseTarget(line);selection=D.bounds([line],image.width,image.height,3);viewport=D.bounds([line],image.width,image.height,18);drawSource();},'text-button'));
    sourceDialog.showModal();drawSource();if(range){chooseTarget(range);selection=D.bounds([range],image.width,image.height);drawSource();}else updateTarget();
  }
  function chooseTarget(range){$('source-original').focus();$('source-original').setSelectionRange(range.start,range.end);target={start:range.start,end:range.end};$('rescan-preview').hidden=true;updateTarget();}
  function updateTarget(){const text=target?records[sourceIndex]?.text.slice(target.start,target.end):'';$('source-target').textContent=text?'바꿀 부분: '+text:'바꿀 글자를 먼저 선택해주세요.';$('rescan-region').disabled=!text||!selection||Boolean(partial);}
  $('source-original').addEventListener('select',()=>{const a=$('source-original').selectionStart,b=$('source-original').selectionEnd;if(b>a){target={start:a,end:b};$('rescan-preview').hidden=true;}else target=null;updateTarget();});
  function drawSource(){const source=sourceCanvas();if(!source||!viewport)return;const canvas=$('source-canvas'),scale=Math.min(1,1400/viewport.w,1800/viewport.h);canvas.width=Math.max(1,Math.round(viewport.w*scale));canvas.height=Math.max(1,Math.round(viewport.h*scale));const ctx=canvas.getContext('2d');ctx.drawImage(source,viewport.x,viewport.y,viewport.w,viewport.h,0,0,canvas.width,canvas.height);
    if(selection){ctx.fillStyle='#c4a12b30';ctx.strokeStyle='#9c7010';ctx.lineWidth=3;const x=(selection.x-viewport.x)*scale,y=(selection.y-viewport.y)*scale,w=selection.w*scale,h=selection.h*scale;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
    const s=selection||viewport;for(const [id,value]of [['x',s.x/source.width],['y',s.y/source.height],['w',s.w/source.width],['h',s.h/source.height]])$('region-'+id).value=Math.round(value*100);updateTarget();}
  const point=e=>{const rect=$('source-canvas').getBoundingClientRect();return {x:Math.max(viewport.x,Math.min(viewport.x+viewport.w,viewport.x+(e.clientX-rect.left)/rect.width*viewport.w)),y:Math.max(viewport.y,Math.min(viewport.y+viewport.h,viewport.y+(e.clientY-rect.top)/rect.height*viewport.h))};};
  $('source-canvas').addEventListener('pointerdown',e=>{if(partial)return;drag=point(e);$('source-canvas').setPointerCapture(e.pointerId);e.preventDefault();});
  $('source-canvas').addEventListener('pointermove',e=>{if(!drag)return;const p=point(e);selection={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.max(1,Math.abs(p.x-drag.x)),h:Math.max(1,Math.abs(p.y-drag.y))};$('rescan-preview').hidden=true;drawSource();});
  for(const event of ['pointerup','pointercancel'])$('source-canvas').addEventListener(event,()=>{drag=null;if(selection&&(selection.w<4||selection.h<4))selection=null;drawSource();});
  for(const id of ['x','y','w','h'])$('region-'+id).addEventListener('input',()=>{const s=sourceCanvas();if(!s)return;const x=Number($('region-x').value)/100*s.width,y=Number($('region-y').value)/100*s.height;selection={x,y,w:Math.max(1,Math.min(s.width-x,Number($('region-w').value)/100*s.width)),h:Math.max(1,Math.min(s.height-y,Number($('region-h').value)/100*s.height))};$('rescan-preview').hidden=true;drawSource();});
  $('source-full').onclick=()=>{const s=sourceCanvas();viewport={x:0,y:0,w:s.width,h:s.height};drawSource();};$('source-zoom').onclick=()=>{if(selection){viewport={...selection};drawSource();}};
  function closeSource(){partial?.abort();partial=null;sourceDialog.close();$('rescan-text').value='';$('rescan-preview').hidden=true;}
  $('source-close').onclick=closeSource;sourceDialog.addEventListener('cancel',e=>{e.preventDefault();closeSource();});
  $('rescan-region').onclick=async()=>{
    if(!target||!selection||partial)return;const controller=new AbortController();partial=controller;const token=epoch,index=sourceIndex,range={...target},box={...selection};const current=()=>epoch===token&&sourceDialog.open&&sourceIndex===index&&!controller.signal.aborted;
    $('rescan-preview').hidden=true;$('rescan-status').textContent='선택한 부분만 다시 읽고 있어요…';updateTarget();
    try{const result=await bridge.rescan(sourceCanvas(),box,controller.signal);if(!current())return;if(!target||target.start!==range.start||target.end!==range.end||JSON.stringify(selection)!==JSON.stringify(box)){$('rescan-status').textContent='선택 영역이 바뀌었어요. 새 범위로 다시 인식해주세요.';return;}$('rescan-text').value=result;$('rescan-preview').hidden=false;$('rescan-preview').dataset.start=range.start;$('rescan-preview').dataset.end=range.end;$('rescan-status').textContent='원문은 아직 그대로예요. 결과를 확인하고 반영해주세요.';}
    catch(error){if(current())$('rescan-status').textContent=error.message||'다시 인식하지 못했어요. 기존 글은 그대로예요.';}
    finally{if(partial===controller){partial=null;updateTarget();}}
  };
  $('rescan-apply').onclick=()=>{if(sourceVersion!==epoch||$('rescan-preview').hidden)return;const text=$('rescan-text').value.trim(),start=Number($('rescan-preview').dataset.start),end=Number($('rescan-preview').dataset.end);try{const next=records.slice();next[sourceIndex]=D.replace(records[sourceIndex],start,end,text);if(next.reduce((n,r)=>n+r.text.length,0)>30000)throw new Error('전체 본문은 30,000자까지 사용할 수 있어요.');mutate(next,bridge.get().annotations);bridge.toast('선택한 부분만 바꿨어요. 되돌리기도 가능해요.');}catch(error){$('rescan-status').textContent=error.message;}};
  function renderPractice(){
    const selector=$('practice-paragraph');selector.replaceChildren();records.forEach((r,i)=>{const o=node('option',(i+1)+'번 단락 · '+r.text.slice(0,24));o.value=i;selector.append(o);});selector.value=practiceIndex;selector.disabled=!records.length;$('practice-empty').hidden=Boolean(records.length);$('practice-options')?.toggleAttribute('hidden',!records.length);
    const list=$('practice-sentences');list.replaceChildren();const record=records[practiceIndex];if(!record)return;
    for(const [i,sentence]of StudyCore.sentenceRanges(record.text,bridge.get().language).entries()){
      const li=node('li',undefined,'paragraph practice-sentence'),play=button('▶ '+(i+1),()=>playSentence(i),'paragraph-play'),body=node('p',undefined,'paragraph-text practice-text');play.setAttribute('aria-label',(i+1)+'번 문장 듣기');body.lang=bridge.get().language;
      const source=$('paragraphs').querySelectorAll('.paragraph-text')[practiceIndex]?.querySelectorAll('.sentence')[i];
      if(source){const copy=source.cloneNode(true);copy.querySelectorAll('button').forEach(b=>b.replaceWith(document.createTextNode(b.textContent)));copy.querySelectorAll('[role],[tabindex]').forEach(r=>{r.removeAttribute('role');r.removeAttribute('tabindex');r.removeAttribute('aria-label');});copy.querySelectorAll('.lookup-word').forEach(r=>r.classList.remove('lookup-word'));body.append(copy);}else body.textContent=record.text.slice(sentence.start,sentence.end);
      li.append(play,body);li.addEventListener('click',e=>{if(!e.target.closest('button'))playSentence(i);});list.append(li);
      if(['playing','paused'].includes(practicePlayer.getState().status)&&i===practiceSentence)li.classList.add('active');
    }
  }
  function playSentence(index){const record=records[practiceIndex];if(!record)return;const sentences=StudyCore.sentenceRanges(record.text,bridge.get().language);if(!sentences[index])return;bridge.stop();practiceSentence=index;const sentence=sentences[index];practicePlayer.play([record.text.slice(sentence.start,sentence.end)],0,'paragraph',bridge.get().language,{repeat:$('practice-repeat').checked,repeatDelay:Number($('practice-gap').value)});}
  $('practice-paragraph').onchange=()=>{practicePlayer.stop();practiceIndex=Number($('practice-paragraph').value);practiceSentence=-1;renderPractice();};
  $('practice-repeat').onchange=()=>practicePlayer.setRepeat($('practice-repeat').checked);
  $('practice-gap').onchange=()=>{practicePlayer.stop();bridge.toast('다음 재생부터 선택한 쉬는 시간을 적용해요.');};
  $('practice-hide').onclick=()=>{const hidden=practice.classList.toggle('hide-original');$('practice-hide').setAttribute('aria-pressed',String(hidden));$('practice-hide').textContent=hidden?'원문 보이기':'원문 가리기';};
  return {setDocument,reset,highlight,navigate,renderPractice,stop,view:()=>view,records:()=>records,words:wordStudy.words,openWord:wordStudy.open,wordData:wordStudy.inspect,changeWords:wordStudy.changeWords,
    playControl(){if(view!=='practice')return false;const state=practicePlayer.getState();if(state.status==='playing')practicePlayer.pause();else if(state.status==='paused')practicePlayer.resume();else playSentence(Math.max(0,practiceSentence));return true;},
    updateRate(){practicePlayer.updateRate();},stopPractice(){practicePlayer.stop();}};
}};

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V=require('../sorinote/vocabulary');
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
test('처음 24개만 표시해도 전체 복사는 나머지 뜻까지 준비하고 더 보기는 모두 펼친다',async()=>{
 const words=Array.from({length:30},(_,i)=>'単語'+i),text=words.join(' ');let requests=0;
 const h=harness({tokenize:async()=>[words.map(surface_form=>({surface_form,reading:'タンゴ',pos:'名詞'}))],translate:async()=>{requests++;return {text:'뜻',provider:'테스트'};}});
 h.app.setDocument([{id:1,text}],[1]);await flush();h.el('study-summary').open=true;h.el('study-summary').fire('toggle');await flush();
 assert.equal(requests,24);assert.doesNotMatch(h.el('study-entries').textContent,/単語29/);assert.equal(h.el('study-more').hidden,false);
 await h.el('study-copy').onclick();assert.equal(requests,30);assert.match(h.calls.copied,/単語29 : たんご \( 뜻 \)/);
 h.el('study-more').onclick();await flush();assert.match(h.el('study-entries').textContent,/単語29/);assert.equal(h.el('study-more').hidden,true);assert.equal(requests,30);
});
test('전체 복사 중 뜻 조회가 실패하면 일부만 전체인 것처럼 복사하지 않는다',async()=>{
 const h=harness({translate:async()=>{throw new Error('무료 한도 초과');}});h.app.setDocument([{id:1,text:'未知語'}],[1]);await flush();h.el('study-summary').open=true;
 await h.el('study-copy').onclick();assert.equal(h.calls.copied,'');assert.match(h.el('study-status').textContent,/한도/);
});
// Minimal DOM harness for async lifecycle checks; layout is tested in the browser.
test('단어 합치기와 나누기는 선택 위치에만 적용하고 원문은 보존한다',async()=>{
 const token=s=>({surface_form:s,reading:s,pos:'名詞',basic_form:s});
 const h=harness({tokenize:async()=>[[token('経済'),token('発展'),token('経済'),token('発展')]]});
 const record={id:1,text:'経済発展経済発展'};h.app.setDocument([record],[]);await flush();
 h.app.changeWords(0,0,4,[token('経済発展')]);
 assert.deepEqual(h.app.words(0).map(w=>w.surface),['経済発展','経済','発展']);
 h.app.changeWords(0,0,4,[token('経済'),token('発展')]);
 assert.equal(h.app.words(0).length,4);assert.equal(record.text,'経済発展経済発展');
 assert.throws(()=>h.app.changeWords(0,0,2,[token('改変')]),/원문/);
});

function harness(options={}){
 const elements=new Map();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.hidden=false;this.open=false;this.events={};this.value='';this._text='';}
  set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set innerHTML(value){for(const match of value.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(match[1]);e.id=match[2];this.children.push(e);}}
  append(...items){this.children.push(...items);}after(){}before(){}replaceChildren(...items){this._text='';this.children=items;}
  setAttribute(){}addEventListener(type,fn){(this.events[type]||=[]).push(fn);}showModal(){this.open=true;}close(){this.open=false;}
  focus(){}select(){}fire(type){for(const fn of this.events[type]||[])fn({preventDefault(){},target:this});}
 }
 const el=id=>{if(!elements.has(id)){const e=new Element('div');e.id=id;}return elements.get(id);};el('rate').value='1';
 const calls={repaint:0,copied:''};const bridge={tokenize:async texts=>texts.map(text=>[{surface_form:text,reading:'トショカン',pos:'名詞'}]),repaint:()=>calls.repaint++,wordReading:()=>'',voiceFor:()=>null,stop(){},toast(){},language:()=> 'ja',hasPhoto:()=>false,translate:async()=>({text:'자동 뜻',provider:'테스트'}),openSource(){},...options};
 const document={getElementById:el,createElement:tag=>new Element(tag),createTextNode:text=>{const e=new Element('#text');e.textContent=text;return e;},body:new Element('body')};
 const context=vm.createContext({window:{},document,StudyVocabulary:V,AbortController,DOMException,navigator:{clipboard:{writeText:async text=>{calls.copied=text;}}}});
 vm.runInContext(fs.readFileSync(require.resolve('../sorinote/word-study.js'),'utf8'),context);
 return {app:context.window.StudyWords.create(bridge),el,calls};
}
test('사전 준비 중 새 본문으로 바꾸면 이전 단어 분석 결과가 화면을 덮지 않는다',async()=>{
 const first=deferred(),second=deferred();let i=0;const h=harness({tokenize:()=>[first,second][i++].promise});
 h.app.setDocument([{id:1,text:'古い本'}],[]);h.app.setDocument([{id:2,text:'図書館'}],[]);
 second.resolve([[{surface_form:'図書館',reading:'トショカン',pos:'名詞'}]]);await flush();first.resolve([[{surface_form:'古い本',reading:'フルイホン',pos:'名詞'}]]);await flush();
 assert.equal(h.app.words(0)[0].surface,'図書館');assert.equal(h.calls.repaint,1);
});
test('단어 창에서 다른 단어로 이동한 뒤 늦은 뜻은 무시한다',async()=>{
 const pending=deferred(),h=harness({translate:()=>pending.promise});
 h.app.open(0,{surface:'未知語',reading:'みちご'});h.app.open(0,{surface:'図書館',reading:'としょかん'});await flush();pending.resolve({text:'늦은 뜻',provider:'테스트'});await flush();
 assert.equal(h.el('word-title').textContent,'図書館');assert.equal(h.el('word-meaning').textContent,'도서관');
});
test('초기화는 열려 있는 창·정리·늦은 번역 결과를 비운다',async()=>{
 const pending=deferred(),h=harness({translate:()=>pending.promise});h.app.setDocument([{id:1,text:'未知語'}],[1]);await flush();
 h.app.open(0,{surface:'未知語',reading:'みちご'});h.app.reset();pending.resolve({text:'늦은 뜻',provider:'테스트'});await flush();
 assert.equal(h.el('word-sheet').open,false);assert.equal(h.el('word-title').textContent,'');assert.equal(h.el('word-meaning').textContent,'');assert.equal(h.el('study-summary').hidden,true);assert.equal(h.el('study-entries').textContent,'');assert.deepEqual(h.app.words(0),[]);
});
test('번역한 단락만 정리하고 문서 교체 후 이전 정리를 숨긴다',async()=>{
 const h=harness();h.app.setDocument([{id:1,text:'図書館'},{id:2,text:'学校'}],[]);await flush();assert.equal(h.el('study-summary').hidden,true);
 h.app.translated(1);assert.match(h.el('study-entries').textContent,/図書館/);assert.doesNotMatch(h.el('study-entries').textContent,/学校/);
 await h.el('study-copy').onclick();assert.equal(h.calls.copied,'한자 단어\n図書館 : としょかん ( 도서관 )');
 h.app.setDocument([{id:3,text:'学校'}],[]);await flush();assert.equal(h.el('study-summary').hidden,true);assert.doesNotMatch(h.el('study-entries').textContent,/図書館/);
});
test('단어 뜻 조회 실패를 재시도할 수 있으며 성공 후 같은 탭에서 재사용한다',async()=>{
 let calls=0;const h=harness({translate:async()=>{calls++;if(calls===1)throw new Error('무료 한도');return {text:'성공',provider:'테스트'};}}),word={surface:'未知語',reading:'みちご'};
 h.app.open(0,word);await flush();assert.equal(h.el('word-retry').hidden,false);assert.equal(h.el('word-meaning').textContent,'무료 한도');
 await h.el('word-retry').onclick();assert.equal(h.el('word-meaning').textContent,'성공');h.app.close();h.app.open(0,word);await flush();assert.equal(calls,2);
});

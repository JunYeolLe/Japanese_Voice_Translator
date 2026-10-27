const test = require('node:test');
const assert = require('node:assert/strict');
const {ocrPlan, rasterSize, splitParagraphs, paragraphsFromOCR, speechChunks, createPlayback} = require('../sorinote/core.js');

test('일본어는 읽기 방향에 맞는 정밀 모델을 쓰고 기존 모델 캐시와 분리한다', () => {
  assert.deepEqual(ocrPlan('ja','auto').langs,['jpn','jpn_vert']);
  assert.equal(ocrPlan('ja','horizontal').langs,'jpn');
  assert.equal(ocrPlan('ja','horizontal').verticalText,'0');
  assert.equal(ocrPlan('ja','vertical').langs,'jpn_vert');
  assert.match(ocrPlan('ja').options.langPath,/tessdata_best@[a-f0-9]{40}$/);
  assert.equal(ocrPlan('ja').options.gzip,false);
  assert.match(ocrPlan('ja').options.cachePath,/sorinote-best-/);
  assert.equal(ocrPlan('ko').langs,'kor');
  assert.deepEqual(ocrPlan('en').options,{});
});
test('사진을 확대하되 가로세로 비율과 휴대폰용 픽셀 예산을 지킨다', () => {
  const small=rasterSize(1500,650);
  assert.equal(small.contentWidth,3000);assert.equal(small.contentHeight,1300);
  for(const [width,height] of [[6000,4000],[1200,10000],[400,800],[1,1]]){
    const size=rasterSize(width,height);
    assert.ok(size.contentWidth*size.contentHeight<6010000);
    assert.ok(Math.max(size.contentWidth,size.contentHeight)<=3600);
    assert.ok(Math.abs(size.contentWidth/size.contentHeight-width/height)<.01);
    assert.ok(size.padding>=16);
  }
  assert.throws(()=>rasterSize(0,100));assert.throws(()=>rasterSize(Infinity,100));
});

test('문장이 아니라 빈 줄로 단락을 구분한다', () => {
  assert.deepEqual(splitParagraphs('一つ目です。次の文です。\n続きです。\n\n二つ目です。', 'ja'), ['一つ目です。次の文です。続きです。','二つ目です。']);
  assert.deepEqual(splitParagraphs('첫 단락입니다.\r\n이어서 읽습니다.\r\n  \r\n다음 단락입니다.', 'ko'), ['첫 단락입니다. 이어서 읽습니다.','다음 단락입니다.']);
  assert.deepEqual(splitParagraphs('Read this.\nRead more.\n\nNew paragraph.', 'en'), ['Read this. Read more.','New paragraph.']);
  assert.deepEqual(splitParagraphs(' \n \n ', 'ja'), []);
});
test('OCR의 구조화된 단락을 유지하고 일본어 글자 사이 공백을 정리한다', () => {
  const data = {text:'fallback',blocks:[{paragraphs:[{text:'日 本 語 を\n読みます。'},{lines:[{words:[{text:'次です。'}]}]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja'), ['日本語を読みます。','次です。']);
  assert.deepEqual(paragraphsFromOCR({text:'First line.\nSecond line.\n\nAnother paragraph.'},'en'), ['First line. Second line.','Another paragraph.']);
  assert.deepEqual(paragraphsFromOCR({text:'',blocks:null},'ko'), []);
});
test('긴 단락은 화면 단락을 쪼개지 않고 짧은 음성으로 나눈다', () => {
  const long = '文'.repeat(510)+'。';
  const chunks = speechChunks(long,'ja');
  assert.ok(chunks.every(text=>Array.from(text).length<=180)); assert.equal(chunks.join(''),long);
  assert.deepEqual(speechChunks('The number is 3.14. It is useful.','en'), ['The number is 3.14.','It is useful.']);
  const english = ('Practice makes progress. ').repeat(30).trim();
  assert.equal(speechChunks(english,'en').join(' '),english);
});
test('OCR에서 하나로 묶인 블록도 큰 줄 간격으로 단락을 복원한다', () => {
  const line = (text,y,x=50) => ({text,bbox:{x0:x,y0:y,x1:800,y1:y+40}});
  const data={blocks:[{paragraphs:[{lines:[line('一つ目です。',50,90),line('続きです。',115),line('二つ目です。',280,90),line('次の続きです。',345)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja'),['一つ目です。続きです。','二つ目です。次の続きです。']);
});
test('일반 줄 간격은 유지하고 문장 끝 다음 들여쓰기는 단락으로 나눈다', () => {
  const line = (text,y,x=50) => ({text,bbox:{x0:x,y0:y,x1:800,y1:y+40}});
  const data={blocks:[{paragraphs:[{lines:[line('First paragraph.',50),line('It continues.',110),line('Next paragraph.',170,100),line('More text.',230)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'en'),['First paragraph. It continues.','Next paragraph. More text.']);
});
test('OCR이 같은 단락을 여러 객체로 잘라도 같은 블록의 줄 간격으로 다시 연결한다', () => {
  const line = (text,y,x=50) => ({text,bbox:{x0:x,y0:y,x1:800,y1:y+40}});
  const data={blocks:[{paragraphs:[{lines:[line('最初です。',50,90)]},{lines:[line('続きです。',115)]},{lines:[line('次の段落です。',280,90),line('終わりです。',345)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja'),['最初です。続きです。','次の段落です。終わりです。']);
});
test('세로쓰기는 오른쪽 열부터 읽고 열 간격과 위쪽 들여쓰기로 단락을 나눈다', () => {
  const line=(text,x,y=50)=>({text,bbox:{x0:x,y0:y,x1:x+40,y1:700}});
  const data={blocks:[{paragraphs:[{lines:[line('続きです',300),line('最初です',370,90),line('終わりです',50),line('次の段落です',120,90)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja','vertical'),['最初です続きです','次の段落です終わりです']);
  assert.deepEqual(paragraphsFromOCR(data,'ja','auto'),['最初です続きです','次の段落です終わりです']);
});
test('마침표 인식이 빠졌어도 명확한 한 글자 들여쓰기는 단락으로 처리한다', () => {
  const line=(text,y,x=50)=>({text,bbox:{x0:x,y0:y,x1:800,y1:y+40}});
  const data={blocks:[{paragraphs:[{lines:[line('最初の段落',50),line('続きです',110),line('次の段落',170,90),line('続きです',230)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja'),['最初の段落続きです','次の段落続きです']);
});
test('실제 정밀 OCR 결과에서 가로쓰기·세로쓰기·혼합 지면의 원래 단락과 순서를 복원한다', () => {
  const horizontal=['毎日、日本語を勉強しています。短い文章を声に出して読みます。','今日は好きな本を読みました。新しい言葉を一つ覚えました。'];
  const vertical=['日本語の本を読んでいます毎日少しずつ勉強します','新しい言葉を覚えます声に出して何度も練習します'];
  assert.deepEqual(paragraphsFromOCR(require('./fixtures/horizontal.json'),'ja','auto'),horizontal);
  assert.deepEqual(paragraphsFromOCR(require('./fixtures/vertical.json'),'ja','auto'),vertical);
  assert.deepEqual(paragraphsFromOCR(require('./fixtures/mixed.json'),'ja','auto'),['日本語を声に出して読みましょう',...vertical]);
});
test('같은 OCR 블록 안에 가로 제목과 세로 본문이 섞여 있어도 따로 읽는다', () => {
  const line=(text,x,y,width,height)=>({text,bbox:{x0:x,y0:y,x1:x+width,y1:y+height}});
  const data={blocks:[{paragraphs:[{lines:[line('横書きの見出し',30,10,700,40),line('最初です',370,100,40,600),line('続きです',300,50,40,650),line('次の段落です',120,100,40,600),line('終わりです',50,50,40,650)]}]}]};
  assert.deepEqual(paragraphsFromOCR(data,'ja','auto'),['横書きの見出し','最初です続きです','次の段落です終わりです']);
});
function harness() {
  let scheduled = new Map(), nextId = 0, rate = 1;
  const spoken = [], events = [], errors = [];
  const synth = {paused:false,cancel(){},speak(u){spoken.push(u);},pause(){this.paused=true;},resume(){this.paused=false;}};
  const player = createPlayback({synth,makeUtterance:text=>({text}),getRate:()=>rate,onChange:state=>events.push(state),onError:error=>errors.push(error),schedule:fn=>{scheduled.set(++nextId,fn);return nextId;},unschedule:id=>scheduled.delete(id)});
  return {player,synth,spoken,events,errors,setRate(value){rate=value;},finish(){spoken.at(-1).onend();},tick(){const entries=[...scheduled.entries()];scheduled.clear();entries.forEach(([,fn])=>fn());}};
}
test('단락 듣기는 선택한 단락만 끝까지 읽고 다음 단락으로 넘어가지 않는다', () => {
  const h=harness(); h.player.play(['첫 번째입니다.','두 번째입니다. 다음 문장입니다.','세 번째입니다.'],1,'paragraph','ko');
  assert.equal(h.spoken[0].text,'두 번째입니다.'); h.finish(); h.tick();
  assert.equal(h.spoken[1].text,'다음 문장입니다.'); h.finish(); h.tick();
  assert.equal(h.player.getState().status,'finished'); assert.equal(h.spoken.length,2);
});
test('전체 듣기는 모든 단락을 순서대로 읽고 완료한다', () => {
  const h=harness(); h.player.play(['First.','Second.'],0,'all','en');
  h.finish(); h.tick(); assert.equal(h.spoken[1].text,'Second.');
  h.finish(); h.tick(); assert.equal(h.player.getState().status,'finished');
});
test('초기화 이후 도착한 이전 음성 이벤트가 재생을 되살리지 않는다', () => {
  const h=harness(); h.player.play(['이전 글입니다.','옛 다음 단락입니다.'],0,'all','ko'); const stale=h.spoken[0];
  h.player.stop(); stale.onend(); stale.onerror({error:'canceled'}); h.tick();
  assert.equal(h.spoken.length,1); assert.equal(h.player.getState().status,'idle'); assert.deepEqual(h.errors,[]);
});
test('새 사진의 글을 재생하면 이전 콜백은 새 글의 순서를 바꾸지 않는다', () => {
  const h=harness(); h.player.play(['이전 글입니다.'],0,'all','ko'); const stale=h.spoken[0];
  h.player.play(['새 사진입니다.','새 다음 단락입니다.'],0,'all','ko'); stale.onend(); h.tick();
  assert.equal(h.spoken.length,2); assert.equal(h.spoken[1].text,'새 사진입니다.');
  h.finish(); h.tick(); assert.equal(h.spoken[2].text,'새 다음 단락입니다.');
});
test('단락 사이 쉬는 중 일시정지해도 이어 듣기가 다음 단락을 재생한다', () => {
  const h=harness(); h.player.play(['一つです。','二つです。'],0,'all','ja'); h.finish(); h.player.pause(); h.tick();
  assert.equal(h.spoken.length,1); h.player.resume(); assert.equal(h.spoken[1].text,'二つです。');
});
test('음성 도중 일시정지 및 이어 듣기에서 중복 발화하지 않는다', () => {
  const h=harness(); h.player.play(['반갑습니다.'],0,'paragraph','ko'); h.player.pause(); assert.equal(h.synth.paused,true);
  h.player.resume(); assert.equal(h.synth.paused,false); assert.equal(h.spoken.length,1);
});
test('정지하면 예약된 다음 발화를 제거한다', () => {
  const h=harness(); h.player.play(['First.','Second.'],0,'all','en'); h.finish(); h.player.stop(); h.tick(); assert.equal(h.spoken.length,1);
});
test('음성 오류는 재생 상태를 정리하고 사용자에게 전달한다', () => {
  const h=harness(); h.player.play(['First.'],0,'all','en'); h.spoken[0].onerror({error:'voice-unavailable'});
  assert.equal(h.player.getState().status,'idle'); assert.deepEqual(h.errors,['voice-unavailable']);
});

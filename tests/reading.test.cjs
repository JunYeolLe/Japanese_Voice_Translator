const test=require('node:test'),assert=require('node:assert/strict');
const {cleanOCRLine,filterOCRData,documentFromOCR,sentenceRanges,readingUnits,createPlayback}=require('../sorinote/core');
const {hiragana,splitReading,rubySegments,plainCopy}=require('../sorinote/reading');
const {cleanRules,cleanLayout}=require('../sorinote/ocr-clean');
test('문항 번호만 제외하고 날짜·금액·소수·장음·밑줄 친 본문은 보존한다',()=>{
 for(const input of ['1. 日本語を読みます。','1 . 日本語を読みます。','①日本語を読みます。','② 日本語を読みます。','（12）日本語を読みます。'])assert.equal(cleanOCRLine(input,'ja'),'日本語を読みます。');
 for(const input of ['2026年10月27日です。','1.5リットルです。','1月は寒いです。','1000円です。','コーヒーを一つください。','㊊は休みです。','㊑会社です。'])assert.equal(cleanOCRLine(input,'ja'),input);
 assert.equal(cleanOCRLine('本文を②読みます。','ja'),'本文を読みます。');
 assert.equal(cleanOCRLine('＿＿＿\n本文です。','ja'),'本文です。');
});
test('가장자리의 독립 페이지 번호를 제외하고 본문의 수치는 보존한다',()=>{
 const line=(text,x,y,w=400,h=30)=>({text,bbox:{x0:x,y0:y,x1:x+w,y1:y+h},words:[]});
 const data={blocks:[{paragraphs:[{lines:[line('本文です。',50,50),line('2026年です。',50,100),line('42',250,800,30,15)]}]}]};
 assert.deepEqual(documentFromOCR(data,'ja').paragraphs,['本文です。2026年です。']);
});
test('후리가나는 합성 한자와 오쿠리가나를 나누되 원문을 바꾸지 않는다',()=>{
 assert.equal(hiragana('ジカン'),'じかん');
 assert.deepEqual(splitReading('時間','ジカン'),[{base:'時間',reading:'じかん'}]);
 assert.deepEqual(splitReading('取り扱う','トリアツカウ'),[{base:'取',reading:'と'},{base:'り',reading:''},{base:'扱',reading:'あつか'},{base:'う',reading:''}]);
 assert.deepEqual(splitReading('食べ物','タベモノ'),[{base:'食',reading:'た'},{base:'べ',reading:''},{base:'物',reading:'もの'}]);
 assert.deepEqual(splitReading('お金','オカネ'),[{base:'お',reading:''},{base:'金',reading:'かね'}]);
 assert.deepEqual(splitReading('かな','カナ'),[{base:'かな',reading:''}]);
 const text='時間を大切に。 1.5時間です。';
 const segments=rubySegments(text,[{surface_form:'時間',reading:'ジカン'},{surface_form:'を',reading:'ヲ'},{surface_form:'大切',reading:'タイセツ'},{surface_form:'に',reading:'ニ'},{surface_form:'。',reading:'。'}]);
 assert.equal(segments.map(segment=>segment.base).join(''),text);
 assert.equal(plainCopy([text,'次です。']),text+'\n\n次です。');
});
test('부분 한자의 후리가나 수정은 해당 부분에만 반영된다',()=>{
 const segments=rubySegments('食べ物',[{surface_form:'食べ物',reading:'タベモノ'}],{2:{base:'物',reading:'ぶつ'}});
 assert.equal(segments[0].reading,'た');assert.equal(segments[2].reading,'ぶつ');assert.equal(segments.map(p=>p.base).join(''),'食べ物');
});
test('문장 표시 범위는 음성 조각·반복 문장에서도 원문 위치를 유지한다',()=>{
 const text='同じです。同じです。続きです。',units=readingUnits(text,'ja');
 assert.equal(units.length,3);assert.equal(units[0].sentenceStart,0);assert.equal(units[1].sentenceStart,5);
 units.forEach(unit=>assert.equal(text.slice(unit.start,unit.end),unit.text));
 const long='漢'.repeat(400)+'。';const pieces=readingUnits(long,'ja');assert.ok(pieces.length>1);pieces.forEach(unit=>{assert.equal(unit.sentenceStart,0);assert.equal(unit.sentenceEnd,long.length);});
 assert.equal(sentenceRanges('One. Two.','en').map(p=>p.text).join(''),'One. Two.');
});
test('선택 단락 반복은 다음 단락으로 넘어가지 않으며 반복 끄기·정지가 예약을 취소한다',()=>{
 const spoken=[],scheduled=[];const synth={cancel(){},speak(u){spoken.push(u);},resume(){},pause(){}};
 const player=createPlayback({synth,makeUtterance:text=>({text}),schedule:fn=>{scheduled.push(fn);return scheduled.length;},unschedule:id=>{scheduled[id-1]=null;}});
 const tick=()=>{const f=scheduled.splice(0);f.forEach(fn=>fn&&fn());};
 player.play(['最初です。','次です。'],0,'paragraph','ja',{repeat:true});spoken.at(-1).onend();tick();assert.equal(spoken.at(-1).text,'最初です。');assert.equal(player.getState().cycle,2);
 spoken.at(-1).onend();player.setRepeat(false);tick();assert.equal(player.getState().status,'finished');assert.equal(spoken.length,2);
 player.play(['再開です。'],0,'paragraph','ja',{repeat:true});spoken.at(-1).onend();player.stop();tick();assert.equal(spoken.length,3);assert.equal(player.getState().status,'idle');
});
function raster(width,height){const data=new Uint8ClampedArray(width*height*4);data.fill(255);return {width,height,data};}
function fill(image,x,y,w,h){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const p=(yy*image.width+xx)*4;image.data[p]=image.data[p+1]=image.data[p+2]=0;}}
test('긴 밑줄을 지우되 짧은 一 획과 글자 세로 획을 보존한다',()=>{
 const image=raster(400,180);fill(image,30,30,24,2);fill(image,100,25,3,28);fill(image,30,100,250,2);
 const result=cleanRules(image);assert.ok(result.rules>0);
 assert.equal(image.data[(30*400+40)*4],0);assert.equal(image.data[(30*400+101)*4],0);assert.equal(image.data[(100*400+100)*4],255);
});
test('작은 후리가나 띠만 지우고 아래 본문 글자와 구두점은 보존한다',()=>{
 const image=raster(500,220);for(let i=0;i<10;i++){fill(image,30+i*35,80,20,30);fill(image,30+i*35,65,9,8);}fill(image,390,104,6,6);
 const bbox={x0:30,y0:80,x1:396,y1:110};const data={blocks:[{paragraphs:[{lines:[{text:'本文です。',bbox,words:[{text:'本文',bbox:{x0:30,y0:80,x1:80,y1:110}}]}]}]}]};
 const result=cleanLayout(image,data);assert.ok(result.ruby>0);assert.equal(image.data[(68*500+33)*4],255);assert.equal(image.data[(90*500+33)*4],0);assert.equal(image.data[(106*500+392)*4],0);
});
test('작은 원형 문항 표시 안의 숫자는 제외하되 빈 구두점 원은 보존한다',()=>{
 const image=raster(500,220);for(let i=0;i<10;i++)fill(image,60+i*35,80,20,30);
 const ring=(cx,cy,r)=>{for(let i=0;i<120;i++){const angle=i*Math.PI/60;fill(image,Math.round(cx+r*Math.cos(angle)),Math.round(cy+r*Math.sin(angle)),1,1);}};
 ring(38,100,8);fill(image,38,96,1,9);ring(45,114,3);
 const data={blocks:[{paragraphs:[{lines:[{text:'本文です。',bbox:{x0:60,y0:80,x1:400,y1:120},words:[{text:'本文',bbox:{x0:60,y0:80,x1:120,y1:110}}]}]}]}]};
 const result=cleanLayout(image,data);assert.equal(result.markers,1);assert.equal(image.data[(100*500+38)*4],255);assert.equal(image.data[(114*500+48)*4],0);assert.equal(image.data[(90*500+65)*4],0);
});
test('세로 본문 아래로 분리된 작은 구두점을 해당 열에 붙이고 독립 단락으로 읽지 않는다',()=>{
 const column={text:'日本語を読みます',bbox:{x0:300,y0:100,x1:330,y1:500},words:[]},dot={text:'o',bbox:{x0:302,y0:525,x1:310,y1:533},words:[]};
 const data={blocks:[{paragraphs:[{lines:[column]}]},{paragraphs:[{lines:[dot]}]}]};
 assert.deepEqual(documentFromOCR(data,'ja','vertical').paragraphs,['日本語を読みます。']);
});
test('작은 중앙 페이지 번호가 가나로 오인식돼도 본문 뒤의 넓은 여백으로 구분한다',()=>{
 const line=(text,x,y,w,h)=>({text,bbox:{x0:x,y0:y,x1:x+w,y1:y+h},words:[]});
 const data={pageWidth:600,pageHeight:900,blocks:[{paragraphs:[{lines:[line('これは本文です。',50,100,450,30),line('次の文章を読みます。',50,160,450,30),line('はは',290,840,25,14)]}]}]};
 assert.deepEqual(documentFromOCR(data,'ja').paragraphs,['これは本文です。次の文章を読みます。']);
});
test('실제로 인쇄 후리가나를 제거한 가로·세로 OCR 결과에서 본문과 단락을 보존한다',()=>{
 assert.deepEqual(documentFromOCR(require('./fixtures/printed-horizontal.json'),'ja').paragraphs,['時間は大切です。毎日、日本語を読みます。','漢字の読み方を声に出して練習します。','今日は本を読みました。','新しい言葉を一つ覚えました。']);
 assert.deepEqual(documentFromOCR(require('./fixtures/printed-vertical.json'),'ja').paragraphs,['時間を大切にします。毎日日本語を読みます。','新しい本を読みます。声に出して練習します。']);
 assert.deepEqual(documentFromOCR(require('./fixtures/printed-vertical2x.json'),'ja').paragraphs,['時間を大切にします。毎日日本語を読みます。','新しい本を読みます。声に出して練習します。']);
 for(const name of ['horizontal','vertical','mixed']){
  const data=require('./fixtures/'+name+'.json');assert.deepEqual(documentFromOCR(data,'ja').paragraphs,require('../sorinote/core').paragraphsFromOCR(data,'ja'));
 }
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createPlayback}=require('../sorinote/core');

function harness(){
  let now=0,nextId=0,rate=1;const tasks=new Map(),spoken=[],errors=[];
  const synth={paused:false,cancel(){},pause(){this.paused=true;},resume(){this.paused=false;},speak(u){spoken.push(u);}};
  const player=createPlayback({synth,makeUtterance:text=>({text}),getRate:()=>rate,onError:error=>errors.push(error),schedule:(fn,delay)=>{tasks.set(++nextId,{at:now+delay,fn});return nextId;},unschedule:id=>tasks.delete(id)});
  function advance(ms){
    const until=now+ms;
    while(true){
      const next=[...tasks].filter(([,task])=>task.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();
    }
    now=until;
  }
  return {player,synth,spoken,errors,advance,rateTo(value){rate=value;player.updateRate();}};
}

test('재생 중 속도 변경은 단락 처음 대신 현재 문장의 읽던 단어부터 이어간다',()=>{
  const h=harness();h.player.play(['First sentence. Today we read words slowly.'],0,'paragraph','en',{repeat:true});
  h.spoken[0].onend();h.advance(90);const old=h.spoken.at(-1),before=h.player.getState();
  old.onboundary({charIndex:9});h.rateTo(1.5);h.advance(210);
  assert.equal(h.spoken.at(-1).text,'read words slowly.');assert.equal(h.spoken.at(-1).rate,1.5);
  const after=h.player.getState();
  for(const key of ['paragraph','chunk','scope','repeat','cycle','rangeStart','rangeEnd'])assert.equal(after[key],before[key]);
  old.onend();old.onerror({error:'interrupted'});old.onboundary({charIndex:20});h.advance(1000);
  assert.equal(h.spoken.length,3);assert.equal(h.player.getState().status,'playing');assert.deepEqual(h.errors,[]);
});

test('여러 번 빠르게·느리게 바꿔도 새 음성의 상대 위치를 누적한다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'all','en');
  h.spoken.at(-1).onboundary({charIndex:9});h.rateTo(1.5);h.advance(210);
  h.spoken.at(-1).onboundary({charIndex:5});h.rateTo(.7);h.advance(210);
  assert.equal(h.spoken.at(-1).text,'words slowly.');assert.equal(h.spoken.at(-1).rate,.7);
  h.spoken.at(-1).onend();assert.equal(h.player.getState().status,'finished');
});

test('연속 드래그 중에도 최신 속도를 반영하고 잦은 입력을 한 번으로 묶는다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'all','en');
  h.spoken[0].onboundary({charIndex:9});
  for(let i=1;i<=10;i++){h.rateTo(1+i*.05);h.advance(45);}
  h.advance(60);assert.equal(h.spoken.length,2);assert.equal(h.spoken.at(-1).rate,1.5);
  h.advance(500);assert.equal(h.spoken.length,2);
});

test('일시정지 중 슬라이더를 움직여도 소리를 내지 않으며 이어 듣기에 새 속도를 쓴다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'paragraph','en');
  h.spoken[0].onboundary({charIndex:9});h.player.pause();h.rateTo(1.35);h.advance(1000);
  assert.equal(h.spoken.length,1);assert.equal(h.player.getState().status,'paused');
  h.player.resume();h.advance(60);assert.equal(h.spoken.at(-1).text,'read words slowly.');
  assert.equal(h.spoken.at(-1).rate,1.35);assert.equal(h.synth.paused,false);
});

test('문장 사이 속도 변경은 다음 문장부터 적용하고 앞 문장으로 돌아가지 않는다',()=>{
  const h=harness();h.player.play(['First. Second.','Third.'],0,'all','en');
  h.spoken[0].onend();h.rateTo(.8);h.advance(90);
  assert.equal(h.spoken.length,2);assert.equal(h.spoken.at(-1).text,'Second.');assert.equal(h.spoken.at(-1).rate,.8);
  h.spoken.at(-1).onend();h.advance(380);assert.equal(h.spoken.at(-1).text,'Third.');
});

test('위치 이벤트가 없는 음성은 현재 문장 조각만 다시 읽으며 아직 읽지 않은 글을 건너뛰지 않는다',()=>{
  const h=harness();h.player.play(['最初です。次の文章を読みます。'],0,'paragraph','ja');
  h.spoken[0].onend();h.advance(90);h.rateTo(1.2);h.advance(210);
  assert.equal(h.spoken.at(-1).text,'次の文章を読みます。');assert.equal(h.spoken.at(-1).rate,1.2);
});

test('속도 적용 대기 중 정지·새 재생은 이전 예약을 취소한다',()=>{
  const h=harness();h.player.play(['Old text.'],0,'all','en');h.rateTo(1.5);h.player.stop();h.advance(1000);
  assert.equal(h.spoken.length,1);assert.equal(h.player.getState().status,'idle');
  h.player.play(['New text.'],0,'all','en');h.rateTo(.8);h.player.play(['Fresh text.'],0,'all','en');h.advance(1000);
  assert.equal(h.spoken.length,3);assert.equal(h.spoken.at(-1).text,'Fresh text.');assert.equal(h.spoken.at(-1).rate,.8);
});

test('속도를 원래 값으로 되돌리면 불필요한 음성 취소가 없다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'all','en');
  h.rateTo(1.5);h.advance(50);h.rateTo(1);h.advance(1000);assert.equal(h.spoken.length,1);
});

test('속도 전환의 동기 취소 이벤트를 음성 실패로 오인하지 않는다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'all','en');
  const old=h.spoken[0];h.synth.cancel=()=>old.onerror({error:'interrupted'});
  h.rateTo(1.5);h.advance(210);assert.equal(h.player.getState().status,'playing');assert.deepEqual(h.errors,[]);
});

test('엔진이 음성을 정리하는 짧은 시간에 일시정지해도 새 속도의 이어 읽기를 보존한다',()=>{
  const h=harness();h.player.play(['Today we read words slowly.'],0,'all','en');
  h.spoken[0].onboundary({charIndex:9});h.rateTo(1.5);h.advance(150);h.player.pause();h.advance(1000);
  assert.equal(h.spoken.length,1);assert.equal(h.player.getState().status,'paused');
  h.rateTo(.8);h.player.resume();h.advance(1000);
  assert.equal(h.spoken.length,2);assert.equal(h.spoken.at(-1).text,'read words slowly.');assert.equal(h.spoken.at(-1).rate,.8);
});

test('네이티브 float 배속의 반올림 차이를 새로운 속도 변경으로 오인하지 않는다',()=>{
  const h=harness(),speak=h.synth.speak;h.synth.speak=u=>{u.rate=Math.fround(u.rate);speak(u);};
  h.rateTo(1.1);h.player.play(['Today we read words slowly.'],0,'all','en');
  h.player.pause();h.player.resume();h.advance(1000);assert.equal(h.spoken.length,1);
  h.rateTo(1.1);h.advance(1000);assert.equal(h.spoken.length,1);
});

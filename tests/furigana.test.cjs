const test=require('node:test'),assert=require('node:assert/strict');
const {createFuriganaController}=require('../sorinote/reading');
const fs=require('node:fs'),vm=require('node:vm');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tokens=[[{surface_form:'時間',reading:'ジカン'}]];

test('첫 클릭은 준비 중이며 사전 완료 뒤 추가 클릭 없이 후리가나를 표시한다',async()=>{
  const pending=deferred(),changes=[];let progress;
  const controller=createFuriganaController({load:(_items,report)=>{progress=report;return pending.promise;},onChange:state=>changes.push(state)});
  const job=controller.toggle(['時間']);
  assert.equal(controller.getState().status,'loading');
  assert.equal(controller.getState().visible,false);
  assert.equal(controller.getState().tokens,null);
  await Promise.resolve();progress('readings');
  assert.equal(controller.getState().stage,'readings');
  assert.equal(controller.getState().visible,false);
  pending.resolve(tokens);await job;
  assert.equal(controller.getState().status,'ready');
  assert.equal(controller.getState().visible,true);
  assert.deepEqual(controller.getState().tokens,tokens);
  assert.equal(changes.filter(state=>state.visible).length,1);
});

test('느린 첫 준비 중 여러 번 눌러도 같은 요청을 기다리고 켜진 상태로 완료한다',async()=>{
  const pending=deferred();let calls=0;
  const controller=createFuriganaController({load:()=>{calls++;return pending.promise;}});
  const first=controller.toggle(['時間']);
  assert.equal(controller.toggle(['時間']),first);
  await Promise.resolve();assert.equal(calls,1);
  pending.resolve(tokens);await first;
  assert.equal(controller.getState().visible,true);
  await controller.toggle(['時間']);assert.equal(controller.getState().visible,false);
  await controller.toggle(['時間']);assert.equal(controller.getState().visible,true);
  assert.equal(calls,1);
});

test('초기화 직후 늦게 도착한 진행 상황과 결과가 이전 본문을 되살리지 않는다',async()=>{
  const pending=deferred();let progress;
  const controller=createFuriganaController({load:(_items,report)=>{progress=report;return pending.promise;}});
  const first=controller.toggle(['時間']);await Promise.resolve();
  controller.reset();progress('readings');pending.resolve(tokens);await first;
  assert.deepEqual(controller.getState(),{status:'idle',visible:false,tokens:null,stage:'',error:''});
});

test('초기화 뒤 새 본문의 요청이 이전 요청의 완료나 오류에 덮이지 않는다',async()=>{
  for(const fail of [false,true]){
    const old=deferred(),fresh=deferred();let calls=0;
    const controller=createFuriganaController({load:()=>++calls===1?old.promise:fresh.promise});
    const first=controller.toggle(['時間']);await Promise.resolve();controller.reset();
    const second=controller.toggle(['本']);await Promise.resolve();
    const newTokens=[[{surface_form:'本',reading:'ホン'}]];
    fresh.resolve(newTokens);await second;
    if(fail)old.reject(new Error('old worker failed'));else old.resolve(tokens);
    await first;
    assert.equal(controller.getState().visible,true);
    assert.deepEqual(controller.getState().tokens,newTokens);
  }
});

test('클릭 직후 초기화한 경우 취소된 사전 작업을 시작하지 않는다',async()=>{
  let calls=0;
  const controller=createFuriganaController({load:()=>{calls++;return tokens;}});
  const job=controller.toggle(['時間']);controller.reset();await job;
  assert.equal(calls,0);assert.equal(controller.getState().status,'idle');
});

test('사전 실패를 켜짐으로 표시하지 않으며 다음 클릭은 새 요청으로 재시도한다',async()=>{
  let calls=0;
  const controller=createFuriganaController({load:()=>{if(++calls===1)throw new Error('사전 연결 오류');return tokens;}});
  await controller.toggle(['時間']);
  assert.equal(controller.getState().status,'error');
  assert.equal(controller.getState().visible,false);
  assert.equal(controller.getState().error,'사전 연결 오류');
  await controller.toggle(['時間']);
  assert.equal(calls,2);assert.equal(controller.getState().status,'ready');
  assert.equal(controller.getState().visible,true);
});

test('진행 알림이나 불완전한 결과를 후리가나 완료로 처리하지 않는다',async()=>{
  for(const invalid of [undefined,{status:'dictionary'},[],[null]]){
    const controller=createFuriganaController({load:()=>invalid});
    await controller.toggle(['時間']);
    assert.equal(controller.getState().status,'error');
    assert.equal(controller.getState().visible,false);
    assert.equal(controller.getState().tokens,null);
  }
});

function workerHarness(){
  const messages=[];let finish,builds=0;
  const context=vm.createContext({self:{postMessage:message=>messages.push(message)},importScripts(){},kuromoji:{builder:()=>({build:callback=>{builds++;finish=callback;}})}});
  vm.runInContext(fs.readFileSync(require.resolve('../sorinote/furigana-worker.js'),'utf8'),context);
  return {messages,send:data=>context.self.onmessage({data}),finish:(error,value)=>finish(error,value),builds:()=>builds};
}

test('Worker 진행 알림은 결과보다 먼저 오며 이전 버전의 요청에는 결과만 응답한다',async()=>{
  const worker=workerHarness();
  const first=worker.send({id:1,paragraphs:['時間'],progress:true});
  assert.equal(worker.messages.length,1);assert.equal(worker.messages[0].status,'dictionary');
  assert.equal(worker.messages[0].tokens,undefined);
  worker.finish(null,{tokenize:text=>[{surface_form:text,reading:'ジカン'}]});await first;
  assert.equal(worker.messages[1].status,'readings');
  assert.equal(worker.messages[2].tokens[0][0].reading,'ジカン');
  worker.messages.length=0;
  await worker.send({id:2,paragraphs:['時間']});
  assert.equal(worker.messages.length,1);assert.equal(worker.messages[0].id,2);
  assert.equal(worker.messages[0].tokens[0][0].surface_form,'時間');
  assert.equal(worker.builds(),1);
});

test('Worker의 첫 사전 준비가 실패해도 다음 요청에서 다시 준비한다',async()=>{
  const worker=workerHarness(),first=worker.send({id:1,paragraphs:['時間'],progress:true});
  worker.finish(new Error('connection failed'));await first;
  assert.ok(worker.messages.at(-1).error);
  const second=worker.send({id:2,paragraphs:['時間'],progress:true});
  worker.finish(null,{tokenize:text=>[{surface_form:text,reading:'ジカン'}]});await second;
  assert.equal(worker.builds(),2);assert.equal(worker.messages.at(-1).id,2);
  assert.equal(worker.messages.at(-1).tokens[0][0].reading,'ジカン');
});

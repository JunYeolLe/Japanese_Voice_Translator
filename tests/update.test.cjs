const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const U=require('../sorinote/update');
const flush=()=>new Promise(r=>setImmediate(r));
function harness(){
 let busy=false,sent=0,reloaded=0,rendered,timers=[];
 const app=U.create({busy:()=>busy,send:()=>sent++,reload:()=>reloaded++,render:s=>rendered=s,schedule:fn=>{timers.push(fn);return fn;},unschedule:fn=>timers=timers.filter(x=>x!==fn)});
 return {app,busy:v=>busy=v,tick:()=>{const t=timers;timers=[];t.forEach(fn=>fn());},get:()=>({sent,reloaded,rendered})};
}
test('업데이트 발견과 다른 탭의 전환만으로는 재생 중인 화면을 다시 열지 않는다',()=>{
 const h=harness();h.busy(true);h.app.offer({});h.app.changed();assert.equal(h.get().sent,0);assert.equal(h.get().reloaded,0);assert.equal(h.get().rendered.available,true);
});
test('적용을 눌러도 재생·일시정지·반복 대기 상태가 끝날 때까지 기다린다',async()=>{
 const h=harness();h.busy(true);h.app.offer({});h.app.apply();h.tick();await flush();
 assert.equal(h.get().sent,0);assert.equal(h.get().rendered.waiting,true);
 h.busy(false);h.tick();await flush();assert.equal(h.get().sent,1);assert.equal(h.get().reloaded,0);
 h.app.changed();h.app.changed();assert.equal(h.get().reloaded,1);
});
test('적용 예약을 취소하면 듣기가 끝나도 업데이트하지 않는다',async()=>{
 const h=harness();h.busy(true);h.app.offer({});h.app.apply();h.app.later();h.busy(false);h.tick();await flush();assert.equal(h.get().sent,0);assert.equal(h.get().reloaded,0);
});
test('활성화 직전에 새 재생이 시작돼도 끝나기 전에는 새로고침하지 않는다',async()=>{
 const h=harness();h.app.offer({});h.app.apply();h.app.apply();await flush();assert.equal(h.get().sent,1);
 h.busy(true);h.app.changed();assert.equal(h.get().reloaded,0);h.busy(false);h.tick();assert.equal(h.get().reloaded,1);
});
test('적용 실패는 재시도 안내로 끝나고 현재 화면을 유지한다',async()=>{
 let view,reloaded=0;
 const a=U.create({busy:()=>false,send:async()=>{throw Error('offline');},reload:()=>reloaded++,render:s=>view=s});
 a.offer({});a.apply();await flush();assert.equal(view.requested,false);assert.match(view.error,/연결/);assert.equal(reloaded,0);
});
test('앱을 모두 닫아 새 워커가 활성화돼도 적용 전에는 선택한 이전 화면 파일을 유지한다',async()=>{
 const scope='https://example.test/',events={},stores=new Map();let skipped=0;
 const key=x=>new URL(typeof x==='string'?x:x.url,scope).href;
 const caches={open:async name=>{
   if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);
   return {match:async r=>store.get(key(r))?.clone(),put:async(r,v)=>store.set(key(r),v.clone()),addAll:async()=>{}};
 },match:async r=>{for(const store of stores.values())if(store.has(key(r)))return store.get(key(r)).clone();},keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n)};
 await(await caches.open('sorinote-update-settings')).put(scope+'active-shell',new Response('sorinote-shell-15'));
 await(await caches.open('sorinote-shell-15')).put('./',new Response('old release'));
 await(await caches.open('sorinote-shell-16')).put('./',new Response('new release'));
 const context=vm.createContext({URL,Response,caches,location:{origin:scope.slice(0,-1)},fetch:()=>assert.fail('Cached shell should not use network'),self:{registration:{scope},addEventListener:(n,f)=>events[n]=f,clients:{claim:async()=>{},matchAll:async()=>[{},{}]},skipWaiting:async()=>skipped++}});
 vm.runInContext(fs.readFileSync(require.resolve('../sorinote/sw.js'),'utf8'),context);
 let task;events.activate({waitUntil:p=>task=p});await task;
 const navigate=async()=>{let response;events.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:p=>response=p});return(await response).text();};
 assert.equal(await navigate(),'old release');assert.equal(skipped,0);
 let reply;events.message({source:{},ports:[{postMessage:x=>reply=x}],data:{type:'APPLY_UPDATE'},waitUntil:p=>task=p});await task;
 assert.equal(reply.ok,true);assert.equal(skipped,1);assert.equal(await navigate(),'new release');
});

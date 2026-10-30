'use strict';
(()=>{
  if(!('serviceWorker'in navigator))return;
  const BUILD='sorinote-shell-16',sw=navigator.serviceWorker;
  const panel=document.createElement('aside');panel.id='update-notice';panel.hidden=true;panel.setAttribute('aria-label','소리노트 업데이트');
  panel.innerHTML='<strong>새 버전이 준비됐어요</strong><p id="update-message" role="status"></p><p class="update-note">적용하면 화면을 새로 열며 현재 사진·본문은 비워집니다.</p><div><button id="update-apply" class="primary" type="button">적용하기</button><button id="update-later" class="secondary" type="button">나중에</button></div>';
  document.body.append(panel);
  const $=id=>document.getElementById(id);
  const check=document.createElement('button');check.type='button';check.className='secondary';check.textContent='업데이트 확인';$('guide-view').append(check);
  const status=document.createElement('p');status.className='workspace-hint';status.setAttribute('role','status');check.after(status);
  let registration=null,checking=false,lastCheck=0;
  function message(worker,type){
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timeout=setTimeout(()=>{channel.port1.close();reject(new Error('timeout'));},12000);
      channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();e.data?.ok?resolve(e.data):reject(new Error('worker failed'));};
      try{worker.postMessage({type,build:BUILD},[channel.port2]);}catch(error){clearTimeout(timeout);channel.port1.close();reject(error);}
    });
  }
  const manager=SorinoteUpdate.create({
    busy:()=>Boolean(window.Sorinote?.isListening()||window.speechSynthesis?.speaking||window.speechSynthesis?.pending),
    send:async worker=>{await message(worker,'APPLY_UPDATE');if(worker.state==='activated')manager.changed();},
    reload:()=>location.reload(),
    render:s=>{
      panel.hidden=!s.available||s.snoozed;
      $('update-message').textContent=s.error||(s.waiting?'듣기가 끝나거나 정지하면 적용합니다. 일시정지·반복 듣기 중에는 기다려요.':s.sent?'새 버전을 적용하고 있어요…':'지금은 기존 버전으로 계속 사용할 수 있어요.');
      $('update-apply').disabled=s.requested||s.sent;
      $('update-apply').textContent=s.waiting?'듣기 종료 대기 중':s.sent?'적용 중…':'적용하기';
      $('update-later').disabled=s.sent;$('update-later').textContent=s.requested?'예약 취소':'나중에';
    }
  });
  $('update-apply').onclick=()=>manager.apply();$('update-later').onclick=()=>manager.later();
  sw.addEventListener('controllerchange',()=>{manager.changed();inspect();});
  async function inspect(){
    if(registration?.waiting){manager.offer(registration.waiting);return true;}
    if(sw.controller){
      try{const info=await message(sw.controller,'UPDATE_STATUS');if(info.build!==BUILD){manager.offer(sw.controller);return true;}}catch{}
    }
    return false;
  }
  function watch(worker){
    if(!worker)return;
    worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&sw.controller)manager.offer(registration.waiting||worker);
      if(worker.state==='redundant')status.textContent='새 버전 준비에 실패했어요. 나중에 다시 확인해주세요.';
    });
  }
  async function checkForUpdate(manual=false){
    if(!registration||checking)return;
    if(!manual&&Date.now()-lastCheck<60000)return;
    lastCheck=Date.now();checking=true;check.disabled=true;if(manual){manager.show();status.textContent='새 버전을 확인하고 있어요…';}
    try{
      await registration.update();const available=await inspect();
      if(manual)status.textContent=available?'새 버전 안내에서 적용하기를 눌러주세요.':registration.installing?'새 버전 파일을 준비하고 있어요. 준비되면 안내합니다.':'현재 최신 버전입니다.';
    }catch{if(manual)status.textContent='연결할 수 없어요. 현재 버전은 계속 사용할 수 있습니다.';}
    finally{checking=false;check.disabled=false;}
  }
  check.onclick=()=>checkForUpdate(true);
  sw.register('./sw.js',{updateViaCache:'none'}).then(async reg=>{
    registration=reg;reg.addEventListener('updatefound',()=>watch(reg.installing));watch(reg.installing);await inspect();checkForUpdate();
  }).catch(()=>{status.textContent='자동 업데이트를 준비하지 못했어요. 인터넷 연결 후 다시 열어주세요.';});
  window.addEventListener('online',()=>checkForUpdate());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForUpdate();});
  const interval=setInterval(()=>{if(!document.hidden)checkForUpdate();},5*60*1000);
  window.addEventListener('pagehide',()=>{clearInterval(interval);manager.dispose();});
})();

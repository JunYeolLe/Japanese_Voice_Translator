'use strict';
(function(root){
  function create({busy,send,reload,render,schedule=setTimeout,unschedule=clearTimeout}){
    let worker=null,requested=false,sent=false,activated=false,reloaded=false,timer=null,snoozed=false,error='';
    function notify(){render({available:!!worker,requested,sent,activated,snoozed,error,waiting:requested&&busy()});}
    function tick(){
      timer=null;if(!requested||reloaded)return;
      if(busy()){notify();timer=schedule(tick,250);return;}
      if(activated){reloaded=true;reload();return;}
      if(!sent){sent=true;notify();Promise.resolve().then(()=>send(worker)).catch(()=>{
        sent=false;requested=false;error='업데이트를 적용하지 못했어요. 연결을 확인하고 다시 눌러주세요.';notify();
      });}
    }
    return {
      offer(next){if(!next||next===worker)return;worker=next;snoozed=false;error='';notify();},
      apply(){if(!worker||sent)return;requested=true;snoozed=false;error='';tick();},
      later(){if(sent)return;requested=false;snoozed=true;if(timer)unschedule(timer);timer=null;notify();},
      show(){snoozed=false;notify();},
      changed(){if(!requested)return;activated=true;if(timer)unschedule(timer);tick();},
      dispose(){if(timer)unschedule(timer);requested=false;},
      state:()=>({requested,sent,activated,reloaded})
    };
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create};else root.SorinoteUpdate={create};
})(typeof globalThis!=='undefined'?globalThis:this);

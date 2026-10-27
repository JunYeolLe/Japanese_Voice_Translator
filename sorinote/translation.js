'use strict';
(function(root) {
  const bytes=text=>new TextEncoder().encode(text).length;
  function chunks(text,max=480) {
    const sentences=String(text).match(/[^。！？.!?\n]+[。！？.!?\n]*|[。！？.!?\n]+/gu)||[];
    const output=[];let current='';
    for(const sentence of sentences) {
      if(bytes(current+sentence)<=max){current+=sentence;continue;}
      if(current){output.push(current);current='';}
      for(const char of sentence){if(bytes(current+char)>max){output.push(current);current='';}current+=char;}
    }
    if(current)output.push(current);return output;
  }
  function create({fetcher=root.fetch?.bind(root),translatorAPI=root.Translator,consent,onStatus=()=>{},decode=text=>text}={}) {
    let native=null,nativeLoading=null,consented=false;
    function check(signal){if(signal?.aborted)throw new DOMException('취소됨','AbortError');}
    async function translate(text,signal,status=onStatus) {
      check(signal);
      if(translatorAPI){
        try {
          const availability=await translatorAPI.availability({sourceLanguage:'ja',targetLanguage:'ko'});check(signal);
          if(availability!=='unavailable') {
            status('기기 내 번역을 준비하고 있어요…');
            if(!native) {
              if(!nativeLoading)nativeLoading=translatorAPI.create({sourceLanguage:'ja',targetLanguage:'ko',monitor(m){m.addEventListener('downloadprogress',e=>{if(!signal?.aborted)status('기기 내 번역 모델 준비 · '+Math.round(e.loaded*100)+'%');});}}).then(value=>native=value).finally(()=>nativeLoading=null);
              await nativeLoading;
            }
            check(signal);const result=await native.translate(text);check(signal);
            if(result?.trim())return {text:result.trim(),provider:'기기 내 번역'};
          }
        }catch(error){check(signal);/* External fallback still requires explicit consent. */}
      }
      if(!consented){consented=Boolean(await consent?.(text,signal));check(signal);if(!consented)throw new Error('외부 전송을 취소했어요. 원문은 그대로 남아 있어요.');}
      const parts=chunks(text),results=[];
      for(let i=0;i<parts.length;i++) {
        check(signal);status('한국어 뜻을 가져오고 있어요 · '+(i+1)+' / '+parts.length);
        const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        const timeout=setTimeout(abort,25000);
        try {
          const url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',parts[i]);url.searchParams.set('langpair','ja|ko');
          const response=await fetcher(url.toString(),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
          check(signal);
          if(response.status===429)throw new Error('무료 번역 한도를 초과했어요. 나중에 다시 시도해주세요. 유료로 전환되지 않아요.');
          if(!response.ok)throw new Error('번역 서버에 연결하지 못했어요. 잠시 후 다시 눌러주세요.');
          const data=await response.json();check(signal);
          if(data.quotaFinished||Number(data.responseStatus)===429||/MYMEMORY WARNING|NEXT AVAILABLE IN|DAILY LIMIT/i.test(data.responseData?.translatedText||''))throw new Error('무료 번역 한도를 초과했어요. 나중에 다시 시도해주세요. 유료로 전환되지 않아요.');
          if(Number(data.responseStatus)!==200||!data.responseData?.translatedText?.trim())throw new Error('번역 결과를 받지 못했어요. 잠시 후 다시 시도해주세요.');
          results.push(decode(data.responseData.translatedText).trim());
        } catch(error){check(signal);if(error.name==='AbortError')throw new Error('번역 연결 시간이 초과됐어요. 다시 시도해주세요.');throw error;}
        finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
      }
      return {text:results.join(' '),provider:'MyMemory'};
    }
    return {translate};
  }
  const api={bytes,chunks,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyTranslation=api;
})(typeof globalThis!=='undefined'?globalThis:this);

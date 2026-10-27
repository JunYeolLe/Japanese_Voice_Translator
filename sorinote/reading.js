(function(root){
  'use strict';
  const hiragana=text=>String(text||'').replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
  const hasKanji=text=>/[\p{Script=Han}々〆]/u.test(text);
  function splitReading(base,reading){
    reading=hiragana(reading);
    if(!hasKanji(base)||!reading||reading==='*')return [{base,reading:''}];
    const parts=base.match(/[\p{Script=Han}々〆]+|[^\p{Script=Han}々〆]+/gu)||[base];
    function align(index,cursor){
      if(index===parts.length)return cursor===reading.length?[]:null;
      const part=parts[index];
      if(!hasKanji(part)){
        const kana=hiragana(part);
        if(!reading.startsWith(kana,cursor))return null;
        const rest=align(index+1,cursor+kana.length);
        return rest&&[{base:part,reading:''},...rest];
      }
      if(index===parts.length-1)return cursor<reading.length?[{base:part,reading:reading.slice(cursor)}]:null;
      const anchor=hiragana(parts[index+1]);let found=reading.indexOf(anchor,cursor+1);
      while(found>=0){const rest=align(index+1,found);if(rest)return [{base:part,reading:reading.slice(cursor,found)},...rest];found=reading.indexOf(anchor,found+1);}
      return null;
    }
    return align(0,0)||[{base,reading}];
  }
  function rubySegments(text,tokens=[],overrides={}){
    const segments=[];let cursor=0;
    const append=(base,reading,start)=>{const override=overrides[start];if(base)segments.push({base,reading:override&&override.base===base?hiragana(override.reading):reading,start,end:start+base.length});};
    for(const token of tokens){
      const base=token.surface_form||'',start=text.indexOf(base,cursor);
      if(!base||start<cursor)continue;
      if(start>cursor)append(text.slice(cursor,start),'',cursor);
      let offset=start;
      for(const part of splitReading(base,token.reading)){
        append(part.base,part.reading,offset);offset+=part.base.length;
      }
      cursor=start+base.length;
    }
    if(cursor<text.length)append(text.slice(cursor),'',cursor);
    return segments;
  }
  function plainCopy(paragraphs){return paragraphs.join('\n\n');}
  function createFuriganaController({load,onChange=()=>{}}){
    let generation=0,job=null;
    const empty=()=>({status:'idle',visible:false,tokens:null,stage:'',error:''});
    let state=empty();
    const snapshot=()=>({...state});
    const notify=()=>onChange(snapshot());
    function reset(){generation++;job=null;state=empty();notify();}
    function toggle(paragraphs){
      // A second activation while the dictionary is loading must not cancel
      // the first request or start another request for the same document.
      if(state.status==='loading')return job;
      if(state.tokens){state.visible=!state.visible;notify();return Promise.resolve(snapshot());}
      const token=++generation,items=paragraphs.slice();
      state={...empty(),status:'loading',stage:'dictionary'};notify();
      job=Promise.resolve().then(()=>{
        if(token!==generation)return null;
        return load(items,stage=>{
          if(token!==generation||state.status!=='loading')return;
          state.stage=stage;notify();
        });
      }).then(tokens=>{
        if(token!==generation)return snapshot();
        if(!Array.isArray(tokens)||tokens.length!==items.length||tokens.some(part=>!Array.isArray(part)))throw new Error('후리가나 결과를 받지 못했어요. 다시 시도해주세요.');
        state={status:'ready',visible:true,tokens,stage:'',error:''};notify();return snapshot();
      }).catch(error=>{
        if(token!==generation)return snapshot();
        state={...empty(),status:'error',error:error?.message||'후리가나를 준비하지 못했어요. 다시 시도해주세요.'};notify();return snapshot();
      }).finally(()=>{if(token===generation)job=null;});
      return job;
    }
    return {toggle,reset,getState:snapshot};
  }
  const api={hiragana,hasKanji,splitReading,rubySegments,plainCopy,createFuriganaController};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyReading=api;
})(typeof globalThis!=='undefined'?globalThis:this);

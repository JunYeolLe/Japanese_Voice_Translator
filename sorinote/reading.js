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
  const api={hiragana,hasKanji,splitReading,rubySegments,plainCopy};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyReading=api;
})(typeof globalThis!=='undefined'?globalThis:this);

'use strict';
(function(root) {
  let serial = 0;
  const fresh = text => ({id:++serial,text,regions:[],uncertain:[]});
  const canonical = text => String(text || '').replace(/\s/gu,'').replace(/[|｜]/g,'」');
  const validBox=box=>box&&['x0','y0','x1','y1'].every(k=>Number.isFinite(box[k]))&&box.x1>box.x0&&box.y1>box.y0;
  function indexMap(text) {
    const positions=[],chars=[];
    for(let i=0;i<text.length;i++) if(!/\s/u.test(text[i])) {positions.push(i);chars.push(text[i].replace(/[|｜]/g,'」'));}
    return {text:chars.join(''),positions};
  }
  // Match against the final, cleaned text. Unmatched lines are deliberately not
  // assigned a guessed rectangle: the source viewer then shows the whole page.
  function fromOCR(texts,data,core,lang) {
    const records=texts.map(fresh),maps=texts.map(indexMap);
    const lines=(core.filterOCRData(data,lang).blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    for(const line of lines) {
      if(!validBox(line.bbox))continue;
      const value=canonical(core.cleanOCRLine(line.text,lang));if(!value)continue;
      for(let i=0;i<records.length;i++) {
        const map=maps[i],record=records[i];let at=map.text.indexOf(value);
        while(at>=0 && record.regions.some(r=>map.positions[at]<r.end && map.positions[at+value.length-1]+1>r.start))at=map.text.indexOf(value,at+1);
        if(at<0)continue;
        const start=map.positions[at],end=map.positions[at+value.length-1]+1;
        const region={start,end,box:{...line.bbox}};record.regions.push(region);
        let cursor=at,covered=0;const matchedBoxes=[];
        for(const word of line.words||[]) {
          const wordText=canonical(word.text);if(!wordText)continue;
          const found=map.text.indexOf(wordText,cursor);
          if(found<cursor||found+wordText.length>at+value.length)continue;
          cursor=found+wordText.length;
          covered+=wordText.length;if(validBox(word.bbox))matchedBoxes.push(word.bbox);
          if(Number.isFinite(word.confidence)&&word.confidence<80)record.uncertain.push({start:map.positions[found],end:map.positions[cursor-1]+1,box:{...(word.bbox||line.bbox)}});
        }
        if(matchedBoxes.length&&covered>=value.length*.8)region.box={x0:Math.min(...matchedBoxes.map(b=>b.x0)),y0:Math.min(...matchedBoxes.map(b=>b.y0)),x1:Math.max(...matchedBoxes.map(b=>b.x1)),y1:Math.max(...matchedBoxes.map(b=>b.y1))};
        if(!record.uncertain.some(r=>r.start>=start&&r.end<=end)&&Number.isFinite(line.confidence)&&line.confidence<65)record.uncertain.push({start,end,box:{...line.bbox}});
        break;
      }
    }
    for(const record of records){record.regions.sort((a,b)=>a.start-b.start);record.uncertain.sort((a,b)=>a.start-b.start);}
    return records;
  }
  function slice(record,start,end) {
    const part=fresh(record.text.slice(start,end));
    for(const key of ['regions','uncertain'])part[key]=record[key].filter(r=>r.start<end&&r.end>start).map(r=>({...r,start:Math.max(r.start,start)-start,end:Math.min(r.end,end)-start}));
    return part;
  }
  function replace(record,start,end,text) {
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>record.text.length||!text.trim())throw new Error('바꿀 글자 범위와 새 글을 확인해주세요.');
    const next=fresh(record.text.slice(0,start)+text+record.text.slice(end)),delta=text.length-(end-start);
    for(const key of ['regions','uncertain'])next[key]=record[key].flatMap(r=>{
      if(r.end<=start)return [{...r}];
      if(r.start>=end)return [{...r,start:r.start+delta,end:r.end+delta}];
      if(key==='regions')return [{...r,start:Math.min(r.start,start),end:Math.max(start+text.length,r.end+delta)}];
      return [];
    });
    return next;
  }
  function merge(a,b,lang='ja') {
    const separator=lang==='ja'?'':' ',offset=a.text.length+separator.length,next=fresh(a.text+separator+b.text);
    for(const key of ['regions','uncertain'])next[key]=[...a[key],...b[key].map(r=>({...r,start:r.start+offset,end:r.end+offset}))];
    return next;
  }
  function bounds(regions,width,height,pad=16) {
    if(!regions.length)return {x:0,y:0,w:width,h:height};
    const boxes=regions.map(r=>r.box);
    const x=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.x0))-pad)),y=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.y0))-pad));
    return {x,y,w:Math.min(width,Math.ceil(Math.max(...boxes.map(b=>b.x1))+pad))-x,h:Math.min(height,Math.ceil(Math.max(...boxes.map(b=>b.y1))+pad))-y};
  }
  const api={fresh,fromOCR,slice,replace,merge,bounds};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyDocument=api;
})(typeof globalThis!=='undefined'?globalThis:this);

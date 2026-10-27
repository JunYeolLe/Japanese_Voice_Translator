(function(root){
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const median=values=>values.length?values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)]:0;
  function inkMask(image,threshold=180){
    const mask=new Uint8Array(image.width*image.height), pixels=image.data;
    for(let p=0;p<mask.length;p++)mask[p]=(pixels[p*4]*.299+pixels[p*4+1]*.587+pixels[p*4+2]*.114)<threshold?1:0;
    return mask;
  }
  function bands(values,threshold=2){
    const found=[];let start=-1,last=-1,weight=0;
    for(let i=0;i<=values.length+2;i++){
      if(i<values.length&&values[i]>=threshold){if(start<0)start=i;last=i;weight+=values[i];}
      else if(start>=0&&i-last>2){found.push({start,end:last+1,size:last+1-start,weight});start=-1;weight=0;}
    }
    return found;
  }
  function estimateHeight(mask,width,height){
    const rows=new Uint32Array(height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)rows[y]+=mask[y*width+x];
    const sizes=bands(rows,Math.max(3,width*.003)).filter(band=>band.size>=8&&band.size<Math.min(width,height)*.15);
    if(!sizes.length)return Math.max(14,Math.min(width,height)*.022);
    const byWeight=sizes.slice().sort((a,b)=>a.size-b.size),total=byWeight.reduce((sum,band)=>sum+band.weight,0);let sum=0;
    return byWeight.find(band=>(sum+=band.weight)>=total*.6)?.size||median(sizes.map(b=>b.size));
  }
  function erase(image,mask,box){
    const x0=clamp(Math.floor(box.x0),0,image.width),x1=clamp(Math.ceil(box.x1),0,image.width),y0=clamp(Math.floor(box.y0),0,image.height),y1=clamp(Math.ceil(box.y1),0,image.height);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=y*image.width+x;image.data[p*4]=image.data[p*4+1]=image.data[p*4+2]=image.data[p*4+3]=255;mask[p]=0;}
  }
  function cleanRules(image){
    const {width,height}=image,mask=inkMask(image),font=estimateHeight(mask,width,height);
    let strokes=0;const regions=[];const thickness=Math.max(2,Math.round(font*.12));
    // Long, thin straight strokes are rules. A single 一 or ー is much shorter.
    for(const vertical of [false,true]){
      const outer=vertical?width:height,inner=vertical?height:width,minLength=Math.max(40,font*1.9);
      const pixel=(a,b)=>vertical?b*width+a:a*width+b;
      for(let a=0;a<outer;a++){
        let start=-1,last=-1;
        const finish=()=>{
          if(start<0||last-start+1<minLength)return;
          let thin=0;
          for(let b=start;b<=last;b+=3){let n=1;for(let d=1;d<=thickness+1;d++){if(a-d>=0&&mask[pixel(a-d,b)])n++;else break;}for(let d=1;d<=thickness+1;d++){if(a+d<outer&&mask[pixel(a+d,b)])n++;else break;}if(n<=thickness)thin++;}
          if(thin<((last-start+1)/3)*.8)return;
          regions.push(vertical?{x0:a-1,x1:a+2,y0:start,y1:last+1,kind:'rule'}:{x0:start,x1:last+1,y0:a-1,y1:a+2,kind:'rule'});
          for(let b=start;b<=last;b++){
            let n=1;for(let d=1;d<=thickness+1;d++){if(a-d>=0&&mask[pixel(a-d,b)])n++;else break;}for(let d=1;d<=thickness+1;d++){if(a+d<outer&&mask[pixel(a+d,b)])n++;else break;}
            if(n<=thickness){const p=pixel(a,b);image.data[p*4]=image.data[p*4+1]=image.data[p*4+2]=255;mask[p]=0;}
          }
          strokes++;
        };
        for(let b=0;b<=inner;b++){
          if(b<inner&&mask[pixel(a,b)]){if(start<0)start=b;last=b;}
          else if(start>=0&&b-last>1){finish();start=-1;}
        }
      }
    }
    return {rules:strokes,regions};
  }
  function components(mask,width,height){
    const parent=[0],boxes=[null];let previous=new Int32Array(width),current=new Int32Array(width);
    const find=label=>{let root=label;while(parent[root]!==root)root=parent[root];while(parent[label]!==label){const next=parent[label];parent[label]=root;label=next;}return root;};
    const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return a;if(a>b)[a,b]=[b,a];parent[b]=a;const A=boxes[a],B=boxes[b];A.x0=Math.min(A.x0,B.x0);A.x1=Math.max(A.x1,B.x1);A.y0=Math.min(A.y0,B.y0);A.y1=Math.max(A.y1,B.y1);A.area+=B.area;return a;};
    for(let y=0;y<height;y++){
      current.fill(0);
      for(let x=0;x<width;x++)if(mask[y*width+x]){
        const left=x?current[x-1]:0,above=previous[x],diagonal=x?previous[x-1]:0,other=x+1<width?previous[x+1]:0;
        let label=left||above||diagonal||other;
        if(!label){label=parent.length;parent.push(label);boxes.push({x0:x,x1:x+1,y0:y,y1:y+1,area:0});}
        label=find(label);for(const neighbour of [left,above,diagonal,other])if(neighbour)label=union(label,neighbour);
        current[x]=label;const box=boxes[label];box.x0=Math.min(box.x0,x);box.x1=Math.max(box.x1,x+1);box.y1=y+1;box.area++;
      }
      [previous,current]=[current,previous];
    }
    return boxes.filter((box,index)=>box&&parent[index]===index);
  }
  function cleanLayout(image,data,layout='auto'){
    const {width,height}=image,mask=inkMask(image),lines=(data?.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(p=>p.lines||[])).filter(line=>line.bbox);
    const sizes=lines.flatMap(line=>(line.words||[]).filter(word=>word.bbox&&/\p{L}/u.test(word.text||'')).map(word=>(line.bbox.y1-line.bbox.y0)>(line.bbox.x1-line.bbox.x0)*2?word.bbox.x1-word.bbox.x0:word.bbox.y1-word.bbox.y0)).filter(size=>size>=8);
    const projectedFont=estimateHeight(mask,width,height);
    const wordFont=sizes.length?sizes.sort((a,b)=>a-b)[Math.floor(sizes.length*.65)]:projectedFont;
    const font=projectedFont>=wordFont*.55?Math.min(wordFont,projectedFont):wordFont;
    const regions=[],punctuation=[];let ruby=0,markers=0;
    const add=box=>{if(!regions.some(r=>Math.abs(r.x0-box.x0)<3&&Math.abs(r.y0-box.y0)<3&&Math.abs(r.x1-box.x1)<3&&Math.abs(r.y1-box.y1)<3)){regions.push(box);return true;}return false;};
    for(const line of lines){
      const b=line.bbox,w=b.x1-b.x0,h=b.y1-b.y0,vertical=layout==='vertical'||(layout==='auto'&&h>w*2);
      if(!vertical&&w<h*2)continue;if(vertical&&h<w*2)continue;
      const start=clamp(Math.floor((vertical?b.x0:b.y0)-font),0,vertical?width:height),end=clamp(Math.ceil((vertical?b.x1:b.y1)+font),0,vertical?width:height);
      const inlineStart=clamp(Math.floor(vertical?b.y0:b.x0),0,vertical?height:width),inlineEnd=clamp(Math.ceil(vertical?b.y1:b.x1),0,vertical?height:width);
      const projection=new Uint32Array(end-start);
      for(let cross=start;cross<end;cross++)for(let along=inlineStart;along<inlineEnd;along++)projection[cross-start]+=mask[vertical?along*width+cross:cross*width+along];
      const list=bands(projection,Math.max(2,(inlineEnd-inlineStart)*.004)).map(band=>({...band,start:band.start+start,end:band.end+start}));
      const body=list.filter(band=>band.size>font*.5&&band.size<font*1.5).sort((a,b)=>b.weight-a.weight)[0];
      if(!body)continue;
      for(const band of list){
        if(band.start<=start+2||band.end>=end-2)continue;
        const gap=vertical?band.start-body.end:body.start-band.end;
        if(gap<0||gap>body.size*.8||band.size<body.size*.2||band.size>body.size*.68)continue;
        const rect=vertical?{x0:band.start-1,x1:band.end+1,y0:inlineStart,y1:inlineEnd}:{x0:inlineStart,x1:inlineEnd,y0:band.start-1,y1:band.end+1};
        // Only small bands directly above/right of real body text are reading aids.
        if(add({...rect,kind:'ruby'}))ruby++;
      }
    }
    const markerMask=inkMask(image,220),parts=components(markerMask,width,height),darkParts=components(mask,width,height);
    const columns=lines.filter(line=>line.bbox.y1-line.bbox.y0>(line.bbox.x1-line.bbox.x0)*3);
    for(const box of parts){
      const w=box.x1-box.x0,h=box.y1-box.y0;
      if(w<font*.12||w>font*.48||h<font*.12||h>font*.48||w/h<.75||w/h>1.35||box.area/(w*h)>.8)continue;
      if(!columns.some(line=>{const b=line.bbox,size=b.x1-b.x0;return !/[。！？][」』]?\s*$/.test(line.text||'')&&box.x0>=b.x0-size*.4&&box.x1<=b.x1+size*.4&&box.y0>=b.y1+size*.1&&box.y0<=b.y1+size*2;}))continue;
      let ring=0;const cx=(box.x0+box.x1-1)/2,cy=(box.y0+box.y1-1)/2;
      for(let k=0;k<24;k++){const angle=k*Math.PI/12,x=Math.round(cx+Math.cos(angle)*(w-1)*.46),y=Math.round(cy+Math.sin(angle)*(h-1)*.46);let found=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height&&markerMask[(y+dy)*width+x+dx])found=true;if(found)ring++;}
      if(ring>=21)punctuation.push({...box});
    }
    for(const box of parts){
      const w=box.x1-box.x0,h=box.y1-box.y0;
      if(w<font*.38||w>font*.78||h<font*.38||h>font*.78||w/h<.78||w/h>1.28||box.area/(w*h)<.12||box.area/(w*h)>.72)continue;
      // A circled item has a separate digit inside a closed outer ring. This
      // rejects Japanese 。 and の, whose strokes must remain part of the body.
      if(!darkParts.some(inner=>inner.area>=3&&inner.x0>box.x0+w*.15&&inner.x1<box.x1-w*.15&&inner.y0>box.y0+h*.12&&inner.y1<box.y1-h*.12))continue;
      const near=lines.some(line=>{
        const b=line.bbox,vertical=(b.y1-b.y0)>(b.x1-b.x0)*2;
        return vertical?box.y0>=b.y0-font&&box.y1<=b.y1+font&&box.x0>=b.x0-font*.25&&box.x1<=b.x1+font*.8:box.x0>=b.x0-font&&box.x1<=b.x1+font&&box.y0>=b.y0+font*.1&&box.y1<=b.y1+font*.65;
      });
      if(!near)continue;
      const cx=(box.x0+box.x1-1)/2,cy=(box.y0+box.y1-1)/2;let ring=0;
      for(let k=0;k<24;k++){
        const angle=k*Math.PI/12,x=Math.round(cx+Math.cos(angle)*(w-1)*.46),y=Math.round(cy+Math.sin(angle)*(h-1)*.46);
        let found=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height&&markerMask[(y+dy)*width+x+dx])found=true;
        if(found)ring++;
      }
      if(ring>=21&&add({...box,x0:box.x0-1,x1:box.x1+1,y0:box.y0-1,y1:box.y1+1,kind:'marker'}))markers++;
    }
    for(const region of regions)erase(image,mask,region);
    return {ruby,markers,regions,punctuation};
  }
  function suppressRegions(data,regions){
    if(!regions.length)return data;
    const overlap=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0))/Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
    return {...data,blocks:(data.blocks||[]).map(block=>({...block,paragraphs:(block.paragraphs||[]).map(p=>({...p,text:'',lines:(p.lines||[]).map(line=>{
      if(regions.some(region=>line.bbox&&overlap(line.bbox,region)>.75))return null;
      const words=(line.words||[]).filter(word=>!regions.some(region=>word.bbox&&overlap(word.bbox,region)>.7));
      return words.length!==(line.words||[]).length?{...line,words,text:words.map(word=>word.text).join(' ')}:line;
    }).filter(Boolean)})).filter(p=>p.lines.length)})).filter(block=>block.paragraphs.length)};
  }
  function restoreVerticalPunctuation(data,boxes=[]){
    if(!boxes.length)return data;
    const overlap=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0))/Math.max(1,(a.x1-a.x0)*(a.y1-a.y0));
    const blocks=(data.blocks||[]).map(block=>({...block,paragraphs:(block.paragraphs||[]).map(p=>({...p,text:'',lines:(p.lines||[]).filter(line=>!line.bbox||!boxes.some(box=>overlap(line.bbox,box)>.55))})).filter(p=>p.lines.length)})).filter(b=>b.paragraphs.length);
    for(const bbox of boxes)blocks.push({bbox,paragraphs:[{lines:[{text:'。',bbox,words:[]}]}]});
    return {...data,blocks};
  }
  const api={inkMask,cleanRules,cleanLayout,suppressRegions,restoreVerticalPunctuation};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OCRClean=api;
})(typeof globalThis!=='undefined'?globalThis:this);

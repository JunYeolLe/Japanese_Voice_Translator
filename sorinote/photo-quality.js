'use strict';
(function(root){
  // Advisory image measurements only: no OCR, network requests or pixel removal.
  function assess({data,width,height}, originalWidth=width, originalHeight=height){
    const n=width*height, gray=new Uint8Array(n),hist=new Uint32Array(256);
    for(let i=0;i<n;i++){const j=i*4;gray[i]=Math.round(.299*data[j]+.587*data[j+1]+.114*data[j+2]);hist[gray[i]]++;}
    const percentile=p=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=n*p)return i;}return 255;};
    const light=percentile(.8),dark=percentile(.005),contrast=light-dark;
    let gradient=0,laplace=0,edges=0,edgeHits=0;const points=[];
    const threshold=Math.max(20,light-Math.max(35,contrast*.4));
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x,v=gray[i],gx=gray[i+1]-gray[i-1],gy=gray[i+width]-gray[i-width];
      gradient+=gx*gx+gy*gy;const l=4*v-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width];laplace+=l*l;
      if(v<threshold){edges++;if(x<3||y<3||x>width-4||y>height-4)edgeHits++;if((x+2*y)%3===0)points.push([x,y]);}
    }
    let angle=0,gain=1;
    // Both projection axes are evaluated so vertical type and printed ruby remain intact.
    if(points.length>80&&points.length<n/12){
      const size=Math.ceil(Math.hypot(width,height)*2)+4,offset=Math.ceil(size/2);
      const score=(degrees,vertical)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),bins=new Uint32Array(size);for(const [x,y]of points){const at=Math.round((vertical?x*c+y*s:y*c-x*s)/2)+offset;if(at>=0&&at<size)bins[at]++;}let total=0;for(const v of bins)total+=v*v;return total;};
      for(const vertical of [false,true]){const base=score(0,vertical);let best=base,bestAngle=0;for(let a=-12;a<=12;a++){if(a===0)continue;const value=score(a,vertical);if(value>best){best=value;bestAngle=a;}}if(best/Math.max(1,base)>gain){gain=best/Math.max(1,base);angle=bestAngle;}}
    }
    const issues=[];let severe=false;
    const add=(message,high=false)=>{issues.push(message);severe ||= high;};
    if(light<100)add('사진이 많이 어두워요. 밝은 곳에서 다시 찍어주세요.',true);
    else if(light<160)add('사진이 어두운 편이에요. 그림자를 줄여주세요.');
    if(Math.max(originalWidth,originalHeight)<600||Math.min(originalWidth,originalHeight)<200)add('사진 해상도가 낮아요. 글자를 더 크게 찍어주세요.',Math.max(originalWidth,originalHeight)<300);
    if(contrast<35)add('글자와 배경의 구분이 약해요. 빛 반사나 흐림을 확인해주세요.',contrast<15);
    const sharpness=laplace/Math.max(1,gradient),inkRatio=edges/Math.max(1,n);
    if(contrast>=35&&inkRatio>.003&&sharpness<.24)add('글자 가장자리가 흐려 보여요. 초점을 맞춰 다시 찍어주세요.',sharpness<.1);
    if(Math.abs(angle)>=3&&gain>1.25)add('사진이 기울어져 보여요. 책과 카메라를 평행하게 맞춰주세요.');
    if(edgeHits>Math.max(12,(width+height)*.018)&&inkRatio<.4)add('가장자리에 글자나 짙은 부분이 닿아 있어요. 잘린 글자가 없는지 확인해주세요.');
    return {level:severe?'retake':issues.length?'check':'good',label:severe?'다시 찍기 권장':issues.length?'확인이 필요함':'읽기 좋음',issues,metrics:{light,contrast,sharpness,angle,gain,inkRatio}};
  }
  function inspect(canvas){const probe=document.createElement('canvas'),scale=Math.min(1,1100/Math.max(canvas.width,canvas.height));probe.width=Math.max(1,Math.round(canvas.width*scale));probe.height=Math.max(1,Math.round(canvas.height*scale));const ctx=probe.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,probe.width,probe.height);return assess(ctx.getImageData(0,0,probe.width,probe.height),canvas.width,canvas.height);}
  const api={assess,inspect};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PhotoQuality=api;
})(typeof globalThis!=='undefined'?globalThis:this);

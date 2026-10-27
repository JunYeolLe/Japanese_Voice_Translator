'use strict';
importScripts('ocr-clean.js?v=5');
self.onmessage=event=>{
  const {id,stage,width,height,pixels,data,layout}=event.data;
  try{
    const image={width,height,data:new Uint8ClampedArray(pixels)};
    const stats=stage==='rules'?OCRClean.cleanRules(image):OCRClean.cleanLayout(image,data,layout);
    self.postMessage({id,stats,pixels:image.data.buffer},[image.data.buffer]);
  }catch{self.postMessage({id,error:'사진의 본문 영역을 분석하지 못했어요.'});}
};

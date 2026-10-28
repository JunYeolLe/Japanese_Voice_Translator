'use strict';
(function(root){
  async function recognize(task,worker,canvas,options,output){
    const check=()=>{if(task.cancelled||task.terminated)throw new DOMException('취소됨','AbortError');};
    check();
    // Tesseract converts a canvas asynchronously before posting to its worker.
    // Finish that conversion here so reset cannot terminate the worker mid-conversion.
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('사진을 준비하지 못했어요.')),'image/png'));
    check();const bytes=new Uint8Array(await blob.arrayBuffer());check();
    return worker.recognize(bytes,options,output);
  }
  const api={recognize};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyOCRInput=api;
})(typeof globalThis!=='undefined'?globalThis:this);

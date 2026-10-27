'use strict';
let tokenizerPromise=null;
function tokenizer(){
  if(!tokenizerPromise)tokenizerPromise=new Promise((resolve,reject)=>{
    importScripts('vendor/kuromoji.js');
    kuromoji.builder({dicPath:'vendor/dict/'}).build((error,value)=>error?reject(error):resolve(value));
  }).catch(error=>{tokenizerPromise=null;throw error;});
  return tokenizerPromise;
}
self.onmessage=async event=>{
  const {id,paragraphs}=event.data;
  try{
    const analyzer=await tokenizer();
    const tokens=paragraphs.map(text=>analyzer.tokenize(text).map(token=>({surface_form:token.surface_form,reading:token.reading||''})));
    self.postMessage({id,tokens});
  }catch{self.postMessage({id,error:'후리가나 사전을 준비하지 못했어요. 연결을 확인하고 다시 켜주세요.'});}
};

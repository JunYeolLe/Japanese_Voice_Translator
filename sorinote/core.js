(function(root){
  'use strict';
  const LANGUAGES={ja:{name:'일본어',native:'日本語',locale:'ja-JP',ocr:'jpn',sample:'毎日、少しずつ日本語を勉強しています。\n今日は好きな本を一ページ読みました。\n分からない言葉があっても、まずは声に出してみます。\n小さな練習を続けることが、明日の自信につながります。'},ko:{name:'한국어',native:'한국어',locale:'ko-KR',ocr:'kor',sample:'매일 조금씩 새로운 문장을 읽습니다.\n처음에는 낯설어도 여러 번 들으면 익숙해집니다.\n오늘 배운 한 문장을 소리 내어 따라 읽어 보세요.\n작은 반복이 쌓이면 어느새 자신감이 생깁니다.'},en:{name:'영어',native:'English',locale:'en-US',ocr:'eng',sample:'A little practice every day makes a difference.\nToday, I read one page of my favorite book.\nI listen to each sentence and say it out loud.\nLearning a language is a journey, and every small step counts.'}};
  function splitSentences(text,lang){
    const cleaned=String(text).replace(/\r\n?/g,'\n').trim();
    if(!cleaned)return [];
    const lines=cleaned.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    if(typeof Intl!=='undefined'&&Intl.Segmenter){const segmenter=new Intl.Segmenter(LANGUAGES[lang]?.locale||'en',{granularity:'sentence'});return lines.flatMap(line=>Array.from(segmenter.segment(line),s=>s.segment.trim()).filter(Boolean));}
    return lines.flatMap(line=>line.match(/[^。！？!?]+[。！？!?]+[」』”’"]*|[^。！？!?]+$/g)||[line]).map(s=>s.trim()).filter(Boolean);
  }
  function normalizeOCR(text,lang,join){
    let clean=String(text).replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
    if(lang==='ja')clean=clean.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々。、！？「」『』（）])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々。、！？「」『』（）])/gu,'$1');
    if(!join)return clean;
    return clean.split(/\n\s*\n/).map(p=>p.split('\n').map(l=>l.trim()).filter(Boolean).join(lang==='ja'?'':' ')).join('\n\n');
  }
  function validateBackup(data){
    if(!data||data.format!=='sorinote'||data.version!==1||!Array.isArray(data.notes)||data.notes.length>500)throw new Error('소리노트 백업 파일이 아니거나 지원하지 않는 형식입니다.');
    const ids=new Set();
    return data.notes.map(n=>{
      if(!n||typeof n.id!=='string'||n.id.length>100||!n.id||ids.has(n.id)||!Object.hasOwn(LANGUAGES,n.lang)||typeof n.text!=='string'||!n.text.trim()||n.text.length>30000||typeof n.title!=='string'||n.title.length>100)throw new Error('백업에 올바르지 않은 학습 자료가 있습니다.');
      ids.add(n.id);
      if(n.image!=null&&(typeof n.image!=='string'||n.image.length>8000000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(n.image)))throw new Error('백업의 사진 형식이 올바르지 않습니다.');
      const sentences=splitSentences(n.text,n.lang);
      return {id:n.id,title:n.title,lang:n.lang,text:n.text,image:n.image||null,createdAt:Number.isFinite(n.createdAt)?n.createdAt:Date.now(),updatedAt:Number.isFinite(n.updatedAt)?n.updatedAt:Date.now(),cursor:Math.max(0,Math.min(Number.isInteger(n.cursor)?n.cursor:0,sentences.length-1))};
    });
  }
  const api={LANGUAGES,splitSentences,normalizeOCR,validateBackup};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);

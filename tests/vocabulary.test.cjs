const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../sorinote/vocabulary'),T=require('../sorinote/translation');
const t=(surface,reading,pos='名詞',detail='一般',base=surface)=>({surface_form:surface,reading,pos,pos_detail_1:detail,basic_form:base});
test('띄어쓰기 없는 본문에서 図書館 전체와 반복 등장 위치를 보존한다',()=>{
  const text=' 図書館で図書館の本。',tokens=[t('図書館','トショカン'),t('で','デ','助詞'),t('図書館','トショカン'),t('の','ノ','助詞'),t('本','ホン'),t('。','。','記号')];
  const words=V.words(text,tokens);assert.equal(words.map(w=>w.surface).join(''),text);
  const libraries=words.filter(w=>w.surface==='図書館');assert.deepEqual(libraries.map(w=>w.start),[1,5]);assert.equal(libraries[0].reading,'としょかん');assert.equal(V.lookup('図書館'),'도서관');
});
test('동사의 활용과 する 동사를 함께 선택하고 기본형은 별도로 보존한다',()=>{
  const tokens=[t('勉強','ベンキョウ','名詞','サ変接続'),t('し','シ','動詞','自立','する'),t('ます','マス','助動詞'),t('。','。','記号'),t('読み','ヨミ','動詞','自立','読む'),t('まし','マシ','助動詞'),t('た','タ','助動詞')];
  const words=V.words('勉強します。読みました',tokens);assert.deepEqual(words.map(w=>w.surface),['勉強します','。','読みました']);assert.equal(words[0].base,'勉強する');assert.equal(words[0].reading,'べんきょうします');assert.equal(words[2].base,'読む');assert.equal(words[2].reading,'よみました');
});
test('문법은 として와 について의 뜻을 구분한다',()=>{
  const text='学生として環境について考えます。',tokens=[t('学生','ガクセイ'),t('として','トシテ','助詞'),t('環境','カンキョウ'),t('について','ニツイテ','助詞'),t('考え','カンガエ','動詞','自立','考える'),t('ます','マス','助動詞'),t('。','。','記号')];
  const grammar=V.grammarIn(text,tokens);assert.deepEqual(grammar.map(g=>g.surface),['～として','～について']);assert.match(grammar[0].meaning,/로서/);assert.equal(grammar[1].meaning,'～에 대해서');assert.equal(V.lookup('として'),grammar[0].meaning);
});
test('落としています 속 부분 글자를 として 문법으로 잘못 뽑지 않는다',()=>{
  const tokens=[t('落とし','オトシ','動詞'),t('て','テ','助詞'),t('い','イ','動詞'),t('ます','マス','助動詞')];
  assert.deepEqual(V.grammarIn('落としています',tokens),[]);
});
test('긴 문법을 우선하여 짧은 중복 표현을 다시 정리하지 않는다',()=>{
  const tokens=[t('学生','ガクセイ'),t('だけ','ダケ','助詞'),t('で','デ','助詞'),t('なく','ナク','助動詞')];
  assert.deepEqual(V.grammarIn('学生だけでなく',tokens).map(g=>g.surface),['～だけでなく']);
});
test('요약은 중복 단어를 합치고 고유명사·숫자를 제외하며 주요 개수만 제한한다',()=>{
  const doc={text:'図書館学校図書館東京三',tokens:[t('図書館','トショカン'),t('学校','ガッコウ'),t('図書館','トショカン'),t('東京','トウキョウ','名詞','固有名詞'),t('三','サン','名詞','数')]};
  const result=V.collect([doc],1);assert.equal(result.total,2);assert.equal(result.words.length,1);assert.equal(result.words[0].surface,'図書館');assert.equal(result.words[0].count,2);
});
test('사전에 없는 표기·공백·기호를 없애거나 단어로 추측하지 않는다',()=>{
  const text='未知🙂 123',words=V.words(text,[]);assert.equal(words.map(w=>w.surface).join(''),text);assert.equal(words[0].selectable,false);assert.equal(V.lookup('未知の造語'),'');
});
test('정리 복사는 요청한 형식을 사용하며 준비되지 않은 뜻은 제외한다',()=>{
  assert.equal(V.format([{surface:'図書館',reading:'としょかん',meaning:'도서관'},{surface:'～として',reading:'～として',meaning:'～로서'},{surface:'未確認',reading:'みかくにん',meaning:''}]),'図書館 : としょかん ( 도서관 )\n～として : ～として ( ～로서 )');
});
test('동시에 단락과 단어를 조회해도 외부 번역 안내를 덮어쓰지 않는다',async()=>{
  let accept,calls=0,requests=0;const translator=T.create({translatorAPI:null,consent:()=>{calls++;return new Promise(r=>accept=r);},fetcher:async()=>{requests++;return {ok:true,status:200,json:async()=>({responseStatus:200,responseData:{translatedText:'뜻'}})};}});
  const a=translator.translate('勉強します。'),b=translator.translate('勉強');assert.equal(calls,1);assert.equal(requests,0);accept(true);await Promise.all([a,b]);assert.equal(requests,2);
});
test('동의 대기 중 취소된 단어는 동의 후에도 외부로 보내지 않는다',async()=>{
  let accept,sent=0;const abort=new AbortController(),translator=T.create({translatorAPI:null,consent:()=>new Promise(r=>accept=r),fetcher:async()=>{sent++;}});
  const result=translator.translate('昔の単語',abort.signal);abort.abort();accept(true);await assert.rejects(result,{name:'AbortError'});assert.equal(sent,0);
});

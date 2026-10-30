const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../sorinote');
test('공개 사전은 품사별로 조회하며 기본형의 한국어 뜻을 기기에서 제공한다',()=>{
 const context=vm.createContext({});context.window=context;
 for(const file of ['basic-dictionary.js','dictionary-data.js','vocabulary.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 assert.equal(Object.keys(context.OpenDictionary).length,7243);
 assert.equal(context.StudyVocabulary.local({surface:'読みました',base:'読む',pos:'動詞'}).text,'읽다');
 const known=context.StudyVocabulary.local({surface:'冷蔵庫',base:'冷蔵庫',pos:'名詞'});
 assert.equal(known.provider,'위키낱말사전');assert.match(known.text,/냉장고/);
 assert.equal(context.StudyVocabulary.local({surface:'冷蔵庫',base:'冷蔵庫',pos:'動詞'}),null);
});
test('설치 캐시에는 존재하는 앱 자산만 넣고 사진과 외부 요청은 캐시하지 않는다',async()=>{
 const events={},cached=[];const context=vm.createContext({URL,location:{origin:'https://example.test'},self:{registration:{scope:'https://example.test/'},addEventListener:(name,fn)=>events[name]=fn},caches:{open:async()=>({addAll:async files=>cached.push(...files)})}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
 let install;events.install({waitUntil:p=>install=p});await install;
 for(const file of cached)assert.ok(fs.existsSync(path.join(root,file==='./'?'index.html':file.split('?')[0])),file);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)\?v=\d+)"/g))assert.ok(cached.includes(match[1]),match[1]);
 for(const url of ['https://example.test/photo.jpg','https://api.mymemory.translated.net/get?q=private','blob:https://example.test/photo'])events.fetch({request:{method:'GET',url},respondWith:()=>assert.fail('Private/external request intercepted')});
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
 assert.equal(manifest.display,'standalone');for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(root,icon.src)));
});

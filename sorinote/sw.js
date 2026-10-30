const CACHE='sorinote-shell-17';
const FILES=['./','index.html','style.css?v=12','pro.css?v=14','modern.css?v=17','update.css?v=16','update.js?v=16','update-ui.js?v=17','core.js?v=17','reading.js?v=6','ocr-clean.js?v=5','ocr-input.js?v=10','photo-quality.js?v=10','study.js?v=10','translation.js?v=12','vocabulary.js?v=14','word-study.js?v=17','workspace.js?v=17','app.js?v=17','basic-dictionary.js?v=14','pro.js?v=17','dictionary-data.js?v=14','dictionary-license.html','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'];
const META='sorinote-update-settings',KEY=new URL('./active-shell',self.registration.scope).href;
const selected=async()=>{const r=await (await caches.open(META)).match(KEY);return r?await r.text():CACHE;};
const select=async name=>(await caches.open(META)).put(KEY,new Response(name));
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
// The chosen shell persists across app closure. A newly activated worker does
// not silently switch an existing installation to new application files.
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const meta=await caches.open(META);if(!await meta.match(KEY))await select(CACHE);
  await self.clients.claim();
})()));
self.addEventListener('message',e=>{
  if(!e.source||!e.ports?.[0])return;
  const reply=data=>e.ports[0].postMessage(data);
  if(e.data?.type==='UPDATE_STATUS'){
    reply({ok:true,build:CACHE});
    if(e.data.build===CACHE)e.waitUntil((async()=>{
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      if(clients.length===1&&await selected()===CACHE)for(const key of await caches.keys())if(key.startsWith('sorinote-shell-')&&key!==CACHE)await caches.delete(key);
    })());
    return;
  }
  if(e.data?.type!=='APPLY_UPDATE')return;
  e.waitUntil((async()=>{try{await select(CACHE);await self.skipWaiting();reply({ok:true});}catch{reply({ok:false});}})());
});
// Only public application assets are cached; never photos, text or translations.
// Cache-first pins the chosen release. Keep older shells for already-open tabs.
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const file=u.pathname.split('/').pop();
  if(!FILES.some(f=>f.split('?')[0]===file)&&file!=='')return;
  e.respondWith((async()=>{
    const name=await selected(),cache=await caches.open(name);
    const navigation=e.request.mode==='navigate'&&(file===''||file==='index.html');
    const cached=await cache.match(navigation?'./':e.request);
    if(cached)return cached;
    if(!navigation){const previous=await caches.match(e.request);if(previous)return previous;}
    return fetch(e.request);
  })());
});

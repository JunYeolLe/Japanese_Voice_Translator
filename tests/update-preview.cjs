// Local-only integration fixture: type "next" on stdin to publish a second release.
// Never served by Netlify. Playback is simulated through visible test controls.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../sorinote');const build=Number(fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/sorinote-shell-(\d+)/)[1]);let release=build;
process.stdin.on('data',chunk=>{if(chunk.toString().trim()==='next'){release=build+1;console.log('Fixture next release ready');}});
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
 const file=path.resolve(root,'.'+relative);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(error,data)=>{
  if(error){res.writeHead(404);res.end();return;}
  if(relative==='/sw.js'||relative==='/update-ui.js')data=Buffer.from(data.toString().replaceAll('sorinote-shell-'+build,'sorinote-shell-'+release));
  if(relative==='/index.html')data=Buffer.from(data.toString().replace('</body>',`<div style="position:fixed;bottom:0;left:0;z-index:100;background:white"><span id="test-release">테스트 버전 ${release}</span><button id="test-audio">테스트 재생 시작</button></div><script>addEventListener('DOMContentLoaded',()=>{let playing=false;const original=Sorinote.isListening;Sorinote.isListening=()=>playing||original();document.getElementById('test-audio').onclick=e=>{playing=!playing;e.target.textContent=playing?'테스트 재생 끝내기':'테스트 재생 시작';};});</script></body>`));
  const type={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':type[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 });
}).listen(4178,'127.0.0.1',()=>console.log('Update fixture: http://127.0.0.1:4178'));

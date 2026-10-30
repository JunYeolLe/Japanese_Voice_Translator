// Rebuild from the separately downloaded Kaikki Korean Wiktionary JSONL.
// Never includes user documents. See sorinote/dictionary-license.html.
const fs=require('node:fs'),path=require('node:path');
const source=process.argv[2];if(!source)throw new Error('Provide Kaikki Japanese JSONL path');
const entries={};
for(const line of fs.readFileSync(source,'utf8').split(/\r?\n/)){
 if(!line.trim())continue;const entry=JSON.parse(line);
 if(entry.lang_code!=='ja'||!['noun','verb','adj','adv'].includes(entry.pos)||!/[一-龯々]/u.test(entry.word))continue;
 const meanings=[...new Set((entry.senses||[]).flatMap(s=>s.glosses||[]).filter(g=>/[가-힣]/u.test(g)&&g.length<220))];
 if(!meanings.length)continue;
 (entries[entry.word]||=[]).push([entry.pos,meanings.slice(0,3).join('; ')]);
}
const result='/* Korean Wiktionary contributors via Kaikki.org. CC BY-SA 4.0. See dictionary-license.html. Filtered definitions only. */\nwindow.OpenDictionary='+JSON.stringify(entries)+';\n';
fs.writeFileSync(path.resolve(__dirname,'../sorinote/dictionary-data.js'),result);
console.log(Object.keys(entries).length+' headwords, '+Buffer.byteLength(result)+' bytes');

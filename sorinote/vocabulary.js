'use strict';
(function(root){
  const hira=text=>String(text||'').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96));
  // Small, authored study glosses. Other words use the existing, labelled translator.
  const glosses={図書館:'도서관',学校:'학교',学生:'학생',先生:'선생님',日本語:'일본어',日本:'일본',韓国語:'한국어',英語:'영어',本:'책',勉強:'공부',練習:'연습',言葉:'말, 단어',漢字:'한자',文法:'문법',文章:'글, 문장',意味:'의미',写真:'사진',時間:'시간',今日:'오늘',明日:'내일',昨日:'어제',毎日:'매일',毎年:'매년',今年:'올해',友達:'친구',家族:'가족',仕事:'일, 직업',生活:'생활',社会:'사회',問題:'문제',質問:'질문',答え:'답',理由:'이유',方法:'방법',必要:'필요',大切:'소중함, 중요함',重要:'중요함',自由:'자유',世界:'세계',文化:'문화',経済:'경제',環境:'환경',自然:'자연',人間:'인간',人:'사람',国:'나라',お金:'돈',金:'돈, 금',子供:'아이',子ども:'아이',気持ち:'마음, 기분',自分:'자신',相手:'상대',目的:'목적',経験:'경험',意見:'의견',関係:'관계',場合:'경우',結果:'결과',原因:'원인',変化:'변화',情報:'정보',電車:'전철',駅:'역',大学:'대학교',会社:'회사',研究:'연구',先生方:'선생님들',名前:'이름',場所:'장소',教室:'교실',授業:'수업',試験:'시험',食事:'식사',料理:'요리',旅行:'여행',病院:'병원',天気:'날씨',雨:'비',雪:'눈',空:'하늘',夢:'꿈',声:'목소리',音:'소리',手:'손',目:'눈',は:'~은/는 (주제)',が:'~이/가; ~지만',を:'~을/를',に:'~에/에게',で:'~에서; ~으로',と:'~와/과; ~라고',の:'~의; 것',も:'~도',へ:'~로 (방향)',から:'~부터; ~이므로',まで:'~까지',より:'~보다; ~로부터',だけ:'~만',しか:'~밖에 (뒤에 부정)',など:'~등',そして:'그리고',しかし:'그러나',だから:'그래서',また:'또, 다시'};
  // Patterns are matched at morphological boundaries, longest first.
  const grammar=[
    ['なければならない','～なければならない','～해야 한다'],['なければいけない','～なければいけない','～해야 한다'],
    ['なくてもいい','～なくてもいい','～하지 않아도 된다'],['てもいい','～てもいい','～해도 된다'],['てはいけない','～てはいけない','～해서는 안 된다'],
    ['ことができる','～ことができる','～할 수 있다'],['ことができます','～ことができます','～할 수 있습니다'],
    ['ようになる','～ようになる','～하게 되다'],['ようになった','～ようになった','～하게 되었다'],['ことになる','～ことになる','～하게 되다 (결정·결과)'],['ことにする','～ことにする','～하기로 하다'],
    ['として','～として','～로서; ～라는 입장에서'],['について','～について','～에 대해서'],['に対して','～に対して','～에 대하여; ～에게'],['によって','～によって','～에 따라; ～에 의해'],['による','～による','～에 의한; ～에 따른'],['にとって','～にとって','～에게 있어서'],
    ['に関して','～に関して','～에 관해서'],['に比べて','～に比べて','～에 비해서'],['に加えて','～に加えて','～에 더하여'],['において','～において','～에서 (장소·상황)'],['に応じて','～に応じて','～에 따라; ～에 맞추어'],
    ['ために','～ために','～하기 위해; ～때문에'],['おかげで','～おかげで','～덕분에'],['せいで','～せいで','～탓에'],['にもかかわらず','～にもかかわらず','～에도 불구하고'],
    ['わけではない','～わけではない','반드시 ～인 것은 아니다'],['わけがない','～わけがない','～할 리가 없다'],['はずがない','～はずがない','～할 리가 없다'],['はずです','～はずです','～일 것이다; ～일 터이다'],['はずだ','～はずだ','～일 것이다; ～일 터이다'],
    ['という','～という','～라고 하는'],['といった','～といった','～와 같은'],['だけでなく','～だけでなく','～뿐만 아니라'],['ばかりでなく','～ばかりでなく','～뿐만 아니라'],['ように','～ように','～하도록; ～처럼'],['そうです','～そうです','～라고 합니다; ～인 것 같습니다'],['ながら','～ながら','～하면서; ～이면서도'],['うちに','～うちに','～하는 동안에; ～하기 전에'],['たびに','～たびに','～할 때마다'],['ほど','～ほど','～정도; ～만큼'],['ので','～ので','～이므로'],['のに','～のに','～인데도; ～하는 데']
  ];
  function words(text,tokens){
    const out=[];let cursor=0;
    for(const token of tokens||[]){
      const surface=token.surface_form;if(!surface)continue;
      const start=text.indexOf(surface,cursor);if(start<0)continue;
      if(start>cursor)out.push({surface:text.slice(cursor,start),start:cursor,end:start,selectable:false});
      const item={surface,start,end:start+surface.length,reading:hira(token.reading||(/^[ぁ-ゖァ-ヶー]+$/.test(surface)?surface:'')),base:token.basic_form&&token.basic_form!=='*'?token.basic_form:surface,pos:token.pos||'',detail:token.pos_detail_1||'',selectable:/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(surface)};
      const previous=out.at(-1);
      // Keep verb/adjective inflection and noun suffixes with the word they belong to.
      const sahen=previous?.detail==='サ変接続'&&token.pos==='動詞'&&token.basic_form==='する';
      const inflection=previous&&previous.end===start&&(sahen||(token.pos==='助動詞'&&['動詞','形容詞'].includes(previous.pos))||(token.pos==='名詞'&&token.pos_detail_1==='接尾'&&previous.pos==='名詞'&&previous.detail!=='数'));
      if(inflection){if(sahen){previous.base=previous.surface+'する';previous.pos='動詞';previous.detail='自立';}previous.surface+=surface;previous.end=item.end;previous.reading=previous.reading&&item.reading?previous.reading+item.reading:'';}
      else out.push(item);cursor=item.end;
    }
    if(cursor<text.length)out.push({surface:text.slice(cursor),start:cursor,end:text.length,selectable:false});
    return out;
  }
  function grammarIn(text,tokens){
    const boundaries=new Set([0,text.length]);let cursor=0;
    for(const t of tokens||[]){const at=text.indexOf(t.surface_form,cursor);if(at<0)continue;boundaries.add(at);cursor=at+t.surface_form.length;boundaries.add(cursor);}
    const matches=[],used=[],segments=words(text,tokens);
    for(const [pattern,surface,meaning]of [...grammar].sort((a,b)=>b[0].length-a[0].length)){
      let start=text.indexOf(pattern);
      while(start>=0){const end=start+pattern.length;
        if(boundaries.has(start)&&boundaries.has(end)&&!used.some(r=>start<r.end&&end>r.start)){
          const matched=segments.filter(w=>w.start>=start&&w.end<=end);
          const reading=matched.map(w=>w.reading||w.surface).join('');
          matches.push({surface,reading:'～'+(reading||pattern),meaning,start,end,kind:'grammar'});used.push({start,end});
        }start=text.indexOf(pattern,start+pattern.length);
      }
    }
    return matches.sort((a,b)=>a.start-b.start).filter((item,i,all)=>all.findIndex(x=>x.surface===item.surface)===i);
  }
  function local(word){
    const meaning=glosses[word.surface]||root.BasicDictionary?.[word.base]?.meaning;
    if(meaning)return {text:meaning,provider:'기본 풀이'};
    const headword=word.base||word.surface,rows=root.OpenDictionary?.[headword];
    const pos={名詞:'noun',動詞:'verb',形容詞:'adj',副詞:'adv'}[word.pos];
    const row=rows?.find(r=>r[0]===pos);
    return row?{text:row[1],provider:'위키낱말사전',headword}:null;
  }
  function collect(documents,limit=24){
    const map=new Map(),patterns=new Map();let order=0;
    for(const doc of documents){
      for(const word of words(doc.text,doc.tokens)){
        if(!/[一-龯々]/.test(word.surface)||!['名詞','動詞','形容詞','副詞'].includes(word.pos)||['固有名詞','数','非自立','代名詞'].includes(word.detail))continue;
        const key=word.base||word.surface,previous=map.get(key);
        if(previous)previous.count++;else {const known=local(word);map.set(key,{...word,kind:'word',meaning:known?.text||'',dictionary:known?.provider==='위키낱말사전',count:1,order:order++});}
      }
      for(const item of grammarIn(doc.text,doc.tokens))if(!patterns.has(item.surface))patterns.set(item.surface,item);
    }
    const all=[...map.values()].sort((a,b)=>b.count-a.count||a.order-b.order);
    return {words:all.slice(0,limit),grammar:[...patterns.values()],total:all.length};
  }
  function format(items){return items.filter(x=>x.meaning).map(x=>`${x.surface} : ${x.reading||'읽는 법 확인 필요'} ( ${x.meaning} )`).join('\n');}
  const lookup=surface=>glosses[surface]||grammar.find(g=>g[0]===surface)?.[2]||'';
  const api={hira,glosses,lookup,local,words,grammarIn,collect,format};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.StudyVocabulary=api;
})(typeof globalThis!=='undefined'?globalThis:this);

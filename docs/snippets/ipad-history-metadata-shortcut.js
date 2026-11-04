(() => {
  const page = new URL(location.href);
  const profile = /^\/player\/([1-9][0-9]{0,9})\/[0-9.]+\/?$/.exec(page.pathname);
  if (page.protocol !== 'https:' || !['saki.sapk.ch', 'amae-koromo.sapk.ch'].includes(page.hostname) || !profile) {
    throw new Error('牌譜屋のプレイヤー履歴ページで実行してください。');
  }
  const actor = 1358437 + ((7 * Number(profile[1]) + 1117113) ^ 86216345);
  const entries = new Map();
  function metadata(link, url) {
    const row = typeof link.closest === 'function' ? link.closest('[role="row"]') : null;
    const cells = row ? Array.from(row.querySelectorAll('[role="gridcell"]')) : [];
    if (cells.length !== 4) return {};
    const mode = {'玉':12,'王座':16,'金':9,'玉東':11,'王東':15,'金東':8,'玉南':12,'王座南':16,'金南':9}[cells[0].textContent.trim()];
    const rankText=cells[1].textContent.trim();
    const rank={'一':1,'二':2,'三':3,'四':4}[rankText] || (/^[1-4]位?$/.test(rankText)?Number(rankText[0]):0);
    const date=/^(20[0-9]{2})\/([0-9]{1,2})\/([0-9]{1,2}) ([0-9]{1,2}):([0-9]{2})$/.exec(cells[3].textContent.trim());
    const links=Array.from(cells[2].querySelectorAll('a[title="牌譜を見る"]'));
    const raw=links.map(a=>/^\[[^\]]+\]\s*(.*?)\s*\[(-?[0-9]+)\]$/.exec(a.textContent.replace(/\s+/g,' ').trim()));
    if(!mode||!rank||!date||raw.length!==4||raw.some(p=>!p||!p[1])) return {};
    const players=raw.map(p=>({name:p[1],score:Number(p[2])}));
    if(players.some(p=>!Number.isInteger(p.score)||Math.abs(p.score)>1000000||[...p.name.trim()].length>100||/[\u0000-\u001f]/.test(p.name))) return {};
    const [year,month,day,hour,minute]=date.slice(1).map(Number);
    const calendar=new Date(Date.UTC(year,month-1,day));
    if(year<2019||year>2100||hour>23||minute>59||calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day) return {};
    const order=[0,1,2,3].sort((a,b)=>players[b].score-players[a].score||a-b);
    const own=links.map((a,i)=>{
      try { const u=new URL(a.getAttribute('href'),page); const v=u.origin==='https://mjai.ekyu.moe'?u.searchParams.get('url'):u.href; return v===url?i:-1; } catch (_) { return -1; }
    }).filter(i=>i>=0);
    if(own.length!==1 || order.indexOf(own[0])+1!==rank) return {};
    return {mode,rank,seat:own[0],players,at:`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${date[4].padStart(2,'0')}:${date[5]}:00+09:00`};
  }
  for (const link of document.querySelectorAll('a[href]')) {
    try {
      const target = new URL(link.getAttribute('href'), page);
      const value = target.origin === 'https://mjai.ekyu.moe'
        ? target.searchParams.get('url') : target.href;
      if (value && /^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(value) && value.endsWith('_a' + actor)) {
        if (entries.has(value) || entries.size < 500) {
          const meta=metadata(link,value);
          const old=entries.get(value);
          if (!old || !old.at) entries.set(value,{url:value,...meta});
        }
      }
    } catch (_) {}
  }
  if (!entries.size) throw new Error('この画面に対象URLがありません。対局履歴を表示してください。');
  completion(JSON.stringify({kind:'kyokuloop-history',version:1,player:Number(profile[1]),entries:[...entries.values()]}));
})();

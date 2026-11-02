(() => {
  'use strict';
  if (location.protocol !== 'https:' || !['amae-koromo.sapk.ch', 'saki.sapk.ch'].includes(location.hostname)) {
    alert('牌譜屋のプレイヤー履歴ページで実行してください。');
    return;
  }
  const route = /^\/player\/([1-9][0-9]{0,9})\/([0-9.]+)\/?$/.exec(location.pathname);
  if (!route) { alert('牌譜屋のプレイヤー履歴ページで実行してください。'); return; }
  const id = 'kyokuloop-history-collector';
  if (document.getElementById(id)) return;
  const pagePath = location.pathname;
  const player = Number(route[1]);
  const actor = 1358437 + ((7 * player + 1117113) ^ 86216345);
  const entries = new Map();
  const modes = { '玉': 12, '王座': 16, '金': 9, '玉東': 11, '王東': 15, '金東': 8 };
  const rankNumbers = { '一': 1, '二': 2, '三': 3, '四': 4 };
  const host = document.createElement('section');
  host.id = id;
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>:host{font:14px system-ui;color:#173d34}section{background:#fffef7;border:1px solid #b9cec2;border-radius:12px;padding:14px;box-shadow:0 4px 24px #0003;width:290px;box-sizing:border-box}header{display:flex;justify-content:space-between;align-items:center}button{font:inherit;cursor:pointer;border:1px solid #bfd0c4;border-radius:6px;background:#eef3ec;color:#173d34;padding:9px 10px}header button{padding:4px 9px}p{margin:9px 0;font-size:12px;line-height:1.5}nav{display:flex;gap:6px;flex-wrap:wrap}.primary{background:#194d40;color:#fff}textarea{box-sizing:border-box;width:100%;height:110px;margin-top:8px}</style><section aria-label="KyokuLoop 一括取得"><header><strong>KyokuLoop · <span id="count">0件</span></strong><button id="close" aria-label="取得を終了">×</button></header><p id="status" role="status">必要な範囲までスクロールしてからコピー</p><nav><button id="copy" class="primary">KyokuLoopへコピー</button><button id="urls">URLだけコピー</button></nav><textarea hidden readonly aria-label="コピー用データ"></textarea></section>';
  document.body.append(host);
  const count = root.getElementById('count');
  const status = root.getElementById('status');
  let stopped = false;
  function metadata(link) {
    const row = link.closest('[role="row"]');
    const cells = row ? Array.from(row.querySelectorAll('[role="gridcell"]')) : [];
    if (cells.length !== 4) return {};
    const mode = modes[cells[0].textContent.trim()];
    const rank = rankNumbers[cells[1].textContent.trim()];
    const date = /^(20[0-9]{2})\/([0-9]{1,2})\/([0-9]{1,2}) ([0-9]{1,2}):([0-9]{2})$/.exec(cells[3].textContent.trim());
    const links = Array.from(cells[2].querySelectorAll('a[title="牌譜を見る"]'));
    const players = links.map(a => /^\[[^\]]+\]\s*(.*?)\s*\[(-?[0-9]+)\]$/.exec(a.textContent.replace(/\s+/g, ' ').trim()));
    if (!mode || !rank || !date || players.length !== 4 || players.some(p => !p)) return {};
    const people = players.map(p => ({ name: p[1], score: Number(p[2]) }));
    const order = [0, 1, 2, 3].sort((a, b) => people[b].score - people[a].score || a - b);
    return { mode, players: people, seat: order[rank - 1],
      at: `${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${date[4].padStart(2,'0')}:${date[5]}:00+09:00` };
  }
  function scan() {
    if (location.pathname !== pagePath) {
      stopped = true;
      observer.disconnect();
      status.textContent = 'ページが変わったため取得停止。取得済み分はコピーできます。';
    }
    if (stopped) return;
    for (const link of document.querySelectorAll('a[href]')) {
      try {
        const target = new URL(link.getAttribute('href'), location.href);
        if (target.origin !== 'https://mjai.ekyu.moe' || !['/ja.html','/zh-cn.html','/','/ko.html','/ru.html'].includes(target.pathname) || target.hash) continue;
        if ([...target.searchParams.keys()].join() !== 'url') continue;
        const url = target.searchParams.get('url');
        if (!/^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(url) || !url.endsWith('_a' + actor)) continue;
        if (entries.has(url) || entries.size < 500) entries.set(url, { ...entries.get(url), url, ...metadata(link) });
      } catch { /* Unknown or masked links never become a guessed replay URL. */ }
    }
    count.textContent = entries.size + '件';
    if (entries.size >= 500) status.textContent = '上限500件。取得済み分をコピーしてください。';
  }
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  scan();
  async function copy(urlsOnly) {
    scan();
    if (!entries.size) { status.textContent = '対象URLがありません。日本語表示の履歴をスクロールしてください。'; return; }
    const data = urlsOnly ? [...entries.keys()].join('\n') : JSON.stringify({ kind: 'kyokuloop-history', version: 1, player, entries: [...entries.values()] });
    try {
      await navigator.clipboard.writeText(data);
      status.textContent = entries.size + '件をコピーしました。KyokuLoopへ貼り付けてください。';
    } catch {
      const area = root.querySelector('textarea');
      area.hidden = false;
      area.value = data;
      area.focus();
      area.select();
      status.textContent = 'この欄をCtrl+Cでコピーし、KyokuLoopへ貼り付けてください。';
    }
  }
  root.getElementById('copy').addEventListener('click', () => void copy(false));
  root.getElementById('urls').addEventListener('click', () => void copy(true));
  root.getElementById('close').addEventListener('click', () => { observer.disconnect(); host.remove(); });
})();

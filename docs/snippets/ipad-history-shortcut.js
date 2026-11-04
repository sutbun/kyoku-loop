(() => {
  const page = new URL(location.href);
  const profile = /^\/player\/([1-9][0-9]{0,9})\/[0-9.]+\/?$/.exec(page.pathname);
  if (page.protocol !== 'https:' || !['saki.sapk.ch', 'amae-koromo.sapk.ch'].includes(page.hostname) || !profile) {
    throw new Error('牌譜屋のプレイヤー履歴ページで実行してください。');
  }
  const actor = 1358437 + ((7 * Number(profile[1]) + 1117113) ^ 86216345);
  const urls = new Set();
  for (const link of document.querySelectorAll('a[href]')) {
    try {
      const target = new URL(link.getAttribute('href'), page);
      const value = target.origin === 'https://mjai.ekyu.moe'
        ? target.searchParams.get('url') : target.href;
      if (value && /^https:\/\/game\.mahjongsoul\.com\/\?paipu=[A-Za-z0-9_-]{10,200}$/.test(value) && value.endsWith('_a' + actor)) {
        if (urls.size < 500) urls.add(value);
      }
    } catch (_) {}
  }
  if (!urls.size) throw new Error('この画面に対象URLがありません。対局履歴を表示してください。');
  completion([...urls].join('\n'));
})();

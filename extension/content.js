// Salon Board Customer Exporter - Content Script v3
// 戦略: 画面遷移ベース（fetchでなく実ナビゲーション）でセッション/JS依存を回避
// 状態は chrome.storage に保存し、ページロード後に自動継続する

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const sendStatus = (text) => {
  try { chrome.runtime.sendMessage({ type: 'status', text }); } catch (e) {}
  console.log('[SB Exporter]', text);
};

async function getStored() {
  const { customers = [] } = await chrome.storage.local.get('customers');
  return customers;
}
async function saveStored(customers) {
  await chrome.storage.local.set({ customers });
}
async function getJob() {
  const { sb_job = null } = await chrome.storage.local.get('sb_job');
  return sb_job;
}
async function setJob(job) {
  await chrome.storage.local.set({ sb_job: job });
}
async function clearJob() {
  await chrome.storage.local.remove('sb_job');
}

// ============ テーブル探索 ============
// 画面のあらゆるテーブルから「お客様一覧」を探す
function findListTable(root = document) {
  const tables = [...root.querySelectorAll('table')];

  // 戦略A: ヘッダーに「お客様番号」「カナ」「漢字」など複数キーワードを含む
  const KEYS = ['お客様番号', 'カナ', '漢字', '氏名', '性別', '来店回数'];
  let bestScore = 0, bestTable = null;
  for (const t of tables) {
    const headerRow = t.querySelector('thead tr') || t.querySelector('tr');
    if (!headerRow) continue;
    const headTxt = cleanText(headerRow);
    let score = 0;
    KEYS.forEach(k => { if (headTxt.includes(k)) score++; });
    if (score > bestScore) { bestScore = score; bestTable = t; }
  }
  if (bestScore >= 2 && bestTable) return bestTable;

  // 戦略B: 行数が最も多い（ヘッダーらしきテーブル）
  let maxRows = 0; bestTable = null;
  for (const t of tables) {
    const rowCount = t.querySelectorAll('tbody tr, tr').length;
    if (rowCount > maxRows) { maxRows = rowCount; bestTable = t; }
  }
  if (maxRows >= 5) return bestTable;
  return null;
}

// ============ ヘッダーマッピング ============
function getHeaderCells(table) {
  let cells = [...table.querySelectorAll('thead th')].map(cleanText);
  if (!cells.length) {
    const firstRow = table.querySelector('tr');
    cells = [...(firstRow?.querySelectorAll('th, td') || [])].map(cleanText);
  }
  return cells;
}

function mapRowToObj(headerCells, cells, link) {
  const obj = { detail_url: null };
  if (link) {
    const href = link.getAttribute('href');
    if (href && href !== '#' && !href.startsWith('javascript:')) {
      try { obj.detail_url = new URL(href, location.href).href; } catch (e) {}
    } else {
      // onclick の中から ID を抜き出して URL 化（サロンボードはフォーム POST が多いのでここはベストエフォート）
      const onclick = link.getAttribute('onclick') || '';
      const m = onclick.match(/['"]([^'"]*\d{5,}[^'"]*)['"]/);
      if (m) try { obj.detail_url = new URL(m[1], location.href).href; } catch (e) {}
    }
  }
  headerCells.forEach((h, i) => {
    if (!h || cells[i] == null) return;
    const v = cells[i];
    if (/カナ/.test(h)) obj.kana = v;
    else if (/漢字|^氏名$|氏名$/.test(h) && !obj.full_name) obj.full_name = v;
    else if (/お客様番号|顧客番号|会員番号/.test(h)) obj.customer_no = v;
    else if (/性別/.test(h)) obj.gender = v;
    else if (/職業/.test(h)) obj.occupation = v;
    else if (/来店回数|回数/.test(h)) obj.visit_count = v;
    else if (/前回来店|前回|最終来店/.test(h)) obj.last_visit_date = v;
    else if (/初回来店/.test(h)) obj.first_visit_date = v;
    else if (/誕生日|生年月日/.test(h)) obj.birthday = v;
  });
  return obj;
}

// ============ 一覧パース ============
function parseListPage() {
  const table = findListTable();
  if (!table) return { rows: [], debug: 'table_not_found', tableCount: document.querySelectorAll('table').length };

  const headerCells = getHeaderCells(table);
  const rows = [];
  const allTrs = [...table.querySelectorAll('tbody tr')];
  const trs = allTrs.length ? allTrs : [...table.querySelectorAll('tr')];

  for (const tr of trs) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) continue;
    // ヘッダー行をスキップ
    if (tr.querySelectorAll('th').length > 0 && tds.length === 0) continue;
    const cells = [...tds].map(cleanText);
    // 全部空 or "-" だけの行はスキップ
    const nonEmpty = cells.filter(c => c && c !== '-' && c !== '－').length;
    if (nonEmpty < 2) continue;

    const link = tr.querySelector('a[href], a[onclick]');
    const obj = mapRowToObj(headerCells, cells, link);

    // ヘッダーが取れなかった場合の位置ベース fallback
    if (!obj.kana && !obj.full_name && cells.length >= 3) {
      // サロンボードの典型: [チェックボックス, お客様番号, カナ, 漢字, ...]
      // または [お客様番号, カナ, 漢字, ...]
      const startIdx = cells[0].length === 0 || cells[0] === '□' ? 1 : 0;
      obj.customer_no = obj.customer_no || cells[startIdx];
      obj.kana = obj.kana || cells[startIdx + 1];
      obj.full_name = obj.full_name || cells[startIdx + 2];
    }
    if (obj.kana || obj.full_name || obj.customer_no) rows.push(obj);
  }
  return { rows, debug: `${rows.length}行抽出 (header: ${headerCells.join('|')})`, headerCells };
}

// ============ ページネーション ============
// 「次へ」リンクを画面から探す
function findNextPageLink() {
  // テキストベース
  const candidates = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
  for (const el of candidates) {
    const txt = cleanText(el) || el.value || '';
    if (/^(次へ|次の|次ページ|>>?|»)$/.test(txt) || /次へ/.test(txt)) {
      // disabled でないこと
      if (el.disabled || el.classList.contains('disabled')) continue;
      const parentDisabled = el.closest('.disabled');
      if (parentDisabled) continue;
      return el;
    }
  }
  return null;
}

// 現在ページ / 総ページ / 件数を抽出
function getPageInfo() {
  const txt = document.body.innerText.replace(/\s+/g, ' ');
  let current = 1, total = 1, totalCount = null;
  let m = txt.match(/(\d+)\s*\/\s*(\d+)\s*ページ/);
  if (m) { current = parseInt(m[1]); total = parseInt(m[2]); }
  m = txt.match(/該当[:：]?\s*(\d+)\s*件/) || txt.match(/(\d+)\s*件\s*該当/) || txt.match(/全\s*(\d+)\s*件/);
  if (m) totalCount = parseInt(m[1]);
  // 現在ページ強調表示（<strong>1</strong> や class="current"）
  const cur = document.querySelector('.pager .current, .pagination .active, .pageNation strong, .page strong');
  if (cur) {
    const n = parseInt(cleanText(cur));
    if (n) current = n;
  }
  return { current, total, totalCount };
}

// ============ 自動継続スキャン ============
// ページロード時に「ジョブ実行中」なら自動的に続きを処理する
async function autoContinueIfJobActive() {
  const job = await getJob();
  if (!job || !job.active) return;

  // テーブルが現れるまで少し待つ（最大10秒）
  let table = null;
  for (let i = 0; i < 20; i++) {
    table = findListTable();
    if (table && table.querySelectorAll('tbody tr, tr').length > 1) break;
    await sleep(500);
  }
  if (!table) {
    sendStatus('⚠️ テーブルが見つかりません。お客様一覧画面で検索を実行してから再開してください。');
    return;
  }

  const { rows, debug } = parseListPage();
  const info = getPageInfo();
  sendStatus(`ページ ${info.current}/${info.total || '?'}: ${debug}`);

  // 取得した行を保存
  const stored = await getStored();
  const merged = mergeCustomers(stored, rows);
  await saveStored(merged);
  sendStatus(`💾 累計 ${merged.length}件 保存`);

  // 終了判定
  const reachedEnd = job.endPage && info.current >= job.endPage;
  const reachedLast = info.total && info.current >= info.total;
  if (reachedEnd || reachedLast) {
    await clearJob();
    sendStatus(`✅ 一覧スキャン完了: 合計 ${merged.length}件`);
    return;
  }

  // 次ページへ
  await sleep(job.delay || 2500);
  const nextLink = findNextPageLink();
  if (!nextLink) {
    await clearJob();
    sendStatus(`⚠️ 「次へ」リンクが見つからないため終了。合計 ${merged.length}件`);
    return;
  }
  sendStatus(`次のページへ遷移します… (${info.current + 1})`);
  // クリック
  if (nextLink.tagName === 'A' && nextLink.href && !nextLink.getAttribute('onclick')) {
    location.href = nextLink.href;
  } else {
    nextLink.click();
  }
}

// ============ マージ ============
function mergeCustomers(existing, fresh) {
  const map = new Map();
  [...existing, ...fresh].forEach(c => {
    const key = c.customer_no || c.detail_url || ((c.kana || '') + '|' + (c.full_name || ''));
    if (!key || key === '|') return;
    const prev = map.get(key) || {};
    map.set(key, { ...prev, ...c });
  });
  return [...map.values()];
}

// ============ 詳細スキャン ============
async function scanDetails({ delay = 2500 }) {
  const customers = await getStored();
  const targets = customers.filter(c => c.detail_url && !c.phone && !c.birthday);
  if (!targets.length) {
    sendStatus('詳細取得対象がありません');
    return;
  }
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    sendStatus(`詳細取得中: ${i + 1}/${targets.length}`);
    try {
      const html = await fetch(c.detail_url, { credentials: 'include' }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      Object.assign(c, parseDetailFromDoc(doc));
    } catch (e) {
      console.error('詳細取得エラー', e);
    }
    if (i % 5 === 0) await saveStored(customers);
    await sleep(delay);
  }
  await saveStored(customers);
  sendStatus(`✅ 詳細スキャン完了: ${targets.length}件`);
}

function parseDetailFromDoc(doc) {
  const obj = {};
  doc.querySelectorAll('th').forEach(th => {
    const label = cleanText(th);
    const td = th.nextElementSibling;
    if (!td || td.tagName !== 'TD') return;
    const val = cleanText(td);
    if (!val || val === '-' || val === '－') return;
    if (/氏名.*漢字|^氏名$/.test(label)) obj.full_name = val.replace(/ダイレクト会員|会員/g, '').trim();
    else if (/氏名.*カナ/.test(label)) obj.kana = val;
    else if (/電話番号\s*1|^電話番号$/.test(label)) obj.phone = val;
    else if (/電話番号\s*2/.test(label)) obj.phone2 = val;
    else if (/E-?MAIL.*PC/i.test(label)) obj.email = val;
    else if (/E-?MAIL.*携帯/i.test(label)) obj.email_mobile = val;
    else if (/誕生日|生年月日/.test(label)) obj.birthday = val;
    else if (/血液型/.test(label)) obj.blood_type = val;
    else if (/職業/.test(label)) obj.occupation = val;
    else if (/性別/.test(label)) obj.gender = val.split(/\s|・/)[0];
    else if (/住所/.test(label)) obj.address = val;
    else if (/お客様メモ/.test(label)) obj.memo = val;
    else if (/初回来店/.test(label)) obj.first_visit_date = val;
  });
  return obj;
}

// ============ メッセージ受信 ============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.action === 'scanList') {
      // ジョブを記録して、現ページから処理スタート
      await setJob({ active: true, endPage: msg.endPage || null, delay: msg.delay || 2500, startedAt: Date.now() });
      sendStatus('スキャン開始: 現在ページから自動巡回します');
      await autoContinueIfJobActive();
    } else if (msg.action === 'stopScan') {
      await clearJob();
      sendStatus('⏸ スキャンを停止しました');
    } else if (msg.action === 'scanDetails') {
      scanDetails(msg).catch(e => sendStatus('❌ ' + e.message));
    } else if (msg.action === 'debug') {
      const r = parseListPage();
      const p = getPageInfo();
      const next = findNextPageLink();
      sendStatus(`診断: ${r.debug} / ページ ${p.current}/${p.total || '?'} (該当${p.totalCount || '?'}件) / 次へリンク: ${next ? '✓発見' : '✗なし'} / table数: ${document.querySelectorAll('table').length}`);
      console.log('[SB Exporter] 診断詳細', { parse: r, page: p, nextLink: next });
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// ============ ページロード時に自動継続 ============
if (document.readyState === 'complete') {
  autoContinueIfJobActive();
} else {
  window.addEventListener('load', () => setTimeout(autoContinueIfJobActive, 1000));
}

console.log('[Salon Board Exporter] v3 ready');

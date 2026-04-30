// Salon Board Customer Exporter - Content Script v2
// URLパラメータ(pn=N)でページ遷移してスキャン

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sendStatus = (text) => {
  try { chrome.runtime.sendMessage({ type: 'status', text }); } catch (e) {}
  console.log('[SB Exporter]', text);
};
const cleanText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

async function getStored() {
  const { customers = [] } = await chrome.storage.local.get('customers');
  return customers;
}
async function saveStored(customers) {
  await chrome.storage.local.set({ customers });
}

// ===== 一覧テーブルを発見（複数戦略） =====
function findListTable() {
  const tables = document.querySelectorAll('table');
  // 戦略1: ヘッダーに「カナ」を含むテーブル
  for (const t of tables) {
    const headTxt = cleanText(t.querySelector('thead')) || cleanText(t.querySelector('tr'));
    if (/カナ/.test(headTxt) && /漢字|氏名/.test(headTxt)) return t;
  }
  // 戦略2: 詳細リンクを多く含むテーブル
  let best = null, bestCount = 0;
  for (const t of tables) {
    const links = t.querySelectorAll('a[href*="customerDetail"], a[href*="customerSearch"], a[href*="customer/"]');
    if (links.length > bestCount) { best = t; bestCount = links.length; }
  }
  if (bestCount >= 3) return best;
  return null;
}

// ===== 一覧パース =====
function parseListPage() {
  const table = findListTable();
  if (!table) {
    console.warn('[SB Exporter] 一覧テーブルが見つかりません');
    return { rows: [], headers: [], debug: 'table_not_found' };
  }

  // ヘッダー取得（thead優先、なければ最初の行のth）
  let headerCells = [...table.querySelectorAll('thead th')].map(cleanText);
  if (!headerCells.length) {
    headerCells = [...(table.querySelector('tr')?.querySelectorAll('th, td') || [])].map(cleanText);
  }

  const rows = [];
  // データ行（thead以外のtr）
  const allRows = [...table.querySelectorAll('tr')];
  for (const tr of allRows) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) continue;
    const link = tr.querySelector('a[href]');
    let detailUrl = null;
    if (link) {
      const href = link.getAttribute('href');
      // onclick="javascript:..."の可能性も
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        try { detailUrl = new URL(href, location.href).href; } catch (e) {}
      } else {
        const onclick = link.getAttribute('onclick') || '';
        const m = onclick.match(/['"]([^'"]*customer[^'"]*)['"]/);
        if (m) try { detailUrl = new URL(m[1], location.href).href; } catch (e) {}
      }
    }

    const cells = [...tds].map(cleanText);
    const obj = { detail_url: detailUrl };
    headerCells.forEach((h, i) => {
      if (!h) return;
      if (/カナ/.test(h)) obj.kana = cells[i];
      else if (/漢字|^氏名$|氏名$/.test(h) && !obj.full_name) obj.full_name = cells[i];
      else if (/お客様番号/.test(h)) obj.customer_no = cells[i];
      else if (/性別/.test(h)) obj.gender = cells[i];
      else if (/職業/.test(h)) obj.occupation = cells[i];
      else if (/来店回数|回数/.test(h)) obj.visit_count = cells[i];
      else if (/前回来店|前回/.test(h)) obj.last_visit_date = cells[i];
    });
    // ヘッダーが取れなかった場合の位置ベースfallback
    if (!obj.kana && !obj.full_name && cells.length >= 2) {
      obj.kana = cells[0];
      obj.full_name = cells[1];
    }
    if (obj.kana || obj.full_name) rows.push(obj);
  }
  return { rows, headers: headerCells, debug: `${rows.length}行抽出` };
}

// 総ページ数を取得
function getTotalPages() {
  const txt = document.body.innerText;
  // パターン1: "1 / 26 ページ"
  let m = txt.match(/(\d+)\s*\/\s*(\d+)\s*ページ/);
  if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) };
  // パターン2: "1260件" → 1ページ50件と仮定
  m = txt.match(/(\d+)\s*件あります/);
  if (m) return { current: 1, total: Math.ceil(parseInt(m[1]) / 50) };
  return { current: 1, total: 1 };
}

// 現在のページ番号をURLから
function getCurrentPageFromUrl() {
  const url = new URL(location.href);
  const pn = url.searchParams.get('pn');
  return pn ? parseInt(pn) : 1;
}

// ページN へ遷移するURLを作る
function buildPageUrl(n) {
  const url = new URL(location.href);
  url.searchParams.set('pn', String(n));
  return url.href;
}

// ===== 一覧スキャン（fetch方式：高速&安定） =====
async function scanList({ startPage = 1, endPage = null, delay = 2500 }) {
  const pageInfo = getTotalPages();
  const lastPage = endPage || pageInfo.total;
  sendStatus(`スキャン準備中: 全${lastPage}ページを処理します`);

  // まず現在のページをパース
  const all = [];
  const baseUrl = location.href.replace(/[?&]pn=\d+/, '');
  
  for (let pn = startPage; pn <= lastPage; pn++) {
    sendStatus(`一覧スキャン中: ${pn} / ${lastPage} ページ (${all.length}件取得済み)`);

    let rows = [];
    if (pn === getCurrentPageFromUrl()) {
      // 現在ページはDOMから直接
      const result = parseListPage();
      rows = result.rows;
      sendStatus(`ページ ${pn}: ${result.debug}`);
    } else {
      // 他ページはfetchで取得
      try {
        const url = buildPageUrl(pn);
        const html = await fetch(url, { credentials: 'include' }).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, 'text/html');
        rows = parseListFromDoc(doc);
        sendStatus(`ページ ${pn}: ${rows.length}件抽出`);
      } catch (e) {
        console.error('[SB Exporter] ページ取得エラー', pn, e);
        sendStatus(`⚠️ ページ ${pn} エラー: ${e.message}`);
      }
    }
    all.push(...rows);

    // 5ページごとに進捗保存
    if (pn % 5 === 0) {
      const merged = mergeCustomers(await getStored(), all);
      await saveStored(merged);
    }
    if (pn < lastPage) await sleep(delay);
  }

  // 最終マージ
  const existing = await getStored();
  const merged = mergeCustomers(existing, all);
  await saveStored(merged);
  sendStatus(`✅ 一覧スキャン完了: 合計 ${merged.length}件 保存しました`);
}

function mergeCustomers(existing, fresh) {
  const map = new Map();
  [...existing, ...fresh].forEach(c => {
    const key = c.detail_url || c.customer_no || ((c.kana || '') + '|' + (c.full_name || ''));
    if (!key || key === '|') return;
    map.set(key, { ...(map.get(key) || {}), ...c });
  });
  return [...map.values()];
}

// fetched docから一覧抽出
function parseListFromDoc(doc) {
  const tables = doc.querySelectorAll('table');
  let table = null;
  for (const t of tables) {
    const head = (t.querySelector('thead')?.textContent || t.querySelector('tr')?.textContent || '').replace(/\s+/g, ' ');
    if (/カナ/.test(head) && /漢字|氏名/.test(head)) { table = t; break; }
  }
  if (!table) {
    let best = null, bc = 0;
    for (const t of tables) {
      const links = t.querySelectorAll('a[href*="customer"]');
      if (links.length > bc) { best = t; bc = links.length; }
    }
    if (bc >= 3) table = best;
  }
  if (!table) return [];

  let headerCells = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').replace(/\s+/g, ' ').trim());
  if (!headerCells.length) {
    headerCells = [...(table.querySelector('tr')?.querySelectorAll('th, td') || [])].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
  }

  const rows = [];
  const baseHref = doc.baseURI || 'https://salonboard.com/';
  for (const tr of table.querySelectorAll('tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) continue;
    const link = tr.querySelector('a[href]');
    let detailUrl = null;
    if (link) {
      const href = link.getAttribute('href');
      if (href && href !== '#') {
        try { detailUrl = new URL(href, baseHref).href; } catch (e) {}
      }
    }
    const cells = [...tds].map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
    const obj = { detail_url: detailUrl };
    headerCells.forEach((h, i) => {
      if (!h) return;
      if (/カナ/.test(h)) obj.kana = cells[i];
      else if (/漢字|^氏名$|氏名$/.test(h) && !obj.full_name) obj.full_name = cells[i];
      else if (/お客様番号/.test(h)) obj.customer_no = cells[i];
      else if (/性別/.test(h)) obj.gender = cells[i];
      else if (/職業/.test(h)) obj.occupation = cells[i];
      else if (/来店回数|回数/.test(h)) obj.visit_count = cells[i];
      else if (/前回来店|前回/.test(h)) obj.last_visit_date = cells[i];
    });
    if (!obj.kana && !obj.full_name && cells.length >= 2) {
      obj.kana = cells[0];
      obj.full_name = cells[1];
    }
    if (obj.kana || obj.full_name) rows.push(obj);
  }
  return rows;
}

// ===== 詳細スキャン =====
async function scanDetails({ delay = 2500 }) {
  const customers = await getStored();
  const targets = customers.filter(c => c.detail_url && !c.phone && !c.birthday);
  if (!targets.length) {
    sendStatus('詳細取得対象がありません（先に一覧スキャン、または既に取得済み）');
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    sendStatus(`詳細取得中: ${i + 1}/${targets.length}  ${c.full_name || c.kana || ''}`);
    try {
      const html = await fetch(c.detail_url, { credentials: 'include' }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      Object.assign(c, parseDetailFromDoc(doc));
    } catch (e) {
      console.error('詳細取得エラー', c.detail_url, e);
    }
    if (i % 5 === 0) await saveStored(customers);
    await sleep(delay);
  }
  await saveStored(customers);
  sendStatus(`✅ 詳細スキャン完了: ${targets.length}件を更新`);
}

function parseDetailFromDoc(doc) {
  const obj = {};
  doc.querySelectorAll('th').forEach(th => {
    const label = (th.textContent || '').replace(/\s+/g, ' ').trim();
    const td = th.nextElementSibling;
    if (!td || td.tagName !== 'TD') return;
    const val = (td.textContent || '').replace(/\s+/g, ' ').trim();
    if (!val || val === '-' || val === '－') return;

    if (/氏名.*漢字|^氏名$/.test(label)) obj.full_name = val.replace(/ダイレクト会員|会員/g, '').trim();
    else if (/氏名.*カナ/.test(label)) obj.kana = val;
    else if (/電話番号\s*1|^電話番号$/.test(label)) obj.phone = val;
    else if (/電話番号\s*2/.test(label)) obj.phone2 = val;
    else if (/E-?MAIL.*PC/.test(label)) obj.email = val;
    else if (/E-?MAIL.*携帯/.test(label)) obj.email_mobile = val;
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

// ===== Message Listener =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanList') {
    scanList(msg).catch(e => sendStatus('❌ エラー: ' + e.message));
  } else if (msg.action === 'scanDetails') {
    scanDetails(msg).catch(e => sendStatus('❌ エラー: ' + e.message));
  } else if (msg.action === 'debug') {
    const r = parseListPage();
    const p = getTotalPages();
    sendStatus(`診断: ${r.debug} / ページ情報 ${p.current}/${p.total} / URL pn=${getCurrentPageFromUrl()}`);
  }
  sendResponse({ ok: true });
  return true;
});

console.log('[Salon Board Exporter] v2 ready');

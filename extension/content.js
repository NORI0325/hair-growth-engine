// Salon Board Customer Exporter - Content Script
// 一覧ページと詳細ページからお客様情報を抽出

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sendStatus = (text) => chrome.runtime.sendMessage({ type: 'status', text });
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

async function getStored() {
  const { customers = [] } = await chrome.storage.local.get('customers');
  return customers;
}
async function saveStored(customers) {
  await chrome.storage.local.set({ customers });
}

// ===== 一覧ページから抽出 =====
function parseListPage() {
  const rows = [];
  // 一覧テーブル: お客様情報一覧 のテーブルを特定
  const tables = document.querySelectorAll('table');
  let targetTable = null;
  for (const t of tables) {
    const headers = [...t.querySelectorAll('th')].map(th => text(th));
    if (headers.some(h => h.includes('氏名 (カナ)') || h.includes('氏名(カナ)') || h.includes('カナ'))) {
      targetTable = t; break;
    }
  }
  if (!targetTable) return { rows: [], headers: [] };

  const headerCells = [...targetTable.querySelectorAll('thead th, tr:first-child th')].map(th => text(th));
  const trs = targetTable.querySelectorAll('tbody tr, tr');
  trs.forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (!tds.length) return;
    const link = tr.querySelector('a[href]');
    const detailUrl = link ? new URL(link.getAttribute('href'), location.href).href : null;
    const cells = [...tds].map(td => text(td));
    // ヘッダーに合わせて項目をマップ
    const obj = { detail_url: detailUrl };
    headerCells.forEach((h, i) => {
      if (h.includes('カナ')) obj.kana = cells[i];
      else if (h.includes('漢字') || h === '氏名') obj.full_name = cells[i];
      else if (h.includes('お客様番号')) obj.customer_no = cells[i];
      else if (h.includes('性別')) obj.gender = cells[i];
      else if (h.includes('職業')) obj.occupation = cells[i];
      else if (h.includes('来店回数')) obj.visit_count = cells[i];
      else if (h.includes('前回来店')) obj.last_visit_date = cells[i];
    });
    if (obj.kana || obj.full_name) rows.push(obj);
  });
  return { rows, headers: headerCells };
}

// 「次へ」リンクを探す
function findNextLink() {
  // テキストで探す
  const links = [...document.querySelectorAll('a, input[type="button"], button')];
  for (const a of links) {
    const t = text(a) || a.value || '';
    if (/次へ|next|＞/.test(t) && !a.disabled && !a.classList.contains('disabled')) {
      // 灰色化された「次へ」を除外
      const style = getComputedStyle(a);
      if (style.pointerEvents !== 'none' && style.opacity !== '0.5') return a;
    }
  }
  return null;
}

// 現在のページ番号と総ページ数を取得
function getPagination() {
  const txt = document.body.innerText;
  const m = txt.match(/(\d+)\s*\/\s*(\d+)\s*ページ/);
  if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) };
  return { current: 1, total: 1 };
}

// ===== 一覧スキャン =====
async function scanList({ startPage = 1, endPage = null, delay = 2500 }) {
  const all = [];
  let pageInfo = getPagination();
  const lastPage = endPage || pageInfo.total;
  
  // 開始ページまで進める（必要なら）
  let safety = 0;
  while (pageInfo.current < startPage && safety++ < 50) {
    const next = findNextLink();
    if (!next) break;
    next.click();
    await sleep(delay);
    pageInfo = getPagination();
  }

  while (true) {
    pageInfo = getPagination();
    sendStatus(`一覧スキャン中: ${pageInfo.current} / ${lastPage} ページ (${all.length}件取得済み)`);
    
    const { rows } = parseListPage();
    all.push(...rows);
    
    if (pageInfo.current >= lastPage) break;
    const next = findNextLink();
    if (!next) break;
    next.click();
    await sleep(delay);
  }
  
  // マージ: 既存データと結合（detail_urlで重複排除）
  const existing = await getStored();
  const map = new Map();
  [...existing, ...all].forEach(c => {
    const key = c.detail_url || c.customer_no || (c.kana + '|' + c.full_name);
    map.set(key, { ...(map.get(key) || {}), ...c });
  });
  const merged = [...map.values()];
  await saveStored(merged);
  sendStatus(`✅ 一覧スキャン完了: 合計 ${merged.length}件`);
}

// ===== 詳細ページから抽出 =====
function parseDetailPage() {
  const obj = {};
  // ラベル→値 のテーブル形式を総当たり解析
  const ths = document.querySelectorAll('th');
  ths.forEach(th => {
    const label = text(th);
    const td = th.nextElementSibling;
    if (!td || td.tagName !== 'TD') return;
    const val = text(td);
    if (val === '-' || val === '－') return;
    
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
    else if (/お客様番号/.test(label)) obj.customer_no = val;
    else if (/住所/.test(label)) obj.address = val;
    else if (/お客様メモ/.test(label)) obj.memo = val;
    else if (/初回来店/.test(label)) obj.first_visit_date = val;
    else if (/来店回数/.test(label)) obj.visit_count = val.replace(/[^\d]/g, '');
  });
  
  // 顧客IDをページから（"顧客ID:C00871546190" のような表示）
  const idMatch = document.body.innerText.match(/顧客ID[:：]\s*([A-Z0-9]+)/);
  if (idMatch) obj.customer_id_sb = idMatch[1];
  
  return obj;
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
    sendStatus(`詳細取得中: ${i+1}/${targets.length}  ${c.full_name || c.kana || ''}`);
    
    try {
      // iframeで詳細ページを開いて解析
      const html = await fetch(c.detail_url, { credentials: 'include' }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const detail = parseDetailFromDoc(doc);
      Object.assign(c, detail);
    } catch (e) {
      console.error('詳細取得エラー', c.detail_url, e);
    }
    
    // 進捗を5件ごとに保存
    if (i % 5 === 0) await saveStored(customers);
    await sleep(delay);
  }
  
  await saveStored(customers);
  sendStatus(`✅ 詳細スキャン完了: ${targets.length}件を更新`);
}

// 詳細をdocから抽出（fetch版）
function parseDetailFromDoc(doc) {
  const obj = {};
  const ths = doc.querySelectorAll('th');
  ths.forEach(th => {
    const label = (th.textContent || '').replace(/\s+/g, ' ').trim();
    const td = th.nextElementSibling;
    if (!td || td.tagName !== 'TD') return;
    const val = (td.textContent || '').replace(/\s+/g, ' ').trim();
    if (val === '-' || val === '－' || !val) return;
    
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
  }
  sendResponse({ ok: true });
  return true;
});

console.log('[Salon Board Exporter] ready');

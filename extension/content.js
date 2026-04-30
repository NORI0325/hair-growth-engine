// Salon Board Customer Exporter - Content Script v5
// 戦略:
//  ① 一覧スキャン: 実画面遷移で全ページ巡回。各行の「名前リンクのクリック識別子」も保存
//  ② 詳細スキャン: 未取得顧客を1人ずつ実画面で開き、詳細を読み取り→一覧に戻る を繰り返す
//     (fetchではセッションが切れるため、必ず実ブラウザ遷移を使う)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const normalizeValue = (value) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (s === '-' || s === '－' || s === '―' || s === '—') ? '' : s;
};
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
async function getDetailJob() {
  const { sb_detail_job = null } = await chrome.storage.local.get('sb_detail_job');
  return sb_detail_job;
}
async function setDetailJob(job) {
  await chrome.storage.local.set({ sb_detail_job: job });
}
async function clearDetailJob() {
  await chrome.storage.local.remove('sb_detail_job');
}

const MAX_DETAIL_ATTEMPTS = 2;

function customerUid(c, index = 0) {
  const customerNo = normalizeValue(c.customer_no);
  if (customerNo) return `no:${customerNo}`;
  const detailKey = normalizeValue(c.detail_key);
  if (detailKey) return `detail:${detailKey}`;
  const detailUrl = normalizeValue(c.detail_url);
  if (detailUrl) return `url:${detailUrl}`;
  if (c.scan_page && c.scan_row) return `row:${c.scan_page}:${c.scan_row}`;
  return `fallback:${normalizeValue(c.kana)}|${normalizeValue(c.full_name)}|${normalizeValue(c.last_visit_date)}|${normalizeValue(c.visit_count)}|${index}`;
}

function withCustomerUids(customers) {
  return customers.map((c, i) => ({
    ...c,
    export_uid: c.export_uid || customerUid(c, i),
    detail_attempts: Number(c.detail_attempts || 0),
  }));
}

function isDetailPending(c) {
  if (c.detail_fetched === true || c.detail_status === 'fetched') return false;
  if (c.detail_status === 'skipped') return false;
  return Number(c.detail_attempts || 0) < MAX_DETAIL_ATTEMPTS;
}

function hasUsefulDetail(detail) {
  return Boolean(
    detail.customer_no || detail.full_name || detail.kana || detail.phone || detail.phone2 ||
    detail.email || detail.email_mobile || detail.birthday || detail.address || detail.memo ||
    detail.blood_type || detail.visit_trigger || (detail.visit_history && detail.visit_history.length)
  );
}

// ============ テーブル探索 ============
function findListTable(root = document) {
  const tables = [...root.querySelectorAll('table')];
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

  let maxRows = 0; bestTable = null;
  for (const t of tables) {
    const rowCount = t.querySelectorAll('tbody tr, tr').length;
    if (rowCount > maxRows) { maxRows = rowCount; bestTable = t; }
  }
  if (maxRows >= 5) return bestTable;
  return null;
}

function getHeaderCells(table) {
  let cells = [...table.querySelectorAll('thead th')].map(cleanText);
  if (!cells.length) {
    const firstRow = [...table.querySelectorAll('tr')].find(tr => tr.querySelectorAll('th').length >= 2) || table.querySelector('tr');
    cells = [...(firstRow?.querySelectorAll('th, td') || [])].map(cleanText);
  }
  return cells;
}

// ============ リンク識別子の抽出 ============
// 名前リンクからクリックを再現するための情報を取り出す
function getLinkSignature(link) {
  if (!link) return null;
  const href = link.getAttribute('href') || '';
  const onclick = link.getAttribute('onclick') || '';
  const raw = `${href} ${onclick}`;

  // 顧客IDっぽいトークンを抽出（C00971546190 のような形式や数値ID）
  const idMatch =
    raw.match(/['"]?(C\d{8,})['"]?/i) ||
    raw.match(/(?:customerId|kokyakuId|memberId|customerCd|kkykNo|kyakuNo|id)\s*[:=]\s*['"]?([0-9A-Za-z_-]{4,})['"]?/i) ||
    raw.match(/[?&](?:id|customerId|customerCd|kokyakuId|memberId|no)=([^&'"\)]+)/i);
  const detailKey = idMatch ? idMatch[1] : '';

  let detailUrl = null;
  if (href && href !== '#' && !href.startsWith('javascript:')) {
    try { detailUrl = new URL(href, location.href).href; } catch (e) {}
  }

  return {
    detail_url: detailUrl,
    detail_key: detailKey || detailUrl || '',
    onclick_raw: onclick,
    href_raw: href,
    link_text: cleanText(link),
  };
}

function mapRowToObj(headerCells, cells, link, meta = {}) {
  const obj = {};
  const sig = getLinkSignature(link) || {};
  Object.assign(obj, sig);

  headerCells.forEach((h, i) => {
    if (!h || cells[i] == null) return;
    const v = normalizeValue(cells[i]);
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
  if (!obj.kana && obj.link_text && /[ァ-ヶー]/.test(obj.link_text)) obj.kana = obj.link_text;
  obj.scan_page = meta.page || null;
  obj.scan_row = meta.rowNumber || null;
  return obj;
}

function parseListPage() {
  const table = findListTable();
  if (!table) return { rows: [], debug: 'table_not_found', tableCount: document.querySelectorAll('table').length };
  const headerCells = getHeaderCells(table);
  const pageInfo = getPageInfo();
  const rows = [];
  const allTrs = [...table.querySelectorAll('tbody tr')];
  const trs = allTrs.length ? allTrs : [...table.querySelectorAll('tr')];
  let dataRowNumber = 0;

  for (const tr of trs) {
    if (tr.querySelectorAll('th').length > 0) continue;
    const tds = tr.querySelectorAll('td');
    if (tds.length < 5) continue;
    const cells = [...tds].map(td => cleanText(td));
    const normalized = cells.map(normalizeValue);
    const nonEmpty = normalized.filter(Boolean).length;
    if (nonEmpty < 2) continue;

    const link = tr.querySelector('a[href], a[onclick]');
    if (!link && !normalized.some(c => /[ァ-ヶー]|[一-龯]/.test(c))) continue;
    dataRowNumber += 1;
    const obj = mapRowToObj(headerCells, cells, link, { page: pageInfo.current, rowNumber: dataRowNumber });

    if (cells.length >= 7) {
      obj.kana = obj.kana || normalized[0] || obj.link_text;
      obj.full_name = obj.full_name || normalized[1];
      obj.customer_no = obj.customer_no || normalized[2];
      obj.gender = obj.gender || normalized[3];
      obj.occupation = obj.occupation || normalized[4];
      obj.visit_count = obj.visit_count || normalized[5];
      obj.last_visit_date = obj.last_visit_date || normalized[6];
    }
    if (obj.kana || obj.full_name || obj.customer_no) rows.push(obj);
  }
  return { rows, debug: `${rows.length}行抽出 (header: ${headerCells.join('|')})`, headerCells };
}

// ============ ページネーション ============
function findNextPageLink() {
  const candidates = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
  for (const el of candidates) {
    const txt = cleanText(el) || el.value || el.getAttribute('title') || el.getAttribute('alt') || '';
    const cls = el.className || '';
    const href = el.getAttribute('href') || '';
    const onclick = el.getAttribute('onclick') || '';
    const looksNext = /次へ|次の|次ページ|next/i.test(`${txt} ${cls} ${href} ${onclick}`) || /^(>|>>|»)$/.test(txt.trim());
    if (!looksNext) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) continue;
    if (el.closest('.disabled')) continue;
    return el;
  }
  return null;
}

function getPageInfo() {
  const txt = (document.body.innerText || document.body.textContent || '').replace(/\s+/g, ' ');
  let current = 1, total = 1, totalCount = null;
  let m = txt.match(/(\d+)\s*\/\s*(\d+)\s*ページ/) || txt.match(/(\d+)\s*\/\s*(\d+)\s*ﾍﾟｰｼﾞ/);
  if (m) { current = parseInt(m[1]); total = parseInt(m[2]); }
  m = txt.match(/該当するお客様情報が\s*(\d+)\s*件/) || txt.match(/該当[:：]?\s*(\d+)\s*件/) || txt.match(/(\d+)\s*件\s*該当/) || txt.match(/全\s*(\d+)\s*件/);
  if (m) totalCount = parseInt(m[1]);
  const cur = document.querySelector('.pager .current, .pagination .active, .pageNation strong, .page strong');
  if (cur) {
    const n = parseInt(cleanText(cur));
    if (n) current = n;
  }
  return { current, total, totalCount };
}

// ============ 一覧スキャン自動継続 ============
async function autoContinueListJob() {
  const job = await getJob();
  if (!job || !job.active) return false;

  let table = null;
  for (let i = 0; i < 20; i++) {
    table = findListTable();
    if (table && table.querySelectorAll('tbody tr, tr').length > 1) break;
    await sleep(500);
  }
  if (!table) {
    sendStatus('⚠️ テーブルが見つかりません。お客様一覧画面で検索を実行してから再開してください。');
    return true;
  }

  const { rows, debug } = parseListPage();
  const info = getPageInfo();
  sendStatus(`ページ ${info.current}/${info.total || '?'}: ${debug}`);

  const stored = await getStored();
  const merged = mergeCustomers(stored, rows);
  await saveStored(merged);
  sendStatus(`💾 このページ ${rows.length}件 / 累計 ${merged.length}件 保存`);

  if (rows.length === 0) {
    await clearJob();
    sendStatus('⚠️ このページで0件でした。停止しました。「現在ページを診断」を押してください。');
    return true;
  }

  const reachedEnd = job.endPage && info.current >= job.endPage;
  const reachedLast = info.total && info.current >= info.total;
  if (reachedEnd || reachedLast) {
    await clearJob();
    sendStatus(`✅ 一覧スキャン完了: 合計 ${merged.length}件`);
    return true;
  }

  await sleep(job.delay || 2500);
  const nextLink = findNextPageLink();
  if (!nextLink) {
    await clearJob();
    sendStatus(`⚠️ 「次へ」リンクが見つからないため終了。合計 ${merged.length}件`);
    return true;
  }
  sendStatus(`次のページへ遷移します… (${info.current + 1})`);
  if (nextLink.tagName === 'A' && nextLink.href && !nextLink.getAttribute('onclick')) {
    location.href = nextLink.href;
  } else {
    nextLink.click();
  }
  return true;
}

// ============ マージ ============
function mergeCustomers(existing, fresh) {
  const map = new Map();
  [...existing, ...fresh].forEach(c => {
    const customerNo = normalizeValue(c.customer_no);
    const key = customerNo
      ? `no:${customerNo}`
      : c.detail_key
        ? `detail:${c.detail_key}`
        : c.detail_url
          ? `url:${c.detail_url}`
          : `name:${normalizeValue(c.kana)}|${normalizeValue(c.full_name)}|${normalizeValue(c.last_visit_date)}|${normalizeValue(c.visit_count)}|p${c.scan_page || ''}r${c.scan_row || ''}`;
    if (!key || key === 'name:||||p r') return;
    const prev = map.get(key) || {};
    map.set(key, { ...prev, ...c });
  });
  return [...map.values()];
}

// ============ 詳細ページ判定&パース ============
function isDetailPage() {
  const txt = (document.body.innerText || document.body.textContent || '');
  // 画面上部に「お客様情報詳細」、または「基本情報」「来店情報」などの見出しがある
  return /お客様情報詳細|基本情報[\s\S]*来店情報/.test(txt);
}

function extractDetailInfoFromBody() {
  const obj = {};
  // 顧客IDをページから取得（例: 顧客ID:C00971546190）
  const idTxt = (document.body.innerText || document.body.textContent || '').match(/顧客\s*ID\s*[:：]\s*([0-9A-Za-z_-]+)/);
  if (idTxt) obj.detail_key = idTxt[1];

  // テーブル th/td のラベル→値マッピング
  document.querySelectorAll('th').forEach(th => {
    const label = cleanText(th);
    let td = th.nextElementSibling;
    if (!td || td.tagName !== 'TD') return;
    let val = cleanText(td);
    if (!val || val === '-' || val === '－') return;

    if (/氏名.*漢字|^氏名$/.test(label) && !obj.full_name) obj.full_name = val.replace(/ダイレクト会員|会員/g, '').trim();
    else if (/氏名.*カナ/.test(label)) obj.kana = val;
    else if (/電話番号\s*1|^電話番号$/.test(label)) obj.phone = val;
    else if (/電話番号\s*2/.test(label)) obj.phone2 = val;
    else if (/E-?MAIL.*PC/i.test(label)) obj.email = val;
    else if (/E-?MAIL.*携帯/i.test(label)) obj.email_mobile = val;
    else if (/誕生日|生年月日/.test(label)) obj.birthday = val;
    else if (/血液型/.test(label)) obj.blood_type = val;
    else if (/職業/.test(label)) obj.occupation = val;
    else if (/性別/.test(label)) obj.gender = val.split(/\s|・|\n/)[0];
    else if (/^住所$|住所/.test(label)) obj.address = val;
    else if (/お客様メモ/.test(label)) obj.memo = val;
    else if (/初回来店/.test(label)) obj.first_visit_date = val;
    else if (/来店回数/.test(label)) obj.visit_count = val;
    else if (/お客様番号|顧客番号/.test(label)) obj.customer_no = val;
    else if (/要注意/.test(label)) obj.warning_flag = val;
    else if (/その他\s*1/.test(label)) obj.other1 = val;
    else if (/その他\s*2/.test(label)) obj.other2 = val;
    else if (/その他\s*3/.test(label)) obj.other3 = val;
    else if (/はがき/.test(label)) obj.postcard = val;
    else if (/来店きっかけ/.test(label)) obj.visit_trigger = val;
  });

  // 予約履歴テーブル(来店日 / スタイリスト / ステータス / メニュー …)
  try {
    const tables = [...document.querySelectorAll('table')];
    for (const t of tables) {
      const head = cleanText(t.querySelector('thead') || t.querySelector('tr'));
      if (/来店日/.test(head) && /メニュー|店販|サービス/.test(head)) {
        const history = [];
        t.querySelectorAll('tbody tr, tr').forEach(tr => {
          if (tr.querySelectorAll('th').length) return;
          const tds = [...tr.querySelectorAll('td')].map(cleanText);
          if (tds.length >= 4) {
            history.push({
              visit_date: tds[0] || '',
              stylist: tds[1] || '',
              route: tds[2] || '',
              status: tds[3] || '',
              menu: tds[4] || '',
              memo: tds[5] || '',
            });
          }
        });
        if (history.length) obj.visit_history = history;
        break;
      }
    }
  } catch (e) {}

  return obj;
}

// ============ 詳細スキャン自動継続 ============
async function autoContinueDetailJob() {
  const job = await getDetailJob();
  if (!job || !job.active) return false;

  // 詳細ページに居る場合: パースして保存→一覧へ戻る
  if (isDetailPage()) {
    await sleep(800); // レンダー完了待ち
    const detail = extractDetailInfoFromBody();
    const customers = await getStored();

    // 対象顧客を特定: 期待キー or 顧客ID or 名前で
    const expectKey = job.currentKey;
    const idx = customers.findIndex(c => {
      if (expectKey && (c.detail_key === expectKey || c.customer_no === expectKey)) return true;
      if (detail.detail_key && c.detail_key === detail.detail_key) return true;
      if (detail.customer_no && c.customer_no === detail.customer_no) return true;
      if (detail.full_name && c.full_name === detail.full_name && c.kana === detail.kana) return true;
      return false;
    });
    if (idx >= 0) {
      customers[idx] = { ...customers[idx], ...detail, detail_fetched: true };
      await saveStored(customers);
      sendStatus(`📥 詳細取得: ${detail.full_name || customers[idx].full_name || '(名前不明)'} [${job.processed + 1}/${job.totalTargets}]`);
    } else {
      sendStatus(`⚠️ 一致する顧客が見つかりません(${detail.full_name || '?'})`);
    }

    job.processed = (job.processed || 0) + 1;
    job.currentKey = null;
    await setDetailJob(job);

    await sleep(job.delay || 2500);
    // 一覧へ戻る
    if (job.listUrl) {
      location.href = job.listUrl;
    } else {
      history.back();
    }
    return true;
  }

  // 一覧ページに居る場合: 次のターゲットをクリック
  const table = findListTable();
  if (!table) {
    // まだロード中の可能性。少し待つ
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (findListTable()) break;
    }
  }

  const customers = await getStored();
  const remaining = customers.filter(c => !c.detail_fetched);
  if (remaining.length === 0) {
    await clearDetailJob();
    sendStatus(`✅ 詳細スキャン完了: 全 ${job.totalTargets} 件取得済み`);
    return true;
  }

  // 現在の一覧ページから、未取得顧客の名前リンクを探す
  const tbl = findListTable();
  if (!tbl) {
    sendStatus('⚠️ 一覧ページのテーブルが見つかりません');
    return true;
  }

  let clickedTarget = null;
  const trs = [...tbl.querySelectorAll('tbody tr, tr')];
  for (const tr of trs) {
    if (tr.querySelectorAll('th').length) continue;
    const link = tr.querySelector('a[href], a[onclick]');
    if (!link) continue;
    const sig = getLinkSignature(link);
    if (!sig) continue;
    // 未取得顧客の中に、このリンクに対応するものがあるか
    const tds = [...tr.querySelectorAll('td')].map(cleanText);
    const linkText = cleanText(link);
    const target = remaining.find(c => {
      if (sig.detail_key && c.detail_key && sig.detail_key === c.detail_key) return true;
      if (linkText && c.kana === linkText) return true;
      // 行データの全文一致(漢字名 or カナ)
      if (c.full_name && tds.some(t => t.includes(c.full_name))) return true;
      if (c.kana && tds.some(t => t === c.kana)) return true;
      return false;
    });
    if (target) {
      clickedTarget = { target, link, sig };
      break;
    }
  }

  if (clickedTarget) {
    const key = clickedTarget.target.detail_key || clickedTarget.target.customer_no || clickedTarget.target.full_name;
    job.currentKey = key;
    job.listUrl = location.href; // 戻り先として記録
    await setDetailJob(job);
    sendStatus(`▶ 詳細を開きます: ${clickedTarget.target.full_name || clickedTarget.target.kana || '(名前不明)'} [${job.processed + 1}/${job.totalTargets}]`);
    await sleep(500);
    clickedTarget.link.click();
    return true;
  }

  // このページに未取得顧客がいない → 次ページへ
  await sleep(job.delay || 2500);
  const nextLink = findNextPageLink();
  if (nextLink) {
    sendStatus('このページに未取得なし。次ページへ…');
    if (nextLink.tagName === 'A' && nextLink.href && !nextLink.getAttribute('onclick')) {
      location.href = nextLink.href;
    } else {
      nextLink.click();
    }
    return true;
  }

  // 最終ページ到達
  await clearDetailJob();
  const stillRemaining = (await getStored()).filter(c => !c.detail_fetched).length;
  sendStatus(`✅ 詳細スキャン終了。未取得 ${stillRemaining} 件 (リンク不一致の可能性)`);
  return true;
}

// ============ メッセージ受信 ============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.action === 'scanList') {
      if (msg.reset) await saveStored([]);
      await clearDetailJob();
      await setJob({ active: true, endPage: msg.endPage || null, delay: msg.delay || 2500, startedAt: Date.now() });
      sendStatus(msg.reset ? 'スキャン開始: 保存済みデータをクリアして自動巡回します' : 'スキャン開始: 現在ページから自動巡回します');
      await autoContinueListJob();
    } else if (msg.action === 'stopScan') {
      await clearJob();
      await clearDetailJob();
      sendStatus('⏸ スキャン(一覧/詳細)を停止しました');
    } else if (msg.action === 'scanDetails') {
      await clearJob();
      const customers = await getStored();
      const targets = customers.filter(c => !c.detail_fetched);
      if (!targets.length) {
        sendStatus('対象がありません(全件取得済み)。「クリア」してから再スキャンするか、未取得が出る条件を確認してください');
        return;
      }
      await setDetailJob({
        active: true,
        delay: msg.delay || 2500,
        totalTargets: targets.length,
        processed: 0,
        currentKey: null,
        listUrl: location.href, // 開始時の一覧URLを戻り先に
        startedAt: Date.now(),
      });
      sendStatus(`詳細スキャン開始: ${targets.length}件を1件ずつ実画面で開きます`);
      await autoContinueDetailJob();
    } else if (msg.action === 'debug') {
      const r = parseListPage();
      const p = getPageInfo();
      const next = findNextPageLink();
      const stored = await getStored();
      const fetched = stored.filter(c => c.detail_fetched).length;
      sendStatus(`診断: ${r.debug} / ページ ${p.current}/${p.total || '?'} (該当${p.totalCount || '?'}件) / 次へ:${next ? '✓' : '✗'} / 保存${stored.length}件(詳細済${fetched}) / 詳細ページ判定:${isDetailPage() ? 'YES' : 'NO'}`);
      console.log('[SB Exporter] 診断', { parse: r, page: p, nextLink: next, isDetail: isDetailPage() });
    }
    sendResponse({ ok: true });
  })();
  return true;
});

// ============ ページロード時に自動継続 ============
async function bootAutoContinue() {
  // 詳細ジョブが優先
  const dj = await getDetailJob();
  if (dj && dj.active) { await autoContinueDetailJob(); return; }
  const lj = await getJob();
  if (lj && lj.active) { await autoContinueListJob(); return; }
}

if (document.readyState === 'complete') {
  bootAutoContinue();
} else {
  window.addEventListener('load', () => setTimeout(bootAutoContinue, 1000));
}

console.log('[Salon Board Exporter] v5 ready');

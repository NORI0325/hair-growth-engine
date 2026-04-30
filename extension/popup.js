const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $('status').textContent = msg; };

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(action, payload = {}) {
  const tab = await getActiveTab();
  if (!tab.url || !tab.url.includes('salonboard.com')) {
    setStatus('⚠️ サロンボードのページで実行してください');
    return null;
  }
  return chrome.tabs.sendMessage(tab.id, { action, ...payload });
}

$('scanList').addEventListener('click', async () => {
  const startPage = parseInt($('startPage').value) || 1;
  const endPageVal = $('endPage').value;
  const endPage = endPageVal ? parseInt(endPageVal) : null;
  const delay = parseInt($('delay').value) || 2500;
  setStatus('一覧スキャン開始…');
  await send('scanList', { startPage, endPage, delay });
});

$('scanDetails').addEventListener('click', async () => {
  const delay = parseInt($('delay').value) || 2500;
  setStatus('詳細スキャン開始…');
  await send('scanDetails', { delay });
});

$('downloadCsv').addEventListener('click', async () => {
  const { customers = [] } = await chrome.storage.local.get('customers');
  if (!customers.length) { setStatus('データがありません。先にスキャンしてください'); return; }
  
  // CSVヘッダ（インポート用に整形）
  const headers = [
    'full_name', 'kana', 'customer_no', 'gender', 'occupation',
    'visit_count', 'last_visit_date', 'first_visit_date',
    'phone', 'phone2', 'email', 'email_mobile', 'birthday', 'blood_type',
    'address', 'memo', 'detail_url'
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = [headers.join(',')];
  customers.forEach(c => rows.push(headers.map(h => escape(c[h])).join(',')));
  
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().slice(0,10);
  chrome.downloads.download({ url, filename: `salonboard_customers_${ts}.csv`, saveAs: true });
  setStatus(`✅ ${customers.length}件をCSVに出力しました`);
});

$('clearData').addEventListener('click', async () => {
  if (!confirm('保存した顧客データをすべて削除しますか？')) return;
  await chrome.storage.local.remove('customers');
  setStatus('データをクリアしました');
});

// Status受信
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') setStatus(msg.text);
});

// 初期表示
(async () => {
  const { customers = [] } = await chrome.storage.local.get('customers');
  if (customers.length) setStatus(`保存済み: ${customers.length}件`);
})();

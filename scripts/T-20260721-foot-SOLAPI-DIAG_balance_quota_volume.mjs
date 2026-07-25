/**
 * T-20260721-foot-SOLAPI-DAILY-SMS-QUOTA-EXCEEDED — 2단계 진단
 * 목적:
 *   A. 결제 집행 주체 판정 근거: 계정별 잔액 + 계정/플랜/결제수단 API 조회 시도
 *   B. 충전 규모 근거: 최근 30일 계정 전체 실발송량 페이징 pull (limit=500 truncate 극복)
 *   부수: 일일한도 상향(②) 판단용 plan/quota 정보 수집
 * 실행: node scripts/T-20260721-foot-SOLAPI-DIAG_balance_quota_volume.mjs
 * 인증: service_role → get_vault_secret RPC (DB password 불요), Solapi HMAC-SHA256
 * READ-ONLY: 어떤 발송·충전·변경도 하지 않음 (조회 전용)
 */
import fs from 'fs';
import crypto from 'crypto';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

async function vault(name) {
  const r = await fetch(BASE + '/rest/v1/rpc/get_vault_secret', {
    method: 'POST',
    headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: name }),
  });
  const t = await r.text();
  if (!r.ok) return { err: `rpc ${r.status}: ${t.slice(0, 120)}` };
  // RPC returns bare string (json-encoded) or null
  let v = t;
  try { v = JSON.parse(t); } catch (_) {}
  return { val: v };
}

function authHdr(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = crypto.createHmac('sha256', apiSecret).update(`${date}${salt}`).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solGet(apiKey, apiSecret, path) {
  const res = await fetch('https://api.solapi.com' + path, {
    method: 'GET',
    headers: { Authorization: authHdr(apiKey, apiSecret), 'Content-Type': 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const ACCOUNTS = [
  // keyVault/secVault = Vault 참조명(포인터, 시크릿 아님). gitleaks 오탐 회피 위해 clinic short-id로 조립.
  { label: 'A 종로(오리진)', clinic: '74967aea', owner: '문지은', accountId: '26041008595272' },
  { label: 'B 송도',        clinic: 'b4dc0de5', owner: '박영진', accountId: '26041010278719' },
].map((a) => ({ ...a, keyVault: 'solapi_api_key_' + a.clinic, secVault: 'solapi_secret_' + a.clinic }));

// 30일 발송량 페이징 pull
async function volume30d(apiKey, apiSecret) {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const startStr = start.toISOString();
  let nextKey = null, page = 0, total = 0;
  const byStatus = {};
  const byDay = {};
  do {
    let path = `/messages/v4/list?limit=500&startDate=${encodeURIComponent(startStr)}`;
    if (nextKey) path += `&startKey=${encodeURIComponent(nextKey)}`;
    const { status, json } = await solGet(apiKey, apiSecret, path);
    if (status !== 200) return { err: `list ${status}: ${JSON.stringify(json).slice(0, 200)}`, total, byStatus, byDay, pages: page };
    const list = json.messageList || json.data || {};
    const ids = Object.keys(list);
    for (const id of ids) {
      const m = list[id];
      total++;
      const sc = m.statusCode || m.status || '?';
      byStatus[sc] = (byStatus[sc] || 0) + 1;
      const d = (m.dateCreated || m.dateReceived || '').slice(0, 10);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    }
    nextKey = json.nextKey || null;
    page++;
    if (page > 200) break; // safety
  } while (nextKey);
  return { total, byStatus, byDay, pages: page };
}

(async () => {
  const out = { ts: new Date().toISOString(), accounts: [] };
  for (const a of ACCOUNTS) {
    const rec = { label: a.label, clinic: a.clinic, owner: a.owner, accountId: a.accountId };
    const k = await vault(a.keyVault);
    const s = await vault(a.secVault);
    if (k.err || s.err || !k.val || !s.val) {
      rec.vault_error = { key: k.err || (!k.val ? 'null' : 'ok'), secret: s.err || (!s.val ? 'null' : 'ok') };
      out.accounts.push(rec);
      continue;
    }
    const apiKey = k.val, apiSecret = s.val;
    rec.apiKeyTail = String(apiKey).slice(-4);

    // 1) balance
    const bal = await solGet(apiKey, apiSecret, '/cash/v1/balance');
    rec.balance = bal;

    // 2) account/plan info (여러 후보 endpoint 시도)
    for (const p of ['/account/v1/me', '/cash/v1/quota', '/messages/v4/quota']) {
      const r = await solGet(apiKey, apiSecret, p);
      rec['probe_' + p.replace(/\W+/g, '_')] = { status: r.status, json: r.json };
    }

    // 3) 30일 발송량
    rec.volume30d = await volume30d(apiKey, apiSecret);
    out.accounts.push(rec);
  }
  const path = `_artifacts/T-20260721-SOLAPI-DIAG_${Date.now()}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log('WROTE', path);
  // 요약 출력
  for (const a of out.accounts) {
    console.log('\n===', a.label, '(' + a.owner + ' / acct', a.accountId + ') ===');
    if (a.vault_error) { console.log('  VAULT ERROR', a.vault_error); continue; }
    console.log('  balance:', a.balance.status, JSON.stringify(a.balance.json));
    console.log('  probe /account/v1/me:', a.probe__account_v1_me?.status, JSON.stringify(a.probe__account_v1_me?.json).slice(0, 300));
    if (a.volume30d) console.log('  vol30d total=', a.volume30d.total, 'pages=', a.volume30d.pages, 'byStatus=', JSON.stringify(a.volume30d.byStatus), a.volume30d.err ? ('ERR=' + a.volume30d.err) : '');
  }
})();

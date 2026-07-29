/**
 * T-20260729-foot-SOLAPI-3CENTER-ACCOUNT-REMAP — 착수전 실증 (READ-ONLY)
 *
 * 목적: 종로(74967aea)/송도(b4dc0de5) vault slot ↔ SolAPI 계정 실매핑 + 발신번호 등록 현황 확인.
 * 주의:
 *   - vault 시크릿 값은 절대 출력하지 않음(get_vault_secret RPC로 런타임 사용만).
 *   - SolAPI 호출은 /cash/v1/balance, /senderid/v1/numbers 뿐 — READ-ONLY, 발송·과금 없음.
 *   - 어떤 vault write / DB write / 발송도 하지 않음.
 *
 * 실행: node scripts/T-20260729-foot-SOLAPI-3CENTER-ACCOUNT-REMAP_readonly_diag.mjs
 * 필요 env(.env.local): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import fs from 'fs';
import crypto from 'crypto';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(p) {
  const r = await fetch(`${URL}/rest/v1/${p}`, { headers: H });
  return r.ok ? r.json() : { err: r.status, body: await r.text() };
}
async function rpc(fn, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return r.ok ? r.json() : { err: r.status };
}
function solapiAuth(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
async function solapi(apiKey, apiSecret, path) {
  const r = await fetch(`https://api.solapi.com${path}`, { headers: { Authorization: solapiAuth(apiKey, apiSecret) } });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 200) }; }
}

const SLOTS = [
  { slug: '74967aea', label: '종로(74967aea)' },
  { slug: 'b4dc0de5', label: '송도(b4dc0de5)/박영진' },
];

console.log('== clinic_messaging_capability (시크릿 값 없음) ==');
console.log(JSON.stringify(await rest('clinic_messaging_capability?select=clinic_id,enabled,sender_number,kakao_channel_id,solapi_api_key_vault_name,solapi_validation_status'), null, 1));

for (const { slug, label } of SLOTS) {
  const k = await rpc('get_vault_secret', { p_name: 'solapi_api_key_' + slug });
  const s = await rpc('get_vault_secret', { p_name: 'solapi_secret_' + slug });
  if (typeof k !== 'string' || typeof s !== 'string') { console.log(`\n${label}: vault slot 미존재/조회실패`); continue; }
  const bal = await solapi(k, s, '/cash/v1/balance');
  const num = await solapi(k, s, '/senderid/v1/numbers');
  const ids = (num.json?.senderIds || []).map((x) => `${x.phoneNumber || x.number}(${x.status})`).join(', ');
  console.log(`\n== ${label} (key prefix ${String(k).slice(0, 4)}…) ==`);
  console.log(`   accountId=${bal.json?.accountId} balance=${bal.json?.balance}`);
  console.log(`   registered senderIds=[${ids}]`);
}

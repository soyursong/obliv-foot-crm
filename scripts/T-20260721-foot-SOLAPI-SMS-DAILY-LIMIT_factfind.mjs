/**
 * T-20260721-foot-SOLAPI-SMS-DAILY-LIMIT-EXCEEDED — fact-finding (READ-ONLY)
 * AC-1: 솔라피 계정/API key 식별 + 현재 일일 SMS 한도 + 금일 발송량
 * AC-2: (콘솔/문서 기반, 스크립트 외) 한도 상향 옵션
 * 절대 write 없음. Solapi 키는 Vault RPC로 EF와 동일 경로 조회.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); }
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── 1. clinic_messaging_capability — foot CRM 발송 설정 식별 ──
const { data: caps, error: capErr } = await sb
  .from('clinic_messaging_capability')
  .select('clinic_id, enabled, solapi_api_key_vault_name, solapi_secret_vault_name, sender_number, solapi_validation_status');
if (capErr) { console.error('cap query err:', capErr.message); process.exit(1); }
console.log('=== clinic_messaging_capability (foot CRM) ===');
for (const c of caps ?? []) {
  console.log(`  clinic=${c.clinic_id} enabled=${c.enabled} sender=${c.sender_number} validStatus=${c.solapi_validation_status}`);
  console.log(`    api_key_vault=${c.solapi_api_key_vault_name} secret_vault=${c.solapi_secret_vault_name}`);
}

// 대표 vault(첫 enabled) 로 Solapi 조회
const primary = (caps ?? []).find(c => c.enabled && c.solapi_api_key_vault_name) ?? (caps ?? [])[0];
if (!primary) { console.error('no capability row'); process.exit(1); }

const apiKey = (await sb.rpc('get_vault_secret', { p_name: primary.solapi_api_key_vault_name })).data;
const apiSecret = (await sb.rpc('get_vault_secret', { p_name: primary.solapi_secret_vault_name })).data;
if (!apiKey || !apiSecret) { console.error('vault secret 조회 실패'); process.exit(1); }
console.log(`\n=== Solapi 계정 식별 ===`);
console.log(`  vault=${primary.solapi_api_key_vault_name}  apiKey(prefix)=${String(apiKey).slice(0,8)}…  len=${String(apiKey).length}`);

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}`;
}
async function solapiGet(path) {
  try {
    const res = await fetch(`https://api.solapi.com${path}`, { headers: { Authorization: authHeader() } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (e) { return { status: 0, body: { error: String(e) } }; }
}

// ── 2. 계정 정보 (멤버/조직) ──
console.log('\n=== [GET /users/v1/member] 계정 정보 ===');
const me = await solapiGet('/users/v1/member');
console.log('  status', me.status, JSON.stringify(me.body).slice(0, 600));

// ── 3. 잔액 ──
console.log('\n=== [GET /cash/v1/balance] 잔액 ===');
const bal = await solapiGet('/cash/v1/balance');
console.log('  status', bal.status, JSON.stringify(bal.body).slice(0, 400));

// ── 4. 발송 제한/한도 관련 엔드포인트 탐침 ──
for (const p of [
  '/messages/v4/send-limit',
  '/messages/v4/limit',
  '/users/v1/limit',
  '/senderid/v1/numbers?limit=20',
]) {
  console.log(`\n=== [GET ${p}] ===`);
  const r = await solapiGet(p);
  console.log('  status', r.status, JSON.stringify(r.body).slice(0, 600));
}

// ── 5. 금일 발송량 (Solapi message list, KST 자정 기준) ──
// 오늘 = 2026-07-21 KST → startDate 2026-07-20T15:00:00Z
const kstMidnightUtc = '2026-07-20T15:00:00Z';
console.log(`\n=== [GET /messages/v4/list] 금일(KST) 발송량 startDate=${kstMidnightUtc} ===`);
let totalToday = 0; const codeDist = {};
for (let page = 0; page < 5; page++) {
  const params = new URLSearchParams({ limit: '500', startDate: kstMidnightUtc });
  const r = await solapiGet(`/messages/v4/list?${params}`);
  if (r.status !== 200) { console.log('  list err', r.status, JSON.stringify(r.body).slice(0,300)); break; }
  const msgs = Object.values(r.body.messageList ?? {});
  totalToday += msgs.length;
  for (const m of msgs) { const k = `${m.statusCode}/${m.status}`; codeDist[k] = (codeDist[k] ?? 0) + 1; }
  if (msgs.length < 500) break;
}
console.log(`  Solapi 금일 메시지 총 ${totalToday}건`);
console.log('  statusCode 분포:', JSON.stringify(codeDist, null, 2));

// ── 6. DB notification_logs 금일 발송량 (KST) ──
const { count: dbSent } = await sb.from('notification_logs').select('*', { count: 'exact', head: true })
  .gte('sent_at', kstMidnightUtc);
const { data: statusRows } = await sb.from('notification_logs')
  .select('status').gte('created_at', kstMidnightUtc);
const dbDist = {};
for (const r of statusRows ?? []) dbDist[r.status] = (dbDist[r.status] ?? 0) + 1;
console.log('\n=== DB notification_logs 금일(KST) ===');
console.log(`  sent_at>=today sent건수: ${dbSent}`);
console.log('  status 분포(created today):', JSON.stringify(dbDist));

// ── 7. 최근 실패(한도초과) 로그 스니핑 ──
const { data: failRows } = await sb.from('notification_logs')
  .select('event_type, status, error_message, created_at')
  .gte('created_at', kstMidnightUtc)
  .in('status', ['failed'])
  .order('created_at', { ascending: false })
  .limit(15);
console.log('\n=== 금일 failed 로그 (최근 15) ===');
for (const r of failRows ?? []) console.log(`  ${r.created_at} ${r.event_type} :: ${String(r.error_message ?? '').slice(0,120)}`);

console.log('\n[factfind DONE]');

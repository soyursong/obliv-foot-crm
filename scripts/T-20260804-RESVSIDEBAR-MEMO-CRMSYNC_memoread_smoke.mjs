/**
 * T-20260804-dopamine-RESVSIDEBAR-MEMO-CRMSYNC-BIDIR-ALLBRANCH — foot-reservation-memo-read 라이브 스모크
 *
 * 배포 후 실행(supervisor field-soak / green gate). 실 HTTP 로 endpoint 계약 검증.
 * env: FOOT_CALENDAR_READ_SECRET (read-only secret), VITE_SUPABASE_URL (.env.local)
 * usage: FOOT_CALENDAR_READ_SECRET=... node scripts/T-20260804-RESVSIDEBAR-MEMO-CRMSYNC_memoread_smoke.mjs [reservation_id]
 */
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const secret = process.env.FOOT_CALENDAR_READ_SECRET || env.FOOT_CALENDAR_READ_SECRET;
const RID = process.argv[2] || 'f744fbcc-b9e4-47e7-bad6-c27e74312ae4'; // 최경옥 default
if (!base || !secret) { console.error('❌ VITE_SUPABASE_URL + FOOT_CALENDAR_READ_SECRET 필요'); process.exit(1); }
const url = `${base}/functions/v1/foot-reservation-memo-read`;

async function call(headers, body, label) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  console.log(`\n[${label}] status=${r.status}`, JSON.stringify(j).slice(0, 500));
  return { status: r.status, j };
}

let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL', msg); } };

// 1) 인증 누락 → 401
const a = await call({}, { reservation_id: RID }, 'no-secret');
check(a.status === 401, '헤더 없음 → 401');

// 2) 잘못된 secret → 401
const b = await call({ 'X-Foot-Read-Secret': 'wrong' }, { reservation_id: RID }, 'wrong-secret');
check(b.status === 401, '불일치 secret → 401');

// 3) 잘못된 UUID → 400
const c = await call({ 'X-Foot-Read-Secret': secret }, { reservation_id: 'not-a-uuid' }, 'bad-uuid');
check(c.status === 400, '비-UUID → 400');

// 4) 정상 read → 200 + memo 필드
const d = await call({ 'X-Foot-Read-Secret': secret }, { reservation_id: RID, caller: 'smoke' }, 'ok-read');
check(d.status === 200 && d.j.ok === true, '정상 → 200 ok');
check(d.j.read_only === true, 'read_only=true');
check('memo' in d.j && 'sync_memo' in d.j && Array.isArray(d.j.memo_entries), 'contract 필드(memo/sync_memo/memo_entries) 존재');
check(!('customer_name' in d.j) && !('customer_phone' in d.j), 'R2 masking parity — 고객 PII 미반환');

console.log(`\n=== smoke: ${pass} passed / ${fail} failed ===`);
process.exit(fail ? 1 : 0);

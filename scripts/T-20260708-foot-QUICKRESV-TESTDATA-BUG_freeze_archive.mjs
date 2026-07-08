/**
 * T-20260708-foot-QUICKRESV-TESTDATA-BUG — PHASE 1: FREEZE + ARCHIVE-FIRST (READ-ONLY + archive dump)
 * SCOPE-LOCK v2 (reporter 김주연 총괄 승인 2026-07-08 13:51, "AA"=A선택).
 *
 * 삭제 대상(단건, id-pin): reservations id=229caeff-24ed-4b04-a076-6c7a19fd3481
 *   기대값: 이름=접수테스트, phone +821066675557(끝 5557), status=confirmed, customer_id=NULL(orphan)
 * 보존 대상(절대 무접촉): 접수테스트2 = customers 41c2852c / F-4510 / 4447 (+ reservation fd13ce8b)
 *
 * 이 스크립트는 파괴 동작 없음: freeze 재조회 + archive JSON/SQL 덤프만.
 * freeze 불일치 시 EXIT 2(abort) → DELETE 진행 금지.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TARGET_ID = '229caeff-24ed-4b04-a076-6c7a19fd3481';
const PRESERVE_CUST_ID = '41c2852c-d647-474c-8777-bc17111ff7d1'; // 접수테스트2 customers id (F-4510/4447)
const PRESERVE_RESV_ID = 'fd13ce8b-e5fe-40f3-8997-f0e1cc6588b2'; // 접수테스트2 reservation id
const EXPECT = { name: '접수테스트', phoneTail: '5557', status: 'confirmed', customer_id: null };

// off-git 보관 (연락처 포함) — .gitignore rollback/T-20260708-foot-QUICKRESV-TESTDATA-BUG_* 매칭
const EVID_DIR = new URL('../rollback/', import.meta.url).pathname;
mkdirSync(EVID_DIR, { recursive: true });

function fail(msg, extra) {
  console.error('\n❌ ABORT:', msg);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  process.exit(2);
}

console.log('=== PHASE 1: FREEZE 재조회 (삭제 대상 단건) ===');
const { data: rows, error } = await sb
  .from('reservations')
  .select('*')
  .eq('id', TARGET_ID);
if (error) fail('freeze SELECT error', error);
if (!rows || rows.length !== 1) fail(`대상 행 정확히 1건이어야 함 (실제 ${rows?.length ?? 0}건)`, rows);

const row = rows[0];
console.log('freeze 행:', JSON.stringify(row, null, 2));

// --- 가드: 기대값 정합 재검증 ---
const phone = String(row.customer_phone ?? row.phone ?? '');
const checks = {
  customer_id_is_null: row.customer_id === null || row.customer_id === undefined,
  name_match: (row.customer_name ?? row.name ?? '') === EXPECT.name,
  phone_tail_5557: phone.endsWith(EXPECT.phoneTail),
  status_confirmed: row.status === EXPECT.status,
};
console.log('\n=== 가드 정합 체크 ===');
console.log(JSON.stringify(checks, null, 2));
console.log('실제 phone:', phone, '| 실제 name:', row.customer_name ?? row.name);
if (!Object.values(checks).every(Boolean)) {
  fail('freeze 값이 SCOPE-LOCK v2 기대값과 불일치 — 추정 삭제 금지. planner FOLLOWUP 반환.', { checks, row });
}
console.log('✅ freeze 정합 PASS — customer_id=NULL·5557·접수테스트·confirmed 일치.');

// --- 보존 대상 스냅샷 (접수테스트2) ---
console.log('\n=== 보존 대상 접수테스트2 스냅샷 (무접촉 baseline) ===');
const { data: pcust } = await sb.from('customers').select('*').eq('id', PRESERVE_CUST_ID);
const { data: presv } = await sb.from('reservations').select('*').eq('id', PRESERVE_RESV_ID);
console.log(`보존 customers(${PRESERVE_CUST_ID}): ${pcust?.length ?? 0}건`, pcust?.[0]?.name, pcust?.[0]?.chart_number);
console.log(`보존 reservations(${PRESERVE_RESV_ID}): ${presv?.length ?? 0}건`, presv?.[0]?.status);
if ((pcust?.length ?? 0) !== 1 || (presv?.length ?? 0) !== 1) fail('보존 대상 baseline 불일치 — 접수테스트2가 예상과 다름. abort.', { pcust, presv });

// --- archive-first 덤프 (rollback 경로) ---
const archive = {
  ticket: 'T-20260708-foot-QUICKRESV-TESTDATA-BUG',
  scope_lock: 'v2 (reporter 김주연 총괄 승인 2026-07-08 13:51, MSG-20260708-135046-rzo3)',
  archived_reservation: row,
  preserve_baseline: { customers: pcust ?? [], reservations: presv ?? [] },
};
const jsonPath = EVID_DIR + 'T-20260708-foot-QUICKRESV-TESTDATA-BUG_archive_reservation_229caeff.json';
writeFileSync(jsonPath, JSON.stringify(archive, null, 2));

// rollback INSERT SQL 덤프
const cols = Object.keys(row);
const vals = cols.map((c) => {
  const v = row[c];
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
});
const sqlPath = EVID_DIR + 'T-20260708-foot-QUICKRESV-TESTDATA-BUG_rollback_reinsert_229caeff.sql';
const sql = `-- ROLLBACK: 실수 삭제 시 아래로 재삽입 (archive-first)\n-- 대상 reservations id=${TARGET_ID}\nINSERT INTO reservations (${cols.join(', ')})\nVALUES (${vals.join(', ')});\n`;
writeFileSync(sqlPath, sql);

console.log('\n✅ archive-first 완료');
console.log('  JSON:', jsonPath);
console.log('  ROLLBACK SQL:', sqlPath);
console.log('\n=== PHASE 1 DONE — freeze PASS. PHASE 2(DELETE) 진행 가능. ===');

/**
 * P1 fix — 오늘(2026-06-08) 더미 예약 76건에 customer_id 연결
 * 1) customers 테이블에 더미 76건 INSERT (이름+phone+visit_type, is_simulation=true, memo='테스트 더미')
 * 2) reservations.customer_id UPDATE
 *
 * Idempotent: phone unique key 로 dedup. 기존 더미 customer 있으면 INSERT 스킵하고 UPDATE만.
 * Rollback: rollback_foot_dummy_link_20260608.sql 동시 생성.
 *
 * DRY_RUN=1 환경변수로 무변경 미리보기.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DATE = '2026-06-08';
const DRY = process.env.DRY_RUN === '1';

console.log(DRY ? '== DRY-RUN ==' : '== APPLY ==');

const { data: rs, error } = await sb
  .from('reservations')
  .select('id, customer_id, customer_name, customer_phone, visit_type, clinic_id')
  .eq('reservation_date', DATE)
  .eq('memo', '테스트 더미');
if (error) { console.error('rs err', error); process.exit(1); }
console.log(`대상 예약: ${rs.length}건`);

const nullCnt = rs.filter(r => !r.customer_id).length;
console.log(`이미 customer_id 연결된 건: ${rs.length - nullCnt} / 미연결: ${nullCnt}`);

// === Step A: customers upsert (phone unique) ===
// 동일 phone 의 기존 customer (sim or non-sim) 확인 후 없을 때만 INSERT
const phones = [...new Set(rs.map(r => r.customer_phone).filter(Boolean))];
console.log(`고유 phone: ${phones.length}개`);

const { data: existing } = await sb
  .from('customers')
  .select('id, phone, name')
  .in('phone', phones);
const byPhone = new Map((existing ?? []).map(c => [c.phone, c]));
console.log(`이미 customers에 있는 phone: ${byPhone.size}건`);

// 예약별 dedup: 같은 phone 중복 예약은 같은 customer 1건만
const seenPhone = new Set();
const toInsert = [];
const phoneToReservations = new Map(); // phone -> [reservation rows]

for (const r of rs) {
  if (!r.customer_phone) continue;
  if (!phoneToReservations.has(r.customer_phone)) phoneToReservations.set(r.customer_phone, []);
  phoneToReservations.get(r.customer_phone).push(r);

  if (seenPhone.has(r.customer_phone)) continue;
  seenPhone.add(r.customer_phone);
  if (byPhone.has(r.customer_phone)) continue; // 이미 있음 → 재사용

  toInsert.push({
    clinic_id: r.clinic_id,
    name: r.customer_name,
    phone: r.customer_phone,
    visit_type: r.visit_type,
    is_simulation: true,
    memo: '테스트 더미',
  });
}
console.log(`신규 INSERT 대상: ${toInsert.length}건`);
console.log('샘플:', toInsert.slice(0, 3));

if (DRY) {
  // 예약 매칭 미리보기
  console.log('\n== DRY 매칭 시뮬 ==');
  const previewPhones = phones.slice(0, 5);
  for (const ph of previewPhones) {
    const resvCount = phoneToReservations.get(ph)?.length ?? 0;
    console.log(`  ${ph} -> ${resvCount} reservations`);
  }
  console.log('\nDRY-RUN 완료. 실제 적용하려면 DRY_RUN=0 (또는 미지정) 후 재실행.');
  process.exit(0);
}

// === Step B: INSERT customers ===
let createdIds = new Map(); // phone -> new customer id
if (toInsert.length) {
  const { data: ins, error: ie } = await sb
    .from('customers')
    .insert(toInsert)
    .select('id, phone, name');
  if (ie) { console.error('customers insert err', ie); process.exit(1); }
  console.log(`customers INSERT 완료: ${ins.length}건`);
  for (const c of ins) createdIds.set(c.phone, c.id);
}
// merge existing + created
const phoneToId = new Map();
for (const c of (existing ?? [])) phoneToId.set(c.phone, c.id);
for (const [ph, id] of createdIds) phoneToId.set(ph, id);

// === Step C: reservations UPDATE customer_id (only those still NULL) ===
const updates = [];
for (const r of rs) {
  if (r.customer_id) continue;
  const cid = phoneToId.get(r.customer_phone);
  if (!cid) {
    console.warn(`매칭 못 찾음: ${r.id} ${r.customer_name} ${r.customer_phone}`);
    continue;
  }
  updates.push({ id: r.id, customer_id: cid });
}
console.log(`reservations UPDATE 대상: ${updates.length}건`);

let ok = 0, fail = 0;
for (const u of updates) {
  const { error: ue } = await sb
    .from('reservations')
    .update({ customer_id: u.customer_id })
    .eq('id', u.id);
  if (ue) { fail++; console.error('upd err', u.id, ue.message); }
  else ok++;
}
console.log(`UPDATE 결과: 성공 ${ok}, 실패 ${fail}`);

// === Step D: rollback SQL 출력 ===
const rollbackPath = '/Users/domas/Documents/GitHub/obliv-foot-crm/rollback/rollback_foot_dummy_link_20260608.sql';
const rollbackSql = `-- Rollback for foot dummy link 2026-06-08
-- 1) reservations customer_id 를 NULL 로 되돌림 (오늘 더미 한정)
UPDATE reservations
SET customer_id = NULL
WHERE reservation_date = '2026-06-08'
  AND memo = '테스트 더미';

-- 2) 더미로 생성한 customers 삭제 (is_simulation=true + memo='테스트 더미' + 오늘 INSERT)
DELETE FROM customers
WHERE is_simulation = true
  AND memo = '테스트 더미'
  AND created_at >= '2026-06-08 00:00:00+09'
  AND id IN (${[...createdIds.values()].map(id => `'${id}'`).join(',\n      ')});
`;
try {
  fs.mkdirSync('/Users/domas/Documents/GitHub/obliv-foot-crm/rollback', { recursive: true });
  fs.writeFileSync(rollbackPath, rollbackSql, 'utf-8');
  console.log(`rollback SQL: ${rollbackPath}`);
} catch (e) {
  console.warn('rollback write fail', e.message);
}

// === Step E: 검증 ===
console.log('\n== 검증: customer_id NULL 잔여 ==');
const { data: post } = await sb
  .from('reservations')
  .select('id, customer_id, customer_name')
  .eq('reservation_date', DATE)
  .eq('memo', '테스트 더미');
const stillNull = post.filter(r => !r.customer_id).length;
console.log(`총 ${post.length}, NULL 잔여 ${stillNull}`);
if (stillNull === 0) {
  console.log('FIX OK — 모든 더미 예약에 customer_id 연결 완료');
  // 샘플 한 명 차트 시뮬
  console.log('\n--- 샘플 5건 ---');
  post.slice(0, 5).forEach(r => console.log(`  ${r.customer_name} -> ${r.customer_id?.slice(0,8)}`));
} else {
  console.log('잔여 있음 — 수동 확인 필요');
}

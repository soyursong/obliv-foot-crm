/**
 * T-20260804-dopamine-RESVSIDEBAR-MEMO-CRMSYNC-BIDIR-ALLBRANCH — lane B(dev-foot) service_role 감사
 *
 * ★ READ-ONLY. prod write 절대 금지. service_role(RLS bypass)로 실 필드 확정만.
 *
 * 목적 (FIX-REQUEST MSG-20260804-152243-uo5a 작업1):
 *   repro 예약(phone/name = argv/env 로만 주입, 소스에 실환자값 미기재 §4.3)으로
 *   (i)  풋 "예약메모" 실 필드 = reservations.memo vs booking_memo vs reservation_memo_history(rmh)
 *   (ii) dopamine push(memo:input.memo??null)가 무엇을 overwrite 했는지
 *   → 08-03 VANISH 모순(무손실 결론 vs repro 실소실) dispositive 해소.
 *
 * usage: node scripts/T-20260804-RESVSIDEBAR-MEMO-CRMSYNC_laneB_audit.mjs <phone_digits> [name]
 *   실환자 phone/name 은 소스에 하드코딩 금지 — 실행 시 argv 로만 주입(§4.3 UUID-PK-only redaction).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('❌ url/service_role key 필요'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

// ★ 실환자값 하드코딩 금지(§4.3) — phone digits/name 은 argv 로만 주입.
const RAW_PHONE = (process.argv[2] || '').replace(/[^0-9]/g, '');
const RAW_NAME = process.argv[3] || '';
if (!RAW_PHONE) { console.error('❌ usage: node <script> <phone_digits> [name]  (실환자값은 argv 로만)'); process.exit(1); }
const digits10 = RAW_PHONE.replace(/^82/, '0');            // 82-prefixed → 0-leading national
const digitsNat = digits10.replace(/^0/, '');               // drop leading 0 → national digits
const PHONE_VARIANTS = [`+82${digitsNat}`, digits10, `82${digitsNat}`];

const j = (o) => JSON.stringify(o, null, 2);

(async () => {
  console.log('=== [0] reservations 컬럼 스키마 (memo-계열 확인) ===');
  const { data: cols, error: colErr } = await db.rpc('__nonexistent__').then(() => ({})).catch(() => ({}));
  // 스키마는 information_schema 대신 실 row 키로 추론(아래 [2]에서).
  if (colErr) {}

  console.log('\n=== [1] 고객 찾기 (customers, phone variants) ===');
  let customerRows = [];
  for (const p of PHONE_VARIANTS) {
    const { data, error } = await db.from('customers').select('id, name, phone, clinic_id, created_at').eq('phone', p);
    if (error) { console.log(`  phone=${p} ERROR: ${error.message}`); continue; }
    if (data && data.length) { console.log(`  phone=${p} → ${data.length}건`); customerRows.push(...data); }
  }
  // 이름 기반 폴백
  let byName = [];
  if (RAW_NAME) {
    const r = await db.from('customers').select('id, name, phone, clinic_id, created_at').ilike('name', `%${RAW_NAME}%`);
    byName = r.data || [];
    if (byName.length) console.log(`  name~(argv) → ${byName.length}건`);
  }
  const allCust = [...customerRows, ...(byName || [])];
  const custIds = [...new Set(allCust.map(c => c.id))];
  console.log('  customers:', j(allCust));
  console.log('  customer_ids:', custIds);

  console.log('\n=== [2] reservations (해당 고객 or phone) — 전 컬럼 ===');
  let resvRows = [];
  if (custIds.length) {
    const { data, error } = await db.from('reservations').select('*').in('customer_id', custIds).order('created_at', { ascending: false });
    if (error) console.log('  by customer_id ERROR:', error.message);
    else resvRows.push(...(data || []));
  }
  // phone-embedded external_id 폴백 (dopamine self-mint)
  for (const p of [`82${digitsNat}`, digits10, digitsNat]) {
    const { data } = await db.from('reservations').select('*').ilike('external_id', `%${p}%`).order('created_at', { ascending: false });
    if (data && data.length) resvRows.push(...data);
  }
  // dedup by id
  const seen = new Set();
  resvRows = resvRows.filter(r => !seen.has(r.id) && seen.add(r.id));
  console.log(`  reservations: ${resvRows.length}건`);
  if (resvRows.length) {
    console.log('  ▶ 컬럼 키:', Object.keys(resvRows[0]).join(', '));
    for (const r of resvRows) {
      console.log('  ---');
      console.log('   id                :', r.id);
      console.log('   date/time         :', r.reservation_date, r.reservation_time);
      console.log('   status            :', r.status);
      console.log('   source_system     :', r.source_system);
      console.log('   external_id       :', r.external_id);
      console.log('   created_at        :', r.created_at);
      console.log('   updated_at        :', r.updated_at);
      console.log('   memo (deprecated?):', j(r.memo));
      console.log('   booking_memo      :', j(r.booking_memo));
      console.log('   customer_memo     :', j(r.customer_memo));
      console.log('   brief_note        :', j(r.brief_note));
    }
  }

  console.log('\n=== [3] reservation_memo_history (rmh) — 해당 예약 timeline 전량 ===');
  const rids = resvRows.map(r => r.id);
  if (rids.length) {
    const { data: rmh, error: rmhErr } = await db.from('reservation_memo_history')
      .select('*').in('reservation_id', rids).order('created_at', { ascending: true });
    if (rmhErr) console.log('  rmh ERROR:', rmhErr.message);
    else {
      console.log(`  rmh rows: ${rmh.length}건`);
      for (const m of rmh) {
        console.log('  ---');
        console.log('   id            :', m.id);
        console.log('   reservation_id:', m.reservation_id);
        console.log('   source_system :', j(m.source_system), '(NULL=사람저작 / dopamine=sync)');
        console.log('   content       :', j(m.content));
        console.log('   created_by_name:', j(m.created_by_name));
        console.log('   is_pinned     :', m.is_pinned);
        console.log('   created_at    :', m.created_at);
      }
    }
  } else {
    console.log('  (해당 예약 없음 → rmh skip)');
  }

  console.log('\n=== [4] 판정 요약 ===');
  for (const r of resvRows) {
    const hasResvMemo = r.memo != null && String(r.memo).trim() !== '';
    const hasBooking = r.booking_memo != null && String(r.booking_memo).trim() !== '';
    console.log(`  resv ${r.id}: reservations.memo=${hasResvMemo ? 'NON-EMPTY' : 'empty/NULL'}, booking_memo=${hasBooking ? 'NON-EMPTY' : 'empty/NULL'}, source=${r.source_system}`);
  }
  console.log('\n(감사 종료 — write 0)');
})().catch(e => { console.error('FATAL', e); process.exit(1); });

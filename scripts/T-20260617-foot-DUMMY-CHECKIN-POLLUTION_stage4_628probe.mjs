/**
 * T-20260617-foot-DUMMY-CHECKIN-POLLUTION — Stage 4 PROBE (READ-ONLY, 쓰기 0)
 *
 * 목적(planner MSG-...040619 c-2):
 *   6/28 라이브 오염 13건(reservation_id NULL · 6/28 active status)의
 *   ① status 분포 → "active set" 확정  ② created_at 배치 윈도(ad-hoc 출처 추적)
 *   ③ phone 시퀀스 / is_simulation 마킹 여부  ④ 6/17 30건 키와의 비중첩 교차검증
 *   을 순수 SELECT 로 산출. 어떤 write 도 하지 않음(--apply 경로 없음).
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://rxlomoozakkjesdqjtvd.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),
  { auth: { persistSession: false } },
);
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// KST 6/28 00:00~24:00 → UTC
const D628_FROM = '2026-06-27T15:00:00Z';
const D628_TO   = '2026-06-28T15:00:00Z';
// 6/17 배치(교차검증용)
const D617_CREATED_FROM = '2026-06-17T01:08:00Z';
const D617_CREATED_TO   = '2026-06-17T01:09:00Z';

const norm = (s) => (s || '').replace(/\d/g, '#'); // phone 패턴 마스킹 비교용

async function main() {
  console.log(`== Stage4 PROBE [READ-ONLY] jongno-foot 6/28 check_ins ==\n`);

  // 1) 6/28 KST 에 checked_in_at 이 찍힌, reservation_id NULL check_ins 전수
  const { data: rows, error } = await sb
    .from('check_ins')
    .select('id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, checked_in_at, created_at, notes')
    .eq('clinic_id', CLINIC)
    .is('reservation_id', null)
    .gte('checked_in_at', D628_FROM).lt('checked_in_at', D628_TO)
    .order('created_at');
  if (error) throw new Error(`6/28 조회 실패: ${error.message}`);
  console.log(`[A] reservation_id IS NULL & checked_in_at(KST)=6/28 후보: ${rows.length}건`);

  // 2) status 분포 → active set 확정
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log(`\n[B] status 분포:`);
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`    ${s}: ${n}`);

  // 3) created_at 배치 윈도 (ad-hoc 출처 추적)
  const created = rows.map((r) => r.created_at).filter(Boolean).sort();
  console.log(`\n[C] created_at 범위: ${created[0]} ~ ${created[created.length - 1]} (n=${created.length})`);
  // 분(minute) 단위 군집
  const byMin = {};
  for (const c of created) { const k = c.slice(0, 16); byMin[k] = (byMin[k] || 0) + 1; }
  console.log(`    분단위 군집:`);
  for (const [k, n] of Object.entries(byMin).sort()) console.log(`      ${k}Z : ${n}`);

  // 4) phone 시퀀스 / is_simulation 마킹
  const cids = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  const { data: custs } = await sb.from('customers')
    .select('id, name, phone, visit_type, is_simulation, created_at')
    .in('id', cids.length ? cids : ['00000000-0000-0000-0000-000000000000']);
  const simTrue = (custs || []).filter((c) => c.is_simulation === true).length;
  const simFalse = (custs || []).filter((c) => c.is_simulation === false).length;
  console.log(`\n[D] 연결 customers ${custs?.length ?? 0}건 — is_simulation TRUE=${simTrue} / FALSE=${simFalse}`);
  const phonePat = {};
  for (const r of rows) { const p = norm(r.customer_phone); phonePat[p] = (phonePat[p] || 0) + 1; }
  console.log(`    phone 패턴(숫자→#):`);
  for (const [p, n] of Object.entries(phonePat).sort((a, b) => b[1] - a[1])) console.log(`      ${p} : ${n}`);

  // 5) 행별 상세 (이름은 앞1자만 — 실환자 식별 가드)
  console.log(`\n[E] 행 상세(이름 앞1자):`);
  for (const r of rows) {
    const nm = (r.customer_name || '').slice(0, 1) + '*';
    console.log(`    ${r.id.slice(0, 8)} ${nm} ${r.customer_phone} vt=${r.visit_type} st=${r.status} chk=${r.checked_in_at} cr=${r.created_at}`);
  }

  // 6) 6/17 30건 키와 비중첩 교차검증
  const { data: d617 } = await sb.from('check_ins')
    .select('id, status, created_at')
    .eq('clinic_id', CLINIC).is('reservation_id', null).eq('status', 'registered')
    .gte('created_at', D617_CREATED_FROM).lt('created_at', D617_CREATED_TO);
  const set628 = new Set(rows.map((r) => r.id));
  const overlap = (d617 || []).filter((r) => set628.has(r.id));
  console.log(`\n[F] 6/17 배치 잔존 ${d617?.length ?? 0}건 / 6/28셋과 id 중첩 ${overlap.length}건 (0 이어야 비중첩)`);

  // 7) daily_closings 6/28 영향
  const { data: dc } = await sb.from('daily_closings')
    .select('id, close_date, status, closed_at, single_cash_total, actual_card_total')
    .eq('clinic_id', CLINIC).gte('close_date', '2026-06-27').lte('close_date', '2026-06-29').order('close_date');
  console.log(`\n[G] daily_closings(6/27~6/29 jongno-foot): ${dc?.length ?? 0}건`);
  for (const r of (dc || [])) console.log(`    ${r.close_date} status=${r.status} closed_at=${r.closed_at ?? '-'} 단품현금=${r.single_cash_total} 실수금카드=${r.actual_card_total}`);

  console.log(`\n== PROBE 끝 (쓰기 0) ==`);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });

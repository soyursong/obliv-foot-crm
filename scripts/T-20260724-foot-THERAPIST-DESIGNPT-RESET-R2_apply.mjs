/**
 * T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2 — AC-2 집행 (Opt-C keep-only-F-4507)
 *
 * 김주연 총괄 현장 confirm(2026-07-24 13:46): F-4552(이민태)=churn/7-18 계정정리 잔재 삭제확정 → Opt-C.
 *
 * 집행:
 *   ① apply-time freeze 재검증 (divergence면 ABORT — Cross-CRM freeze-set 재검증 abort)
 *   ② customers.designated_therapist_id = NULL WHERE clinic + not null + chart <> F-4507
 *      → rows-affected 검증 (Cross-CRM Write Rows-Affected 표준): 반환행 == 대상셋, F-4507 미포함
 *   ③ orphan-trace 정리(archive-first): F-4552 reservations.preferred_therapist_id(=duplicate 박소예) → NULL
 *      원값 스냅샷 선보존 후 정리. hard-DELETE 없음(컬럼 참조 해제만).
 *   ④ post-verify: clinic designated == {F-4507} 단독, F-4552 designated+preferred 양자 NULL
 *   ⑤ rollback SQL(customers + reservation) 재생성
 *
 * 접속: service-role over PostgREST (RLS bypass). 단일 PATCH = 원자적.
 * 실행: node scripts/T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_apply.mjs
 *   (--commit 없이 실행 시 DRY-RUN: 검증만, PATCH 미실행)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const SECRETS = `${process.env.HOME}/.config/medibuilder-secrets`;
const URL = readFileSync(`${SECRETS}/foot-supabase-url`, 'utf8').trim().replace(/\/$/, '');
const KEY = readFileSync(`${SECRETS}/foot-supabase-service-role`, 'utf8').trim();
const REST = `${URL}/rest/v1`;

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PRESERVE_CHART = 'F-4507';
const REAL_PARKSOYE = '5fb3e3b1-1c5a-461b-9159-c330a52feb95'; // 실 박소예 (F-4507 담당)
const F4552_ID = '5659dad8-c486-465f-a842-a0f41dbd478c';

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const die = (m, extra) => { console.error('ABORT:', m, extra ? JSON.stringify(extra, null, 2) : ''); process.exit(2); };

async function get(path) {
  const r = await fetch(`${REST}/${path}`, { headers: { ...H, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function patch(path, body) {
  const r = await fetch(`${REST}/${path}`, {
    method: 'PATCH',
    headers: { ...H, Accept: 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
  return r.json(); // affected rows representation
}

const main = async () => {
  console.log(`=== ${COMMIT ? 'COMMIT' : 'DRY-RUN'} mode ===`);

  // ── ① apply-time freeze 재검증 ──
  const rows = await get(
    `customers?clinic_id=eq.${CLINIC}&designated_therapist_id=not.is.null` +
    `&select=id,name,chart_number,designated_therapist_id&order=chart_number.asc`
  );
  const preserveRow = rows.find(r => r.chart_number === PRESERVE_CHART);
  if (!preserveRow) die('AC-1b: F-4507 보존대상 부재 — pause+planner 재확인 필요', { rows });
  if (preserveRow.designated_therapist_id !== REAL_PARKSOYE)
    die('AC-1b: F-4507 담당이 실 박소예가 아님 — pause+planner 재확인', { preserveRow, expected: REAL_PARKSOYE });

  const targets = rows.filter(r => r.chart_number !== PRESERVE_CHART);
  const targetIds = targets.map(t => t.id);
  if (targets.some(t => t.id === preserveRow.id)) die('불변식 위반: 보존행이 대상셋에 포함');
  console.log('freeze:', JSON.stringify({
    clinic_total_assigned: rows.length,
    preserve: `${preserveRow.chart_number} -> 박소예(${REAL_PARKSOYE})`,
    targets: targets.map(t => `${t.chart_number} ${t.name}`),
  }, null, 2));

  // F-4552 orphan reservation 재조회
  const f4552Resv = await get(
    `reservations?customer_id=eq.${F4552_ID}&preferred_therapist_id=not.is.null` +
    `&select=id,preferred_therapist_id,reservation_date,status`
  );

  // rollback SQL 재생성 (customers 대상 + reservation orphan)
  const rollback = [
    `-- ROLLBACK for T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2 (Opt-C keep-only-F-4507)`,
    `-- 스냅샷 원값 per-row 복원. F-4507 미변경(보존). captured at apply-time.`,
    `BEGIN;`,
    ...targets.map(t =>
      `UPDATE customers SET designated_therapist_id = '${t.designated_therapist_id}' WHERE id = '${t.id}';  -- ${t.chart_number} ${t.name}`
    ),
    ...f4552Resv.map(rv =>
      `UPDATE reservations SET preferred_therapist_id = '${rv.preferred_therapist_id}' WHERE id = '${rv.id}';  -- F-4552 orphan resv ${rv.reservation_date}`
    ),
    `COMMIT;`,
    ``,
  ].join('\n');
  writeFileSync(join(__dirname, 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_rollback.sql'), rollback);
  console.log('rollback SQL 재생성 완료.');

  if (!COMMIT) {
    console.log('\nDRY-RUN 종료 — PATCH 미실행. 적용하려면 --commit.');
    return;
  }

  // ── ② customers SET NULL (Opt-C 규칙) ──
  const affectedCust = await patch(
    `customers?clinic_id=eq.${CLINIC}&designated_therapist_id=not.is.null&chart_number=neq.${PRESERVE_CHART}` +
    `&select=id,chart_number,name,designated_therapist_id`,
    { designated_therapist_id: null }
  );
  // rows-affected 검증
  const affectedIds = affectedCust.map(r => r.id).sort();
  const expectedIds = [...targetIds].sort();
  if (JSON.stringify(affectedIds) !== JSON.stringify(expectedIds))
    die('rows-affected 불일치 (customers)', { affectedIds, expectedIds });
  if (affectedCust.some(r => r.chart_number === PRESERVE_CHART)) die('불변식 위반: F-4507 이 UPDATE에 포함됨');
  if (affectedCust.some(r => r.designated_therapist_id !== null)) die('불변식 위반: NULL 미적용 행 존재');
  console.log(`② customers NULL 적용: ${affectedCust.length} rows`, affectedCust.map(r => `${r.chart_number} ${r.name}`));

  // ── ③ orphan-trace 정리 (F-4552 reservation preferred → NULL, archive-first) ──
  let affectedResv = [];
  if (f4552Resv.length) {
    affectedResv = await patch(
      `reservations?customer_id=eq.${F4552_ID}&preferred_therapist_id=not.is.null&select=id,preferred_therapist_id`,
      { preferred_therapist_id: null }
    );
    if (affectedResv.length !== f4552Resv.length)
      die('rows-affected 불일치 (reservation orphan)', { got: affectedResv.length, expected: f4552Resv.length });
    if (affectedResv.some(r => r.preferred_therapist_id !== null)) die('불변식 위반: reservation preferred NULL 미적용');
    console.log(`③ F-4552 orphan reservation NULL 적용: ${affectedResv.length} rows`);
  } else {
    console.log('③ F-4552 orphan reservation 무접점 — 정리 대상 없음.');
  }

  // ── ④ post-verify ──
  const post = await get(
    `customers?clinic_id=eq.${CLINIC}&designated_therapist_id=not.is.null&select=id,chart_number,name,designated_therapist_id`
  );
  if (post.length !== 1 || post[0].chart_number !== PRESERVE_CHART || post[0].designated_therapist_id !== REAL_PARKSOYE)
    die('post-verify 실패: clinic designated 잔여 != {F-4507/박소예}', { post });

  const f4552Post = await get(`customers?id=eq.${F4552_ID}&select=chart_number,designated_therapist_id`);
  const f4552ResvPost = await get(`reservations?customer_id=eq.${F4552_ID}&preferred_therapist_id=not.is.null&select=id`);
  if (f4552Post[0].designated_therapist_id !== null) die('post-verify 실패: F-4552 designated 잔존');
  if (f4552ResvPost.length !== 0) die('post-verify 실패: F-4552 reservation preferred 잔존');

  const result = {
    ticket: 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2',
    applied_at: new Date().toISOString(),
    mode: 'COMMIT',
    customers_nulled: affectedCust.map(r => ({ id: r.id, chart: r.chart_number, name: r.name })),
    reservation_orphans_cleared: affectedResv.map(r => r.id),
    post_verify: {
      clinic_designated_remaining: post.map(r => `${r.chart_number} -> 박소예`),
      f4552_designated_null: f4552Post[0].designated_therapist_id === null,
      f4552_reservation_preferred_null: f4552ResvPost.length === 0,
    },
    ac3_designated_count: { '박소예': 1, others: 0 },
  };
  writeFileSync(join(__dirname, 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_apply_result.json'), JSON.stringify(result, null, 2));
  console.log('\n④ POST-VERIFY PASS:\n', JSON.stringify(result.post_verify, null, 2));
  console.log('\n✅ 집행 완료.');
};

main().catch(e => { console.error('FATAL', e); process.exit(1); });

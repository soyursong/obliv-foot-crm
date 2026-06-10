/**
 * T-20260610-foot-RESV-DUPGUARD-SAMEDAY — Step3.1~3.4 집행
 *
 * Y-CONFIRM 수신(김주연 총괄 "웅 진행ㄱ", reply_ts 1781056892.979629, 2026-06-10).
 * confirm 시트 scripts/out/resv_dedupe_confirm_request.md + dry-run scripts/out/resv_dedupe_dryrun_report.md.
 *
 * Step3.1: 13그룹(14 row) 중복 status='cancelled' 논리삭제 — DELETE 절대 금지(내방기록 보존).
 *          확정 override 2건:
 *            - 류복화 05-24: KEEP checked_in 7dba8647 / CANCEL noshow e061d191 (dry-run 기본 역전)
 *            - 김창재 05-20: KEEP checked_in cf9d146a / CANCEL 동시간중복 422f364e (dry-run 기본 동일)
 * Step3.2: 재조사 — 동일고객+당일 활성중복(status NOT IN cancelled) COUNT=0 확인.
 * Step3.3: 0건일 때만 partial UNIQUE idx_reservations_customer_daily 적용(23505 회피).
 * Step3.4: pg_indexes 로 index 존재 확인.
 *
 * 가드: 0건 아니면 index 적용 보류 + 멈추고 보고(exit 2).
 * 실행: node scripts/apply_20260610100020_dedupe_and_unique_index.mjs
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const INDEX_SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260610100010_reservations_customer_daily_unique.sql'),
  'utf8',
);

// 확정 CANCEL(DROP) 대상 — 14 row (13그룹). 김주연 총괄 Y-CONFIRM.
const CANCEL_IDS = [
  '7f14bf4f-5e1c-448b-ab33-5f5fd482e86a', // 장예지 06-09 checked_in
  '549b131a-0dc6-4b1e-badd-71da4b74174b', // 장예지 06-07 checked_in
  '65c601fe-b45a-49aa-8b75-d5da39f9d3b2', // 김규리 06-01 checked_in 동시간
  '9041191a-e1c0-41da-bd8c-a1b5f4f539a4', // 김민경 06-01 checked_in 15:00
  'ea1aed6e-d1a9-475b-bcaf-7e9e7bdd3914', // 김민경 06-01 checked_in 14:30
  '65ef70ff-17e8-430c-9dbb-0a3ac51d6201', // 김사비 05-24 noshow 14:30
  'e061d191-ac07-4bfa-886f-f66cfe1c62ce', // 류복화 05-24 noshow 13:30  ← OVERRIDE(KEEP=7dba8647 checked_in)
  'cd4c3681-66eb-452f-846a-8ed01dab444b', // 김민경 05-24 noshow 14:00
  'f733755e-bf93-4cfe-a4e1-4b3fa280e446', // 엄지원 05-20 noshow 19:00
  '422f364e-f1e7-41d3-b271-a0206193d5bf', // 김창재 05-20 checked_in 동시간중복
  '19e8a530-ad1c-4fc7-bd34-f5ef59ac047f', // 신규 05-19 checked_in
  '78787b99-93a1-43c2-8379-d58640d8bf92', // 김육번 05-17 checked_in
  '53de24da-5296-40ff-ba7a-008fb49003dc', // 강아지 06-03 QA
  '5a91233b-59f2-4168-b525-47221704a990', // 김일번 05-18 QA
];

// 반드시 활성으로 남아야 하는 KEEP(가드 검증용) — override 대상 포함.
const MUST_KEEP_IDS = [
  '7dba8647-8403-4070-82f0-75fa8948e989', // 류복화 KEEP checked_in 10:00 (override)
  'cf9d146a-cf03-4937-99c7-9fe31aaf1e5d', // 김창재 KEEP checked_in 20:00
];

const CANCEL_REASON = 'dedupe: same-day duplicate cleanup (T-20260610-foot-RESV-DUPGUARD-SAMEDAY, 김주연 confirm 2026-06-10)';

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };

(async () => {
  await client.connect();
  out('🚀 T-20260610-foot-RESV-DUPGUARD-SAMEDAY Step3 집행 시작');
  out(`   시각: ${new Date().toISOString()}`);

  // ── 사전 검증: CANCEL 대상 현재 상태 + KEEP 활성 확인 ──────────────────
  const { rows: preCancel } = await client.query(
    `SELECT id, customer_name, status, reservation_date, reservation_time
       FROM public.reservations WHERE id = ANY($1::uuid[]) ORDER BY reservation_date DESC`,
    [CANCEL_IDS],
  );
  out(`\n[사전검증] CANCEL 대상 조회: ${preCancel.length}/${CANCEL_IDS.length} 건 존재`);
  if (preCancel.length !== CANCEL_IDS.length) {
    const found = new Set(preCancel.map((r) => r.id));
    const missing = CANCEL_IDS.filter((id) => !found.has(id));
    out(`❌ 누락 id: ${missing.join(', ')} — 멈춤(데이터 불일치)`);
    throw new Error('CANCEL 대상 일부 미존재 — 집행 중단');
  }
  const alreadyCancelled = preCancel.filter((r) => r.status === 'cancelled');
  out(`   이미 cancelled: ${alreadyCancelled.length}건 (idempotent 통과)`);

  const { rows: preKeep } = await client.query(
    `SELECT id, customer_name, status FROM public.reservations WHERE id = ANY($1::uuid[])`,
    [MUST_KEEP_IDS],
  );
  out(`[사전검증] KEEP(활성유지) 대상: ${preKeep.length}/${MUST_KEEP_IDS.length} 건`);
  for (const k of preKeep) out(`   KEEP ${k.id} ${k.customer_name} status=${k.status}`);
  if (preKeep.some((k) => k.status === 'cancelled')) {
    throw new Error('KEEP 대상이 cancelled 상태 — 집행 중단(데이터 불일치)');
  }
  // CANCEL 목록에 KEEP id가 섞였는지 최종 안전망
  for (const k of MUST_KEEP_IDS) {
    if (CANCEL_IDS.includes(k)) throw new Error(`치명: KEEP id ${k} 가 CANCEL 목록에 포함됨`);
  }

  // ── Step3.1: 논리삭제 UPDATE (트랜잭션) ───────────────────────────────
  out('\n[Step3.1] 중복 row status=cancelled 논리삭제 (DELETE 아님)');
  await client.query('BEGIN');
  let updatedCount = 0;
  try {
    const { rows: updated } = await client.query(
      `UPDATE public.reservations
          SET status = 'cancelled',
              cancelled_at = COALESCE(cancelled_at, now()),
              cancel_reason = COALESCE(cancel_reason, $2),
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND status <> 'cancelled'
        RETURNING id, customer_name, reservation_date`,
      [CANCEL_IDS, CANCEL_REASON],
    );
    updatedCount = updated.length;
    await client.query('COMMIT');
    out(`   ✅ UPDATE 영향 row: ${updatedCount}건 (이미 취소 ${alreadyCancelled.length}건 제외)`);
    for (const u of updated) {
      const d = u.reservation_date instanceof Date ? u.reservation_date.toISOString().slice(0, 10) : String(u.reservation_date).slice(0, 10);
      out(`      cancelled: ${u.id} ${u.customer_name} ${d}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    out(`   ❌ UPDATE 실패 → ROLLBACK: ${e.message}`);
    throw e;
  }

  // KEEP 재확인 (취소 안 됐는지)
  const { rows: postKeep } = await client.query(
    `SELECT id, status FROM public.reservations WHERE id = ANY($1::uuid[])`,
    [MUST_KEEP_IDS],
  );
  if (postKeep.some((k) => k.status === 'cancelled')) {
    throw new Error('치명: dedupe 후 KEEP 대상이 cancelled 됨');
  }
  out(`   ✅ KEEP 무결: ${postKeep.map((k) => `${k.id}=${k.status}`).join(', ')}`);

  // ── Step3.2: 재조사 — 활성 중복 0건 ──────────────────────────────────
  out('\n[Step3.2] 재조사 — 동일고객+당일 활성 중복 COUNT');
  const { rows: recheck } = await client.query(`
    SELECT count(*)::int AS dup_groups FROM (
      SELECT clinic_id, customer_id, reservation_date
      FROM public.reservations
      WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
      GROUP BY clinic_id, customer_id, reservation_date
      HAVING count(*) > 1
    ) g;
  `);
  const dupGroups = recheck[0].dup_groups;
  out(`   활성 중복 그룹: ${dupGroups}건`);

  if (dupGroups !== 0) {
    // 잔존 그룹 상세 덤프
    const { rows: residual } = await client.query(`
      WITH dg AS (
        SELECT clinic_id, customer_id, reservation_date
        FROM public.reservations
        WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
        GROUP BY clinic_id, customer_id, reservation_date HAVING count(*) > 1)
      SELECT r.id, r.customer_name, r.status, r.reservation_date, r.reservation_time
      FROM public.reservations r JOIN dg ON dg.clinic_id=r.clinic_id AND dg.customer_id=r.customer_id AND dg.reservation_date=r.reservation_date
      WHERE r.status NOT IN ('cancelled') ORDER BY r.reservation_date DESC;`);
    out('   ⛔ 잔존 활성중복 → index 적용 보류. 잔존 상세:');
    for (const r of residual) out(`      ${r.id} ${r.customer_name} ${r.status} ${String(r.reservation_date).slice(0,10)} ${r.reservation_time}`);
    out('   → planner/supervisor 즉시 보고 필요. index 미적용으로 종료.');
    writeReport('HOLD_NONZERO');
    process.exitCode = 2;
    return;
  }
  out('   ✅ 활성 중복 0건 — index 적용 게이트 OPEN');

  // ── Step3.3: partial UNIQUE index 적용 ───────────────────────────────
  out('\n[Step3.3] idx_reservations_customer_daily partial UNIQUE 적용');
  await client.query(INDEX_SQL); // 마이그레이션 자체가 BEGIN/COMMIT + ASSERT 포함
  out('   ✅ index SQL 실행 완료 (마이그레이션 내부 ASSERT 통과)');

  // ── Step3.4: index 존재 확인 ─────────────────────────────────────────
  out('\n[Step3.4] pg_indexes 검증');
  const { rows: idx } = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename='reservations' AND indexname='idx_reservations_customer_daily';`);
  if (idx.length < 1) throw new Error('index 검증 실패 — pg_indexes 미존재');
  out(`   ✅ index 존재 확인: ${idx[0].indexname}`);
  out(`      def: ${idx[0].indexdef}`);

  out('\n🏁 Step3 집행 완료 — DB 게이트 종결');
  writeReport('DONE');

  function writeReport(state) {
    mkdirSync(OUT_DIR, { recursive: true });
    const md = `# Step3 집행 결과 — T-20260610-foot-RESV-DUPGUARD-SAMEDAY\n\n`
      + `상태: **${state}**\n생성: ${new Date().toISOString()}\n\n`
      + '```\n' + log.join('\n') + '\n```\n';
    writeFileSync(join(OUT_DIR, 'resv_dedupe_step3_execution_report.md'), md);
  }
})()
  .catch((e) => { console.error('❌ 치명:', e.message); process.exitCode = 1; })
  .finally(async () => { try { await client.end(); } catch {} });

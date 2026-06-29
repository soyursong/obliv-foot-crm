/**
 * T-20260602-foot-VISITTYPE-RETURNING-AUTOSET 트랙1 — DB 백필 적용
 *
 * supervisor SQL 게이트 = GO (티켓 "Supervisor SQL Gate (2026-06-02)").
 * 조건: (a) 적용 전 dry-run count + 대상 customer_id 캡처 보존,
 *       (b) 적용 후 변경 건수 기록, (c) 멱등·EXISTS 가드.
 *
 * 절차:
 *   STEP 0  dry-run count (트랜잭션 외부, read-only)
 *   STEP 1  대상 customer_id 목록 캡처 (롤백 추적 — 파일 보존)
 *   STEP 2  김민경 F-0177 적용 전 상태 캡처
 *   STEP 3  UPDATE (멱등 + EXISTS 가드) → 변경 건수
 *   STEP 4  김민경 F-0177 적용 후 실증 (visit_type='returning')
 *   STEP 5  진짜 초진 보존 카운트 재확인
 *
 * author: dev-foot 2026-06-02
 */
import pg from 'pg';
import fs from 'node:fs';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

const TS = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const captureFile = `scripts/visittype_backfill_capture_${TS}.json`;

try {
  await client.connect();
  console.log('✅ DB 연결 성공 (rxlomoozakkjesdqjtvd)\n');

  // STEP 0 — dry-run 영향 건수
  const dry = await client.query(`
    SELECT count(*)::int AS affected_count
    FROM public.customers c
    WHERE c.visit_type = 'new'
      AND EXISTS (SELECT 1 FROM public.check_ins ci
                  WHERE ci.customer_id = c.id AND ci.status = 'done');
  `);
  const affected = dry.rows[0].affected_count;
  console.log(`STEP 0 [dry-run] 백필 대상 건수: ${affected}건\n`);

  // STEP 1 — 대상 customer_id 목록 캡처 (롤백 추적용)
  const targets = await client.query(`
    SELECT c.id AS customer_id, c.chart_number, c.name,
           (SELECT count(*)::int FROM public.check_ins ci
            WHERE ci.customer_id = c.id AND ci.status = 'done') AS done_count
    FROM public.customers c
    WHERE c.visit_type = 'new'
      AND EXISTS (SELECT 1 FROM public.check_ins ci
                  WHERE ci.customer_id = c.id AND ci.status = 'done')
    ORDER BY done_count DESC, c.chart_number;
  `);
  fs.writeFileSync(captureFile, JSON.stringify({
    ticket: 'T-20260602-foot-VISITTYPE-RETURNING-AUTOSET',
    captured_at: new Date().toISOString(),
    affected_count: affected,
    targets: targets.rows,
  }, null, 2));
  console.log(`STEP 1 [캡처] 대상 ${targets.rows.length}건 → ${captureFile} 보존`);
  console.log('  상위 10건:');
  targets.rows.slice(0, 10).forEach(r =>
    console.log(`    ${r.chart_number} ${r.name} (done ${r.done_count}회) id=${r.customer_id}`));
  console.log();

  // STEP 2 — 김민경 F-0177 적용 전 상태
  const before = await client.query(`
    SELECT id, chart_number, name, visit_type,
           (SELECT count(*)::int FROM public.check_ins ci
            WHERE ci.customer_id = customers.id AND ci.status='done') AS done_count
    FROM public.customers WHERE chart_number = 'F-0177';
  `);
  console.log('STEP 2 [김민경 F-0177 적용 전]:', JSON.stringify(before.rows), '\n');

  // STEP 3 — UPDATE (멱등 + EXISTS 가드)
  const upd = await client.query(`
    UPDATE public.customers c
    SET visit_type = 'returning'
    WHERE c.visit_type = 'new'
      AND EXISTS (SELECT 1 FROM public.check_ins ci
                  WHERE ci.customer_id = c.id AND ci.status = 'done');
  `);
  console.log(`STEP 3 [UPDATE] 변경 건수: ${upd.rowCount}건 (dry-run ${affected}건과 일치 여부: ${upd.rowCount === affected ? 'OK' : 'MISMATCH⚠️'})\n`);

  // STEP 4 — 김민경 F-0177 적용 후 실증
  const after = await client.query(`
    SELECT id, chart_number, name, visit_type,
           (SELECT count(*)::int FROM public.check_ins ci
            WHERE ci.customer_id = customers.id AND ci.status='done') AS done_count
    FROM public.customers WHERE chart_number = 'F-0177';
  `);
  console.log('STEP 4 [김민경 F-0177 적용 후]:', JSON.stringify(after.rows));
  const kmk = after.rows[0];
  console.log(`  → visit_type = '${kmk?.visit_type}' ${kmk?.visit_type === 'returning' ? '✅ 재진 전환 확인' : '⚠️ 미전환'}\n`);

  // STEP 5 — 진짜 초진 보존 카운트
  const genuine = await client.query(`
    SELECT count(*)::int AS genuine_new_count
    FROM public.customers c
    WHERE c.visit_type = 'new'
      AND NOT EXISTS (SELECT 1 FROM public.check_ins ci
                      WHERE ci.customer_id = c.id AND ci.status = 'done');
  `);
  console.log(`STEP 5 [진짜 초진 보존] done 0건이면서 'new' 유지 고객: ${genuine.rows[0].genuine_new_count}건 (정상 보존)\n`);

  console.log('=== 요약 ===');
  console.log(`백필 변경: ${upd.rowCount}건 | 김민경 F-0177: ${kmk?.visit_type} | 진짜 초진 보존: ${genuine.rows[0].genuine_new_count}건`);
  console.log(`캡처 파일: ${captureFile}`);
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

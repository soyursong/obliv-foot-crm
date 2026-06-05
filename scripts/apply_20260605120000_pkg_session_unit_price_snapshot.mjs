/**
 * T-20260605-foot-SALES-STAFF-DEDUCT-BASIS — package_sessions.unit_price 스냅샷 근본 fix + 소급 backfill 적용
 *
 *   (1) BEFORE INSERT 트리거 fn_fill_session_unit_price(): unit_price NULL/0 이면 package 현재 단가 자동 스냅샷.
 *   (2) 소급 backfill: status='used' & unit_price NULL/0 인 58건을 package 현재 단가로 정정 (소스 0 인 구형 3건 제외).
 *
 * 실행 모드:
 *   node scripts/apply_20260605120000_pkg_session_unit_price_snapshot.mjs --dry-run   # SELECT only, 변경 없음
 *   node scripts/apply_20260605120000_pkg_session_unit_price_snapshot.mjs --apply      # 트리거 + backfill 트랜잭션 적용
 *
 * node-pg pooler 직접 연결. 멱등(재실행 안전). supabase/migrations/20260605120000_pkg_session_unit_price_snapshot.sql 와 동일.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const DRYRUN_SQL = `
SELECT s.session_type,
       COUNT(*) FILTER (WHERE s.unit_price IS NULL OR s.unit_price = 0) AS zero_before,
       COUNT(*) FILTER (WHERE (s.unit_price IS NULL OR s.unit_price = 0)
                          AND CASE s.session_type
                                WHEN 'heated_laser' THEN p.heated_unit_price
                                WHEN 'unheated_laser' THEN p.unheated_unit_price
                                WHEN 'iv' THEN p.iv_unit_price
                                WHEN 'podologue' THEN p.podologe_unit_price
                                WHEN 'podologe' THEN p.podologe_unit_price
                                WHEN 'trial' THEN p.trial_unit_price ELSE NULL END > 0) AS will_fill
FROM package_sessions s JOIN packages p ON p.id = s.package_id
WHERE s.status='used' GROUP BY s.session_type ORDER BY s.session_type;`;

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  // ── DRY-RUN: 변경 전 상태 SELECT ──
  console.log('\n── DRY-RUN PREVIEW (status=used 회차차감 by session_type) ──');
  const pre = await client.query(DRYRUN_SQL);
  console.table(pre.rows);
  const willFill = pre.rows.reduce((a, r) => a + Number(r.will_fill), 0);
  const zeroBefore = pre.rows.reduce((a, r) => a + Number(r.zero_before), 0);
  console.log(`▶ zero_before 합계 = ${zeroBefore}건,  will_fill 합계 = ${willFill}건  (기대: will_fill=58)`);

  // 트리거 존재 여부
  const trg = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='trg_fill_session_unit_price';`);
  console.log(`▶ 트리거 trg_fill_session_unit_price 존재: ${trg.rowCount > 0 ? 'YES' : 'NO'}`);

  if (MODE === 'dry-run') {
    console.log('\n🟡 dry-run 종료 (변경 없음).');
    await client.end();
    process.exit(0);
  }

  // ── APPLY ──
  console.log('\n── APPLY: 트리거 + backfill ──');
  await client.query('BEGIN');

  await client.query(`
    CREATE OR REPLACE FUNCTION fn_fill_session_unit_price()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
    BEGIN
      IF NEW.unit_price IS NULL OR NEW.unit_price = 0 THEN
        SELECT CASE NEW.session_type
                 WHEN 'heated_laser'   THEN p.heated_unit_price
                 WHEN 'unheated_laser' THEN p.unheated_unit_price
                 WHEN 'iv'             THEN p.iv_unit_price
                 WHEN 'podologue'      THEN p.podologe_unit_price
                 WHEN 'podologe'       THEN p.podologe_unit_price
                 WHEN 'trial'          THEN p.trial_unit_price
                 ELSE NULL
               END
          INTO NEW.unit_price
          FROM public.packages p
         WHERE p.id = NEW.package_id;
      END IF;
      RETURN NEW;
    END;
    $fn$;`);
  await client.query(`ALTER FUNCTION fn_fill_session_unit_price() OWNER TO postgres;`);
  await client.query(`DROP TRIGGER IF EXISTS trg_fill_session_unit_price ON public.package_sessions;`);
  await client.query(`
    CREATE TRIGGER trg_fill_session_unit_price
      BEFORE INSERT ON public.package_sessions
      FOR EACH ROW EXECUTE FUNCTION fn_fill_session_unit_price();`);
  await client.query(`COMMENT ON FUNCTION fn_fill_session_unit_price() IS
    '회차차감 insert 시 unit_price 미기록(NULL/0)이면 package 현재 단가를 스냅샷으로 자동 기록 (T-20260605-foot-SALES-STAFF-DEDUCT-BASIS)';`);

  const upd = await client.query(`
    UPDATE public.package_sessions ps
    SET unit_price = src.new_price
    FROM (
      SELECT s.id,
             CASE s.session_type
               WHEN 'heated_laser'   THEN p.heated_unit_price
               WHEN 'unheated_laser' THEN p.unheated_unit_price
               WHEN 'iv'             THEN p.iv_unit_price
               WHEN 'podologue'      THEN p.podologe_unit_price
               WHEN 'podologe'       THEN p.podologe_unit_price
               WHEN 'trial'          THEN p.trial_unit_price
               ELSE NULL
             END AS new_price
      FROM public.package_sessions s
      JOIN public.packages p ON p.id = s.package_id
      WHERE s.status = 'used'
        AND (s.unit_price IS NULL OR s.unit_price = 0)
    ) src
    WHERE ps.id = src.id AND src.new_price IS NOT NULL AND src.new_price > 0;`);
  console.log(`▶ backfill UPDATE rowCount = ${upd.rowCount}  (기대: 58)`);

  await client.query('COMMIT');
  console.log('✅ COMMIT 완료');

  // ── 적용 후 검증 SELECT ──
  console.log('\n── POST-APPLY 검증 ──');
  const post = await client.query(DRYRUN_SQL);
  console.table(post.rows);
  const postZero = post.rows.reduce((a, r) => a + Number(r.zero_before), 0);
  console.log(`▶ 잔존 zero(NULL/0) = ${postZero}건  (기대: 3건 = 소스단가 0 구형 패키지)`);

  // 담당치료사별 차감기준 매출(스냅샷) 집계 — 0원 아님 확인
  const staffSum = await client.query(`
    SELECT COALESCE(SUM(unit_price),0) AS deduct_basis_total,
           COUNT(*) FILTER (WHERE unit_price > 0) AS priced_used
    FROM package_sessions WHERE status='used';`);
  console.log('▶ 담당치료사별 차감기준 매출 합계(전체 used 스냅샷):', staffSum.rows[0]);

  await client.end();
  console.log('\n🟢 done.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}

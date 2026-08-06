/**
 * DRY-RUN (No-Persistence): T-20260806-foot-CLOSING-HERALD-TOTALS-RECOMPUTE-PORT
 *   20260806150000_foot_closing_herald_totals_recompute_port.sql
 *   (4함수 CREATE OR REPLACE — closing_source_split / closing_insurance_split /
 *    closing_month_projection / enqueue_closing_confirmed. function-diff)
 *
 * canonical 러너 scripts/dryrun_lib.mjs 위임(txn-control strip + plpgsql exception-rollback + assertAbsent post-probe).
 *   up.sql = BEGIN…COMMIT + 4 CREATE OR REPLACE + DO$seal$ + DO$verify$ + NOTIFY.
 *   stripTxnControl 이 top-level BEGIN;/COMMIT; 제거 → 나머지를 exception-handler 하 EXECUTE(무영속).
 *
 * ── 추가: 실데이터 INV 검증 DO 블록(무영속) ────────────────────────────────────
 *   up.sql 뒤에 INV 검증 DO 를 덧붙여, 무영속 서브트랜잭션 안에서 신 함수를 실 prod 데이터(08-01~08-06
 *   closed 마감)로 호출해 INV1(ad+org==total)·INV2(copay+nonins==total)·INV4(각>=0)·total==daily_closings
 *   sys_total 을 실증. 위반 시 RAISE → dry-run FAIL(무영속). 통과 시 sentinel unwind.
 *
 * ── 무영속 post-probe (CREATE OR REPLACE 특수) ──────────────────────────────
 *   4함수 전부 prod 존재 → procAbsent 불가. 신버전 고유 마커 'TOTALS-RECOMPUTE-PORT' 가 dry-run 후
 *   prod enqueue prosrc 에 부재(absent=true)함을 실측 → 롤백 하네스가 replace 를 영속시키지 않았음을 실증(INV-3).
 *
 * 실행: (repo root) node supabase/migrations/20260806150000_foot_closing_herald_totals_recompute_port.dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN.
 * author: dev-foot / 2026-08-06
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { runDryrun } from '../../scripts/dryrun_lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const UP = join(here, '20260806150000_foot_closing_herald_totals_recompute_port.sql');

// ── 실데이터 INV 검증(무영속) — 신 함수를 08-01~08-06 closed 마감으로 호출·불변식 실증 ──
const INV_VALIDATE = `
DO $inv_validate$
DECLARE
  r RECORD;
  v_src JSONB; v_ins JSONB;
  v_sys BIGINT; v_stot BIGINT; v_ad BIGINT; v_org BIGINT;
  v_itot BIGINT; v_cop BIGINT; v_non BIGINT; v_cov BIGINT;
  v_fail TEXT := '';
  v_n INT := 0;
BEGIN
  FOR r IN
    SELECT dc.clinic_id, dc.close_date,
      (COALESCE(dc.package_card_total,0)     + COALESCE(dc.single_card_total,0)
     + COALESCE(dc.package_cash_total,0)     + COALESCE(dc.single_cash_total,0)
     + COALESCE(dc.package_transfer_total,0) + COALESCE(dc.single_transfer_total,0)) AS sys_total
    FROM public.daily_closings dc
    WHERE dc.status='closed' AND dc.close_date BETWEEN '2026-08-01' AND '2026-08-06'
    ORDER BY dc.close_date
  LOOP
    v_n := v_n + 1;
    v_sys  := r.sys_total;
    v_src  := public.closing_source_split(r.clinic_id, r.close_date);
    v_ins  := public.closing_insurance_split(r.clinic_id, r.close_date);
    v_stot := (v_src->>'total')::bigint; v_ad := (v_src->>'revenue_ad')::bigint; v_org := (v_src->>'revenue_organic')::bigint;
    v_itot := (v_ins->>'total')::bigint; v_cop := (v_ins->>'rev_copay_self')::bigint;
    v_non  := (v_ins->>'rev_noninsurance')::bigint; v_cov := (v_ins->>'rev_insurance_covered')::bigint;
    IF v_stot <> v_sys           THEN v_fail := v_fail || format('[%s] src.total %s<>sys %s; ', r.close_date, v_stot, v_sys); END IF;
    IF v_ad + v_org <> v_stot    THEN v_fail := v_fail || format('[%s] INV1 ad+org %s<>total %s; ', r.close_date, v_ad+v_org, v_stot); END IF;
    IF v_ad < 0 OR v_org < 0     THEN v_fail := v_fail || format('[%s] INV4 neg ad=%s org=%s; ', r.close_date, v_ad, v_org); END IF;
    IF v_itot <> v_sys           THEN v_fail := v_fail || format('[%s] ins.total %s<>sys %s; ', r.close_date, v_itot, v_sys); END IF;
    IF v_cop + v_non <> v_itot   THEN v_fail := v_fail || format('[%s] INV2 copay+nonins %s<>total %s; ', r.close_date, v_cop+v_non, v_itot); END IF;
    IF v_cop < 0 OR v_non < 0 OR v_cov < 0 THEN v_fail := v_fail || format('[%s] INV3/4 neg; ', r.close_date); END IF;
    RAISE NOTICE 'INV-OK [%] sys=% ad=% org=% copay=% nonins=% covered=%', r.close_date, v_sys, v_ad, v_org, v_cop, v_non, v_cov;
  END LOOP;
  IF v_n = 0 THEN
    RAISE WARNING 'TOTALS-RECOMPUTE-PORT INV 검증: 08-01~08-06 closed 마감 0건(스킵)';
  ELSIF v_fail <> '' THEN
    RAISE EXCEPTION 'TOTALS-RECOMPUTE-PORT INV 검증 실패(%건 중): %', v_n, v_fail;
  ELSE
    RAISE NOTICE 'TOTALS-RECOMPUTE-PORT INV 검증 전건 통과(%건 · INV1/INV2/INV4 + total==daily_closings sys_total).', v_n;
  END IF;
END
$inv_validate$;
`;

const upSql = readFileSync(UP, 'utf8') + '\n' + INV_VALIDATE;

runDryrun({
  upSql,
  passNote: 'TOTALS-RECOMPUTE-PORT: 4함수 무영속 적용 + 실데이터 INV1/INV2/INV4/total==sys 실증 통과',
  assertAbsent: [
    {
      label: "enqueue_closing_confirmed new-version marker 'TOTALS-RECOMPUTE-PORT'",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'enqueue_closing_confirmed'
                AND p.prosrc LIKE '%TOTALS-RECOMPUTE-PORT%'
            ) AS absent;`,
    },
    {
      label: "closing_source_split new-version marker '미연결/aggregate 흡수' (residual 산식)",
      sql: `SELECT NOT EXISTS(
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'closing_source_split'
                AND p.prosrc LIKE '%v_ad_raw%'
            ) AS absent;`,
    },
  ],
});

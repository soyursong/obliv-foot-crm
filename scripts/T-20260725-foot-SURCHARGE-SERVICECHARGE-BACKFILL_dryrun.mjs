#!/usr/bin/env node
/**
 * T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL — dry-run 규모 산출 (READ-ONLY, 무영속)
 *
 * 목적: 07458cf6 배포(07-25) ~ Phase B write-path 라이브(2026-08-11 05:41 KST) window 사이,
 *       급여 진찰료(시간외/공휴/토요) service_charges 中 base_amount 가산 미반영(저계상) 대상의
 *       건수·금액 규모를 산출한다. WRITE 0 · DDL 0 · SELECT-only (data_correction_backfill_sop §5-2 dry-run).
 *
 * SOP 준수(data_correction_backfill_sop):
 *   §1  판정신호 = prod 물리값만(hira_code LIKE 'AA%' = 진찰료 AA154/AA254/AA222, KOH검사·처치 제외).
 *   §2  버그경로 지문 = 가산-eligible(detectSurchargeKind: 일/공휴/토09시~/평일18시~, checked_in_at KST 기준)
 *        ∩ 가산 미반영(base_amount 에 ×1.3 미적용).  가산 대상 판정 SSOT = nightHolidaySurcharge.ts 미러.
 *   §0-2 소스차단 선행 = ★본 dry-run 이 검증(POST-WINDOW probe). 통과 못하면 apply BLOCK.
 *   §3-2 freeze/판정근거 스냅샷 = evidence JSON (service_charge id + 판정신호) off-git dump.
 *   §4  원장 무접점 = DDL 0, 스냅샷 CREATE TABLE 0.  PHI 위생 = 환자 PII 미포함(SC id·grade·code·금액만).
 *
 * AC-2 MONEY 무접점: 본 dry-run 은 service_charges 명세 저계상만 측정. payments 무접촉.
 * AC-3 grade-keyed: grade=null/unverified 대상은 covered=0 유지(집계에서 분리 카운트).
 *
 * 실행: node scripts/T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL_dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';
import { writeFileSync } from 'node:fs';

// 2026 법정공휴일 (nightHolidaySurcharge.ts KOREAN_HOLIDAYS_2026 미러)
const HOL = "'2026-01-01','2026-01-28','2026-01-29','2026-01-30','2026-03-01','2026-05-05'," +
            "'2026-05-25','2026-06-06','2026-08-15','2026-09-30','2026-10-01','2026-10-02'," +
            "'2026-10-03','2026-10-09','2026-12-25'";
// window: 07458cf6 배포 07-25 KST ~ Phase B 라이브 2026-08-11 05:41 KST
const W_LO = "'2026-07-25 00:00:00+09'";
const W_HI = "'2026-08-11 05:41:00+09'";

// 급여 진찰료 가산-eligible 대상 (SOP §2 지문). checked_in_at 부재 시 calculated_at 폴백.
const eligBlock = (lo, hi) => `
  FROM service_charges sc
  JOIN services s ON s.id = sc.service_id
  LEFT JOIN check_ins ci ON ci.id = sc.check_in_id
  , LATERAL (SELECT COALESCE(ci.checked_in_at, sc.calculated_at) AT TIME ZONE 'Asia/Seoul' AS ref) r
  , LATERAL (SELECT EXTRACT(DOW FROM r.ref)::int dow, EXTRACT(HOUR FROM r.ref)::int hr,
                    to_char(r.ref,'YYYY-MM-DD') ds) t
  , LATERAL (SELECT (t.dow=0 OR t.ds IN (${HOL}) OR (t.dow=6 AND t.hr>=9) OR (t.hr>=18)) AS eligible) e
  WHERE COALESCE(sc.is_simulation,false)=false
    AND sc.is_insurance_covered = TRUE
    AND s.hira_code LIKE 'AA%'          -- 진찰료 only (AA154 초진 / AA254 재진 / AA222 재진-물리)
    AND e.eligible
    AND sc.calculated_at >= ${lo} AND sc.calculated_at < ${hi}`;
// 가산 미반영(저계상) 판정: base_amount 가 ×1.3 근처가 아님(surcharge 미적용).
const UNDER = ` AND sc.base_amount < ROUND(sc.hira_score*sc.hira_unit_value*1.25)`;

const evidence = { ticket: 'T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL',
  mode: 'dry-run READ-ONLY (no persistence · no DDL · SELECT-only)',
  window: { lo: '2026-07-25 00:00 KST (07458cf6)', hi: '2026-08-11 05:41 KST (Phase B live)' },
  probes: {} };

async function run(key, sql) { const rows = await q(sql); evidence.probes[key] = rows; return rows; }

// P1: window 내 가산-eligible 진찰료 규모 (grade split + already-surcharged 확인)
const p1 = await run('P1_in_window_by_grade', `
  SELECT COALESCE(sc.customer_grade_at_charge,'(null)') grade,
    count(*) n,
    count(*) FILTER (WHERE sc.base_amount >= ROUND(sc.hira_score*sc.hira_unit_value*1.25)) already_surcharged,
    SUM(FLOOR(sc.base_amount*0.3/10)*10) surcharge_amount_sum
  ${eligBlock(W_LO,W_HI)} ${UNDER} GROUP BY 1 ORDER BY n DESC;`);

// P2: kind × code 분해
await run('P2_in_window_by_kind_code', `
  SELECT (CASE WHEN t.dow=0 OR t.ds IN (${HOL}) OR (t.dow=6 AND t.hr>=9) THEN 'holiday' ELSE 'night' END) kind,
    s.hira_code, s.name, count(*) n, SUM(FLOOR(sc.base_amount*0.3/10)*10) surcharge_amount
  ${eligBlock(W_LO,W_HI)} ${UNDER} GROUP BY 1,2,3 ORDER BY n DESC;`);

// P3: write-path(engine version) 분해 — 어느 경로가 저계상을 만드는가
await run('P3_in_window_by_engine', `
  SELECT sc.calculation_engine_version ver, count(*) n
  ${eligBlock(W_LO,W_HI)} ${UNDER} GROUP BY 1 ORDER BY n DESC;`);

// P4: ★§0-2 소스차단 선행 검증 — Phase B(08-11 05:41) 이후 신규 저계상 유입 count
//     >0 이면 소스 미차단 = backfill apply HARD BLOCK (재오염·freeze drift·역오염 위험).
const p4 = await run('P4_source_closed_probe_POST_WINDOW', `
  SELECT count(*) new_undercounted_after_phaseB,
    array_agg(DISTINCT sc.calculation_engine_version) vers,
    min(sc.calculated_at) mn, max(sc.calculated_at) mx
  ${eligBlock(W_HI, "'2027-01-01'")} ${UNDER};`);

// P5: freeze PK 스냅샷 (SOP §3-1/§3-2 판정근거 — off-git evidence)
const p5 = await run('P5_freeze_set', `
  SELECT sc.id::text id, s.hira_code,
    COALESCE(sc.customer_grade_at_charge,'(null)') grade,
    (CASE WHEN t.dow=0 OR t.ds IN (${HOL}) OR (t.dow=6 AND t.hr>=9) THEN 'holiday' ELSE 'night' END) kind,
    to_char(COALESCE(ci.checked_in_at,sc.calculated_at) AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD DY HH24:MI') visit_kst,
    sc.base_amount cur_base, FLOOR(sc.base_amount*0.3/10)*10 surcharge_amt,
    sc.insurance_covered_amount cur_cov, sc.copayment_amount cur_copay,
    sc.calculation_engine_version ver
  ${eligBlock(W_LO,W_HI)} ${UNDER} ORDER BY sc.calculated_at;`);

evidence.summary = {
  freeze_count: p5.length,
  sum_surcharge_amount: p5.reduce((a,r)=>a+Number(r.surcharge_amt),0),
  by_grade: p1,
  source_closed: Number(p4[0]?.new_undercounted_after_phaseb||0) === 0,   // ⚠ Mgmt API lowercases aliases
  post_window_new_undercounted: Number(p4[0]?.new_undercounted_after_phaseb||0),
};

const out = process.env.EVIDENCE_OUT ||
  '/Users/domas/claude-sync/memory/db-gate/T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL_dryrun_evidence.json';
writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log('freeze_count =', evidence.summary.freeze_count);
console.log('sum_surcharge_amount =', evidence.summary.sum_surcharge_amount);
console.log('source_closed =', evidence.summary.source_closed,
            '(post-window new undercounted =', evidence.summary.post_window_new_undercounted, ')');
console.log('by_grade =', JSON.stringify(p1));
console.log('by_engine =', JSON.stringify(evidence.probes.P3_in_window_by_engine));
console.log('evidence →', out);

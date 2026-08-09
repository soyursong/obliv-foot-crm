#!/usr/bin/env node
// ============================================================================
// T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — #7 is_healer_intent apply
// STEP 1: no-persistence read-only probe (apply-guard 밖, SELECT only).
// ----------------------------------------------------------------------------
// 목적(GO-token 가드 §1):
//   apply 직전, prod `reservations.is_healer_intent` 부재를 재확인(무영속)하고
//   마이그 선언 ↔ 현 prod parity 를 재대조하여 DRIFT(동명이표 등) 재발을 차단한다.
//   ★ 어떤 DDL/DML 도 실행하지 않는다. 전부 information_schema / catalog SELECT.
//   ★ 이 probe 통과 ≠ apply 허가. apply 는 supervisor DB-GATE GO-token 수신 후에만.
//
// 배경: Jun-16 evidence 는 컬럼 ADD+backfill PASS 로 기록됐으나, 본 티켓 #A 가
//   DDL-diff GO 후 prod DRIFT 로 자동롤백된 전례 → 현 prod 실재 상태 UNKNOWN.
//   따라서 apply 前 실측 재확인이 필수.
// ============================================================================
import { query } from './lib/foot_migration_ledger.mjs';

const MIG_VERSION = '20260614130000';
const OUT = {};

function line(t) { console.log(t); }

async function main() {
  line('════════════════════════════════════════════════════════════════════');
  line(' healer-intent PROD PROBE (no-persistence, read-only)  prod=rxlomoozakkjesdqjtvd');
  line('════════════════════════════════════════════════════════════════════');

  // [A] 대상 컬럼 존재/메타 (부재 재확인)
  const colMeta = await query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reservations'
      AND column_name='is_healer_intent';`);
  OUT.column_present = Array.isArray(colMeta) && colMeta.length > 0;
  OUT.column_meta = colMeta;
  line(`\n[A] reservations.is_healer_intent 존재: ${OUT.column_present ? 'YES ⚠' : 'NO (부재 — apply 대상)'}`);
  line('    meta: ' + JSON.stringify(colMeta));

  // [B] DRIFT 체크 — 동명이표(is_healer_intent 를 가진 다른 테이블) 스캔
  const driftScan = await query(`
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name='is_healer_intent'
    ORDER BY table_schema, table_name;`);
  OUT.same_name_columns = driftScan;
  line(`\n[B] is_healer_intent 를 가진 모든 테이블(동명이표 DRIFT 스캔):`);
  line('    ' + JSON.stringify(driftScan));

  // [C] 마이그 원장(schema_migrations) version 존재 여부
  const ledger = await query(`
    SELECT version, name, created_by
    FROM supabase_migrations.schema_migrations
    WHERE version='${MIG_VERSION}';`);
  OUT.ledger_present = Array.isArray(ledger) && ledger.length > 0;
  OUT.ledger_row = ledger;
  line(`\n[C] 원장 version ${MIG_VERSION} 기록: ${OUT.ledger_present ? 'YES' : 'NO'}`);
  line('    ' + JSON.stringify(ledger));

  // [D] parity 컨텍스트 — reservations 총건 / healer_flag=true (backfill 상한, 본 apply 는 backfill 제외)
  const counts = await query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE healer_flag = true)::int AS healer_flag_true
    FROM public.reservations;`);
  OUT.counts = counts;
  line(`\n[D] reservations parity 컨텍스트: ${JSON.stringify(counts)}`);

  // [E] reservations 테이블 실재 확인 (동명이표/base-table 대조용)
  const tbl = await query(`
    SELECT table_type
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='reservations';`);
  OUT.reservations_table_type = tbl;
  line(`\n[E] public.reservations 유형: ${JSON.stringify(tbl)}`);

  // ── 판정 ──
  line('\n════════════════════════════════════════════════════════════════════');
  const clearToRequestGo =
    OUT.column_present === false &&
    Array.isArray(OUT.same_name_columns) &&
    OUT.same_name_columns.length === 0 &&
    Array.isArray(OUT.reservations_table_type) &&
    OUT.reservations_table_type.length === 1 &&
    OUT.reservations_table_type[0].table_type === 'BASE TABLE';

  OUT.verdict = clearToRequestGo
    ? 'CLEAR-TO-REQUEST-GO: 컬럼 부재 + 동명이표 없음 + reservations=BASE TABLE. GO-token 요청 진행 가능(apply 는 GO-token 후).'
    : (OUT.column_present
        ? 'ALREADY-PRESENT: is_healer_intent 이미 존재 — apply 불필요(멱등). ledger/포스트체크만 확인.'
        : 'DRIFT/ANOMALY: 동명이표 또는 테이블유형 이상 — apply 전 planner/supervisor 에스컬레이션 필요.');
  line(' VERDICT: ' + OUT.verdict);
  line('════════════════════════════════════════════════════════════════════');

  line('\n--- MACHINE-READABLE ---');
  line(JSON.stringify({
    ts: process.env.PROBE_TS || null,
    prod: 'rxlomoozakkjesdqjtvd',
    persistence: 'none (SELECT only)',
    column_present: OUT.column_present,
    same_name_columns: OUT.same_name_columns,
    ledger_present: OUT.ledger_present,
    ledger_row: OUT.ledger_row,
    counts: OUT.counts,
    reservations_table_type: OUT.reservations_table_type,
    verdict: OUT.verdict,
  }, null, 2));
}

main().catch((e) => { console.error('[PROBE ABORT]', e.message); process.exit(1); });

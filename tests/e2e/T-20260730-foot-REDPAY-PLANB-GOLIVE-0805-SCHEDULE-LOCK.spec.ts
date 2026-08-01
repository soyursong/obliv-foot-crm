/**
 * E2E spec — T-20260730-foot-REDPAY-PLANB-GOLIVE-0805-SCHEDULE-LOCK
 * 레드페이 플랜B 카드결제 단일 정본 write-path RPC(record_planb_card_payment) 신설 계약 검증.
 *   SSOT: da_consult_reply_foot_redpay_planb_single_rpc_absorb_guard_20260802.md
 *         (DA-20260802-FOOT-REDPAY-PLANB-SINGLE-RPC-ABSORB-GUARD, Q1=ADDITIVE GO / Q2=§5 ADDENDUM)
 *
 * 소스-계약 검증(레포 컨벤션: db_change/ef_only 티켓은 source-assertion E2E — REDPAY-CLOSING-TAB 동형).
 *   런타임 결제기록 parity(현장 클릭 3종 S1~S6)는 무영속 통합 harness
 *   scripts/T-20260730-foot-REDPAY-PLANB-SINGLE-RPC_integration.mjs 가 커버(prod 무영속 rollback).
 *
 * 현장 클릭 시나리오(티켓 §) → 계약 매핑:
 *   S1 정상 결제기록(경로B, card)      → RPC method='card'·external_trxid·accounting_date 앵커·check_in 결속
 *   S2 absorb-guard(CAT-origin 흡수)   → payment_attempt_id NOT NULL scope + absorb→reconciled_at set + INSERT skip
 *   S3 엣지(multi-candidate/cross-tenant) → tier4_manual / MERNO cross-tenant reject
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const MIG = 'supabase/migrations/20260802061500_foot_record_planb_card_payment_rpc.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260802061500_foot_record_planb_card_payment_rpc.rollback.sql';
const MIG_DRYRUN = 'supabase/migrations/20260802061500_foot_record_planb_card_payment_rpc.dryrun.mjs';
const LIB = 'src/lib/recordPlanbCardPayment.ts';
const EF = 'supabase/functions/redpay-planb-match/index.ts';
const REF = 'src/lib/manualPaymentWritePath.ts';

const readMig = () => fs.readFileSync(MIG, 'utf-8');

// ─── 그룹 1 · single RPC 계약(SECDEF seal + foot-native 필드) ──────────────────────
test.describe('S1 single RPC record_planb_card_payment 계약', () => {
  test('CREATE FUNCTION + SECURITY DEFINER + search_path 핀', () => {
    const s = readMig();
    expect(s).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_planb_card_payment/);
    expect(s).toContain('SECURITY DEFINER');
    expect(s).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/);
  });

  test('grant seal — REVOKE PUBLIC/anon + GRANT authenticated,service_role (신규 anon 도입 0)', () => {
    const s = readMig();
    expect(s).toMatch(/REVOKE ALL ON FUNCTION public\.record_planb_card_payment\([^)]*\) FROM PUBLIC/);
    expect(s).toMatch(/REVOKE ALL ON FUNCTION public\.record_planb_card_payment\([^)]*\) FROM anon/);
    expect(s).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_planb_card_payment\([^)]*\) TO authenticated, service_role/);
  });

  test('clinic-scope 재검증 = user_profiles(RLS 등가) — staff 테이블 아님', () => {
    const s = readMig();
    // 권위 role 소스 = user_profiles (payments RLS current_user_role() 와 동일). staff.role 은 admin/manager 부재.
    expect(s).toMatch(/FROM user_profiles up[\s\S]*up\.id\s*=\s*v_uid[\s\S]*up\.clinic_id\s*=\s*p_clinic_id/);
    expect(s).toMatch(/up\.role IN \('admin','manager','consultant','coordinator','therapist','technician'\)/);
    // anon 거부 · authenticated null uid 거부
    expect(s).toMatch(/anon\/no-role/);
  });

  test('foot-native 필드계약 — method=card 고정 · external_trxid · accounting_date=approved_at Seoul달력일', () => {
    const s = readMig();
    // payments INSERT 는 method 'card' 리터럴만 write (pg_provider/method_standard 컬럼 assign 없음 = foot prod 부재)
    // INSERT 컬럼 리스트/값에 pg_provider·method_standard 대입이 없어야 함(주석 언급은 허용).
    const insertBlock = s.slice(s.indexOf('INSERT INTO payments'));
    expect(insertBlock).not.toMatch(/pg_provider\s*[=,)]/);
    expect(insertBlock).not.toMatch(/method_standard\s*[=,)]/);
    expect(insertBlock).toMatch(/'card'/);
    // 매출-일자 앵커 = approved_at 의 Asia/Seoul 달력일 (INSERT 시각 금지)
    expect(s).toMatch(/AT TIME ZONE 'Asia\/Seoul'\)::date/);
    expect(s).toMatch(/COALESCE\(v_raw\.approved_at, v_raw\.received_at\)/);
    // external_trxid 판별자 populate
    expect(s).toContain('external_trxid');
  });

  test('멱등 = raw-row 원자 claim(matched_payment_id IS NULL, rows=1) · trxid 단독 금지', () => {
    const s = readMig();
    expect(s).toMatch(/UPDATE redpay_raw_transactions[\s\S]*SET matched_payment_id[\s\S]*WHERE id = p_raw_txid AND matched_payment_id IS NULL/);
    expect(s).toContain('already_claimed');
    // rows-affected assert (INV-W2/W5 — 0-row 성공오판 차단)
    expect(s).toMatch(/GET DIAGNOSTICS v_rows = ROW_COUNT/);
  });

  test('checkin 결속 필수(orphan payment 금지) + 칸반 payment_waiting→done', () => {
    const s = readMig();
    expect(s).toMatch(/check_in_id required for checkin attribution/);
    expect(s).toMatch(/payment_waiting/);
    expect(s).toMatch(/status_transitions/);
  });
});

// ─── 그룹 2 · absorb-guard (K5 CAT-origin 흡수, §5 ADDENDUM 5조건) ──────────────────
test.describe('S2 absorb-guard — CAT-origin 흡수(신규 INSERT skip, 매출 double-count 0)', () => {
  test('② CAT-origin scope = payment_attempt_id IS NOT NULL(PRIMARY) + MSG_TRACE belt(cband_payment_attempts)', () => {
    const s = readMig();
    expect(s).toMatch(/p\.payment_attempt_id IS NOT NULL/);
    expect(s).toMatch(/cband_payment_attempts a[\s\S]*a\.msg_trace IS NOT NULL/);
  });

  test('① composite: amount ∧ card ∧ same-KST-day(accounting_date) ∧ external_approval_no corroborator', () => {
    const s = readMig();
    expect(s).toMatch(/p\.method = 'card'/);
    expect(s).toMatch(/p\.amount = v_amount/);
    expect(s).toMatch(/p\.accounting_date = v_acct_date/);
    // AUTHNO = corroborator leg only (sole-key 동등매칭 금지 → composite leg)
    expect(s).toMatch(/p\.external_approval_no IS NOT DISTINCT FROM v_raw\.approval_no/);
  });

  test('③ multi-candidate(≥2) → tier4_manual (blind auto-absorb 금지)', () => {
    const s = readMig();
    expect(s).toMatch(/v_cand_count >= 2/);
    expect(s).toContain('tier4_manual');
  });

  test('⑤ count-grain 불변 — absorb = reconciled_at set only(행접기/DISTINCT 금지)', () => {
    const s = readMig();
    // 흡수 성립 = 기존 payment 에 reconciled_at set + raw claim, 신규 INSERT skip
    expect(s).toMatch(/SET reconciled_at\s*=\s*COALESCE\(reconciled_at, p_reconciled_at\)/);
    expect(s).toContain("'absorbed'");
    // DISTINCT 로 행 접기 금지
    expect(s).not.toMatch(/SELECT\s+DISTINCT/i);
  });

  test('MERNO cross-tenant 격리 — foot registry 밖 = cross_tenant_reject(A11/A12)', () => {
    const s = readMig();
    expect(s).toMatch(/redpay_terminal_registry/);
    expect(s).toMatch(/r\.domain = 'foot' AND r\.active/);
    expect(s).toContain('cross_tenant_reject');
  });
});

// ─── 그룹 3 · package branch(paid_amount 재집계) + rollback ───────────────────────
test.describe('S3 package branch + rollback(ADDITIVE)', () => {
  test('package = package_payments INSERT + packages.paid_amount 재집계(recordManualPayment 동일 산식)', () => {
    const s = readMig();
    expect(s).toMatch(/INSERT INTO package_payments/);
    expect(s).toMatch(/UPDATE packages SET paid_amount = v_total/);
    // 재집계 산식: refund 부호 반전 합 (reference recordManualPayment 동형)
    expect(s).toMatch(/payment_type = 'refund' THEN -amount ELSE amount/);
  });

  test('rollback = DROP FUNCTION (ADDITIVE 역연산·회귀 0)', () => {
    const r = fs.readFileSync(MIG_ROLLBACK, 'utf-8');
    expect(r).toMatch(/DROP FUNCTION IF EXISTS public\.record_planb_card_payment/);
  });

  test('무영속 dry-run 러너 존재(post-probe procAbsent)', () => {
    const d = fs.readFileSync(MIG_DRYRUN, 'utf-8');
    expect(d).toMatch(/runDryrun/);
    expect(d).toMatch(/procAbsent\('record_planb_card_payment'\)/);
  });
});

// ─── 그룹 4 · single-writer 수렴 (FE 경로B lib + EF 경로A gating) ──────────────────
test.describe('S4 single-writer 수렴 — FE lib + EF auto-create gating', () => {
  test('FE lib = supabase.rpc(record_planb_card_payment) 위임 · 인라인 payments INSERT 금지', () => {
    const l = fs.readFileSync(LIB, 'utf-8');
    expect(l).toMatch(/supabase\.rpc\(\s*'record_planb_card_payment'/);
    // 인라인 divergent 재구현 금지 (single-writer 수렴)
    expect(l).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)\s*\.insert/);
  });

  test('FE lib action 타입 = absorbed/tier4_manual/cross_tenant_reject 포함(UX 분기)', () => {
    const l = fs.readFileSync(LIB, 'utf-8');
    for (const a of ['absorbed', 'tier4_manual', 'cross_tenant_reject', 'already_claimed']) {
      expect(l).toContain(a);
    }
  });

  test('EF 경로A = flag-gated auto-create(default OFF) → 동일 RPC 1벌 호출(single-writer)', () => {
    const e = fs.readFileSync(EF, 'utf-8');
    expect(e).toMatch(/REDPAY_PLANB_AUTOCREATE_ENABLED/);
    // default OFF = 기존 Model A(pending 전이만) 회귀-안전
    expect(e).toMatch(/AUTOCREATE_ENABLED\s*=[\s\S]*"false"/);
    expect(e).toMatch(/if\s*\(AUTOCREATE_ENABLED\)/);
    expect(e).toMatch(/supabase\.rpc\(\s*"record_planb_card_payment"/);
  });

  test('parity 기준점 = recordManualPayment(reference) 존재(shape-parity 앵커)', () => {
    const ref = fs.readFileSync(REF, 'utf-8');
    expect(ref).toMatch(/export async function recordManualPayment/);
  });
});

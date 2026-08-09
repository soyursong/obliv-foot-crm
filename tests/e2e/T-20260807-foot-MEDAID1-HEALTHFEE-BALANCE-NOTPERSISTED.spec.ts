/**
 * T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED  (P1, foot, db_change=true)
 *   건강생활유지비(의료급여 1종 공단 지원금) 잔액 방문 간 이월 저장.
 *   현 useState(0) 매 방문 초기화 → foot-local satellite 스냅샷 이월 + DERIVED 현재잔액.
 *
 * DA 설계 제약(SSOT da_decision_foot_medaid1_healthfee_balance_persist_20260807 · GO(조건부)·ADDITIVE):
 *   · PRIMARY = satellite 1:1 {verified_balance, verified_at, verified_by} "스냅샷만 영속".
 *   · ★현재잔액 = DERIVED (decrement write 금지):
 *       current = verified_balance − Σ(HM payments net WHERE created_at >= verified_at).
 *   · 월전환 재확인(DoD#3) = verified_at 기준 stale 판정.
 *   · Σ(payments)==payableTotal 불변(payments 원장 무접점).
 *
 * ── 티켓 §5 현장 클릭 시나리오 → 검증 매핑 ─────────────────────────────────────
 *   시나리오1(이월 정상): 최초 입력·저장 → 닫기/재진입 → 저장 잔액 그대로(0 초기화 아님) → 차감 시 감소.
 *   시나리오2(월 전환): 월 경계 넘으면 재확인 유도(stale) 표시.
 *
 * ── 커버리지 ─────────────────────────────────────────────────────────────────
 *   [U] lib healthMaintenanceBalance 순수 로직(isSnapshotStale) 실행 검증(월 경계).
 *   [S0] 소스계약(무네트워크) — 이 레포 관례. loader prefill(0 아님)·저장 upsert·DERIVED 파생·
 *        stale 배너·no-decrement-write·Σ(payments) 원장 무접점을 권위 검증.
 *   (라이브 이월/차감 = satellite prod-apply(MIG-GATE GO) 후 갤탭 실단말 field-soak = DoD#4 최종판정.)
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isSnapshotStale } from '../../src/lib/healthMaintenanceBalance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = (rel: string) => readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');
const pmw = () => repo('src/components/PaymentMiniWindow.tsx');
const lib = () => repo('src/lib/healthMaintenanceBalance.ts');
const upSql = () =>
  repo('supabase/migrations/20260807150000_foot_health_maintenance_balances_satellite.sql');

// 공단 차감/이월 teal 박스 JSX 슬라이스(다른 곳 토큰 오탐 방지).
function deductBox(src: string): string {
  const start = src.indexOf('의료급여 1종 · 건강생활유지비 공단 차감');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start - 800, start + 6000);
}

// ── [U] lib 순수 로직: 월전환 stale 판정 (시나리오2 핵심) ─────────────────────
test.describe('U — isSnapshotStale 월 경계 판정(DoD#3)', () => {
  test('U-1 같은 달 verified_at 은 stale 아님', () => {
    // 오늘과 같은 달의 시각(월초) → not stale
    const now = new Date();
    const sameMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0).toISOString();
    expect(isSnapshotStale(sameMonth)).toBe(false);
  });

  test('U-2 이전 달(월 경계 넘음) verified_at 은 stale (재확인 유도)', () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0).toISOString();
    expect(isSnapshotStale(prevMonth)).toBe(true);
  });

  test('U-3 verified_at 없음(최초 미저장) = stale 아님', () => {
    expect(isSnapshotStale(null)).toBe(false);
    expect(isSnapshotStale(undefined)).toBe(false);
  });
});

// ── [S0] lib 소스계약: DERIVED 파생 · decrement write 금지 · 스냅샷 upsert ────
test.describe('S0 lib — DERIVED 현재잔액 + 스냅샷 영속(원장 무접점)', () => {
  test('S0-L1 현재잔액 = verified_balance − Σ(HM payments >= verified_at) (DERIVED)', () => {
    const src = lib();
    // payments 원장에서 method='health_maintenance' 를 verified_at 이후로 합산해 파생
    expect(src).toContain("from('payments')");
    expect(src).toContain("eq('method', 'health_maintenance')");
    expect(src).toContain("gte('created_at', snapshot.verified_at)");
    // 순액(payment − refund) 차감 후 verified_balance 에서 감산
    expect(src).toContain("r.payment_type === 'refund'");
    expect(src).toMatch(/snapshot\.verified_balance\s*-\s*deducted/);
  });

  test('S0-L2 satellite 에는 decrement write 없음 — 스냅샷 upsert(verified_*)만', () => {
    const src = lib();
    // health_maintenance_balances 접근은 select(로드) + upsert(스냅샷 영속) 뿐.
    expect(src).toContain("from('health_maintenance_balances')");
    expect(src).toContain('.upsert(');
    expect(src).toContain("onConflict: 'customer_id'");
    // 잔액을 깎아 내리는 감소 UPDATE(decrement write) 경로가 없어야 함(구조적 double-decrement 불가).
    expect(src).not.toMatch(/health_maintenance_balances[\s\S]{0,200}\.update\(/);
    // upsert 페이로드는 검증 스냅샷(verified_balance/verified_at) — 파생 현재값 저장 아님.
    expect(src).toContain('verified_balance:');
    expect(src).toContain('verified_at: verifiedAt');
  });

  test('S0-L3 satellite 부재/에러 = 잔액 0 폴백(회귀 안전, 이월 없음)', () => {
    const src = lib();
    expect(src).toMatch(/if \(snapErr \|\| !snap\) return EMPTY;/);
  });
});

// ── [S0] PaymentMiniWindow 소스계약: 이월 loader · 저장 · stale 배너 ─────────
test.describe('S0 PMW — 이월 로더 / 저장 / 월전환 배너', () => {
  test('S0-1 (시나리오1) 진입 시 satellite 현재잔액을 prefill — 0 초기화 아님', () => {
    const src = pmw();
    // grade=medical_aid_1 확정 후 loadHealthMaintenanceBalance → setHealthMaintenanceBalance(state.current)
    expect(src).toContain('loadHealthMaintenanceBalance');
    expect(src).toMatch(/customerInsuranceGrade !== 'medical_aid_1'\) return;/);
    expect(src).toContain('setHealthMaintenanceBalance(state.current)');
    // 파생 현재잔액 이월 주석(0 초기화 아님)
    expect(src).toMatch(/파생 현재잔액 이월\(0 초기화 아님\)/);
  });

  test('S0-2 (시나리오1) [잔액 저장] 버튼 → persistHealthMaintenanceSnapshot upsert', () => {
    const src = pmw();
    expect(src).toContain('persistHealthMaintenanceSnapshot');
    expect(src).toContain('data-testid="hm-save-balance"');
    // dirty(최초/재확인/월전환)일 때만 활성 — 불필요 write 억제
    expect(src).toContain('disabled={!hmDirty || hmSaving}');
    expect(src).toContain('onClick={handleSaveHmBalance}');
  });

  test('S0-3 (시나리오1) 저장 성공 시 이월 안내(carryover note) 노출', () => {
    const src = pmw();
    expect(src).toContain('data-testid="hm-carryover-note"');
    expect(src).toContain('저장된 잔액이 이월되었습니다.');
  });

  test('S0-4 (시나리오2) 월 경계 넘으면 stale 배너로 재확인 유도(DoD#3)', () => {
    const src = pmw();
    expect(src).toContain('data-testid="hm-stale-banner"');
    expect(src).toContain('월이 바뀌었습니다. 공단 포털에서 잔액을 다시 확인해 입력·저장해 주세요.');
    // stale 은 로드/저장 시 isSnapshotStale(verified_at) 파생값(hmIsStale)으로 게이트
    expect(src).toContain('setHmIsStale(state.isStale)');
    expect(src).toContain('setHmIsStale(isSnapshotStale(verifiedAt))');
  });

  test('S0-5 (무회귀) 차감 산정·Σ(payments)==payableTotal 원장 경로 불변', () => {
    const src = pmw();
    // 기존 차감 산정 토큰 불변(공단차감 write-path 무접촉)
    expect(src).toContain('const healthFeeDeducted =');
    expect(src).toContain('const netPayableAfterHealthFee =');
    expect(src).toContain("method: 'health_maintenance'");
    // 이월/저장 상태는 매 방문 리셋(창 유지 시 stale 상태 잔존 방지)
    expect(src).toContain('setHmSnapshotBalance(null);');
    expect(src).toContain('setHmIsStale(false);');
  });
});

// ── [S0] 마이그레이션 계약: ADDITIVE satellite + RLS clinic-scoped + anon-deny ─
test.describe('S0 MIG — satellite ADDITIVE + RLS + anon-deny', () => {
  test('MIG-1 satellite 1:1 (customer_id PK) + verified_* 스냅샷 컬럼', () => {
    const sql = upSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.health_maintenance_balances');
    expect(sql).toMatch(/customer_id\s+UUID\s+PRIMARY KEY REFERENCES public\.customers\(id\)/);
    expect(sql).toMatch(/verified_balance INTEGER\s+NOT NULL CHECK \(verified_balance >= 0\)/);
    expect(sql).toContain('verified_at');
    expect(sql).toContain('verified_by');
  });

  test('MIG-2 RLS clinic-scoped(authenticated auth_all) + anon REVOKE(deny)', () => {
    const sql = upSql();
    expect(sql).toContain('ALTER TABLE public.health_maintenance_balances ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/CREATE POLICY "auth_all" ON public\.health_maintenance_balances\s+FOR ALL TO authenticated/);
    expect(sql).toContain('REVOKE ALL ON public.health_maintenance_balances FROM anon');
  });

  test('MIG-3 별도 잔액원장(ledger) 테이블 없음 — payments 축 단일(DA REJECT 준수)', () => {
    const sql = upSql();
    // 차감이력 ledger 테이블을 만들지 않는다(dual-ledger drift 금지). 스냅샷 satellite 하나뿐.
    const tableCreates = (sql.match(/CREATE TABLE/g) || []).length;
    expect(tableCreates).toBe(1);
  });
});

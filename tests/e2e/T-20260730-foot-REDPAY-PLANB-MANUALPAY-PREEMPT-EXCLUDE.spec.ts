/**
 * Contract spec — T-20260730-foot-REDPAY-PLANB-MANUALPAY-PREEMPT-EXCLUDE
 *   (부모: T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD, 플래그 VITE_PAYMENT_PLANB OFF)
 *
 * 목적: NOWAIT 결제페이지 타임아웃 후 [수기 입력하러 가기] 진입 시 연관 pending_payment(선점표)를
 *   웹훅 자동매칭(match-cron)에서 즉시 제외 → 지연 웹훅(레드페이 재전송) 자동연결 이중기록 봉인.
 *   계약·불변식을 순수 로직·소스 검증(browser 무접점, CI 결정적)으로 고정.
 *   실 브라우저/단말/cron 통합은 macstudio + 갤탭 field-soak 로 검증(외부 단말·server cron 의존).
 *
 * 현장 클릭 시나리오(티켓) → 계약 매핑:
 *   S1(수기폴백→제외→지연웹훅 skip): C1(FE exclude write) · C2(EF open-only 필터 자동제외) · C4(폴링 terminal)
 *   S2(엣지: 클릭만 하고 저장 안 함):  C3(제외는 클릭 즉시 = 저장 완료에 비의존 + matched 는 덮어쓰지 않음)
 *
 * 공통 불변식:
 *   INV-A exclude 경로는 payments write 안 함(§550 Model A, 매출 무접점).
 *   INV-B ADDITIVE — status CHECK widen 1값(manual_override) + COLUMN excluded_at 순증, 파괴적 변경 0.
 *   INV-C 기존 결제화면·수기입력 UI 불변(대원칙 §2) + 플래그 OFF 게이트 회귀 보존.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { isTerminalStatus } from '../../src/lib/paymentPlanb';

const LIB = 'src/lib/paymentPlanb.ts';
const HOOK = 'src/hooks/usePlanbClaimStatus.ts';
const PAGE = 'src/pages/PaymentPlanb.tsx';
const EF = 'supabase/functions/redpay-planb-match/index.ts';
const MIG = 'supabase/migrations/20260730130000_foot_redpay_planb_manual_override.sql';
const MIG_RB = 'supabase/migrations/20260730130000_foot_redpay_planb_manual_override.rollback.sql';

const read = (p: string) => fs.readFileSync(p, 'utf8');
/** 주석 제거 후 실제 코드만(주석 doc 문자열 오탐 방지). */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
/** SQL 실 statement 만(-- 라인주석 제거 — 주석 내 'DROP COLUMN' 등 오탐 방지). */
const sqlOf = (p: string) => read(p).replace(/--.*$/gm, '');

// ── S1 / C1: FE 매칭제외 write (수기 폴백 진입 → manual_override 전이) ────────────
test.describe('C1 FE exclude write — [수기 입력하러 가기] → 선점표 매칭제외', () => {
  test('C1a: excludePendingFromMatch 가 status=manual_override + excluded_at 로 전이', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/export async function excludePendingFromMatch/);
    expect(code).toMatch(/status: 'manual_override'/);
    expect(code).toMatch(/excluded_at: nowIso/);
    expect(code).toMatch(/\.from\('pending_payment'\)/);
  });
  test('C1b: 전이 대상 = open/expired/failed 만(matched/cancelled/manual_override 는 덮어쓰지 않음)', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/\.in\('status',\s*\['open',\s*'expired',\s*'failed'\]\)/);
    // matched 는 전이 대상에서 제외(이미 자동기록 성공 → 수기 이중 방지).
    expect(code).not.toMatch(/\.in\('status',\s*\[[^\]]*'matched'/);
  });
  test('C1c: PaymentPlanb 폴백 버튼 onClick = handleManualFallback(exclude 후 이동)', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/onClick=\{handleManualFallback\}/);
    expect(code).toMatch(/data-testid="planb-manual-fallback-btn"/);
    expect(code).toMatch(/excludePendingFromMatch\(pendingId\)/);
  });
  test('C1d: manual_override 는 terminal 상태(폴링 정지 대상) + 타입 포함', () => {
    // 런타임 판정: manual_override = terminal.
    expect(isTerminalStatus('manual_override')).toBe(true);
    const code = codeOf(LIB);
    expect(code).toMatch(/status === 'manual_override'/);
    expect(code).toMatch(/'manual_override'/); // PendingPaymentStatus 타입 유니온 포함
    const hookCode = codeOf(HOOK);
    expect(hookCode).toMatch(/isTerminalStatus/); // 훅은 terminal 이면 폴링 정지(회귀 보존)
  });
});

// ── S1 / C2: EF 자동매칭에서 manual_override 제외 (open-only 필터) ─────────────────
test.describe('C2 EF 매칭제외 — manual_override 는 open-only 필터로 자동 제외', () => {
  test('C2a: matchPass 는 status=open 만 매칭 → 비-open(manual_override) 자동 제외', () => {
    const code = codeOf(EF);
    // 유효창 open 선점만 후보로 로드(.eq status open + expires_at 유효).
    expect(code).toMatch(/\.eq\("status",\s*"open"\)/);
    expect(code).toMatch(/\.gt\("expires_at",\s*nowIso\)/);
  });
  test('C2b: EF 주석이 manual_override 제외를 명시(AC2 문서화) + 로직 무변경 유지', () => {
    const raw = read(EF); // 주석 포함 원문
    expect(raw).toMatch(/manual_override/);
    // §789/§550 불변식 회귀 보존: payments 무접점 + raw 역참조.
    const code = codeOf(EF);
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);
    expect(code).not.toMatch(/matched_payment_id/);
  });
  test('C2c: 만료 패스도 open 만 전이 → manual_override 재전이 없음(회귀 보존)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/status:\s*"expired"/);
    expect(code).toMatch(/\.eq\("status",\s*"open"\)/);
  });
});

// ── S2 / C3: 엣지 — 제외 시점 = 클릭 즉시(저장 완료에 비의존) ──────────────────────
test.describe('C3 제외 시점 = 클릭 즉시(AC3) — 저장 완료에 비의존', () => {
  test('C3a: 제외는 handleManualFallback(클릭 핸들러)에서 navigate 前 실행(저장 이벤트 게이팅 없음)', () => {
    const code = codeOf(PAGE);
    // 클릭 핸들러 내에서 exclude → navigate 순서(저장 완료 콜백에 걸지 않음).
    expect(code).toMatch(/async function handleManualFallback\(\)/);
    expect(code).toMatch(/excludePendingFromMatch\(pendingId\)[\s\S]*navigate\('\/admin'\)/);
    // 기존 결제화면/수기저장 흐름을 이 페이지가 직접 후킹하지 않음(대원칙 §2).
    expect(code).not.toMatch(/onManualSaveComplete|afterManualSave|save.*complete/i);
  });
  test('C3b: 제외 write 실패해도 이동은 비차단(폴백은 항상 열림)', () => {
    const raw = read(PAGE);
    // try/catch 로 감싸고 navigate 는 항상 실행.
    expect(raw).toMatch(/try\s*\{[\s\S]*excludePendingFromMatch[\s\S]*\}\s*catch/);
    expect(raw).toMatch(/navigate\('\/admin'\)/);
  });
});

// ── C4: 마이그 ADDITIVE 계약 (INV-B) ──────────────────────────────────────────────
test.describe('C4 마이그 — ADDITIVE(CHECK widen 1값 + COLUMN 순증), 파괴적 변경 0', () => {
  test('C4a: status CHECK widen 에 manual_override 추가(6값)', () => {
    const up = read(MIG);
    expect(up).toMatch(/CHECK \(status IN \('open','matched','expired','failed','cancelled','manual_override'\)\)/);
  });
  test('C4b: excluded_at 컬럼 순증(nullable) — ADD COLUMN IF NOT EXISTS', () => {
    const up = read(MIG);
    expect(up).toMatch(/ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ/);
  });
  test('C4c: 파괴적 변경 0 — DROP COLUMN/DROP TABLE/CREATE TABLE/타입변경 없음', () => {
    const up = sqlOf(MIG); // 실 statement 만(주석 내 rollback 설명의 DROP COLUMN 오탐 제외)
    expect(up).not.toMatch(/DROP COLUMN|DROP TABLE|CREATE TABLE|CREATE TYPE|ALTER TYPE/);
    // widen 은 DROP CONSTRAINT → ADD CONSTRAINT(단일 txn) 만 허용.
    expect(up).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
  test('C4d: rollback 은 excluded_at DROP + old CHECK(5값) 복원(테이블 무접촉)', () => {
    const rb = read(MIG_RB);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS excluded_at/);
    expect(rb).toMatch(/CHECK \(status IN \('open','matched','expired','failed','cancelled'\)\)/);
    expect(rb).not.toMatch(/DROP TABLE/);
  });
});

// ── INV-A / INV-C: 매출 무접점 + 기존 UI 불변 회귀 가드 ───────────────────────────
test.describe('INV 회귀 — 매출 무접점(§550) + 기존 UI 불변(§2) + 플래그 OFF 게이트', () => {
  test('INV-A: exclude lib 은 payments 를 write 하지 않음(매출 무접점)', () => {
    const code = codeOf(LIB);
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);
  });
  test('INV-C: PaymentPlanb 는 플래그 OFF 시 /admin 리다이렉트(신규 노출 0, 회귀 보존)', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/if \(!enabled\) return <Navigate to="\/admin" replace/);
  });
});

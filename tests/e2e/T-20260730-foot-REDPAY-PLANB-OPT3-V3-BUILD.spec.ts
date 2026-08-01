/**
 * Contract spec — T-20260730-foot-REDPAY-PLANB-OPT3-V3-BUILD-P1 (제3안 1차 build)
 *
 * 목적: 레드페이 플랜B 제3안(별도버튼·팝업·배지) 1차 build 의 DA/스샷 무관 3파트
 *   (#1 팝업 · #4 autoCancelPass · #6 수신 대기 목록)의 계약·불변식을 순수 소스 검증
 *   (browser 무접점, CI 결정적)으로 고정. 실 브라우저/갤탭 field-soak 은 별도(현장 confirm).
 *
 * 스코프 매핑:
 *   #1 팝업  → C2(버튼명·§③ 위치) · C3(금액 자동채움·안내문구·툴팁·수신대기 취소)
 *   #4 자동취소 → C5(matchPass 이후 3번째 패스·match-before-cancel·컷오프 SSOT·상태전환만·rows-affected·no DDL)
 *   #6 목록  → C6(status=open 조회 리스트)
 *   §④ 배지  → C4(기존 [미결제] 배지 확장 — '수납 대기·{금액}원'/'수납 완료', 신설 아님)
 *   게이트   → C1(피처플래그 VITE_PAYMENT_PLANB OFF 격리)
 *
 * 공통 불변식:
 *   INV-A pending_payment 만 write, payments 무접촉(§550 Model A, 매출 무접점).
 *   INV-B 취소·자동취소 = 상태전환(cancelled)만, DELETE 금지(행 보존 → 미배정 유입지표 정합).
 *   INV-C autoCancel 컷오프 = RETENTION_MS(redpayPlanbTtl SSOT 미러, 1h 하드코딩 금지).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { REDPAY_PLANB_AUTO_RECORD_NOTICE } from '../../src/lib/redpayPlanbTtl';

const LIB = 'src/lib/paymentPlanb.ts';
const EXPECTED = 'src/lib/planbExpectedAmount.ts';
const EXPECTED_HOOK = 'src/hooks/usePlanbExpectedAmount.ts';
const BADGE_HOOK = 'src/hooks/useCheckInPlanbBadge.ts';
const DIALOG = 'src/components/PlanbSusuScheduleDialog.tsx';
const BUTTON = 'src/components/PlanbSusuScheduleButton.tsx';
const LIST = 'src/components/PlanbPendingReceiveList.tsx';
const CHECKIN = 'src/components/CheckInDetailSheet.tsx';
const RECON = 'src/components/closing/RedpayReconcileTab.tsx';
const EF = 'supabase/functions/redpay-planb-match/index.ts';
const MATCH = 'supabase/functions/redpay-planb-match/match.ts';

const read = (p: string) => fs.readFileSync(p, 'utf8');
/** 주석 제거 후 실제 코드만(주석 doc 문자열 오탐 방지). */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

// ── C1: 피처플래그 게이트 (OFF 격리 — 현장 노출 0) ─────────────────────────────
test.describe('C1 피처플래그 VITE_PAYMENT_PLANB OFF 격리', () => {
  test('C1a: OPT3 진입 버튼은 플래그 OFF 시 null(기존 화면 무변경)', () => {
    const code = codeOf(BUTTON);
    expect(code).toMatch(/if \(!isPaymentPlanbEnabled\(\)\) return null/);
  });
  test('C1b: 수신 대기 목록은 플래그 OFF 시 null', () => {
    const code = codeOf(LIST);
    expect(code).toMatch(/if \(!enabled\) return null/);
    expect(code).toMatch(/isPaymentPlanbEnabled\(\)/);
  });
  test('C1c: 배지 확장 훅은 플래그 ON(enabled) 일 때만 조회 — OFF 면 요청 없음', () => {
    const code = codeOf(BADGE_HOOK);
    expect(code).toMatch(/enabled:\s*enabled\s*&&\s*!!checkInId/);
  });
  test('C1d: 배지는 planbFlagOn 게이트 하에서만 확장 — OFF 면 기존 미결제/결제완료 폴백', () => {
    const code = codeOf(CHECKIN);
    expect(code).toMatch(/const planbFlagOn = isPaymentPlanbEnabled\(\)/);
    expect(code).toMatch(/planbFlagOn && planbBadge\.data/);
  });
});

// ── C2: #1 '카드 수납예정등록' 버튼 (§③ 위치) ─────────────────────────────────
test.describe('C2 카드 수납예정등록 버튼 — 버튼명·§③ 배치', () => {
  test('C2a: 버튼명 = "카드 수납예정등록" (속도약속 문구 금지)', () => {
    const code = codeOf(BUTTON);
    expect(code).toMatch(/카드 수납예정등록/);
    // '즉시'·'자동기록' 등 속도약속 문구를 버튼 라벨로 쓰지 않음.
    expect(code).not.toMatch(/즉시/);
  });
  test('C2b: §③ 새 버튼은 [결제 등록] "위"에 렌더(CheckInDetailSheet 순서 보장)', () => {
    const code = codeOf(CHECKIN);
    const idxSusu = code.indexOf('PlanbSusuScheduleButton');
    const idxRegister = code.indexOf('btn-chart1-payment-register');
    expect(idxSusu).toBeGreaterThan(-1);
    expect(idxRegister).toBeGreaterThan(-1);
    // 새 버튼(카드 수납예정등록)이 기존 [결제 등록] 버튼보다 JSX 상 먼저(위) 위치.
    expect(idxSusu).toBeLessThan(idxRegister);
  });
  test('C2c: 기존 [결제 등록] 버튼은 라벨·동작 불변(보존)', () => {
    const code = codeOf(CHECKIN);
    expect(code).toMatch(/결제 등록/);
    expect(code).toMatch(/onClick=\{\(\) => onPayment\(checkIn\)\}/);
  });
});

// ── C3: #1 팝업(Dialog) — 금액 자동채움·안내문구·툴팁·수신대기 취소 ────────────────
test.describe('C3 팝업 — 자동채움/안내/툴팁/취소', () => {
  test('C3a: 팝업은 route 아닌 Dialog(팝업)로 재배치', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/DialogContent/);
    expect(code).toMatch(/data-testid="planb-susu-dialog"/);
  });
  test('C3b: 금액 자동채움 — usePlanbExpectedAmount 로 예상금액 prefill', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/usePlanbExpectedAmount/);
    expect(code).toMatch(/setAmountDisplay\(String\(expected\.data\)\)/);
    // 자동채움 소스 = check_in_services price×quantity 합.
    const src = codeOf(EXPECTED);
    expect(src).toMatch(/from\('check_in_services'\)/);
    expect(src).toMatch(/price \* qty/);
  });
  test('C3c: 안내문구 상수(redpayPlanbTtl) 소비 + 자동채움이 수기입력 덮어쓰지 않음', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/REDPAY_PLANB_AUTO_RECORD_NOTICE/);
    expect(code).toMatch(/amountTouched/); // 직원이 손대면 자동채움 중단.
  });
  test('C3d: 툴팁(안내 상세) 제공', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/title=\{/); // native tooltip(title 속성).
    expect(code).toMatch(/data-testid="planb-susu-notice"/);
  });
  test('C3e: 수신대기 취소 버튼 — open 선점 취소', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/data-testid="planb-susu-cancel-waiting"/);
    expect(code).toMatch(/cancelPendingPayment/);
  });
});

// ── C4: §④ [미결제] 배지 확장 (신설 아님) ─────────────────────────────────────
test.describe('C4 배지 — 기존 [미결제] 배지 확장', () => {
  test('C4a: 수납 대기 · {금액}원 / 수납 완료 표기', () => {
    const code = codeOf(CHECKIN);
    expect(code).toMatch(/수납 대기 · \{formatAmount\(planbBadge\.data\.expectedAmount\)\}원/);
    expect(code).toMatch(/수납 완료/);
    expect(code).toMatch(/data-testid="planb-badge-susu-waiting"/);
    expect(code).toMatch(/data-testid="planb-badge-susu-done"/);
  });
  test('C4b: 새 배지 컴포넌트 생성 아님 — 기존 Badge 재사용 + 미결제/결제완료 폴백 보존', () => {
    const code = codeOf(CHECKIN);
    // 확장이므로 기존 미결제/결제완료 분기가 폴백으로 남아 있어야 함.
    expect(code).toMatch(/미결제/);
    expect(code).toMatch(/결제완료/);
  });
});

// ── C5: #4 autoCancelPass (match-before-cancel) ───────────────────────────────
test.describe('C5 autoCancelPass — matchPass 이후 3번째 패스', () => {
  test('C5a: 패스 순서 = expire → match → autoCancel (match-before-cancel 구조)', () => {
    const code = codeOf(EF);
    const iExpire = code.indexOf('expirePass(nowIso)');
    const iMatch = code.indexOf('matchPass(nowIso)');
    const iCancel = code.indexOf('autoCancelPass(nowIso)');
    expect(iExpire).toBeGreaterThan(-1);
    expect(iMatch).toBeGreaterThan(-1);
    expect(iCancel).toBeGreaterThan(-1);
    expect(iExpire).toBeLessThan(iMatch);
    expect(iMatch).toBeLessThan(iCancel); // 자동취소는 매칭 '이후'.
  });
  test('C5b: 대상 = status ∈ {expired, failed} AND expires_at <= now-retention', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/\.in\("status", \["expired", "failed"\]\)/);
    expect(code).toMatch(/\.lte\("expires_at", cutoffIso\)/);
  });
  test('C5c: 컷오프 SSOT = RETENTION_MS (1h 하드코딩 금지)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/retentionCutoffIso\(nowIso, RETENTION_MS\)/);
    // EF 본문에 raw 3600000/60*60 리터럴 하드코딩 없음(SSOT 상수만).
    expect(code).not.toMatch(/60 \* 60 \* 1000/);
  });
  test('C5d: 상태전환만(cancelled) — DELETE 금지(행 보존)', () => {
    const code = codeOf(EF);
    const cancelBlock = code.slice(code.indexOf('async function autoCancelPass'), code.indexOf('Deno.serve'));
    expect(cancelBlock).toMatch(/\.update\(\{ status: "cancelled"/);
    expect(cancelBlock).not.toMatch(/\.delete\(\)/);
  });
  test('C5e: rows-affected 가드 — select 반환 0건이면 no-op', () => {
    const code = codeOf(EF);
    const cancelBlock = code.slice(code.indexOf('async function autoCancelPass'), code.indexOf('Deno.serve'));
    expect(cancelBlock).toMatch(/\.select\("id"\)/);
    expect(cancelBlock).toMatch(/data\?\.length \?\? 0/);
  });
  test('C5f: isAutoCancelTarget ⊥ isWithinRetention (보관창 내 건은 절대 취소 안 함)', () => {
    const code = codeOf(MATCH);
    expect(code).toMatch(/export function isAutoCancelTarget/);
    expect(code).toMatch(/return exp <= now - retentionMs/);
  });
});

// ── C6: #6 수신 대기 목록 (status=open) ───────────────────────────────────────
test.describe('C6 수신 대기 목록', () => {
  test('C6a: status=open 선점만 조회', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/export async function listOpenPendingPayments/);
    const block = code.slice(code.indexOf('listOpenPendingPayments'));
    expect(block).toMatch(/\.eq\('status', 'open'\)/);
  });
  test('C6b: 리스트 뷰 + 개별 취소', () => {
    const code = codeOf(LIST);
    expect(code).toMatch(/listOpenPendingPayments/);
    expect(code).toMatch(/btn-planb-pending-cancel-/);
  });
  test('C6c: 레드페이 탭에 마운트(플래그 OFF=null)', () => {
    const code = codeOf(RECON);
    expect(code).toMatch(/PlanbPendingReceiveList/);
  });
});

// ── INV: 매출 무접점 / 상태전환만 ─────────────────────────────────────────────
test.describe('INV 불변식', () => {
  test('INV-A: pending_payment 만 write, payments 무접촉(취소/자동취소 포함)', () => {
    const libCode = codeOf(LIB);
    // 취소 경로가 payments 를 건드리지 않음.
    const cancelBlock = libCode.slice(libCode.indexOf('cancelPendingPayment'));
    expect(cancelBlock).not.toMatch(/from\('payments'\)/);
  });
  test('INV-B: 취소 = 상태전환(cancelled)만 + rows-affected 가드(status=open 한정)', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/\.update\(\{ status: 'cancelled'/);
    expect(code).toMatch(/\.eq\('status', 'open'\)/); // open 만 취소(rows-affected 가드).
    expect(code).not.toMatch(/from\('pending_payment'\)[\s\S]{0,80}\.delete\(\)/);
  });
  test('INV-C: 안내문구 상수는 redpayPlanbTtl SSOT 산출값', () => {
    expect(REDPAY_PLANB_AUTO_RECORD_NOTICE).toContain('분 내 자동 기록');
  });
});

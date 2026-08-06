/**
 * T-20260806-foot-MEDAID1-DEDUCTBTN-TEXT-TRUNCATE-FIX  (P2, foot, FE-only)
 *   8/5 배포분 51562df2(DEDUCTWIN-LAYOUT-BALANCE-FIX) 소크 후 현장 회귀 1건 정정.
 *   대상 = 수납창(PaymentMiniWindow) '공단 차감'(건강생활유지비) 버튼 라벨 잘림. DB 무변경.
 *
 * ── 현상 ─────────────────────────────────────────────────────────────────────
 *   공단 금액 입력 시 버튼 라벨('공단 차감 (건강생활유지비에서 1,000 차감)')이
 *   좁은 진료비 산정 컬럼(sm:w-56~lg:w-64)에서 중앙정렬 클립되어
 *   '단 차감 (건강생활유지비에서 1,000 차...' 로만 보임.
 *   원인 = shadcn Button 기본 whitespace-nowrap + 고정 h-9 → overflow clip.
 *
 * ── AC ───────────────────────────────────────────────────────────────────────
 *   AC1 (라벨 전체 표시) : 버튼이 whitespace-normal 로 wrap 허용 + h-auto/min-h-9 로
 *     높이 확장 → 긴 라벨('공단 차감 (건강생활유지비에서 N 차감)')이 잘리지 않고 전부 노출.
 *   AC2 (무회귀 — Phase A/DEDUCTWIN) : 라벨 콘텐츠·onClick(setHealthFeeApplied)·
 *     disabled 조건·차감 산정(healthFeeDeducted/netPayableAfterHealthFee)·
 *     write-path(health_maintenance) 무접촉 — 표시/오버플로우만 수정.
 *
 * ── 커버리지 ─────────────────────────────────────────────────────────────────
 *   [S0 소스계약 — 항상 실행, 무네트워크] 이 레포 다수 spec 관례. PaymentMiniWindow 소스가
 *     위 AC 를 만족하는지 권위 검증. 산정/write-path 토큰 불변(무회귀 가드) 동반.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = (rel: string) => readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');
const pmw = () => repo('src/components/PaymentMiniWindow.tsx');

// 공단 차감 버튼(적용 전 분기) JSX 블록만 슬라이스(다른 곳의 토큰 오탐 방지).
function deductBtn(src: string): string {
  const anchor = src.indexOf('onClick={() => setHealthFeeApplied(true)}');
  expect(anchor).toBeGreaterThan(-1);
  // 버튼 className(anchor 위)부터 라벨(anchor 아래)까지 넉넉히 슬라이스.
  return src.slice(anchor - 700, anchor + 300);
}

test.describe('S0 소스계약 — 공단 차감 버튼 라벨 잘림 정정', () => {
  // ── AC1: 라벨 전체 표시 (wrap 허용) ──────────────────────────────────────
  test('S0-1 (AC1) 버튼이 whitespace-normal 로 wrap 허용', () => {
    const btn = deductBtn(pmw());
    expect(btn).toContain('whitespace-normal');
  });

  test('S0-2 (AC1) 버튼 높이가 h-auto/min-h-9 로 확장(고정 h-9 클립 제거)', () => {
    const btn = deductBtn(pmw());
    expect(btn).toMatch(/h-auto/);
    expect(btn).toMatch(/min-h-9/);
    // 구 고정 h-9 단독(클립 원인)은 제거됨: 'w-full h-9 bg-teal-600' 정확 시퀀스 소멸
    expect(btn).not.toContain('w-full h-9 bg-teal-600');
  });

  test('S0-3 (AC1) 라벨 콘텐츠(공단 차감 + 차감 프리뷰)는 그대로 유지', () => {
    const btn = deductBtn(pmw());
    // 버튼 텍스트 전체가 소스에 온전히 존재
    expect(btn).toContain('공단 차감');
    expect(btn).toMatch(/건강생활유지비에서 \$\{formatAmount\(healthFeeDeductable\)\} 차감/);
  });

  // ── AC2: 무회귀 가드 (동작·산정·write-path 토큰 불변) ─────────────────────
  test('S0-4 (AC2) 버튼 동작(onClick/disabled) 무접촉', () => {
    const btn = deductBtn(pmw());
    expect(btn).toContain('onClick={() => setHealthFeeApplied(true)}');
    expect(btn).toContain('disabled={!healthFeeEligible || settled}');
  });

  test('S0-5 (AC2) 차감 산정/write-path 토큰 무접촉(Phase A·DEDUCTWIN 무회귀)', () => {
    const src = pmw();
    expect(src).toMatch(/const healthFeeDeducted = healthFeeApplied && healthFeeEligible \? healthFeeDeductable : 0;/);
    expect(src).toMatch(/const netPayableAfterHealthFee = Math\.max\(0, payableTotalWithSurcharge - healthFeeDeducted\);/);
    expect(src).toMatch(/method: 'health_maintenance', amount: hmAmount/);
    // DEDUCTWIN(AC2) 잔액 상시 표기·차감 후 teal 승격도 무회귀
    expect(src).toMatch(/!healthFeeApplied && healthMaintenanceBalance > 0 &&/);
    expect(src).toMatch(/className="flex justify-between font-medium text-teal-800">\s*<span>차감 후 건강생활유지비 잔액<\/span>/);
  });
});

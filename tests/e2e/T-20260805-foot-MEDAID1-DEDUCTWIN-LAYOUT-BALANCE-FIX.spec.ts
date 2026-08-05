/**
 * T-20260805-foot-MEDAID1-DEDUCTWIN-LAYOUT-BALANCE-FIX  (P1, foot, FE-only)
 *   Phase A('공단 차감' 버튼, commit 317a0c28) 소크 후 회귀 2건 정정.
 *   대상 = 수납창(PaymentMiniWindow) '의료급여1종 · 건강생활유지비 공단 차감' 영역. DB 무변경.
 *
 * ── AC ───────────────────────────────────────────────────────────────────────
 *   AC1 (레이아웃 비율)  : 좁은 진료비 산정 컬럼(sm:w-56~lg:w-64)에서 [라벨·input·원] 가로 배치가
 *     input 을 짓눌러 긴 placeholder 가 잘리던 비율 어긋남 → 라벨을 input 위로 스택 +
 *     input min-w-0 full-width + placeholder 축약으로 정렬.
 *   AC2 (잔액 표기 복구)  : 건강생활유지비 잔액이 '적용 클릭 후' + muted 톤으로만 노출돼 '안 보임' 회귀.
 *     → (a) 적용 전 잔액 입력 즉시 현재 잔액 상시 표기, (b) 적용 후 '차감 후 잔액' 을 teal 톤으로 승격.
 *   AC3 (무회귀)  : 차감 산정(실수납 0원)·payments method='health_maintenance' write-path·영수증 차감
 *     3줄 표기는 무접촉 — 표시/배치만 수정.
 *
 * ── 커버리지 ─────────────────────────────────────────────────────────────────
 *   [S0 소스계약 — 항상 실행, 무네트워크] 이 레포 다수 spec 관례. PaymentMiniWindow 소스가 위 AC 를
 *     만족하는지 권위 검증. 산정 로직 토큰(healthFeeDeducted/netPayableAfterHealthFee/handleSettle)
 *     불변(무회귀 가드) 동반.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = (rel: string) => readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');
const pmw = () => repo('src/components/PaymentMiniWindow.tsx');

// 공단 차감 teal 박스 JSX 블록만 슬라이스(다른 곳의 토큰 오탐 방지).
function deductBox(src: string): string {
  const start = src.indexOf('의료급여 1종 · 건강생활유지비 공단 차감');
  expect(start).toBeGreaterThan(-1);
  // 박스 끝 = 공단 차감 취소 버튼 이후 '실수납액' 라인까지 충분히 포함하도록 넉넉히 슬라이스.
  return src.slice(start - 400, start + 4200);
}

test.describe('S0 소스계약 — 공단 차감 창 레이아웃/잔액 회귀 정정', () => {
  // ── AC1: 레이아웃 비율 ──────────────────────────────────────────────────
  test('S0-1 (AC1) 공단 잔액 라벨이 input 위로 스택된다(가로 nowrap 짓눌림 제거)', () => {
    const box = deductBox(pmw());
    // 라벨이 block(스택) 이고 (공단 포털 확인) 안내를 포함
    expect(box).toMatch(/<label className="block text-xs text-muted-foreground">공단 잔액 \(공단 포털 확인\)<\/label>/);
    // 구 가로배치(whitespace-nowrap 라벨 '공단 잔액')는 제거됨
    expect(box).not.toContain('text-xs text-muted-foreground whitespace-nowrap">공단 잔액</label>');
  });

  test('S0-2 (AC1) input 은 min-w-0 full-width + 축약 placeholder(잘림 방지)', () => {
    const box = deductBox(pmw());
    expect(box).toMatch(/className="h-8 min-w-0 flex-1 rounded border px-2 text-sm text-right tabular-nums/);
    expect(box).toContain('placeholder="잔액 입력"');
    // 구 긴 placeholder(컬럼에서 잘리던 원인) 소멸
    expect(box).not.toContain('공단 포털에서 확인한 잔액 입력');
    // '원' 단위는 shrink-0 로 밀리지 않음
    expect(box).toMatch(/<span className="shrink-0 text-xs text-muted-foreground">원<\/span>/);
  });

  // ── AC2: 잔액 표기 복구 ─────────────────────────────────────────────────
  test('S0-3 (AC2) 적용 전 — 입력 즉시 건강생활유지비 잔액 상시 표기', () => {
    const box = deductBox(pmw());
    // 적용 전(!healthFeeApplied) + 잔액>0 조건에서 현재 잔액을 표기
    expect(box).toMatch(/!healthFeeApplied && healthMaintenanceBalance > 0 &&/);
    expect(box).toMatch(/건강생활유지비 잔액<\/span>\s*<span className="tabular-nums">\{formatAmount\(healthMaintenanceBalance\)\}/);
  });

  test('S0-4 (AC2) 적용 후 — 차감 후 잔액이 teal font-medium 로 승격(muted 흐림 제거)', () => {
    const box = deductBox(pmw());
    // 차감 후 잔액 라인이 teal-800 font-medium 이어야 함
    expect(box).toMatch(/className="flex justify-between font-medium text-teal-800">\s*<span>차감 후 건강생활유지비 잔액<\/span>/);
    // 구 muted 톤(안 보이던 원인) 제거
    expect(box).not.toMatch(/className="flex justify-between text-muted-foreground">\s*<span>차감 후 건강생활유지비 잔액/);
  });

  // ── AC3: 무회귀 가드 (산정 로직 토큰 불변) ───────────────────────────────
  test('S0-5 (AC3) 차감 산정/write-path 토큰 무접촉', () => {
    const src = pmw();
    // 실수납 0원 세팅·차감 파생 로직 SSOT 유지
    expect(src).toMatch(/const healthFeeDeducted = healthFeeApplied && healthFeeEligible \? healthFeeDeductable : 0;/);
    expect(src).toMatch(/const netPayableAfterHealthFee = Math\.max\(0, payableTotalWithSurcharge - healthFeeDeducted\);/);
    // health_maintenance 결제행 write-path(handleSettle 분리행) 유지
    expect(src).toMatch(/method: 'health_maintenance', amount: hmAmount/);
  });
});

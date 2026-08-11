/**
 * T-20260811-foot-PLANA-REFUND-PKGSESSION-INVALIDATE
 * 플랜A 실테스트 현장(최필경 총괄) 재확인 — money-path P1.
 *
 * [증상] 12회권 환불 완료(돈 반환) 후에도 (1) 잔여 회차(비가열/가열)가 살아있고,
 *   (2) 미수 2,960,000 이 부활한다.
 * [RC] 환불행 append-only INSERT + cross-ledger 트리거(foot_recompute_package_status)가
 *   packages.status='refunded' 로 정상 전이한다. 그러나 상세시트의
 *   (a) 잔여 회차 = get_package_remaining(declared−used) → status 무시
 *   (b) 미수 = computeOutstanding(total, net) → net=0 부활분(2,960,000) 을 status 무관 표시.
 *   리스트 뱃지 SSOT(loadCustomerOutstanding)은 이미 status='active' 한정(환불=0-due).
 * [FIX · 순수 FE 표시 게이팅, db_change=false] 상세시트를 SSOT(active-only)에 정합:
 *   isRefundVoided(pkg.status==='refunded') → 잔여 전 종류 0 · 미수 0 · '환불완료·사용불가' 배너 ·
 *   리스트행 회색(무효화). 환불 원장/회차 세션행/미수 산식 semantics 무변경.
 *
 * 본 spec 은 표시 게이팅 계약(회귀 방지)을 코드-레벨로 고정한다. 실 DB 시딩 없이도
 * 렌더 게이팅 술어(status==='refunded' → 0/void/gray)의 구조를 문서화·회귀검증하는 스모크.
 * 현장 실기기 확인(갤탭)은 supervisor QA + field-soak 로 종결.
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260811 패키지 환불 무효화 표시 게이팅', () => {
  test('환불 상태 게이팅 술어가 소스에 보존되어 있다 (회귀 가드)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/Packages.tsx', 'utf-8');

    // AC-1: 잔여 회차 0화 — 환불 티켓은 displayRemaining(전 종류 0)
    expect(src).toContain('isRefundVoided');
    expect(src).toMatch(/displayRemaining[^\n]*isRefundVoided/);

    // AC-2: 미수 0 — 환불 티켓은 outstanding 0 (net=0 부활분 clamp)
    expect(src).toMatch(/isRefundVoided \? 0 : computeOutstanding/);

    // AC-3: '환불완료 · 사용불가' terminal 배너
    expect(src).toContain('pkg-refunded-void-banner');
    expect(src).toContain('환불완료 · 사용불가');

    // AC-4: 리스트행 회색(무효화) + testid 구분
    expect(src).toContain('pkg-row-refunded');
    expect(src).toMatch(/status === 'refunded' && 'bg-muted\/30/);

    // AC-6: 원장/세션 hard-delete 0 — 표시 게이팅은 세션행을 파괴하지 않는다(append-only 보존).
    //   (환불 자체는 기존 append-only RPC 경로 유지 = 본 표시 fix 는 write 를 추가하지 않는다.)
    expect(src).not.toMatch(/from\(['"]package_sessions['"]\)[\s\S]{0,40}\.delete\(/);
  });

  test('환불 패키지는 사용불가 — 액션버튼은 status===active 게이트 하에만 렌더', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/Packages.tsx', 'utf-8');
    // 회차소진/결제/환불/양도/재생성 액션은 pkg.status==='active' 로 감싸져 refunded 에서 미노출
    expect(src).toMatch(/pkg\.status === 'active' &&/);
  });
});

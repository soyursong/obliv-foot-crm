/**
 * T-20260811-foot-PLANA-REFUND-PKGSESSION-INVALIDATE  (round2 — CustomerChartPage PORT)
 * 플랜A 실테스트 현장(최필경 총괄, C0ATE5P6JTH) 재확인 — money-path P1.
 *
 * [round2 RC · dispositive] round1 fix(6df35061)가 src/pages/Packages.tsx(패키지관리 페이지)에만
 *   착지했다. 그러나 reporter 실화면 /chart/66c08e48 = src/pages/CustomerChartPage.tsx(고객차트
 *   패키지 탭)은 게이팅 전무(git grep 0건)였다. packages.status 실측 = 박민석 F-4445 12회권 2건
 *   모두 'refunded' 정상 전이(트리거 net≤0 정상 발화) → status-transition 가설 FALSIFIED.
 *   진짜 RC = 게이팅이 wrong surface(파일)에 있었다.
 *
 * [FIX · Packages.tsx 와 동일 술어를 CustomerChartPage 로 port, db_change=false] 표시/상태 렌더
 *   게이팅만. isRefundVoided(p.status==='refunded') → 잔여 전 종류 0(AC-1) · 미수/잔금 0(AC-2) ·
 *   '환불완료 · 사용불가' 배너(AC-3) · 리스트행 회색 무효화 + testid(AC-4). 환불 원장/회차 세션행/
 *   RPC/미수 산식 semantics 무접촉(hard-delete 0 · append-only 원장 보존).
 *
 * 본 spec 은 두 surface 가 같은 술어를 쓰도록 CustomerChartPage 소스에 게이팅 계약을 코드-레벨로
 * 고정한다(회귀 가드). 현장 실기기 확인(갤탭)은 supervisor QA + field-soak 로 종결.
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260811 round2 — CustomerChartPage 패키지 탭 환불 무효화 게이팅 port', () => {
  test('CustomerChartPage 실화면에 환불 게이팅 술어가 착지되어 있다 (round2 회귀 가드)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');

    // 술어 정의 존재
    expect(src).toMatch(/const isRefundVoided = p\.status === 'refunded'/);

    // AC-1: 잔여 회차 표시 0화 — 환불 티켓은 잔여 전 종류 0(세션행/RPC 불변, 표시단 clamp)
    expect(src).toMatch(/isRefundVoided \? 0 : row\.qty - row\.used/);

    // AC-2: 미수/잔금 0 — 상세 미수 박스 clamp + 미수요약 루프 refunded skip
    expect(src).toMatch(/isRefundVoided \? 0 : computeOutstanding/);
    expect(src).toMatch(/p\.status === 'cancelled' \|\| p\.status === 'refunded'\) continue/);

    // AC-3: '환불완료 · 사용불가' terminal 배너
    expect(src).toContain('pkg-refunded-void-banner');
    expect(src).toContain('환불완료 · 사용불가');

    // AC-4: 리스트행 회색(무효화) + testid 구분
    expect(src).toContain('pkg-row-refunded');
    expect(src).toMatch(/isRefundVoided && 'bg-muted\/30 opacity-60'/);
  });

  test('money-path 가드 — CustomerChartPage 표시 게이팅은 세션행을 파괴하지 않는다 (hard-delete 0)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');
    // 본 fix 로 package_sessions hard-delete 를 추가하지 않는다(append-only 보존).
    expect(src).not.toMatch(/from\(['"]package_sessions['"]\)[\s\S]{0,40}\.delete\(\)/);
  });

  test('두 surface 가 같은 술어를 공유한다 — Packages.tsx round1 회귀 병존 확인', async () => {
    const fs = await import('node:fs');
    const pkg = fs.readFileSync('src/pages/Packages.tsx', 'utf-8');
    const chart = fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');
    // round1(Packages.tsx) 게이팅이 여전히 보존(회귀가드 병존)
    expect(pkg).toContain('isRefundVoided');
    expect(pkg).toContain('pkg-refunded-void-banner');
    // round2(CustomerChartPage) 게이팅이 착지 = 두 surface 동일 술어
    expect(chart).toContain('isRefundVoided');
    expect(chart).toContain('pkg-refunded-void-banner');
  });
});

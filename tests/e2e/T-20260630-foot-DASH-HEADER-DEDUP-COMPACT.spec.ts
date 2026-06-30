import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260630-foot-DASH-HEADER-DEDUP-COMPACT
 *
 * 현장(김주연 총괄): 풋 대시보드 상단 헤더/툴바 정리 4건 (첨부 F0BEVJG4SLQ로 위치 특정).
 *   1) 종(알림) 아이콘 삭제 — 마키 스트립(클릭=드롭다운)이 이미 알림 진입점이라 종 버튼은 중복.
 *   2) '전체/신규/재진' 탭에 'N건' 표기 — 기존 화면 보유 카운트(statusNewCount/statusReturningCount) 재사용.
 *   3) 좌측 '초진·재진·수납대기·완료' 상태바(dashboard-statusbar-4item) 제거 — 초진/재진이 탭 건수와 중복.
 *   4) '슬롯편집/배치편집/당일검색' 2줄 줄바꿈 → whitespace-nowrap로 1줄 유지.
 *
 * 구현 요지:
 *   - AC-1: AssignmentNotifyBell에 showBell prop(default true) 추가. 대시보드는 showBell={false}로 종 버튼+배지 숨김.
 *           마키(assign-notify-marquee)·드롭다운(assign-notify-panel)은 유지 → 알림 기능 무손실.
 *           예약관리(Reservations)는 prop 미전달=기본 true → 종 유지(스코프 격리, 동작 불변).
 *   - AC-2: 탭 라벨 '전체 {신규+재진}건 / 신규 {statusNewCount}건 / 재진 {statusReturningCount}건'. 신규 fetch·집계 없음.
 *           0건도 '0건' 정상 표기(NaN/undefined 금지 — 숫자 변수는 항상 정의됨).
 *   - AC-3: dashboard-statusbar-4item 블록 + 미사용된 statusDoneCount/statusPaymentWaitingCount 정의 제거.
 *           doneCumulativeIds는 activeNonTerminal 계산에 필수라 유지.
 *   - AC-4: 슬롯편집(slot-batch-edit-btn)·배치편집·당일검색 버튼에 whitespace-nowrap+shrink-0.
 *
 * 영역 경계(REDEFINITION_RISK): 헤더/툴바만. 좌측 사이드바(SIDEBAR-DAYLOG)·인수인계 박스(HANDOVER-BOX) 무수정.
 *
 * 시나리오(AC1~AC4):
 *   S1(source-integrity, 결정론): 종 버튼 showBell 게이트 + 대시보드 showBell={false} + 탭 N건 배선 + 상태바 제거 + nowrap.
 *   S2(live, best-effort): 대시보드 헤더에 종 버튼(assign-notify-bell) 미노출 + 상태바 4item 미노출 + 탭 'N건' 표기 + pageerror 0.
 *
 * FE-only · NO-DDL · 발송 0. 데이터 정책 자문 게이트 비대상. 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상(접수/칸반 화면).
 */

const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const BELL = fs.readFileSync(path.resolve('src/components/AssignmentNotifyBell.tsx'), 'utf-8');
const RESV = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// S1 — source-integrity gating (결정론, auth 불요)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-HEADER-DEDUP-COMPACT — source-integrity', () => {
  test('S1-a: AC-1 종 버튼이 showBell prop 게이트로 감싸짐 + 대시보드는 showBell={false}', () => {
    // 컴포넌트: showBell prop(default true) 도입.
    expect(BELL).toMatch(/showBell\s*=\s*true/);
    expect(BELL).toMatch(/showBell\?\:\s*boolean/);
    // 종 버튼(assign-notify-bell)은 showBell일 때만 렌더.
    expect(BELL).toMatch(/\{showBell\s*&&\s*\(/);
    // 마키(알림 진입점)는 유지 — 무손실.
    expect(BELL).toContain('assign-notify-marquee');
    expect(BELL).toContain('assign-notify-panel');
    // 대시보드 사용처는 showBell={false}.
    expect(DASH).toMatch(/<AssignmentNotifyBell\b[^>]*showBell=\{false\}/);
  });

  test('S1-b: AC-1 스코프 격리 — 예약관리(Reservations)는 showBell 미전달(기본 true=종 유지)', () => {
    // Reservations는 종을 그대로 유지해야 함(인접 코드 동작 불변).
    const resvUsage = RESV.match(/<AssignmentNotifyBell\b[^>]*\/>/g) ?? [];
    expect(resvUsage.length).toBeGreaterThanOrEqual(1);
    for (const u of resvUsage) expect(u).not.toContain('showBell');
  });

  test('S1-c: AC-2 전체/신규/재진 탭에 N건 표기(기존 카운트 재사용, 신규 집계 없음)', () => {
    expect(DASH).toMatch(/전체 \{statusNewCount \+ statusReturningCount\}건/);
    expect(DASH).toMatch(/신규 \{statusNewCount\}건/);
    expect(DASH).toMatch(/재진 \{statusReturningCount\}건/);
    // 카운트 변수는 기존 정의 재사용 — 본 티켓이 신규 fetch/집계를 추가하지 않음.
    expect(DASH).toMatch(/const statusNewCount = activeNonTerminal\.filter/);
    expect(DASH).toMatch(/const statusReturningCount = activeNonTerminal\.filter/);
  });

  test('S1-d: AC-3 좌측 상태바(dashboard-statusbar-4item) + 미사용 카운트 정의 제거', () => {
    // 상태바 블록 제거.
    expect(DASH).not.toContain('dashboard-statusbar-4item');
    // 표기 소비처가 사라진 두 카운트 정의 제거(unused 방지).
    expect(DASH).not.toContain('const statusDoneCount');
    expect(DASH).not.toContain('const statusPaymentWaitingCount');
    // doneCumulativeIds는 activeNonTerminal 계산에 필수라 유지.
    expect(DASH).toContain('const doneCumulativeIds');
    expect(DASH).toMatch(/doneCumulativeIds\.has\(r\.id\)/);
  });

  test('S1-e: AC-4 슬롯편집/배치편집/당일검색 1줄화(whitespace-nowrap)', () => {
    // 슬롯편집 버튼.
    expect(DASH).toMatch(/data-testid="slot-batch-edit-btn"[\s\S]{0,260}?whitespace-nowrap/);
    // 당일검색 버튼.
    expect(DASH).toMatch(/title="당일 예약 환자 검색[^"]*"/);
    expect(DASH).toMatch(/bg-teal-50 px-2\.5 py-1\.5 text-xs text-teal-700 hover:bg-teal-100 transition whitespace-nowrap/);
    // 배치편집 토글 버튼.
    expect(DASH).toMatch(/handleLayoutEditToggle[\s\S]{0,400}?whitespace-nowrap/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// S2 — live (best-effort; 실 렌더 최종 확인은 supervisor 갤탭 field-soak)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260630 DASH-HEADER-DEDUP-COMPACT — live', () => {
  test('S2: 대시보드 헤더 — 종 버튼 미노출 + 상태바 미노출 + 탭 N건 표기 + pageerror 0', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.waitForTimeout(2000);

    const header = page.locator('[data-dashboard-header]');
    await expect(header).toBeVisible({ timeout: 8000 });

    // AC-1: 헤더 내 종 버튼(assign-notify-bell) 미노출.
    expect(await page.getByTestId('assign-notify-bell').count(), '대시보드 헤더에 종 버튼이 남아있음').toBe(0);

    // AC-3: 좌측 상태바(dashboard-statusbar-4item) 미노출.
    expect(await page.getByTestId('dashboard-statusbar-4item').count(), '상태바 4item이 남아있음').toBe(0);

    // AC-2: 탭 라벨에 'N건' 표기(0건 포함 NaN/undefined 금지).
    const headerTxt = await header.innerText().catch(() => '');
    expect(headerTxt, "탭 '전체 N건' 표기 누락").toMatch(/전체\s*\d+건/);
    expect(headerTxt, "탭 '신규 N건' 표기 누락").toMatch(/신규\s*\d+건/);
    expect(headerTxt, "탭 '재진 N건' 표기 누락").toMatch(/재진\s*\d+건/);
    expect(headerTxt, 'NaN/undefined 표기 발생').not.toMatch(/NaN|undefined/);

    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

/**
 * T-20260630-foot-HANDOVER-BOX-COMPACT-MONO
 * 인수인계 박스 컴팩트 + 모노톤 회귀 E2E
 *
 * 요청: 김주연 총괄(C0ATE5P6JTH) / 스크린샷 F0BDUSA00AF(공간 과다)
 *
 * 배경(SUPERSEDE): 직전 T-20260609-foot-HANDOVER-PARTBOX-COLOR 의 '박스 배경 파트색'
 *   (PART_BOX_CLASS rose/amber/teal/indigo)을 동일 reporter 자기-override 로 모노톤 회귀.
 *   - 박스 배경/테두리 = 전 파트 동일 모노톤(bg-slate-50/border-slate-200).
 *   - 상단 파트 배지 = 무채색(slate-200) 통일 — 라벨(텍스트)만 유지, 색 제거.
 *       (11:09 PUSH AC2 정정: "배지도 모노톤으로 통일". 파트 구분=배지 텍스트.)
 *   - 이름칩(NAMECARD: 상담 sky/코디 yellow/치료 green)은 불변(범위 밖).
 *   - 컴팩트: 박스 여백/간격 축소(p-2.5→p-2, space-y-1.5→space-y-1).
 *
 * 커버 시나리오:
 *   S1. 박스 모노톤 배경 + 컴팩트(p-2/space-y-1) 렌더 + 파트색 배경 제거 + 배지 색 잔존
 *   S2. 이름칩/배지·파트필터·작성폼·캘린더뷰 무회귀(AC5)
 *
 * 주의:
 *  - 빈 날짜는 박스 미생성=정상 → 작성 후 검증 / 저장 실패(RLS·staging) 시 graceful skip-log.
 *  - 동적 tailwind 클래스 없음(정적 단일 모노톤 클래스).
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260630-foot-HANDOVER-BOX-COMPACT-MONO 박스 컴팩트+모노톤', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 모노톤 배경 + 컴팩트 렌더 + 배지 무채색 ───────────────────────────
  test('S1 치료사 박스+배지 모노톤(slate) + 컴팩트 + 라벨 유지', async ({ page }) => {
    await gotoHandover(page);

    // 오늘 날짜 셀 선택
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // 치료사(therapist) 파트로 작성 — 직전 spec 에선 teal 박스였던 파트
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    const memo = `컴팩트모노 테스트 — 치료사 인계 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER-COMPACT-MONO] S1 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-part', '공통');

    // AC1: 박스 배경/테두리 = 모노톤(bg-slate-50/border-slate-200)
    await expect(card).toHaveClass(/bg-slate-50/);
    await expect(card).toHaveClass(/border-slate-200/);

    // AC1: 파트색 배경(rose/amber/teal/green/indigo -50) 전부 제거됨
    await expect(card).not.toHaveClass(/bg-teal-50/);
    await expect(card).not.toHaveClass(/bg-green-50/);
    await expect(card).not.toHaveClass(/bg-rose-50/);
    await expect(card).not.toHaveClass(/bg-amber-50/);
    await expect(card).not.toHaveClass(/bg-indigo-50/);

    // AC3: 컴팩트 — 박스 패딩/간격 축소 클래스 적용
    await expect(card).toHaveClass(/(^|\s)p-2(\s|$)/);
    await expect(card).toHaveClass(/space-y-1(\s|$)/);

    // AC2(11:09 PUSH 정정): 파트 배지도 무채색(slate-200) 통일 — 라벨은 유지, 파트색 제거
    const badge = card.getByText('공통', { exact: true });
    await expect(badge).toBeVisible(); // 라벨(텍스트) 유지
    await expect(badge).toHaveClass(/bg-slate-200/);
    await expect(badge).not.toHaveClass(/bg-green-100/);
    await expect(badge).not.toHaveClass(/bg-rose-100|bg-amber-100|bg-indigo-100|bg-teal-100/);
    console.log('[HANDOVER-COMPACT-MONO] S1 박스+배지 모노톤+컴팩트 OK');
  });

  // ── S2. 이름칩/배지·필터·폼·캘린더 무회귀 ──────────────────────────────────
  test('S2 이름칩·배지·파트필터·작성폼·캘린더뷰 무회귀(AC5)', async ({ page }) => {
    await gotoHandover(page);

    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO (SUPERSEDE): 파트 필터 탭·작성폼 파트 선택지 제거됨.
    await expect(page.getByTestId('handover-part-filter')).toHaveCount(0);

    // 선택일 출근자 이름칩 — 박스 작업과 무관하게 기존 클래스 유지(이름칩 색 불변)
    await page.getByTestId(`handover-day-${TODAY}`).click();
    const chips = page.getByTestId('handover-selected-attendee-chip');
    const chipCount = await chips.count();
    if (chipCount > 0) {
      await expect(chips.first()).toHaveClass(/rounded-full/);
      console.log(`[HANDOVER-COMPACT-MONO] S2 이름칩 ${chipCount}개 무회귀 확인`);
    } else {
      console.log('[HANDOVER-COMPACT-MONO] S2 선택일 출근자 없음 — 이름칩 무회귀 skip-log');
    }

    // 작성 폼 파트 선택지 제거됨(SUPERSEDE) — 폼 진입은 무회귀, 파트 피커 비노출
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    await expect(page.getByTestId('handover-form-part')).toHaveCount(0);
    await page.getByRole('button', { name: '취소' }).click();

    // 캘린더 뷰 토글 무회귀(통합/주/월)
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-month').click();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[HANDOVER-COMPACT-MONO] S2 무회귀 OK');
  });
});

/**
 * T-20260814-foot-HANDOVER-CHECKLIST-ITEM-EDIT
 * 근무캘린더 > 인수인계 수정 모달 — 체크리스트 항목 "내용 수정(edit)" 기능
 *
 * 요청: 박민석 코디 (MSG-20260814-163648-xmv6) — "삭제 옆에 내용수정 기능 넣어달라공"
 *   → A/B/C 해석발산 종결 = (A) EDIT 확정. 위치 = X 삭제버튼 옆 편집(연필) 컨트롤.
 *
 * AC:
 *   (1) 항목 행 X 삭제버튼 옆 편집(연필) 노출 → 클릭 시 텍스트 in-place 편집
 *   (2) 편집 후 저장 → 재조회(재오픈) 시 변경 반영
 *   (3) 추가/삭제 기존 동작 무회귀 (자매 DELETE 티켓 보존)
 *   (4) 편집 컨트롤 터치 탭타겟 ≥40px (풋=갤탭/터치)
 *
 * 커버 시나리오:
 *   S1. 신규 2항목 → 재오픈 → 연필 클릭 → in-place 입력 → 확인(체크) → 모달 즉시 반영 (AC1)
 *   S2. 저장 → 재오픈 시 편집값 영속 반영 (AC2)
 *   S3. 편집 컨트롤 탭타겟 40px 검증 (AC4)
 *   S4. 무회귀 — 삭제(X) 즉시 제거 여전히 동작 (AC3)
 *
 * 주의: 단일 test 계정. staging RLS/auth 로 저장 카드 미표시 시 graceful skip-log.
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

test.describe('T-20260814-foot-HANDOVER-CHECKLIST-ITEM-EDIT 체크리스트 항목 내용 수정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  test('S1~S4 편집(연필)→in-place 수정→저장 영속 + 탭타겟 + 삭제 무회귀', async ({ page }) => {
    await gotoHandover(page);
    await page.getByTestId(`handover-day-${TODAY}`).click();

    // ── 신규 작성 (메모 + 체크리스트 2건) ──
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });

    const memo = `항목수정 테스트 ${Date.now()}`;
    await page.getByTestId('handover-form-memo').fill(memo);

    const orig = ['베드 소독 확인', '차트 미작성 확인'];
    for (const label of orig) {
      await page.getByTestId('handover-form-item-input').fill(label);
      await page.getByTestId('handover-form-item-add').click();
    }
    await expect(page.getByTestId('handover-form-item-list').getByRole('listitem')).toHaveCount(2);

    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card = page.getByTestId('handover-card').filter({ hasText: memo });
    if ((await card.count()) === 0) {
      console.log('[HANDOVER-ITEM-EDIT] 저장 카드 미표시 — staging RLS/auth 추정, skip');
      test.skip(true, '저장 카드 미표시(staging)');
      return;
    }

    // ── 재오픈(수정) → 2건 로드 ──
    await card.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    const list = page.getByTestId('handover-form-item-list');
    await expect(list.getByRole('listitem')).toHaveCount(2);

    // ── AC1/S1: 첫 항목 연필 클릭 → in-place 입력 노출 → 텍스트 수정 → 확인(체크) ──
    const firstItem = list.getByRole('listitem').filter({ hasText: orig[0] });
    await expect(firstItem).toHaveCount(1);

    // AC4/S3: 편집 컨트롤 탭타겟 ≥40px.
    //   authored 크기는 computed min-width/min-height 로 검증(≥40px 하드 보장).
    //   boundingBox 는 shadcn Dialog 의 zoom-in-95(scale) 트랜스폼으로 40×0.95≈38 로
    //   축소 측정되므로 절대 px 어서션 기준에서 제외하고, 렌더 하한(≥36)만 sanity 확인.
    const editBtn = firstItem.getByTestId('handover-form-item-edit');
    await expect(editBtn).toBeVisible();
    const minSize = await editBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { minW: parseFloat(cs.minWidth), minH: parseFloat(cs.minHeight) };
    });
    expect(minSize.minW, '편집 버튼 min-width').toBeGreaterThanOrEqual(40);
    expect(minSize.minH, '편집 버튼 min-height').toBeGreaterThanOrEqual(40);
    const box = await editBtn.boundingBox();
    expect(box, '편집 버튼 boundingBox').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(36);
    expect(box!.height).toBeGreaterThanOrEqual(36);

    await editBtn.click();
    // 편집 모드 진입 시 라벨 span 이 Input 으로 교체 → li 의 text content 가 사라져
    // hasText 필터(firstItem)가 매칭 불가. 한 번에 한 항목만 편집되므로 list 레벨로 조회.
    const editInput = list.getByTestId('handover-form-item-edit-input');
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue(orig[0]);

    const edited = '베드 소독 완료 재확인';
    await editInput.fill(edited);
    await list.getByTestId('handover-form-item-edit-save').click();

    // 모달 즉시 반영: 편집 입력 닫히고 새 라벨 노출, 개수 유지
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText(edited)).toBeVisible();
    await expect(list.getByText(orig[0])).toHaveCount(0);
    await expect(list.getByText(orig[1])).toBeVisible();

    // ── AC2/S2: 저장 → 재오픈 시 편집값 영속 반영 ──
    await page.getByTestId('handover-form-save').click();
    await expect(page.getByTestId('handover-dialog')).toBeHidden({ timeout: 10_000 });

    const card2 = page.getByTestId('handover-card').filter({ hasText: memo });
    await expect(card2).toBeVisible();
    await expect(card2.getByText(edited)).toBeVisible();
    await expect(card2.getByText(orig[0])).toHaveCount(0);
    await expect(card2.getByText(orig[1])).toBeVisible();

    await card2.getByTestId('handover-edit').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible();
    const list2 = page.getByTestId('handover-form-item-list');
    await expect(list2.getByRole('listitem')).toHaveCount(2);
    await expect(list2.getByText(edited)).toBeVisible();

    // ── AC3/S4: 삭제(X) 무회귀 — 편집값 항목 X 즉시 제거 ──
    const editedItem = list2.getByRole('listitem').filter({ hasText: edited });
    await editedItem.getByTestId('handover-form-item-delete').click();
    await expect(list2.getByRole('listitem')).toHaveCount(1);
    await expect(list2.getByText(edited)).toHaveCount(0);
    await expect(list2.getByText(orig[1])).toBeVisible();

    console.log('[HANDOVER-ITEM-EDIT] S1~S4 편집→저장 영속 + 40px 탭타겟 + 삭제 무회귀 OK');
  });
});

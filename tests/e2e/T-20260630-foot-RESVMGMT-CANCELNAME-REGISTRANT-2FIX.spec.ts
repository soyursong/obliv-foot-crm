/**
 * E2E — T-20260630-foot-RESVMGMT-CANCELNAME-REGISTRANT-2FIX
 * 풋 예약관리(기본=일간 TIMEGRID, renderDayCard) 표현 2종 튜닝. 순수 FE/CSS, DB 무변경.
 *
 *  (1) 예약 취소 시 이름 '축소' 효과 제거 — 취소 성함도 활성 성함과 동일 크기(text-[11px]).
 *      기존: 취소 성함은 plain span 분기라 카드 본문(text-[8px]) 상속 → 활성(CustomerHoverCard compactDense=text-[11px])보다 작아 보였음.
 *  (2) 예약등록자(@registrar) 위치: 예약 상태 '하단'(별도 div 세로 적층) → 상태 '우측 사이드'(같은 flex 행, 좌=상태/우=등록자 ml-auto).
 *
 * 검증(현장 클릭 시나리오 3종 → DOM 구조 invariant):
 *  S1 취소이름  : line-through 성함 span 은 text-[11px] 보유(축소 8px 잔재 0).
 *  S2 등록자우측: 예약등록자 span(title^="예약등록자")은 상태줄 같은 행에서 ml-auto(우측 정렬) + truncate/min-w-0(반응형 가드).
 *                상태 라벨과 같은 flex 부모 안 → '하단 별도 줄' 구조 아님.
 *  S3 회귀      : 예약등록자 표기값이 UUID 아님(NEWRESV-REGISTRANT-UUID-LABEL 매핑 유지) + 예약관리 그리드 정상 렌더.
 *
 * 비파괴: 시드 없음(라이브 데이터 구조 검증, 카드 0이면 graceful skip). 데이터·로직·라우팅 무변경.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const UUID_RE = /^@?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loginIfNeeded(page: Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260630-foot-RESVMGMT-CANCELNAME-REGISTRANT-2FIX — 취소이름 축소제거 + 등록자 우측', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // S1 — [SUPERSEDED by T-20260630-foot-RESVMGMT-GRID-CLICKCREATE-7ADJ ⑥] 취소 이름 취소선(line-through) 자체를 제거(회색+음각 대체).
  //   line-through 성함이 더 이상 존재하지 않으므로 '취소선 성함의 폰트' 검증 전제가 무효 → skip.
  test.skip('S1: 취소(line-through) 성함 span 은 활성과 동일 text-[11px] (SUPERSEDED 7ADJ ⑥)', async ({ page }) => {
    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    // 취소 카드의 성함 = plain span (line-through). 카드 내부 첫 행 성함.
    const cancelledNames = page.locator('span.line-through');
    const cnt = await cancelledNames.count();
    if (cnt === 0) { test.info().annotations.push({ type: 'note', text: '취소 예약 없음 → 구조 검증 skip' }); return; }

    for (let i = 0; i < cnt; i++) {
      const cls = (await cancelledNames.nth(i).getAttribute('class')) ?? '';
      // 성함 span(고객명) 한정: text-[8px] 상속 잔재 없이 명시적 text-[11px] 보유
      if (cls.includes('font-semibold') || cls.includes('truncate')) {
        expect(cls, `취소 성함 span 은 text-[11px] 보유해야 함 (cls=${cls})`).toContain('text-[11px]');
        // 축소 잔재(8px/7px) 직접 클래스 금지
        expect(cls).not.toContain('text-[8px]');
        expect(cls).not.toContain('text-[7px]');
      }
    }
  });

  // S2 — AC-2: 예약등록자가 상태 우측 사이드(같은 flex 행 ml-auto), 하단 별도 줄 아님 + 반응형 가드
  test('S2: 예약등록자 @span 은 상태줄 우측(ml-auto) + truncate/min-w-0 (하단 적층 아님)', async ({ page }) => {
    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });

    const registrar = page.locator('[title^="예약등록자"]');
    const cnt = await registrar.count();
    if (cnt === 0) { test.info().annotations.push({ type: 'note', text: '예약등록자 표기 카드 없음 → skip' }); return; }

    const el = registrar.first();
    const cls = (await el.getAttribute('class')) ?? '';
    // 우측 정렬 + 반응형 가드
    expect(cls, '예약등록자 span 우측 정렬(ml-auto)').toContain('ml-auto');
    expect(cls, '좁은 칸 overflow 가드(truncate)').toContain('truncate');
    expect(cls).toContain('min-w-0');

    // 같은 flex 행에 상태 라벨이 함께 있어야 함('하단 별도 div' 아님)
    const rowText = (await el.locator('xpath=..').innerText()).trim();
    const hasStatus = /(예약|취소|내원|노쇼|체크인|완료)/.test(rowText);
    expect(hasStatus, `예약등록자는 상태 라벨과 같은 행이어야 함 (row="${rowText}")`).toBeTruthy();
  });

  // S3 — AC-3: 등록자 표기값 UUID 아님(이름 매핑 유지) + 그리드 정상
  test('S3: 예약등록자 표기는 이름(UUID 재노출 회귀 0) + 예약 그리드 정상 렌더', async ({ page }) => {
    const grid = page.getByTestId('resv-day-horizontal');
    await expect(grid).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('resv-day-xaxis')).toBeVisible();

    const registrar = page.locator('[title^="예약등록자"]');
    const cnt = await registrar.count();
    for (let i = 0; i < cnt; i++) {
      const txt = (await registrar.nth(i).innerText()).trim();
      expect(UUID_RE.test(txt), `예약등록자 표기가 UUID면 회귀 (txt="${txt}")`).toBeFalsy();
    }
    // 타화면 영향 0 — 예약관리 URL 유지
    await expect(page).toHaveURL(/reservations/);
  });
});

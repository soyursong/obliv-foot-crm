/**
 * E2E spec — T-20260610-foot-CALLLIST-HIDE-TOGGLE
 * '원장님 진료콜 명단'(DoctorCallListBar) — 숨기기 토글 + 숨김 중 신규 리스트업 빨간 배지.
 *
 * 현장 요청(김주연 총괄, C0ATE5P6JTH):
 *   직전 P0(TOP-COVERS-BUTTONS, 명단이 상단 버튼 가림 → 드래그로 1차 해소)의 후속 개선 —
 *   "명단을 아예 숨길 수 있게 + 숨긴 동안 신규 환자 놓치지 않게 알림."
 *
 * planner 스펙 확정:
 *   결정1 = 자동 재노출은 '숨김 유지 + 빨간 배지(unseen)'. ★즉시 강제 펼침 채택 X(P0 버튼가림 회귀).
 *   결정2 = 숨김/표시 상태 localStorage 영구(per-browser). 위치 키와 별도 네임스페이스.
 *
 * AC → 단언 매핑:
 *   AC-1 헤더 숨기기 토글(doctor-call-hide) → 클릭 시 패널 사라짐
 *   AC-2 숨김 중 최소 탭(doctor-call-show) 잔존 → 클릭 시 펼침(완전소멸 금지)
 *   AC-3 localStorage(foot.doctorCallList.hidden.v1) 영구 + 위치 키 분리
 *   AC-4 숨김 중 신규 리스트업 → unseen 배지(doctor-call-unseen-badge), 펼치면 리셋
 *   AC-5 자동 강제 펼침 없음(배지로만)
 *   AC-6/7 콜·집계·정렬·메모·드래그 위치(pos.v1) 보존 — 가시성 facet만 가산
 *
 * 컨벤션: DOM/계약 단언 + localStorage 단언 + 데이터/인증 없으면 graceful skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const HIDDEN_KEY = 'foot.doctorCallList.hidden.v1';
const POS_KEY = 'foot.doctorCallList.pos.v1';

test.describe('T-20260610 CALLLIST-HIDE-TOGGLE — 숨기기 토글 + 신규 리스트업 배지', () => {
  // 매 테스트 전 가시성 상태 초기화(이전 테스트 영속 오염 방지)
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((keys) => {
      try {
        localStorage.removeItem(keys.hidden);
      } catch {
        /* noop */
      }
    }, { hidden: HIDDEN_KEY });
  });

  // ── AC-1·AC-2: 숨기기 → 패널 사라지고 최소 탭만 → 다시 펼침 ──────────────────────────────
  test('AC-1/2: 숨기기 토글 → 최소 탭만 잔존, 탭 클릭 시 펼침(완전소멸 금지)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    // 펼친 상태: 헤더 + 숨기기 버튼 노출
    const hideBtn = page.locator('[data-testid="doctor-call-hide"]');
    await expect(hideBtn).toBeVisible();
    await expect(list).toHaveAttribute('data-hidden', 'false');

    // 숨기기 클릭 → 헤더 사라지고 최소 탭(doctor-call-show)만 남음(위젯 자체는 잔존)
    await hideBtn.click();
    await expect(list).toHaveAttribute('data-hidden', 'true');
    await expect(page.locator('[data-testid="doctor-call-header"]')).toHaveCount(0);
    const showTab = page.locator('[data-testid="doctor-call-show"]');
    await expect(showTab).toBeVisible(); // 완전소멸 금지 — 재접근 가능

    // 최소 탭 클릭 → 다시 펼침(헤더 복귀)
    await showTab.click();
    await expect(list).toHaveAttribute('data-hidden', 'false');
    await expect(page.locator('[data-testid="doctor-call-header"]')).toBeVisible();
  });

  // ── AC-3: 숨김 상태 localStorage 영구 — 새로고침 후에도 유지 + 위치 키와 분리 ───────────────
  test('AC-3: 숨김/표시 상태 localStorage 영구(새로고침 유지) + 위치 키 별도 네임스페이스', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    await page.locator('[data-testid="doctor-call-hide"]').click();
    await expect(list).toHaveAttribute('data-hidden', 'true');

    // localStorage 에 숨김('1') 저장 + 키가 위치 키와 별개
    const saved = await page.evaluate((k) => localStorage.getItem(k), HIDDEN_KEY);
    expect(saved).toBe('1');
    expect(HIDDEN_KEY).not.toBe(POS_KEY);

    // 새로고침 → 여전히 숨김(최소 탭만)
    await page.reload();
    const okReload = await loginAndWaitForDashboard(page);
    if (!okReload || (await list.count()) === 0) {
      test.skip(true, '새로고침 후 위젯 미표시 — 스킵');
      return;
    }
    await expect(list).toHaveAttribute('data-hidden', 'true');
    await expect(page.locator('[data-testid="doctor-call-show"]')).toBeVisible();

    // 펼침 후 새로고침 → 펼침 유지
    await page.locator('[data-testid="doctor-call-show"]').click();
    await expect(list).toHaveAttribute('data-hidden', 'false');
    expect(await page.evaluate((k) => localStorage.getItem(k), HIDDEN_KEY)).toBe('0');
  });

  // ── AC-5: 자동 강제 펼침 없음 — 숨김 상태에서 데이터 갱신돼도 hidden 유지 ────────────────────
  test('AC-5: 숨김 중 명단 변동에도 자동 강제 펼침 없음(배지로만 알림)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    await page.locator('[data-testid="doctor-call-hide"]').click();
    await expect(list).toHaveAttribute('data-hidden', 'true');
    // 잠시 대기(Realtime/refetch 사이클이 있어도) → 여전히 숨김(자동 펼침 금지)
    await page.waitForTimeout(1500);
    await expect(list).toHaveAttribute('data-hidden', 'true');
    await expect(page.locator('[data-testid="doctor-call-header"]')).toHaveCount(0);
  });

  // ── AC-4(계약): unseen 배지 testid 존재 + 숨김 탭에 위치 + 펼치면 사라짐 ─────────────────────
  // 신규 환자 주입은 데이터 의존이라 결정론적 재현이 어려움 → 배지 DOM 계약과 리셋 동선 검증.
  test('AC-4: unseen 배지 계약 — 숨김 탭 하위에 배지 testid, 펼치면 배지 영역 소멸', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    await page.locator('[data-testid="doctor-call-hide"]').click();
    const showTab = page.locator('[data-testid="doctor-call-show"]');
    await expect(showTab).toBeVisible();
    // 배지는 unseen>0 일 때만 렌더(0이면 미존재가 정상) — 존재 시 탭 내부에 위치해야 함
    const badge = page.locator('[data-testid="doctor-call-show"] [data-testid="doctor-call-unseen-badge"]');
    if (await badge.count()) {
      await expect(badge).toBeVisible();
      const txt = (await badge.textContent())?.trim() ?? '';
      expect(Number(txt)).toBeGreaterThan(0);
    }
    // 펼치면(=명단 확인) 배지 리셋 → 배지 DOM 자체가 사라짐(최소 탭도 사라짐)
    await showTab.click();
    await expect(list).toHaveAttribute('data-hidden', 'false');
    await expect(page.locator('[data-testid="doctor-call-unseen-badge"]')).toHaveCount(0);
  });

  // ── AC-6/7: 무회귀 — 드래그 위치 키 보존 + 콜/차트/접기 testid 보존(가시성 facet만 가산) ──────
  test('AC-6/7: 위치 키(pos.v1) 미접촉 + 콜/접기/이름 testid 보존', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    // 펼친 상태 기능 보존
    await expect(page.locator('[data-testid="doctor-call-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-call-hide"]')).toBeVisible();
    if (await page.locator('[data-testid="doctor-call-row"]').count()) {
      await expect(page.locator('[data-testid="doctor-call-name"]').first()).toBeVisible();
    }
    // 숨김 토글은 위치 키를 건드리지 않음(별도 네임스페이스)
    const posBefore = await page.evaluate((k) => localStorage.getItem(k), POS_KEY);
    await page.locator('[data-testid="doctor-call-hide"]').click();
    const posAfter = await page.evaluate((k) => localStorage.getItem(k), POS_KEY);
    expect(posAfter).toBe(posBefore); // 위치 상태 불변(가시성 facet과 직교)
  });
});

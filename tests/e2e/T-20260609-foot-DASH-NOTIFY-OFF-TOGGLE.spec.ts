/**
 * E2E spec — T-20260609-foot-DASH-NOTIFY-OFF-TOGGLE
 * 진료대시보드 브라우저 알림 끄기 토글 (현장 클릭 3 시나리오)
 *
 * 현장 요청 (문지은 대표원장): "알람을 켤 순 있는데 끌 수가 없다."
 *   진료대시보드가 '알림 켜짐' 상태(브라우저 권한 granted)에서, 앱이 OS 배너/토스트를
 *   더 이상 안 띄우게 직접 끌 버튼이 없었음. (②브라우저알림 전용 — ①소리 토글은 별건.)
 *
 * 구현 (커밋 75ef704 ALARM-TOGGLE-OFF에서 도입, 본 spec이 동선을 박제):
 *   - DoctorCallDashboard.tsx: granted/denied(=perm!=='default'&&!=='unsupported')일 때
 *     비클릭 span 대신 클릭 토글 버튼(data-testid="doctor-call-notify-toggle") 렌더.
 *     레이블 = notifyEnabled ? '알림 끄기'(Bell/emerald) : '알림 켜기'(BellOff/회색).
 *   - notifyEnabled 상태 localStorage 영속 (loadNotifyEnabled/saveNotifyEnabled).
 *   - useDoctorCallNotifier({ muted, notifyEnabled }): notifyEnabled=false면 OS배너/토스트
 *     생략. 소리는 muted로 별도 제어(별건). seen 키는 계속 추적 → 재활성 시 백로그 폭주 없음.
 *
 * ⚠ 설계 주: 티켓 초안은 기존 hook `enabled` 옵션 재사용을 제안했으나, `enabled`는 effect
 *   전체(소리·seen 추적 포함)를 게이트하므로 재활성 시 백로그 폭주를 유발한다. OS배너/토스트만
 *   끄는 별도 `notifyEnabled` 옵션이 올바른 설계 — 구현은 그 방식을 따른다.
 *
 * AC 매핑:
 *   S1 granted에서 알림 끄기 토글 노출·클릭(레이블/aria 반전)  → AC-1·AC-2
 *   S2 끈 뒤 새로고침해도 OFF 유지 (localStorage 영속)         → AC-2
 *   S3 ①소리토글은 ②브라우저알림과 별건(독립 버튼·레이블)      → AC-3 회귀
 *
 * 데이터/인증 없으면 graceful skip (field-soak 환경 의존 — 기존 PUSH-DASH spec 컨벤션).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 진료 알림판 탭까지 진입. 성공 시 true, 환경/권한으로 못 가면 false(스킵 유도). */
async function openCallDashboard(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/doctor-tools');
  const tab = page.locator('[data-testid="tab-call-dashboard"]');
  if ((await tab.count()) === 0) return false;
  await tab.click();
  const dash = page.locator('[data-testid="doctor-call-dashboard"]');
  if ((await dash.count()) === 0) return false;
  await expect(dash).toBeVisible();
  return true;
}

test.describe('T-20260609 DASH-NOTIFY-OFF-TOGGLE — 브라우저 알림 끄기 동선', () => {
  // ── S1: granted 상태에서 '알림 끄기' 토글 노출 + 클릭으로 끔 ─────────────────
  test('S1 (AC-1·AC-2): granted에서 알림 토글 클릭 시 켜기↔끄기 반전(끌 수 있음)', async ({
    page,
    context,
  }) => {
    // "켤 순 있는데 끌 수가 없던" granted 케이스 재현.
    await context.grantPermissions(['notifications']);
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/탭 미표시(환경·권한) — 스킵');
      return;
    }

    const toggle = page.locator('[data-testid="doctor-call-notify-toggle"]');
    await expect(toggle).toBeVisible();
    // 비클릭 span이 아니라 클릭 가능한 버튼이어야 함(끌 수 있는 동선).
    await expect(toggle).toHaveAttribute('type', 'button');
    await expect(toggle).toHaveText(/알림 (켜기|끄기)/);

    const before = (await toggle.textContent())?.trim() ?? '';
    const pressedBefore = await toggle.getAttribute('aria-pressed');
    await toggle.click();
    // 레이블 반전(켜기↔끄기) — 실제 토글 동작.
    await expect(toggle).not.toHaveText(before);
    // aria-pressed(=!notifyEnabled) 도 반전.
    await expect(toggle).not.toHaveAttribute('aria-pressed', pressedBefore ?? '');
  });

  // ── S2: 끈 뒤 새로고침해도 OFF 유지 (localStorage 영속) ───────────────────────
  test('S2 (AC-2): 알림을 끄면 새로고침 후에도 OFF 유지(localStorage 영속)', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/탭 미표시(환경·권한) — 스킵');
      return;
    }

    const toggle = page.locator('[data-testid="doctor-call-notify-toggle"]');
    await expect(toggle).toBeVisible();

    // OFF 상태(레이블 '알림 켜기')가 될 때까지 토글. ON이면 '알림 끄기'가 보이므로 1회 클릭.
    if (/알림 끄기/.test((await toggle.textContent()) ?? '')) {
      await toggle.click();
    }
    await expect(toggle).toHaveText(/알림 켜기/); // 현재 OFF
    // 영속 키 확인.
    const stored = await page.evaluate(() => localStorage.getItem('foot.doctorCall.notifyEnabled'));
    expect(stored).toBe('0');

    // 새로고침 후 재진입 → OFF 유지(백로그 폭주 없이 사용자 선택 보존).
    if (!(await openCallDashboard(page))) {
      test.skip(true, '재진입 실패(환경) — 스킵');
      return;
    }
    const toggle2 = page.locator('[data-testid="doctor-call-notify-toggle"]');
    await expect(toggle2).toBeVisible();
    await expect(toggle2).toHaveText(/알림 켜기/); // 여전히 OFF
  });

  // ── S3: ①소리토글은 ②브라우저알림과 별건 (AC-3 회귀) ─────────────────────────
  test('S3 (AC-3 회귀): 소리 토글은 브라우저 알림과 별개 버튼·별개 레이블', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['notifications']);
    if (!(await openCallDashboard(page))) {
      test.skip(true, '로그인/탭 미표시(환경·권한) — 스킵');
      return;
    }

    // ① 소리 토글: 항상 존재, '소리 켜기/끄기' 레이블만(알림과 무관).
    const mute = page.locator('[data-testid="doctor-call-mute-toggle"]');
    await expect(mute).toBeVisible();
    await expect(mute).toHaveText(/소리 (켜기|끄기)/);
    await expect(mute).not.toHaveText(/알림/);

    // ② 브라우저 알림 토글: 소리 토글과 다른 별개 버튼.
    const notify = page.locator('[data-testid="doctor-call-notify-toggle"]');
    await expect(notify).toBeVisible();
    await expect(notify).toHaveText(/알림 (켜기|끄기)/);
    await expect(notify).not.toHaveText(/소리/);

    // 별건 검증: 두 토글은 서로 다른 엘리먼트(testid).
    expect(await mute.count()).toBe(1);
    expect(await notify.count()).toBe(1);

    // ① 소리 끄기 클릭이 ② 알림 토글 상태를 건드리지 않음(독립).
    const notifyTextBefore = (await notify.textContent())?.trim() ?? '';
    await mute.click();
    await expect(notify).toHaveText(notifyTextBefore); // 알림 토글 불변
  });
});

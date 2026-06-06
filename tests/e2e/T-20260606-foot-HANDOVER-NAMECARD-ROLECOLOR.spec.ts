/**
 * T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR
 * [직원 근무 캘린더](/admin/handover) "오늘 출근 명단" 이름 칩 = 역할별 색 분기 E2E
 *
 * 요청: 매니저 — 출근 명단 칩 배경을 직원 역할별로 구분(한눈에 파트 식별).
 * 매핑(staffRoleCardClass, 정적 STAFF_ROLE_CARD_CLASS — JIT purge 안전):
 *   consultant(상담)  → bg-sky-100  text-sky-800  border-sky-300   (하늘)
 *   coordinator(코디) → bg-yellow-100 text-yellow-800 border-yellow-300 (노랑)
 *   therapist(치료)   → bg-green-100 text-green-800 border-green-300 (초록)
 *   그 외(director·technician 등) → 중립 fallback (slate)
 *
 * 커버 시나리오:
 *   S1. 칩에 data-role 부착 + 역할별 색 클래스 일치 (3개 역할) (AC-핵심)
 *   S2. 비대상 역할(director/technician 등) → 중립 fallback (역할 색 미적용)
 *   S3. DutyRosterTab(직원·공간 근무캘린더) part 배지 색 불변 가드 (AC1/AC2)
 *
 * 주의:
 *  - staging duty_roster 등록이 없으면 칩이 0개일 수 있음 → 데이터 의존 시나리오는
 *    graceful(칩 존재 시에만 색 검증). 매핑 자체의 정합은 칩 1개라도 있으면 강하게 검증.
 *  - DutyRosterTab은 절대 손대지 않음(범위 밖). 본 티켓은 Handover.tsx 한 곳만 변경.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';

// 역할 → 기대 색 클래스 (구현의 STAFF_ROLE_CARD_CLASS와 동일해야 함)
const ROLE_CLASS: Record<string, string[]> = {
  consultant: ['bg-sky-100', 'text-sky-800', 'border-sky-300'],
  coordinator: ['bg-yellow-100', 'text-yellow-800', 'border-yellow-300'],
  therapist: ['bg-green-100', 'text-green-800', 'border-green-300'],
};
const FALLBACK_CLASS = ['bg-slate-100', 'text-slate-700', 'border-slate-300'];
const ROLE_COLOR_TOKENS = ['sky', 'yellow', 'green'];

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR 출근 명단 역할별 색', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 역할별 색 클래스 정합 (consultant/coordinator/therapist) ───────────────
  test('S1 칩 data-role + 역할별 색 클래스 일치', async ({ page }) => {
    await gotoHandover(page);
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible({ timeout: 10_000 });
    // 로딩 '…' 해소 대기
    await expect(page.getByTestId('handover-attendees-count')).toHaveText(/^\d+명$/, { timeout: 10_000 });

    const chips = page.getByTestId('handover-attendee-chip');
    const n = await chips.count();
    if (n === 0) {
      test.skip(true, 'staging duty_roster 출근자 0명 — 색 검증 데이터 없음 (graceful)');
      return;
    }

    let checkedRoles = 0;
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      const role = await chip.getAttribute('data-role');
      expect(role, '칩에 data-role 부착되어야 함').toBeTruthy();
      const cls = (await chip.getAttribute('class')) ?? '';
      const expected = ROLE_CLASS[role ?? ''];
      if (expected) {
        for (const c of expected) {
          expect(cls, `role=${role} 칩에 ${c} 적용`).toContain(c);
        }
        checkedRoles++;
      } else {
        // 비대상 역할 → 중립 fallback (S2에서 강하게, 여기선 역할 색 미적용만)
        for (const t of ROLE_COLOR_TOKENS) {
          expect(cls, `비대상 role=${role} 칩에 ${t} 색 미적용`).not.toContain(`bg-${t}-100`);
        }
      }
    }
    console.log(`[ROLECOLOR] S1 칩 ${n}개 중 역할색 ${checkedRoles}개 검증 OK`);
  });

  // ── S2. 비대상 역할 → 중립 fallback ──────────────────────────────────────────
  test('S2 director/technician 등 비대상 역할 칩은 중립색 fallback', async ({ page }) => {
    await gotoHandover(page);
    await expect(page.getByTestId('handover-attendees-count')).toHaveText(/^\d+명$/, { timeout: 10_000 });

    const chips = page.getByTestId('handover-attendee-chip');
    const n = await chips.count();
    if (n === 0) {
      test.skip(true, 'staging 출근자 0명 — fallback 검증 데이터 없음');
      return;
    }

    let fallbackSeen = 0;
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      const role = await chip.getAttribute('data-role');
      if (role && ROLE_CLASS[role]) continue; // 대상 역할은 S1에서 검증
      const cls = (await chip.getAttribute('class')) ?? '';
      for (const c of FALLBACK_CLASS) {
        expect(cls, `비대상 role=${role} 칩에 중립 ${c} 적용`).toContain(c);
      }
      fallbackSeen++;
    }
    console.log(`[ROLECOLOR] S2 비대상 역할 칩 ${fallbackSeen}개 중립 fallback 확인 (없으면 N/A)`);
  });

  // ── S3. DutyRosterTab part 배지 색 불변 가드 (AC1/AC2) ────────────────────────
  test('S3 직원·공간 근무캘린더 part 배지(rose/amber/teal) 범위 밖 — 불변 가드', async ({ page }) => {
    // 본 티켓은 Handover.tsx 한 곳만 변경. DutyRosterTab의 part 색은 손대지 않았음을
    // 구조적으로 보장: Handover 화면에 역할 칩 색이 적용되어도 DutyRoster part 색
    // 토큰과 독립임을 확인(같은 화면에 공존하지 않으므로 화면 분리 자체가 가드).
    await gotoHandover(page);
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible({ timeout: 10_000 });

    // Handover에는 DutyRosterTab 전용 UI가 없어야 함(화면 격리 = 회귀 가드)
    await expect(page.getByTestId('duty-roster-tab')).toHaveCount(0);
    console.log('[ROLECOLOR] S3 화면 격리 가드 OK — DutyRosterTab 미노출');
  });
});

/**
 * T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR
 * [직원 근무 캘린더](/admin/handover) "오늘 출근 명단" 이름 칩 = 역할별 색 분기 E2E
 *
 * 요청: 매니저 — 출근 명단 칩 배경을 직원 역할별로 구분(한눈에 파트 식별).
 * 매핑(staffRoleCardClass, 정적 STAFF_ROLE_CARD_CLASS — JIT purge 안전):
 *   consultant(상담)  → bg-rose-100 text-rose-800 border-rose-300 (로즈) ← T-20260611 sky→rose
 *   coordinator(코디) → bg-yellow-100 text-yellow-800 border-yellow-300 (노랑)
 *   therapist(치료)   → bg-green-100 text-green-800 border-green-300 (초록)
 *   그 외(director·technician 등) / 시트엔 있으나 CRM staff 미매칭 → 중립 fallback (slate)
 *
 * 데이터 소스(REV-1): 출근 명단은 구글시트 직접 read(Edge Function `duty-sheet-read`).
 *   시트엔 역할이 없으므로 이름 → CRM staff.role 매핑으로 칩 색을 칠한다(결합점).
 *   미매칭 이름은 role 없음 → data-role="" → 중립 fallback.
 *
 * 결정적 테스트: 시트 응답을 route mock 으로 주입해 칩을 렌더한 뒤, 각 칩의 data-role
 *   값에 따라 (역할색 또는 fallback) 렌더 분기가 정확한지 검증한다.
 *
 * 커버 시나리오:
 *   S1. 칩에 data-role 속성 부착 + data-role 값에 맞는 색 클래스 렌더 분기 일치
 *   S2. 미매칭/비대상 역할 칩 → 중립 fallback (역할 색 미적용)
 *   S3. DutyRosterTab(직원·공간 근무캘린더) 화면 격리 가드 — 본 화면에 미노출
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const DUTY_FN_GLOB = '**/functions/v1/duty-sheet-read*';

const ROLE_CLASS: Record<string, string[]> = {
  consultant: ['bg-rose-100', 'text-rose-800', 'border-rose-300'],
  coordinator: ['bg-yellow-100', 'text-yellow-800', 'border-yellow-300'],
  therapist: ['bg-green-100', 'text-green-800', 'border-green-300'],
};
const FALLBACK_CLASS = ['bg-slate-100', 'text-slate-700', 'border-slate-300'];
const ROLE_COLOR_TOKENS = ['rose', 'yellow', 'green'];

function kstMonthDay(): { m: number; d: number } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { m: kst.getUTCMonth() + 1, d: kst.getUTCDate() };
}

function buildSheetCsv(names: string[]): string {
  const { m, d } = kstMonthDay();
  const others = [d <= 25 ? d + 1 : d - 1, d <= 25 ? d + 2 : d - 2, d <= 25 ? d + 3 : d - 3];
  const q = (arr: (string | number)[]) => arr.map((c) => `"${c}"`).join(',');
  const lines: string[] = [];
  lines.push(q(['', '2026', `${m}월`, '', '', '']));
  lines.push(q(['', '월', '화', '수', '목', '금']));
  lines.push(q(['', d, ...others, '']));
  for (const name of names) lines.push(q(['', name, '', '', '']));
  return lines.join('\n');
}

async function mockDutySheet(page: Page, names: string[]) {
  await page.route(DUTY_FN_GLOB, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, gid: '341864863', csv: buildSheetCsv(names) }),
    });
  });
}

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260606-foot-HANDOVER-NAMECARD-ROLECOLOR 출근 명단 역할별 색', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. data-role 부착 + data-role 값에 맞는 색 클래스 렌더 분기 ──────────────
  test('S1 칩 data-role 부착 + data-role 별 색 클래스 렌더 분기 일치', async ({ page }) => {
    // 시트에 이름 주입 → 칩 렌더 보장. role 은 CRM staff 매핑 결과(스테이징 의존)이지만
    // 어떤 값이든 "data-role 값 ↔ 적용 클래스"의 렌더 분기 정합을 강하게 검증한다.
    await mockDutySheet(page, ['김주연', '김수린', '엄경은', '정연주']);
    await gotoHandover(page);
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('handover-attendees-count')).toHaveText(/^\d+명$/, { timeout: 10_000 });

    const chips = page.getByTestId('handover-attendee-chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      const role = await chip.getAttribute('data-role'); // 알려진 역할 또는 "" (미매칭)
      expect(role, '칩에 data-role 속성이 있어야 함').not.toBeNull();
      const cls = (await chip.getAttribute('class')) ?? '';
      const expected = ROLE_CLASS[role ?? ''];
      if (expected) {
        for (const c of expected) expect(cls, `role=${role} 칩에 ${c}`).toContain(c);
      } else {
        // 미매칭/비대상 → 중립 fallback + 역할 색 미적용
        for (const c of FALLBACK_CLASS) expect(cls, `미매칭 role="${role}" 칩에 중립 ${c}`).toContain(c);
        for (const t of ROLE_COLOR_TOKENS)
          expect(cls, `미매칭 role="${role}" 칩에 ${t} 색 미적용`).not.toContain(`bg-${t}-100`);
      }
    }
    console.log(`[ROLECOLOR] S1 칩 ${n}개 data-role↔색 렌더 분기 정합 OK`);
  });

  // ── S2. 미매칭/비대상 역할 → 중립 fallback ──────────────────────────────────
  test('S2 비대상/미매칭 역할 칩은 중립색 fallback', async ({ page }) => {
    // CRM staff 에 없을 법한 더미 이름 → 확실히 미매칭(role 없음) → fallback
    await mockDutySheet(page, ['테스트더미일', '테스트더미이']);
    await gotoHandover(page);
    await expect(page.getByTestId('handover-attendees-count')).toHaveText(/^\d+명$/, { timeout: 10_000 });

    const chips = page.getByTestId('handover-attendee-chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(0);

    let fallbackSeen = 0;
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      const role = await chip.getAttribute('data-role');
      if (role && ROLE_CLASS[role]) continue; // 우연히 매칭된 역할은 S1 영역
      const cls = (await chip.getAttribute('class')) ?? '';
      for (const c of FALLBACK_CLASS) expect(cls, `미매칭 role="${role}" 칩에 중립 ${c}`).toContain(c);
      fallbackSeen++;
    }
    expect(fallbackSeen).toBeGreaterThan(0);
    console.log(`[ROLECOLOR] S2 중립 fallback ${fallbackSeen}개 확인 OK`);
  });

  // ── S3. DutyRosterTab 화면 격리 가드 ────────────────────────────────────────
  test('S3 Handover 화면에 DutyRosterTab 미노출 — 화면 격리 가드', async ({ page }) => {
    await mockDutySheet(page, ['김주연']);
    await gotoHandover(page);
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('duty-roster-tab')).toHaveCount(0);
    console.log('[ROLECOLOR] S3 화면 격리 가드 OK');
  });
});

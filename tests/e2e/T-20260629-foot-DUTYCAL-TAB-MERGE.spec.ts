/**
 * T-20260629-foot-DUTYCAL-TAB-MERGE
 * 근무 캘린더(/admin/handover) [직원]·[의사] 두 상단 탭 → 단일 세로 스택 1뷰 통합.
 *   상단 = 의사 근무표 섹션(DutyRosterTab) · 하단 = 직원 근무표 섹션(인수인계 보드).
 *
 * ⚠ 본 건은 같은 reporter(김주연 총괄)·같은 요청을 먼저 처리한
 *    T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL (commit c460a56d, main 배포 완료)으로
 *    기능이 이미 충족된 중복 티켓이다. 본 spec 은 그 통합 상태가
 *    DUTYCAL-TAB-MERGE 의 현장 클릭 시나리오 S1/S2/S3 를 만족함을 명시 매핑·회귀 가드한다.
 *    (구현 churn 없음 — 검증·추적 전용. NO-DDL.)
 *
 * 현장 클릭 시나리오 (티켓 본문):
 *   S1 정상(권한 有) : 탭 없음 + 의사 상단/직원 하단 동시 표시 + 캘린더 동작 유지
 *   S2 권한가드(staff): 의사 섹션 미노출, 직원만
 *   S3 시트 장애     : 의사 섹션 graceful, 직원 정상
 *
 * 코드 레벨 검증(인증 계정 불필요) + 브라우저 통합 skip.
 * 실행: npx playwright test T-20260629-foot-DUTYCAL-TAB-MERGE.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(process.cwd(), 'src');
const handoverSrc = readFileSync(resolve(SRC, 'pages/Handover.tsx'), 'utf-8');

// 의사 근무표 노출 role 집합(보존) / 신규 노출 금지 role
const DUTY_ROSTER_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];
const NEWLY_FORBIDDEN_ROLES = ['part_lead', 'staff', 'tm'];

test.describe('T-20260629-foot-DUTYCAL-TAB-MERGE', () => {

  /** S1 — 탭 스트립 제거: Tabs/TabsList/TabsTrigger·topTab 잔재 없음(탭 전환 동선 소멸). */
  test('S1 — 상단 탭(직원/의사) 제거: Tabs/topTab 미존재', () => {
    expect(handoverSrc).not.toContain('TabsTrigger');
    expect(handoverSrc).not.toContain('TabsList');
    expect(handoverSrc).not.toContain('<Tabs ');
    expect(handoverSrc).not.toContain('topTab');
    expect(handoverSrc).not.toContain('setTopTab');
    expect(handoverSrc).not.toMatch(/from\s+'@\/components\/ui\/tabs'/);
  });

  /** S1 — 단일 세로 스택: 의사 근무표(상단) → 구분선 → 직원 근무표(하단) 동시 렌더. */
  test('S1 — 의사(상단)/직원(하단) 동시 표시 + 섹션 헤더·구분선', () => {
    // 외곽 단일 스크롤 컨테이너
    expect(handoverSrc).toContain('data-testid="handover-scroll-root"');
    // 섹션 순서: 의사 → 직원 (DOM 상 의사가 위)
    const dutyIdx = handoverSrc.indexOf('data-testid="handover-tab-duty"');
    const dividerIdx = handoverSrc.indexOf('data-testid="handover-section-divider"');
    const boardIdx = handoverSrc.indexOf('data-testid="handover-tab-board"');
    expect(dutyIdx).toBeGreaterThan(-1);
    expect(boardIdx).toBeGreaterThan(-1);
    expect(dutyIdx).toBeLessThan(dividerIdx);
    expect(dividerIdx).toBeLessThan(boardIdx);
    // 섹션 구분 헤더("의사"/"직원") + DutyRosterTab 렌더
    expect(handoverSrc).toContain('의사 근무표');
    expect(handoverSrc).toContain('직원 근무 캘린더');
    expect(handoverSrc).toContain('<DutyRosterTab clinic={clinic} />');
  });

  /** S1 — 직원 캘린더 동작 유지(회귀 0): 월/주/일 토글·작성·목록·파트필터 식별자 보존. */
  test('S1 — 직원 캘린더 동작 유지 (회귀 0)', () => {
    expect(handoverSrc).toContain('data-testid="handover-new-btn"');
    expect(handoverSrc).toContain('data-testid="handover-list"');
    expect(handoverSrc).toContain('data-testid="handover-view-toggle"');
    // T-20260630-foot-HANDOVER-PARTSONLY-TOTAL-ATTEND-MONO: 파트 필터 탭 제거됨 → 부재 단언.
    expect(handoverSrc).not.toContain('data-testid="handover-part-filter"');
    expect(handoverSrc).toContain('data-testid="handover-dialog"');
    // topTab 조건부 hidden 토글 잔재 없음(언제나 단일 렌더)
    expect(handoverSrc).not.toMatch(/topTab === 'duty'\s*\?\s*'hidden'/);
  });

  /** S2 — 권한가드 보존: 무권한(staff 등)에 의사 근무표 섹션 미노출, 직원만. */
  test('S2 — 권한가드: 의사 섹션 DUTY_ROSTER_ROLES 게이트 (staff 미노출)', () => {
    expect(handoverSrc).toContain('canSeeDutyRoster');
    const rolesMatch = handoverSrc.match(/DUTY_ROSTER_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(rolesMatch).not.toBeNull();
    const rolesLiteral = rolesMatch![1];
    for (const role of DUTY_ROSTER_ROLES) {
      expect(rolesLiteral).toContain(`'${role}'`);
    }
    // staff/part_lead/tm 신규 노출 금지
    for (const role of NEWLY_FORBIDDEN_ROLES) {
      expect(rolesLiteral).not.toContain(`'${role}'`);
    }
    // 의사 섹션은 canSeeDutyRoster 게이트 뒤에서만 렌더 — 권한 없으면 섹션 자체 비노출
    expect(handoverSrc).toMatch(/canSeeDutyRoster && clinic[\s\S]*?handover-tab-duty/);
    // 직원 섹션(handover-tab-board)은 게이트 밖 — 권한 무관 항상 렌더
    const boardIdx = handoverSrc.indexOf('data-testid="handover-tab-board"');
    const guardOpenIdx = handoverSrc.indexOf('canSeeDutyRoster && clinic');
    expect(boardIdx).toBeGreaterThan(guardOpenIdx); // 직원 섹션은 의사 가드 블록보다 뒤(독립)
  });

  /** S3 — 시트 장애 graceful: 의사 섹션은 DutyRosterTab 의 기존 graceful, 직원 섹션 독립 정상. */
  test('S3 — 구글시트 장애시 직원 섹션 독립 동작 (출근명단 read 실패 graceful)', () => {
    // Handover 자체의 출근명단 시트 read 는 .catch 로 {} graceful (직원 섹션 비차단)
    expect(handoverSrc).toMatch(/fetchAttendeesByDate\([\s\S]*?\.catch\(/);
    expect(handoverSrc).toContain('출근 명단 시트 read 실패');
    // 의사 근무표(DutyRosterTab) 는 별 컴포넌트로 격리 렌더 — 시트 장애가 직원 섹션 렌더를 막지 않음
    expect(handoverSrc).toContain("import { DutyRosterTab } from '@/components/DutyRosterTab'");
  });

  /**
   * 브라우저 통합(admin 계정 필요 — 평소 skip):
   *   진입 → 탭 스트립 없음 → 의사 근무표(상단) + 구분선 + 직원 근무표(하단) 단일 뷰.
   */
  test.skip('브라우저 통합 — 단일 세로 스택 뷰 (admin 계정 필요)', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_ADMIN_EMAIL ?? '';
    const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? '';
    if (!email || !password) return;

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/admin');

    await page.goto('/admin/handover');
    await expect(page.getByTestId('handover-top-tabs')).toHaveCount(0);
    await expect(page.getByTestId('handover-tab-duty')).toBeVisible();
    await expect(page.getByTestId('handover-section-divider')).toBeVisible();
    await expect(page.getByTestId('handover-tab-board')).toBeVisible();
  });
});

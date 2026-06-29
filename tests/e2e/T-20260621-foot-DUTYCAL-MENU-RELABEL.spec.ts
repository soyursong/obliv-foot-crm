/**
 * T-20260621-foot-DUTYCAL-MENU-RELABEL
 * 근무 캘린더 메뉴/탭 표시 라벨 변경 — 텍스트만 교체, 라우트·기능·권한 가드·DB 무변경.
 *
 *   사이드바 최상위 메뉴 : '직원 근무 캘린더' → '근무 캘린더'
 *   내부 탭 1            : '인수인계'        → '직원'
 *   내부 탭 2            : '원장 근무표'      → '의사'
 *
 * AC-1: 사이드바 메뉴 라벨 '근무 캘린더' (route /admin/handover 무변경).
 * AC-2: 탭 표시 라벨 '직원'/'의사' (value/data-testid 무변경).
 * AC-3: 권한 가드 보존 — 의사(구 원장 근무표) 탭 DUTY_ROSTER_ROLES 6역할 게이트 유지.
 *
 * 코드 레벨 검증(인증 계정 불필요).
 * 실행: npx playwright test T-20260621-foot-DUTYCAL-MENU-RELABEL.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(process.cwd(), 'src');
const handoverSrc = readFileSync(resolve(SRC, 'pages/Handover.tsx'), 'utf-8');
const adminLayoutSrc = readFileSync(resolve(SRC, 'components/AdminLayout.tsx'), 'utf-8');

// 의사(구 원장 근무표) 탭 노출 = 이동 전 직원·공간 메뉴 role 집합 (변경 없어야 함)
const DUTY_ROSTER_ROLES = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist'];
const NEWLY_FORBIDDEN_ROLES = ['part_lead', 'staff', 'tm'];

test.describe('T-20260621-foot-DUTYCAL-MENU-RELABEL', () => {

  /** AC-1: 사이드바 메뉴 표시 라벨 '근무 캘린더' (route 무변경). */
  test('AC-1 — 사이드바 메뉴 라벨 = 근무 캘린더 (route /admin/handover 유지)', () => {
    expect(adminLayoutSrc).toMatch(/to:\s*'\/admin\/handover',\s*label:\s*'근무 캘린더'/);
    // 구 라벨 미노출
    expect(adminLayoutSrc).not.toMatch(/label:\s*'직원 근무 캘린더'/);
  });

  /** AC-2: [SUPERSEDED by T-20260629-foot-HANDOVER-TAB-MERGE-SCROLL]
   *  RELABEL 의 '직원'/'의사' 라벨은 탭 통합(단일 스크롤) 이후 섹션 식별자로 이관됨.
   *  탭 트리거(TabsTrigger)는 제거 — 식별자(handover-tab-board/handover-tab-duty)는 섹션으로 보존. */
  test('AC-2 — 직원/의사 식별자 보존 (탭 통합 후 섹션으로 이관)', () => {
    // 탭 식별자가 섹션 data-testid 로 살아있음(E2E 회귀 보존)
    expect(handoverSrc).toContain('data-testid="handover-tab-board"');
    expect(handoverSrc).toContain('data-testid="handover-tab-duty"');
    // 의사 근무표 섹션 헤더 라벨 노출
    expect(handoverSrc).toContain('의사 근무표');
    // 탭 UI(TabsTrigger) 는 통합으로 제거됨
    expect(handoverSrc).not.toContain('TabsTrigger');
  });

  /** AC-3: 권한 가드 보존 — 의사 탭은 canSeeDutyRoster(6역할) 게이트 유지. */
  test('AC-3 — 권한 가드 보존: 의사 탭 DUTY_ROSTER_ROLES(6역할) 게이트', () => {
    // 탭 스트립 + 의사 pane 모두 canSeeDutyRoster 가드 아래 노출
    expect(handoverSrc).toContain('canSeeDutyRoster');
    for (const role of DUTY_ROSTER_ROLES) {
      expect(handoverSrc).toContain(`'${role}'`);
    }
    // 신규 노출 금지 role 이 duty 노출 집합에 추가되지 않음
    const dutyRolesMatch = handoverSrc.match(/DUTY_ROSTER_ROLES[^\]]*\[([^\]]*)\]/);
    if (dutyRolesMatch) {
      for (const forbidden of NEWLY_FORBIDDEN_ROLES) {
        expect(dutyRolesMatch[1]).not.toContain(`'${forbidden}'`);
      }
    }
  });
});

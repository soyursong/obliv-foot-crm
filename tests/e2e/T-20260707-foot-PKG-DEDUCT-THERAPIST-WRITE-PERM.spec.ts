/**
 * T-20260707-foot-PKG-DEDUCT-THERAPIST-WRITE-PERM
 *
 * 현장(김주연 총괄, slack C0ATE5P6JTH): 2번차트 패키지 회차(티켓) '수정'을 치료사(therapist) 계정으로 시도 →
 *   "수정 권한 없음" / 관리자는 되는데 치료사만 막힘.
 *
 * diagnose-first 결과(런타임 확인, 본 세션 진단):
 *   · package_sessions RLS 는 이미 therapist INSERT/UPDATE 허용(permissive `package_sessions_write` FOR ALL,
 *     current_user_role() IN admin/manager/consultant/coordinator/therapist). → RLS gap 아님(가설 #1 기각).
 *   · first-failing-link = FE 게이트: 2번차트 '시술내역' 회차 수정 버튼 게이트가
 *     admin/manager/director/consultant 하드코딩 → therapist/coordinator 미노출(FE/RLS 불일치, latent lock-out).
 *   · fix = 게이트를 STAFF_UNLOCK_ROLES(isStaffUnlockRole) 로 정합. T-20260702 형제 버튼과 동일 패턴. db_change 없음.
 *
 * 시나리오 2건:
 *   (1) 권한 계약: 회차 수정 게이트 role-set = STAFF_UNLOCK_ROLES → therapist/coordinator 포함, floor(part_lead/staff) 제외.
 *   (2) 회귀 가드: CustomerChartPage 회차 '수정' 버튼 게이트가 옛 consultant-한정 하드코딩으로 되돌아가지 않음(isStaffUnlockRole 사용).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isStaffUnlockRole, STAFF_UNLOCK_ROLES } from '../../src/lib/permissions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_SRC = resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');

test.describe('T-20260707 치료사 회차 수정 권한 (FE 게이트 FE=RLS 정합)', () => {
  test('(1) 회차 수정 게이트 role-set = STAFF_UNLOCK_ROLES: therapist/coordinator 포함, floor 제외', () => {
    // 현장 증상 핵심: 치료사가 막힘 → 이제 노출되어야 함
    expect(isStaffUnlockRole('therapist')).toBe(true);
    expect(isStaffUnlockRole('coordinator')).toBe(true);
    // 관리자군은 계속 허용(회귀 없음)
    expect(isStaffUnlockRole('admin')).toBe(true);
    expect(isStaffUnlockRole('manager')).toBe(true);
    expect(isStaffUnlockRole('director')).toBe(true);
    expect(isStaffUnlockRole('consultant')).toBe(true);
    // floor(비해제 대상)는 여전히 제외 = 무분별 write-open 아님
    expect(isStaffUnlockRole('part_lead')).toBe(false);
    expect(isStaffUnlockRole('staff')).toBe(false);
    expect(isStaffUnlockRole(null)).toBe(false);
    expect(isStaffUnlockRole(undefined)).toBe(false);
    // SSOT 6역할 정확히
    expect([...STAFF_UNLOCK_ROLES].sort()).toEqual(
      ['admin', 'consultant', 'coordinator', 'director', 'manager', 'therapist'].sort(),
    );
  });

  test('(2) 회귀 가드: 시술내역 회차 수정 버튼 게이트가 isStaffUnlockRole 사용(옛 consultant-한정 하드코딩 금지)', () => {
    const src = readFileSync(CHART_SRC, 'utf8');
    // 수정 버튼 블록 컨텍스트 추출: setEditSessionDlg( 를 여는 버튼 앞의 게이트 조건
    const idx = src.indexOf('setEditSessionDlg(s)');
    expect(idx, 'setEditSessionDlg(s) 진입점(회차 수정 버튼) 존재').toBeGreaterThan(-1);
    // 버튼 직전 800자 안에 isStaffUnlockRole 게이트가 있어야 함
    const before = src.slice(Math.max(0, idx - 800), idx);
    expect(before, '회차 수정 버튼 게이트가 isStaffUnlockRole(profile?.role) 로 정합되어야 함')
      .toContain('isStaffUnlockRole(profile?.role)');
    // 옛 하드코딩(consultant-한정 4역할 OR 체인)이 이 수정 버튼 게이트로 되돌아오지 않았는지
    expect(
      /profile\?\.role === 'consultant'\)\s*&&\s*\(\s*<span className="ml-auto hidden group-hover:flex/.test(src),
      '옛 consultant-한정 하드코딩 게이트가 수정 버튼에 재유입되면 안 됨',
    ).toBe(false);
  });
});

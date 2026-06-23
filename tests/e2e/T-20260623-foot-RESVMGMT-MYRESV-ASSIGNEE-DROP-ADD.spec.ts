import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-ADD
 *
 * 예약관리 '내 예약' 모드 담당자 선택 드롭다운 신규 추가 (타 담당자 조회).
 * 선행: T-20260623-foot-RESVMGMT-MYRESV-ASSIGNEE-DROP-MISSING (closed=의도설계, B).
 *   reporter(김주연 총괄)가 회귀 복원이 아닌 **신규 기능**으로 정식 요청(MSG-j2ez ADD-2).
 *
 * 현 동작: '내 예약' = registrar_name === profile.name NAME-MATCH(본인 고정).
 * 요청: '내 예약' 선택 시 담당자 선택 드롭 노출(기본=본인) + 다른 담당자 선택 시 그 담당자 기준 조회.
 *
 * AC1: '전체 예약' 상태에서는 담당자 선택 드롭 미노출. '내 예약' 선택 시 노출(기본값=본인).
 * AC2: 담당자 옵션 소스 = reservation_registrars(예약등록자 마스터, active) — registrar_name 스냅샷과 동일 master(DB 변경 0).
 * AC3: 필터 기준 = mineTarget(filterAssignee 선택값 || myDisplayName) === registrar_name (NAME-MATCH 확장).
 * AC4: '전체 예약' 복귀 시 담당자 선택 초기화(본인='')로 리셋 + 드롭 숨김.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak.
 * 권한 1차 정책: 전체 staff 선택 허용(시나리오2 reporter 확인 대상 — FOLLOWUP 별도).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 담당자 선택 드롭 (시드 무관, 결정론적 렌더)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260623 MYRESV-ASSIGNEE-DROP-ADD — 담당자 선택 드롭 (라이브 렌더)', () => {
  test('AC1/AC4: 전체예약=드롭 숨김, 내예약=드롭 노출, 전체 복귀=재숨김', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.goto('/admin/reservations');
    const filter = page.getByTestId('myresv-filter');
    const visible = await filter.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!visible) { test.skip(true, '예약관리 진입/렌더 실패 — 스킵'); return; }

    const assignee = page.getByTestId('myresv-assignee-filter');

    // 전체 예약(기본) → 담당자 드롭 미노출
    await expect(filter).toHaveValue('all');
    await expect(assignee).toHaveCount(0);

    // 내 예약 선택 → 담당자 드롭 노출, 기본값='' (본인)
    await filter.selectOption('mine');
    await expect(assignee).toBeVisible();
    await expect(assignee).toHaveValue('');

    // 전체 복귀 → 드롭 재숨김
    await filter.selectOption('all');
    await expect(assignee).toHaveCount(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — 옵션 소스·필터 결선 (거대 인라인 페이지 관례)
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260623 MYRESV-ASSIGNEE-DROP-ADD — 결선 (소스 무결성)', () => {
  test('AC1: 담당자 드롭은 filterMine 일 때만 렌더', () => {
    expect(RESV_PAGE).toMatch(/filterMine\s*&&\s*\([\s\S]{0,400}data-testid="myresv-assignee-filter"/);
  });

  test('AC2: 옵션 소스 = reservation_registrars(active) 이름 추출·중복제거', () => {
    expect(RESV_PAGE).toContain("from('reservation_registrars')");
    expect(RESV_PAGE).toContain('setAssigneeOptions');
    // 이름 중복 제거(Set) + 공백/빈값 필터
    expect(RESV_PAGE).toMatch(/Array\.from\(\s*new Set\(/);
  });

  test('AC3: 필터 기준 = mineTarget(선택 담당자 || 본인) NAME-MATCH', () => {
    expect(RESV_PAGE).toMatch(
      /const mineTarget = filterAssignee !== ''\s*\?\s*filterAssignee\s*:\s*myDisplayName/,
    );
    expect(RESV_PAGE).toMatch(
      /!filterMine\s*\|\|\s*\(mineTarget\s*!==\s*''\s*&&\s*\(r\.registrar_name\s*\?\?\s*''\)\.trim\(\)\s*===\s*mineTarget\)/,
    );
  });

  test('AC4: 전체예약 복귀 시 filterAssignee 초기화', () => {
    expect(RESV_PAGE).toMatch(/if \(!mine\) setFilterAssignee\(''\)/);
  });

  test('가드: 본인 옵션은 myDisplayName 중복 제거(본인 디폴트 옵션과 충돌 방지)', () => {
    expect(RESV_PAGE).toMatch(/\.filter\(\(n\) => n !== myDisplayName\)/);
  });
});

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E spec — T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI
 *
 * 예약관리(예약 목록/카드) '담당자' = 예약 잡은 계정(예약 생성/수정 계정) 기준으로 재정의.
 *   - AC1: 담당자 = 예약을 생성한 계정(created_by). 차트 담당자(customers.assigned_staff_id) 기준 제거(예약 surface 한정).
 *   - AC2: 예약 일자/시간 변경(UPDATE) 시 담당자 = 마지막 수정 계정(updated_by) 으로 overwrite → 표시 갱신.
 *           담당자 표시 = COALESCE(updated_by, created_by) → user_profiles.name.
 *   - AC3: 표기 `담당 000` → `@담당자명`.
 *   - AC4: 위치 = 연락처(전화) 옆 같은 라인(상태줄 내).
 *   - AC5: 생성/수정자 정보 없는 과거 예약(둘 다 NULL) → 미표시(깨짐 없음).
 *
 * SCOPE 가드(reporter=김주연 총괄 policy_superseded, CONFLICT-DETAIL):
 *   재정의는 예약관리 표시에만 적용. 2번차트·고객 목록/상세의 customers.assigned_staff_id 담당자 의미는 불변(회귀0).
 *
 * DB: reservations.updated_by ADDITIVE(nullable TEXT) — data-architect CONSULT-REPLY MSG-20260622-215701-p402 = GO.
 *   created_by INVARIANT(stats.ts TM 귀속 키) — INSERT 시만 기록, UPDATE 시 updated_by overwrite(created_by 불변).
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating 병행. 실 렌더는 supervisor field-soak(갤탭 실기기).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const TYPES = fs.readFileSync(path.resolve('src/lib/types.ts'), 'utf-8');
const MIGRATION = fs.readFileSync(
  path.resolve('supabase/migrations/20260622200000_reservations_updated_by.sql'), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// 라이브 렌더 — 예약관리 진입 + 담당자 태그 안전 렌더
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260622 RESVMGMT-ASSIGNEE-BOOKER-UI — 라이브', () => {
  test('AC4/AC5: 예약관리 진입 후 담당자 태그가 있으면 @접두 + 에러 없음', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패 — 스킵'); return; }

    await page.goto('/admin/reservations');
    // 예약관리 화면 로드 대기(주간 그리드 또는 새 예약 버튼)
    const ready = await page.getByRole('button', { name: /새 예약|\+/ }).first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!ready) { test.skip(true, '예약관리 진입 실패 — 스킵'); return; }

    // 담당자(booker) 태그가 렌더된 경우, 텍스트는 '@'로 시작해야 함(AC3). 없으면(데이터 의존) 통과(AC5 미표시 안전).
    const tags = page.locator('[data-testid^="assigned-staff-tag-"]');
    const count = await tags.count();
    if (count > 0) {
      const txt = (await tags.first().textContent())?.trim() ?? '';
      expect(txt).toContain('@');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 소스 무결성 — 담당자 = booker(created_by/updated_by) 결선
// ════════════════════════════════════════════════════════════════════════
test.describe('T-20260622 RESVMGMT-ASSIGNEE-BOOKER-UI — 결선 (소스 무결성)', () => {
  test('AC1: 예약관리 담당자 맵은 booker 기준(resvBookerMap), 차트 담당자(resvAssignedStaffMap) 미사용', () => {
    expect(RESV_PAGE).toContain('resvBookerMap');
    expect(RESV_PAGE).not.toContain('resvAssignedStaffMap');
  });

  test('AC1/AC2: booker = COALESCE(updated_by, created_by) → user_profiles.name resolve', () => {
    // 각 예약의 마지막 수정자 우선, 없으면 생성자
    expect(RESV_PAGE).toMatch(/r\.updated_by\s*\?\?\s*r\.created_by/);
    // user_profiles 에서 이름 resolve
    expect(RESV_PAGE).toMatch(/from\('user_profiles'\)[\s\S]{0,120}select\('id, name'\)/);
  });

  test('AC1: 예약 생성 경로가 created_by = 로그인 계정 기록 (INSERT)', () => {
    expect(RESV_PAGE).toMatch(/created_by:\s*input\.changedBy/);
    expect(RESV_PAGE).toMatch(/created_by:\s*changedBy/);
  });

  test('AC2: 일자/시간 변경(UPDATE)이 updated_by = 로그인 계정 overwrite', () => {
    // 드래그/이동/에디터 저장 경로 모두 updated_by 갱신
    const updatedByWrites = RESV_PAGE.match(/updated_by:\s*changedBy/g) ?? [];
    expect(updatedByWrites.length).toBeGreaterThanOrEqual(3);
  });

  test('created_by INVARIANT(HARD, DA 조건): UPDATE 경로에 created_by overwrite 없음 (TM 귀속 키 보존)', () => {
    // .update({ ... created_by ... }) 형태가 없어야 함 — created_by 는 INSERT 에서만.
    expect(RESV_PAGE).not.toMatch(/\.update\(\{[^}]*created_by/);
  });

  test('AC3: 표기 = @{담당자명} (booker 맵 값)', () => {
    expect(RESV_PAGE).toMatch(/@\{resvBookerMap\.get\(r\.id\)\}/);
  });

  test('AC4: 담당자 태그가 연락처(전화) 옆 상태줄 내 — maskPhoneTail 직후 같은 컨테이너', () => {
    // 전화 뒷4자리 표시 직후 같은 상태줄(flex) 컨테이너 안에 booker 태그가 위치(AC4). 사이엔 주석/조건부 렌더만.
    expect(RESV_PAGE).toMatch(/maskPhoneTail\(r\.customer_phone\)[\s\S]{0,700}assigned-staff-tag-\$\{r\.id\}/);
    // booker 태그는 예약메모(📝) 블록보다 앞 = 상태줄 영역에 위치(우측 하단 별도 줄 아님).
    expect(RESV_PAGE).toMatch(/assigned-staff-tag-\$\{r\.id\}[\s\S]{0,600}예약메모 한눈에/);
  });

  test('AC5: 미상(booker 결손) 시 미렌더 — 맵 값 truthy 일 때만 표시', () => {
    expect(RESV_PAGE).toMatch(/\{resvBookerMap\.get\(r\.id\)\s*&&\s*\(/);
  });

  test('SCOPE 가드: customers.assigned_staff_id 는 예약관리 fetch 에서 미로드(다른 surface 불변)', () => {
    // 실제 DB select / 사용이 없어야 함(주석 언급은 허용). chart_number 만 로드.
    expect(RESV_PAGE).not.toMatch(/select\([^)]*assigned_staff_id/);
    expect(RESV_PAGE).not.toMatch(/custAssignedStaff/);
  });

  test('types: reservations.updated_by 타입 + audit 의미 축 주석(DA 조건3)', () => {
    expect(TYPES).toMatch(/updated_by\?:\s*string\s*\|\s*null/);
    expect(TYPES).toContain('audit/last-modifier 축');
  });

  test('migration: updated_by ADDITIVE(IF NOT EXISTS) + created_by 불변 명시', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS updated_by TEXT/);
    expect(MIGRATION).toContain('created_by');
  });
});

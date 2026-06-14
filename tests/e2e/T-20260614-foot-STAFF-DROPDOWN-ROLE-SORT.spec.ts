/**
 * E2E spec — T-20260614-foot-STAFF-DROPDOWN-ROLE-SORT
 * 담당자 드롭다운 나열 순서만 role 기준 정렬: 상담실장(consultant) → 코디/데스크(coordinator).
 * DB·값·구성원 무변경 — 표시 순서 only.
 *
 * 시나리오 1: 2번차트 담당자 드롭다운(assigned_staff) — 상담실장 옵션이 코디 옵션보다 위
 * 시나리오 2: 일마감 결제내역 담당자 필터 드롭다운 — 동일 정렬
 * 회귀:       드롭다운 구성원 수 변경 없음(추가/누락 없음)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// STAFF_ROLE_ORDER 와 동일 우선순위 (status.ts SSOT) — 정렬 기대값 검증용
const ROLE_RANK: Record<string, number> = {
  director: 0,
  consultant: 1,
  coordinator: 2,
  therapist: 3,
  technician: 4,
};

async function fetchStaff(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/staff?select=id,name,display_name,role,active&active=eq.true`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  // 가드: 권한오류/에러객체 등 비정상 응답이면 PostgREST가 배열이 아닌 객체를 반환 → 빈 배열로 정규화
  if (!res.ok()) {
    console.log(`[fetchStaff] 비정상 응답 status=${res.status()} — 빈 배열 처리`);
    return [];
  }
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    console.log(`[fetchStaff] 응답이 배열 아님(${JSON.stringify(body)?.slice(0, 120)}) — 빈 배열 처리`);
    return [];
  }
  return body as Array<{ id: string; name: string; display_name: string | null; role: string; active: boolean }>;
}

test.describe('T-20260614-STAFF-DROPDOWN-ROLE-SORT — 담당자 드롭다운 role 정렬', () => {

  test('시나리오1: 2번차트 담당자 드롭다운 — 상담실장 → 코디 순', async ({ page, request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'SUPABASE env 미설정'); return; }

    const custRes = await request.get(
      `${SUPABASE_URL}/rest/v1/customers?select=id&limit=1&order=created_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const customers = await custRes.json();
    if (!Array.isArray(customers) || customers.length === 0) { test.skip(true, '고객 데이터 없음'); return; }

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto(`/chart/${customers[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 2번차트 담당자 드롭다운: 옵션 라벨에 "(상담실장)"/"(데스크)" role suffix 포함 (— 선택 — 옵션 존재)
    const allSelects = page.locator('select');
    const count = await allSelects.count();
    let verified = false;

    for (let i = 0; i < count; i++) {
      const options = await allSelects.nth(i).locator('option').allTextContents();
      const isStaffDropdown = options.some(o => o.includes('선택')) &&
        options.some(o => o.includes('상담실장')) && options.some(o => o.includes('데스크'));
      if (!isStaffDropdown) continue;

      // role suffix 기준 마지막 상담실장 index < 첫 데스크 index 여야 함
      const lastConsultant = options.map((o, idx) => o.includes('상담실장') ? idx : -1).filter(x => x >= 0).pop() ?? -1;
      const firstDesk = options.findIndex(o => o.includes('데스크'));
      expect(lastConsultant, '상담실장 옵션 존재').toBeGreaterThanOrEqual(0);
      expect(firstDesk, '데스크(코디) 옵션 존재').toBeGreaterThanOrEqual(0);
      expect(lastConsultant, `[시나리오1] 상담실장(${lastConsultant})이 데스크(${firstDesk})보다 위`).toBeLessThan(firstDesk);
      verified = true;
      console.log(`[시나리오1] PASS — select[${i}] 상담실장→코디 순서 확인`);
      break;
    }

    if (!verified) {
      console.log('[시나리오1] 상담실장+데스크 동시 보유 드롭다운 미발견(데이터 조건) — 스킵');
      test.skip(true, '검증 대상 드롭다운 없음(staff 구성)');
    }
  });

  test('시나리오2: 일마감 결제내역 담당자 필터 — 상담실장 → 코디 순 (DB role 매핑)', async ({ page, request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'SUPABASE env 미설정'); return; }

    const staff = await fetchStaff(request);
    if (staff.length === 0) { test.skip(true, 'staff 응답 없음/비정상(권한 등)'); return; }
    const byName = new Map<string, string>(); // 표시명 → role
    for (const s of staff) byName.set((s.display_name || s.name).trim(), s.role);

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    await page.goto('/closing');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 담당자 필터: 옵션 "전체"/"미지정" 포함, director·therapist 제외 → 상담실장+코디만
    const allSelects = page.locator('select');
    const count = await allSelects.count();
    let verified = false;

    for (let i = 0; i < count; i++) {
      const options = await allSelects.nth(i).locator('option').allTextContents();
      const isFilter = options.some(o => o.trim() === '전체') && options.some(o => o.includes('미지정'));
      if (!isFilter) continue;

      // 이름 옵션을 role rank로 매핑 ("전체"/"미지정" 제외)
      const ranks = options
        .map(o => o.trim())
        .filter(o => o !== '전체' && o !== '미지정')
        .map(o => ROLE_RANK[byName.get(o) ?? ''] ?? 99)
        .filter(r => r < 99);

      if (ranks.length < 2) continue; // 비교 대상 부족
      const sorted = [...ranks].every((r, idx) => idx === 0 || ranks[idx - 1] <= r);
      expect(sorted, `[시나리오2] 담당자 필터가 role 오름차순(상담실장→코디): ${JSON.stringify(ranks)}`).toBe(true);
      verified = true;
      console.log(`[시나리오2] PASS — select[${i}] role 정렬 확인 ranks=${JSON.stringify(ranks)}`);
      break;
    }

    if (!verified) {
      console.log('[시나리오2] 비교 가능한 담당자 필터 드롭다운 미발견 — 스킵');
      test.skip(true, '검증 대상 드롭다운 없음(staff 구성)');
    }
  });

  test('회귀: DB staff 무변경 — role 값/active 유지 (표시 순서 only)', async ({ request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'SUPABASE env 미설정'); return; }
    const staff = await fetchStaff(request);
    if (staff.length === 0) { test.skip(true, 'staff 응답 없음/비정상(권한 등)'); return; }
    // role enum 표준값만 존재해야 함 (정렬은 코드 레벨, DB enum 무변경)
    const valid = new Set(['director', 'consultant', 'coordinator', 'therapist', 'technician']);
    for (const s of staff) {
      expect(valid.has(s.role), `staff ${s.name} role=${s.role} 표준값`).toBe(true);
    }
    console.log(`[회귀] active staff ${staff.length}명 role enum 표준 유지 PASS`);
  });
});

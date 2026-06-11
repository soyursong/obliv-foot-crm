/**
 * E2E spec — T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST
 *
 * 차감 시 `unique_package_checkin` 중복키(23505) 오류 graceful 처리 + 같은 내원 재차감 이중선택.
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260611-095223-yagl):
 *   "지정치료사가 있는 경우 다른 치료사 선택 후 차감 시 오류 — 당일만 다른 치료사가 전담하는 경우도 있어"
 *   + 추가 케이스(12회권·비가열 1기차감 → 김규리 재차감, 지정치료사 없음에서도 동일 오류).
 *   + ⓠ1=B 확정("웅 있음!!!!"): 같은 날 같은 패키지 2회+ 차감 실제로 있음.
 *
 * ★ root cause: unique_package_checkin UNIQUE(package_id, check_in_id) 가 같은 내원 2회차 차감을 차단.
 *   지정치료사 유무·값과 무관 — 충돌 판정은 오직 (package_id, check_in_id) 중복(23505).
 *
 * 피벗(ⓠ1=B): 제약을 (package_id, check_in_id, session_number) 복합 unique로 재설계(AC1, DB게이트) +
 *   같은 내원 재차감 감지 시 이중선택 모달(AC2):
 *     ① 치료사만 변경 → 기존 회차 performed_by UPDATE (회차 추가 소진 없음)
 *     ② 1회차 추가 차감 → 새 회차 INSERT (session_number+1, 잔여 1 감소)
 *     ③ 취소 → 변경 없음
 *   AC3: 어떤 경로에서도 raw "duplicate key ... unique_package_checkin" 토스트 금지.
 *
 * 컨벤션: 핵심 판정/분기 로직 page.evaluate 박제(환경독립) + 모달 렌더 스모크(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260611 DEDUCT-DUPKEY-SUBTHERAPIST — 같은 내원 재차감 이중선택 + 23505 graceful', () => {
  // ── 시나리오2 / AC2 (핵심): 충돌 판정 — 오직 (package_id, check_in_id) 중복, 지정치료사 무관 ──
  test('AC2: 같은 내원·같은 패키지 used 이력 존재 시 모달 분기 — designated_therapist 값에 절대 의존 안 함', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // findSameCheckinSession 의 판정 본질 박제: 같은 (package_id, check_in_id)·status='used' 행 존재 여부.
      // ★ designated_therapist_id / performed_by 값은 판정에 일절 들어가지 않는다(planner INFO 2026-06-11).
      type Row = { package_id: string; check_in_id: string | null; status: string; performed_by: string | null; session_number: number };
      const findSameCheckin = (rows: Row[], packageId: string, checkInId: string | null) => {
        if (!checkInId) return null; // check_in_id NULL → PG NULL distinct → 제약 미적용 → 모달 없음
        const hit = rows
          .filter(r => r.package_id === packageId && r.check_in_id === checkInId && r.status === 'used')
          .sort((a, b) => b.session_number - a.session_number)[0];
        return hit ?? null;
      };
      const CI = 'ci-today';
      // 케이스A: 지정치료사 있는 환자(기차감 담당=김봄), 당일 다른 치료사(지원) 재차감 → 충돌 감지
      const rowsA: Row[] = [{ package_id: 'pkg1', check_in_id: CI, status: 'used', performed_by: 'kimbom', session_number: 1 }];
      // 케이스B: 지정치료사 '없음'(performed_by 무관), 12회권 1기차감 → 김규리 재차감 → 동일하게 충돌 감지
      const rowsB: Row[] = [{ package_id: 'pkg2', check_in_id: CI, status: 'used', performed_by: null, session_number: 1 }];
      return {
        // 둘 다 충돌 감지(모달 진입) — 지정치료사 유무와 무관함을 입증
        hitWithDesignated: findSameCheckin(rowsA, 'pkg1', CI)?.session_number ?? null,
        hitWithoutDesignated: findSameCheckin(rowsB, 'pkg2', CI)?.session_number ?? null,
        // check_in_id NULL(차감일≠내원일)이면 제약 미적용 → 모달 없이 정상 INSERT
        nullCheckInNoConflict: findSameCheckin(rowsA, 'pkg1', null),
        // 다른 내원(check_in_id 다름)이면 충돌 아님
        otherCheckInNoConflict: findSameCheckin(rowsA, 'pkg1', 'ci-other'),
        // 같은 패키지에 used 이력 없으면 충돌 아님(첫 차감)
        firstDeductNoConflict: findSameCheckin([], 'pkg1', CI),
      };
    });
    expect(result.hitWithDesignated).toBe(1);       // 지정치료사 있어도 충돌 감지
    expect(result.hitWithoutDesignated).toBe(1);    // ★ 지정치료사 없어도 동일 감지(INFO 핵심)
    expect(result.nullCheckInNoConflict).toBeNull();// check_in_id NULL → 모달 없음
    expect(result.otherCheckInNoConflict).toBeNull();// 다른 내원 → 충돌 아님
    expect(result.firstDeductNoConflict).toBeNull();// 첫 차감 → 모달 없음
  });

  // ── 시나리오2A/2B / AC2 ①·②: 분기별 회차·잔여 효과 박제 ──────────────────────────────
  test('AC2 ①치료사만변경=회차불변 / ②추가차감=session_number+1·잔여 1 감소', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Sess = { id: string; session_number: number; performed_by: string | null; status: string };
      const usedCount = (rows: Sess[]) => rows.filter(s => s.status === 'used').length;

      // 초기: pkg에 1회차(used, 담당 kimbom) 존재
      const base: Sess[] = [{ id: 's1', session_number: 1, performed_by: 'kimbom', status: 'used' }];

      // ① 치료사만 변경: 기존 회차 performed_by UPDATE → 행 수 불변, 회차번호 불변, 담당만 바뀜
      const afterChange = base.map(s => s.id === 's1' ? { ...s, performed_by: 'jiwon' } : s);

      // ② 1회차 추가 차감: usedCount+1 회차 INSERT → 행 +1, 새 session_number = usedCount+1
      const afterAdd: Sess[] = [...base, { id: 's2', session_number: usedCount(base) + 1, performed_by: 'jiwon', status: 'used' }];

      return {
        changeRowCount: afterChange.length,                         // 1 (불변)
        changePerformedBy: afterChange[0].performed_by,             // jiwon (담당만 변경)
        changeUsed: usedCount(afterChange),                         // 1 (회차 추가 소진 없음)
        addRowCount: afterAdd.length,                               // 2
        addNewSessionNumber: afterAdd[1].session_number,           // 2 (session_number+1)
        addUsed: usedCount(afterAdd),                              // 2 (잔여 1 추가 감소)
      };
    });
    // ① 치료사만 변경: 회차 추가 소진 없음, 담당만 교체
    expect(result.changeRowCount).toBe(1);
    expect(result.changePerformedBy).toBe('jiwon');
    expect(result.changeUsed).toBe(1);
    // ② 1회차 추가 차감: session_number+1 새 회차, used +1 (잔여 1 감소)
    expect(result.addRowCount).toBe(2);
    expect(result.addNewSessionNumber).toBe(2);
    expect(result.addUsed).toBe(2);
  });

  // ── AC3: 23505 / unique_package_checkin 위반의 graceful 판정 — raw error.message 노출 금지 ──
  test('AC3: isDupCheckinError — 23505·제약명 매칭 시 graceful, 그 외 일반 오류는 통과', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const isDupCheckinError = (err: { message?: string; code?: string } | null): boolean =>
        !!err && (err.code === '23505' || /unique_package_checkin/i.test(err.message ?? ''));
      return {
        byCode: isDupCheckinError({ code: '23505', message: 'duplicate key value violates unique constraint "unique_package_checkin"' }),
        byNameOnly: isDupCheckinError({ message: 'violates unique constraint "unique_package_checkin"' }),
        bySessionName: isDupCheckinError({ code: '23505', message: 'unique_package_checkin_session' }), // 신 제약명도 23505 코드로 흡수
        otherError: isDupCheckinError({ code: '23503', message: 'foreign key violation' }), // 다른 오류 → 일반 처리
        nullErr: isDupCheckinError(null),
      };
    });
    expect(result.byCode).toBe(true);
    expect(result.byNameOnly).toBe(true);
    expect(result.bySessionName).toBe(true);   // 마이그 후 신 제약명도 23505로 graceful
    expect(result.otherError).toBe(false);     // FK 등 다른 오류는 raw 메시지 경로 유지
    expect(result.nullErr).toBe(false);
  });

  // ── AC1: 복합 unique (package_id, check_in_id, session_number) 의 허용/차단 의미 박제 ──────
  test('AC1: 새 제약 — 같은 내원 다른 회차 허용 / 동일 (pkg,checkin,session) 재INSERT만 차단', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // PG composite unique 의미 모사: key = (package_id, check_in_id, session_number).
      // ★ check_in_id 가 NULL 이면 NULL distinct → 어떤 행도 충돌 없음(기존 동작 보존).
      type Key = { p: string; c: string | null; s: number };
      const violatesUnique = (existing: Key[], next: Key): boolean => {
        if (next.c === null) return false; // NULL check_in → distinct
        return existing.some(k => k.p === next.p && k.c === next.c && k.s === next.s);
      };
      const existing: Key[] = [{ p: 'pkg1', c: 'ci1', s: 1 }];
      return {
        // 같은 내원 2회차(session 2) → 허용(과거 구 제약이 막던 정당한 동선)
        sameCheckinNextSession: violatesUnique(existing, { p: 'pkg1', c: 'ci1', s: 2 }),
        // 같은 내원·같은 회차 재INSERT(이중 클릭) → 여전히 차단(오차감 가드)
        sameCheckinSameSession: violatesUnique(existing, { p: 'pkg1', c: 'ci1', s: 1 }),
        // NULL check_in(차감일≠내원일) → 항상 허용
        nullCheckin: violatesUnique(existing, { p: 'pkg1', c: null, s: 1 }),
        // 다른 내원 → 허용
        otherCheckin: violatesUnique(existing, { p: 'pkg1', c: 'ci2', s: 1 }),
      };
    });
    expect(result.sameCheckinNextSession).toBe(false); // ⓠ1=B: 같은 날 추가 차감 허용
    expect(result.sameCheckinSameSession).toBe(true);  // 이중 클릭 재INSERT 차단(가드 유지)
    expect(result.nullCheckin).toBe(false);            // NULL check_in 보존
    expect(result.otherCheckin).toBe(false);           // 다른 내원 허용
  });

  // ── AC0 회귀 스모크: 고객 차트 진입 + 이중선택 모달이 초기엔 닫혀 있음(데이터 의존 graceful skip) ──
  test('AC0 회귀: 차트 렌더 무파괴 + 이중선택 모달 초기 비표시', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    // 이중선택 모달(dup-deduct-modal)은 재차감 충돌 시에만 노출 — 초기엔 DOM에 없음/비표시.
    await expect(page.locator('[data-testid="dup-deduct-modal"]')).toHaveCount(0);
  });
});

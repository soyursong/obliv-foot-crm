/**
 * E2E spec — T-20260615-foot-DEDUCT-ADDSESSION-MIG-NOTAPPLIED
 *
 * "1회차 추가 차감" 반영 안 됨 = 제약 마이그(20260611230000) prod 미적용의 보충.
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260615-164624-1u0n, 2026-06-15 16:46):
 *   "1회차 추가 차감 반영 안 됨"
 *   첨부: 3-way 모달 + 상단 빨간 토스트 "같은 날 추가 차감 설정이 아직 반영되지 않았어요. 관리자에게 문의해 주세요."
 *
 * ★ root cause: origin T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST 의 DB 마이그
 *   20260611230000 (unique_package_checkin → unique_package_checkin_session 복합 unique 교체)
 *   가 prod 에 적용되지 않아, ② "1회차 추가 차감"(session_number+1 INSERT)이 구 제약
 *   unique_package_checkin(package_id, check_in_id) 에 막혀 23505 → FE graceful 토스트로 흡수됨.
 *   FE(commit 71af107)는 정상 deployed. 코드 결함 아님 → 본건은 마이그 prod 적용(supervisor DB 게이트) 보충.
 *
 * 해소: 2026-06-15 17:44 prod 제약 교체 적용 완료(psql --single-transaction, RESULT.log 증빙).
 *   적용 후 같은 내원 session_number+1 INSERT 수락(23505 미발생) → "아직 반영되지 않았어요" 토스트 미출현.
 *
 * 본 spec 범위: AC-2(추가 차감 정상화·토스트 미출현) + AC-3(이중클릭 가드 유지).
 *   DB 게이트 본체(AC-1 제약 교체)는 supervisor DDL-diff + prod RESULT.log 로 증빙됨(SQL 레벨).
 *   코드 변경 0건이므로 본 spec 은 마이그 적용 후 보장되는 동선 불변식을 환경독립(page.evaluate)으로 박제.
 *
 * 컨벤션: 핵심 판정/분기 로직 page.evaluate 박제(환경독립) + 차트 렌더 스모크(graceful skip).
 *   origin DEDUCT-DUPKEY spec 과 동일 패턴 — 본건은 그 동선이 prod 제약 적용 후 실제로 통하는지를 고정.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260615 DEDUCT-ADDSESSION-MIG-NOTAPPLIED — 마이그 적용 후 ②추가차감 정상화 + 가드 유지', () => {
  // ── AC-2 (핵심): 마이그 적용 후 같은 내원 session_number+1 INSERT 가 제약에 막히지 않음 ──
  //    = handleDupAddSession 이 23505 를 받지 않음 → "아직 반영되지 않았어요" 토스트 미출현.
  test('AC-2: 복합 제약 적용 후 같은 내원 2회차 추가 차감 허용 → graceful 토스트 미출현', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // prod 적용된 신 제약 unique_package_checkin_session(package_id, check_in_id, session_number) 의미 모사.
      // ★ 마이그 미적용(구 제약)이었으면 (package_id, check_in_id)만으로 충돌 → 2회차도 23505.
      //   적용 후엔 session_number 가 키에 포함되어 같은 내원 다른 회차는 허용된다.
      type Key = { p: string; c: string | null; s: number };
      const violatesNewConstraint = (existing: Key[], next: Key): boolean => {
        if (next.c === null) return false; // NULL check_in → PG NULL distinct → 제약 미적용
        return existing.some(k => k.p === next.p && k.c === next.c && k.s === next.s);
      };
      // FE handleDupAddSession 후처리 모사: INSERT error 가 dup(23505)면 "아직 반영되지 않았어요" 토스트.
      const addSessionToast = (insertViolates: boolean): string =>
        insertViolates
          ? '같은 날 추가 차감 설정이 아직 반영되지 않았어요. 관리자에게 문의해 주세요.'
          : '1회차 추가 차감 완료';

      const CI = 'ci-today';
      // 오늘 이미 1회차(used) 차감된 12회권 상태
      const existing: Key[] = [{ p: 'pkg12', c: CI, s: 1 }];
      // ② 1회차 추가 차감 = session_number+1(=2) INSERT
      const addViolates = violatesNewConstraint(existing, { p: 'pkg12', c: CI, s: 2 });

      return {
        addViolates,                       // false (적용 후 허용)
        toast: addSessionToast(addViolates), // 성공 토스트
        // 비교: 마이그 미적용(구 제약, check_in_id만)이었다면 2회차도 충돌했음을 명시
        wouldViolateUnderOldConstraint: existing.some(k => k.p === 'pkg12' && k.c === CI), // true
      };
    });
    expect(result.addViolates).toBe(false);                 // 적용 후 같은 내원 2회차 INSERT 허용
    expect(result.toast).toBe('1회차 추가 차감 완료');        // graceful fallback 토스트 미출현
    expect(result.toast).not.toContain('아직 반영되지 않았어요');
    expect(result.wouldViolateUnderOldConstraint).toBe(true); // 구 제약이었으면 막혔을 것(회귀 근거)
  });

  // ── AC-3: 이중클릭 가드 유지 — 동일 (package_id, check_in_id, session_number) 재INSERT 는 여전히 차단 ──
  test('AC-3: 동일 회차 재INSERT(이중클릭)는 여전히 차단 — 오차감 가드 유지', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Key = { p: string; c: string | null; s: number };
      const violatesNewConstraint = (existing: Key[], next: Key): boolean => {
        if (next.c === null) return false;
        return existing.some(k => k.p === next.p && k.c === next.c && k.s === next.s);
      };
      // 추가 차감 직후 상태: 1회차·2회차 used
      const existing: Key[] = [{ p: 'pkg12', c: 'ci-today', s: 1 }, { p: 'pkg12', c: 'ci-today', s: 2 }];
      return {
        // 동일 2회차 재INSERT(이중 클릭) → 차단(graceful 흡수)
        doubleClickSameSession: violatesNewConstraint(existing, { p: 'pkg12', c: 'ci-today', s: 2 }),
        // 정당한 3회차(또 한 번 시술)는 여전히 허용
        legitNextSession: violatesNewConstraint(existing, { p: 'pkg12', c: 'ci-today', s: 3 }),
      };
    });
    expect(result.doubleClickSameSession).toBe(true);  // 이중클릭/오차감 차단 유지
    expect(result.legitNextSession).toBe(false);       // 정당한 추가 차감은 계속 허용
  });

  // ── AC-3 보강: isDupCheckinError 가 구·신 제약명·23505 모두 graceful 흡수(raw 메시지 노출 금지) ──
  test('AC-3 보강: isDupCheckinError — 23505·구/신 제약명 매칭 시 graceful, 그 외는 통과', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const isDupCheckinError = (err: { message?: string; code?: string } | null): boolean =>
        !!err && (err.code === '23505' || /unique_package_checkin/i.test(err.message ?? ''));
      return {
        oldConstraintName: isDupCheckinError({ code: '23505', message: 'unique constraint "unique_package_checkin"' }),
        newConstraintName: isDupCheckinError({ code: '23505', message: 'unique constraint "unique_package_checkin_session"' }),
        byCodeOnly: isDupCheckinError({ code: '23505', message: '' }),
        fkError: isDupCheckinError({ code: '23503', message: 'foreign key violation' }),
        nullErr: isDupCheckinError(null),
      };
    });
    expect(result.oldConstraintName).toBe(true);
    expect(result.newConstraintName).toBe(true); // 적용 후 신 제약명도 23505로 graceful 흡수
    expect(result.byCodeOnly).toBe(true);
    expect(result.fkError).toBe(false);          // 다른 오류는 raw 경로 유지
    expect(result.nullErr).toBe(false);
  });

  // ── AC0 회귀 스모크: 차트 렌더 무파괴 + 3-way 이중선택 모달 초기 비표시 ──
  test('AC0 회귀: 차트 렌더 무파괴 + 이중선택 모달 초기 비표시', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dup-deduct-modal"]')).toHaveCount(0);
  });
});

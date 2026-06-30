import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260630-foot-RESVPOPUP-DELBTN-HIDE-TMCODY — 예약상세 팝업: TM·코디네이터 [예약삭제] 미렌더
 * 원천: planner NEW-TASK(MSG-20260630-140452). 풋 예약상세 팝업 하단 '예약삭제' 버튼을
 *   role 'tm' + 코디네이터(coordinator)에게는 미렌더(hidden, not disabled). admin 등은 현행 유지(회귀0).
 *
 * FE-only·무DDL. role 값 = profile?.role(useAuth) → currentUserRole prop(인접 TM-LOCK 티켓과 동일 경로).
 * '코디네이터' 정본 enum = 'coordinator' (user_profiles.role / Accounts ROLES / Register '코디').
 * 거대-인라인/established 컴포넌트(ReservationDetailPopup) = source-integrity gating(정적 단언).
 * 실 브라우저 동작(TM/코디 로그인 → 버튼 부재)은 supervisor field-soak(갤탭 실기기 confirm)로 닫음.
 *
 *   AC① TM 미노출       — isAdmin && !isTmRole && !isCoordinatorRole
 *   AC② 코디네이터 미노출 — isCoordinatorRole = role==='coordinator'
 *   AC③ admin 정상노출(회귀0) — isAdmin 게이트 유지, 'coordinator' 단일 비교(타역할 무영향)
 *   AC④ 비노출 시 푸터 레이아웃 비깨짐 — [닫기] ml-auto 우측정렬 유지(조건부 렌더만)
 */

const POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 0 — prop 배선 + 역할 파생
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오0: 권한 prop 배선 + 역할 파생', () => {
  test('AC0-1: 팝업이 currentUserRole prop 수신(인접 TM-LOCK 동일 경로)', () => {
    expect(POPUP, 'currentUserRole prop destructure 누락').toContain('currentUserRole,');
    expect(POPUP, 'currentUserRole 타입 정의 누락').toContain('currentUserRole?: string');
  });

  test('AC0-2: isCoordinatorRole 파생 (role==='+"'coordinator'"+' 한정 — 정본 enum)', () => {
    expect(POPUP, 'isCoordinatorRole 파생 누락')
      .toContain("const isCoordinatorRole = currentUserRole === 'coordinator'");
  });

  test('AC0-3: Reservations 호출부가 profile.role 전달(useAuth 소스)', () => {
    expect(RESV_PAGE, 'currentUserRole 전달 누락')
      .toContain("currentUserRole={profile?.role ?? ''}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (AC①②③) — [예약삭제] 버튼 게이트
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: [예약삭제] 버튼 역할 게이트 (AC①②③)', () => {
  test('AC1-1: 삭제 버튼이 isAdmin && !isTmRole && !isCoordinatorRole 게이트', () => {
    const idx = POPUP.indexOf('data-testid="btn-reservation-delete"');
    expect(idx, 'btn-reservation-delete testid 부재').toBeGreaterThan(-1);
    // 버튼 직전 게이트 윈도(~300자)에 3중 조건 존재
    const region = POPUP.slice(Math.max(0, idx - 300), idx);
    expect(region, '삭제 버튼 isAdmin 게이트 누락(회귀0 — admin 정상노출)')
      .toContain('isAdmin');
    expect(region, '삭제 버튼 TM 제외(AC①) 누락').toContain('!isTmRole');
    expect(region, '삭제 버튼 코디네이터 제외(AC②) 누락').toContain('!isCoordinatorRole');
  });

  test('AC1-2: 미렌더 방식(hidden) — disabled 토글이 아님', () => {
    // 삭제 버튼 자체는 disabled={busy}(액션 중 가드)만, 역할 hide 는 조건부 렌더({cond && <Button>})로 처리
    const idx = POPUP.indexOf('data-testid="btn-reservation-delete"');
    const region = POPUP.slice(Math.max(0, idx - 300), idx);
    expect(region, '역할 hide 가 조건부 렌더(&&)가 아님').toContain('&& (');
    expect(region, '역할이 disabled 로 잘못 처리(미렌더 요건 위반)')
      .not.toContain('disabled={isTmRole');
  });

  test('AC1-3: admin 정상노출 회귀0 — coordinator 단일 비교(타역할 무영향)', () => {
    // isCoordinatorRole 정의가 정확히 'coordinator' 단일 비교 — admin/manager/consultant 미포함
    expect(POPUP, 'isCoordinatorRole 가 coordinator 외 역할 포함(회귀 위험)')
      .not.toMatch(/isCoordinatorRole\s*=\s*currentUserRole\s*===\s*'coordinator'\s*\|\|/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (AC④) — 푸터 레이아웃 비깨짐
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 푸터 레이아웃 비깨짐 (AC④)', () => {
  test('AC2-1: [닫기] 버튼 ml-auto 우측정렬 유지(삭제 미렌더와 무관)', () => {
    // 삭제 버튼 게이트 이후 닫기 버튼이 ml-auto 로 우측 고정 → 삭제 비노출 시에도 레이아웃 안정
    const delIdx = POPUP.indexOf('data-testid="btn-reservation-delete"');
    const after = POPUP.slice(delIdx, delIdx + 400);
    expect(after, '닫기 버튼 ml-auto 우측정렬 누락(레이아웃 안정성)')
      .toMatch(/className="ml-auto"[\s\S]*onClick=\{onClose\}/);
  });

  test('AC2-2: 삭제 핸들러 deleteReservation 보존(admin 동선 무손실)', () => {
    expect(POPUP, '삭제 핸들러 누락').toContain('const deleteReservation = async');
  });
});

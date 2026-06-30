import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260630-foot-RESVPOPUP-TM-REGISTRAR-LOCK — 예약상세 팝업: role='tm' 예약등록자 잠금
 * 원천: 박민지 팀장(C0ATE5P6JTH). TM이 예약등록자(상담사 귀속)를 임의 변경하면 통계 귀속이
 *   오염될 수 있어 read-only(disabled) + 저장 차단. admin/manager/consultant는 기존대로 편집 가능.
 *
 * FE-only·무DDL. role 값은 profile?.role(useAuth, 旣존) FE 접근.
 * 거대-인라인/established 컴포넌트(ReservationDetailPopup/Reservations) = source-integrity gating(정적 단언).
 * 실 브라우저 동작(TM 로그인 → disabled 확인)은 supervisor field-soak 로 닫음.
 *
 *   AC-1 기존 예약 모드 예약등록자 드롭다운 disabled (role='tm')
 *   AC-2 [저장] 시 registrar_id/registrar_name 변경 차단 (DB 미반영)
 *   AC-3 admin/manager/consultant 등 타 역할 편집 정상 (회귀 게이트)
 *   AC-4 신규 예약(new-mode) 예약등록자 드롭다운 disabled (role='tm')
 */

const POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 0 — prop 배선: currentUserRole 전달 + isTmRole 파생
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오0: 권한 prop 배선', () => {
  test('AC0-1: 팝업 props 에 currentUserRole 수신', () => {
    expect(POPUP, 'currentUserRole prop destructure 누락').toContain('currentUserRole,');
    expect(POPUP, 'currentUserRole 타입 정의 누락').toContain('currentUserRole?: string');
  });

  test('AC0-2: isTmRole 파생 (role==='+"'tm'"+' 한정)', () => {
    expect(POPUP, 'isTmRole 파생 누락')
      .toContain("const isTmRole = currentUserRole === 'tm'");
  });

  test('AC0-3: Reservations 호출부가 profile.role 전달', () => {
    expect(RESV_PAGE, 'currentUserRole 전달 누락')
      .toContain("currentUserRole={profile?.role ?? ''}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (AC-1) — 기존 예약 모드 예약등록자 disabled
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 기존 예약 예약등록자 잠금 (AC-1)', () => {
  test('AC1-1: 기존 예약 예약등록자 Select disabled={isTmRole}', () => {
    // popup-registrar testid 직전 Select 루트(~400자 윈도)에 disabled={isTmRole} 존재
    const idx = POPUP.indexOf('data-testid="popup-registrar"');
    expect(idx, 'popup-registrar testid 부재').toBeGreaterThan(-1);
    const region = POPUP.slice(Math.max(0, idx - 400), idx);
    expect(region, '기존 예약 예약등록자 Select disabled 누락').toContain('disabled={isTmRole}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (AC-2) — 저장 시 registrar 변경 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 저장 차단 (AC-2)', () => {
  test('AC2-1: TM 역할은 registrar_id/registrar_name 를 update payload 에서 제외(조건부 spread)', () => {
    // isTmRole 일 때 registrar 필드를 빈 객체로 → update 페이로드에서 누락
    expect(POPUP, 'TM 저장 가드(registrarFields 조건부) 누락')
      .toContain('const registrarFields = isTmRole ? {} : {');
    const guardIdx = POPUP.indexOf('const registrarFields = isTmRole');
    const after = POPUP.slice(guardIdx, guardIdx + 260);
    expect(after, 'registrar_id 가 비-TM 분기에 없음').toContain('registrar_id:');
    expect(after, 'registrar_name 가 비-TM 분기에 없음').toContain('registrar_name: reg ? reg.name : null');
    // update 페이로드가 registrarFields 를 spread 로 합성
    expect(POPUP, 'registrarFields spread 합성 누락').toContain('...registrarFields');
  });

  test('AC2-2: visit_route 는 역할 무관 정상 저장(spread 밖 고정 필드)', () => {
    const updIdx = POPUP.indexOf('...registrarFields');
    const before = POPUP.slice(Math.max(0, updIdx - 200), updIdx);
    expect(before, 'visit_route 가 고정 저장 필드에 없음')
      .toContain("visit_route: visitRoute === '' ? null : visitRoute");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 (AC-3) — 회귀 게이트: 타 역할 편집 무영향
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 타 역할 회귀 게이트 (AC-3)', () => {
  test('AC3-1: disabled 조건은 role==='+"'tm'"+' 한정(다른 역할 분기 영향 0)', () => {
    // isTmRole 정의가 정확히 'tm' 단일 비교 — admin/manager/consultant 등 미포함
    expect(POPUP, 'isTmRole 가 tm 외 역할 포함(회귀 위험)')
      .not.toMatch(/isTmRole\s*=\s*currentUserRole\s*===\s*'tm'\s*\|\|/);
  });

  test('AC3-2: 저장 핸들러 saveRouteAndRegistrar 존재(편집 동선 유지)', () => {
    expect(POPUP, '저장 핸들러 누락').toContain('const saveRouteAndRegistrar = async');
    expect(POPUP, '저장 update 누락').toContain("from('reservations')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 (AC-4) — 신규 예약(new-mode) 예약등록자 disabled
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 신규 예약 모드 잠금 (AC-4)', () => {
  test('AC4-1: new-mode 예약등록자 Select disabled={isTmRole}', () => {
    const idx = POPUP.indexOf('data-testid="newmode-registrar-select"');
    expect(idx, 'newmode-registrar-select testid 부재').toBeGreaterThan(-1);
    const region = POPUP.slice(Math.max(0, idx - 400), idx);
    expect(region, '신규 예약 예약등록자 Select disabled 누락').toContain('disabled={isTmRole}');
  });
});

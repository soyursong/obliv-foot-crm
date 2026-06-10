import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS — 예약경로 신규 + 예약등록자 편집형 마스터 + 고객박스 @등록자
 * 원천: 김주연 총괄(C0ATE5P6JTH). B안 확정(4분할 ReservationDetailPopup 유지·보강).
 *
 * DB 게이트는 supervisor PASS(마이그 20260610110000 prod 반영 — reservation_registrars +
 * reservations.visit_route/registrar_id/registrar_name). 본 spec = FE 단일구현 회귀 차단.
 *
 * 거대-인라인/established 컴포넌트(Reservations.tsx) = source-integrity gating(정적 단언)으로 차단.
 * 실 브라우저 동작은 supervisor field-soak 로 닫음.
 *
 *   AC-4a 예약경로  — 팝업 드롭다운, 옵션=방문경로 SSOT(VISIT_ROUTE_OPTIONS), reservations.visit_route 영속
 *   AC-4b 예약등록자 — 라벨 '예약등록자', 마스터 드롭다운(원내/TM), 관리자 CRUD, registrar_id/name 스냅샷
 *   AC-5  고객박스   — 우측 하단 @등록자(정상+취소됨 박스), 미지정 빈칸
 */

const POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const REGISTRAR_TAB = fs.readFileSync(path.resolve('src/components/ReservationRegistrarTab.tsx'), 'utf-8');
const STAFF_PAGE = fs.readFileSync(path.resolve('src/pages/Staff.tsx'), 'utf-8');
const TYPES = fs.readFileSync(path.resolve('src/lib/types.ts'), 'utf-8');
const MIGRATION = fs.readFileSync(
  path.resolve('supabase/migrations/20260610110000_resv_registrar_route_fields.sql'),
  'utf-8',
);

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 0 — SSOT: 방문경로 옵션 단일 정의 (신규 enum 신설 금지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오0: 방문경로 SSOT', () => {
  test('AC0-1: VISIT_ROUTE_OPTIONS 4값 단일 정의(customers.visit_route enum과 동일)', () => {
    expect(TYPES, 'VISIT_ROUTE_OPTIONS 상수 미정의').toContain('export const VISIT_ROUTE_OPTIONS');
    for (const v of ['TM', '인바운드', '워크인', '지인소개']) {
      expect(TYPES, `VISIT_ROUTE_OPTIONS 누락: ${v}`).toContain(`'${v}'`);
    }
  });

  test('AC0-2: 신규예약 editor·팝업이 동일 SSOT 재사용(하드코딩 옵션 신설 금지)', () => {
    expect(RESV_PAGE, '신규예약 editor 가 VISIT_ROUTE_OPTIONS 재사용 안 함')
      .toContain('VISIT_ROUTE_OPTIONS.map');
    expect(POPUP, '예약상세 팝업이 VISIT_ROUTE_OPTIONS 재사용 안 함')
      .toContain('VISIT_ROUTE_OPTIONS.map');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (AC-4a) — 예약경로 필드
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 예약경로 (AC-4a)', () => {
  test('AC4a-1: 팝업에 예약경로 드롭다운 노출', () => {
    expect(POPUP, '예약경로 라벨 누락').toContain('예약경로');
    expect(POPUP, '예약경로 드롭다운 testid 누락').toContain('data-testid="popup-visit-route"');
  });

  test('AC4a-1b: 저장 시 reservations.visit_route 영속(미지정→null)', () => {
    expect(POPUP, 'visit_route update 누락').toContain('visit_route: visitRoute === \'\' ? null : visitRoute');
  });

  test('AC4a-2: 회귀 — 기존 예약(visit_route NULL) 프리로드 nullish 가드', () => {
    expect(POPUP, 'visit_route 프리로드 가드 누락').toContain("reservation.visit_route ?? ''");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (AC-4b) — 예약등록자 마스터 드롭다운 + 관리자 CRUD
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 예약등록자 (AC-4b)', () => {
  test('AC4b-1: 라벨이 예약등록자(구 "TM 상담사(예약 등록자)" 제거)', () => {
    expect(POPUP, '예약등록자 라벨 누락').toContain('예약등록자');
    expect(POPUP, '구 라벨 "TM 상담사" 잔존').not.toContain('TM 상담사');
  });

  test('AC4b-2: 드롭다운 옵션 = reservation_registrars 마스터(그룹 표시)', () => {
    expect(POPUP, '마스터 fetch 누락').toContain("from('reservation_registrars')");
    expect(POPUP, '활성만 노출 필터 누락').toContain(".eq('active', true)");
    expect(POPUP, '드롭다운 testid 누락').toContain('data-testid="popup-registrar"');
    expect(POPUP, '그룹-이름 표기 누락').toContain('{r.group_name} - {r.name}');
  });

  test('AC4b-2b: registrar_id + registrar_name(스냅샷) 영속', () => {
    expect(POPUP, 'registrar_id update 누락').toContain('registrar_id:');
    expect(POPUP, 'registrar_name 스냅샷 update 누락').toContain('registrar_name: reg ? reg.name : null');
  });

  test('AC4b-3: 관리자 설정 CRUD — Staff 페이지 예약등록자 탭', () => {
    expect(STAFF_PAGE, '예약등록자 탭 트리거 누락').toContain('value="registrars"');
    expect(STAFF_PAGE, '예약등록자 탭 라벨 누락').toContain('예약등록자');
    expect(STAFF_PAGE, 'ReservationRegistrarTab 미연결').toContain('<ReservationRegistrarTab');
  });

  test('AC4b-3b: CRUD 동작 — 추가/수정/비활성/정렬/삭제 전부 존재', () => {
    expect(REGISTRAR_TAB, '추가 핸들러 누락').toContain("from('reservation_registrars')");
    expect(REGISTRAR_TAB, '추가 버튼 testid 누락').toContain('data-testid="registrar-add-btn"');
    expect(REGISTRAR_TAB, 'insert(추가) 누락').toContain('.insert(');
    expect(REGISTRAR_TAB, 'update(수정/비활성/정렬) 누락').toContain('.update(');
    expect(REGISTRAR_TAB, 'delete(삭제) 누락').toContain('.delete(');
    expect(REGISTRAR_TAB, '비활성 토글 누락').toContain('active: !r.active');
    expect(REGISTRAR_TAB, '정렬 swap 누락').toContain('sort_order');
  });

  test('AC4b-3c: CRUD 쓰기는 admin/manager 한정(비권한 read-only)', () => {
    expect(REGISTRAR_TAB, 'canEdit 권한 게이트 누락')
      .toMatch(/canEdit\s*=\s*profile\?\.role === 'admin' \|\| profile\?\.role === 'manager'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 (AC-5) — 고객박스 우측 하단 @예약등록자
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 고객박스 @등록자 (AC-5)', () => {
  test('AC5-1: 고객박스에 @registrar_name 표시(우측 정렬)', () => {
    expect(RESV_PAGE, '@등록자 렌더 누락').toContain('@{r.registrar_name}');
    expect(RESV_PAGE, '등록자 태그 testid 누락').toContain('registrar-tag-');
    expect(RESV_PAGE, '우측 정렬 누락').toMatch(/registrar-tag-[\s\S]*?text-right|text-right[\s\S]*?registrar-tag-/);
  });

  test('AC5-2: 미지정 시 빈칸(조건부 렌더 — 에러 없음)', () => {
    // 정상·취소됨 박스 공통 렌더(status 가드 없음) + registrar_name 존재 시에만 렌더
    expect(RESV_PAGE, '조건부 렌더(미지정 빈칸) 누락').toContain('{r.registrar_name && (');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 — 팝업 푸터 액션(저장/예약취소/예약삭제/예약복원) + DB 마이그(additive)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 푸터 액션 + DB 무결성', () => {
  test('AC6-1: 저장 버튼(예약경로·예약등록자 영속)', () => {
    expect(POPUP, '저장 버튼 testid 누락').toContain('data-testid="btn-reservation-save"');
    expect(POPUP, '저장 핸들러 누락').toContain('saveRouteAndRegistrar');
  });

  test('AC6-2: 정상 [예약취소] / 취소·노쇼 [예약복원] / admin [예약삭제]', () => {
    expect(POPUP, '예약취소 라벨 누락').toContain('예약취소');
    expect(POPUP, '예약복원 라벨 누락').toContain('예약복원');
    expect(POPUP, '예약삭제 라벨 누락').toContain('예약삭제');
    expect(POPUP, '복원 testid 누락').toContain('data-testid="btn-reservation-restore"');
  });

  test('AC6-3: 복원 시 취소 메타 초기화(latent 버그 수정 유지)', () => {
    expect(POPUP, '복원 메타 초기화 누락')
      .toContain('cancelled_at: null, cancel_reason: null, cancelled_by: null');
  });

  test('AC-DB-1: additive only — 신규 컬럼 IF NOT EXISTS + 롤백 동반', () => {
    expect(MIGRATION, 'visit_route additive 누락').toContain('ADD COLUMN IF NOT EXISTS visit_route');
    expect(MIGRATION, 'registrar_id additive 누락').toContain('ADD COLUMN IF NOT EXISTS registrar_id');
    expect(MIGRATION, 'registrar_name additive 누락').toContain('ADD COLUMN IF NOT EXISTS registrar_name');
    expect(MIGRATION, '마스터 테이블 IF NOT EXISTS 누락')
      .toContain('CREATE TABLE IF NOT EXISTS public.reservation_registrars');
    expect(
      fs.existsSync(path.resolve('supabase/migrations/20260610110000_resv_registrar_route_fields.rollback.sql')),
      '롤백 SQL 파일 부재',
    ).toBeTruthy();
  });

  test('AC-DB-2: visit_route CHECK = customers enum 동일 4값(신규 enum 미신설)', () => {
    expect(MIGRATION, 'visit_route CHECK 4값 불일치')
      .toContain("visit_route IN ('TM','워크인','인바운드','지인소개')");
  });

  test('AC-DB-3: 마스터 RLS — admin/manager write', () => {
    expect(MIGRATION, 'RLS 미활성').toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION, 'write 권한 게이트 누락').toContain("role IN ('admin', 'manager')");
  });
});

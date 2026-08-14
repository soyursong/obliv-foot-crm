/**
 * T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT — 직원 '비활성' vs '삭제' 분리 로직 검증
 *
 * 요청(현장): "비활성/삭제 기능 구분. 테스트로 등록된 거 깔끔하게 삭제. 비활성/삭제 버튼 각각."
 *   · 비활성 = 접근/로그인 차단 + 데이터 보존(soft, staff.active=false, 기존 경로 재사용).
 *   · 삭제   = 참조 census(예약·수납·차트·시술 처리자 축) 0건인 테스트/미사용 계정만 hard-delete.
 *             1건이라도 있으면 삭제 차단 → '비활성' 안내.
 *
 * census 축(모두 prod 실재 확인): staffDeletion.STAFF_REF_PROBES
 *   check_ins.{consultant_id,therapist_id,technician_id,assigned_counselor_id} / check_in_services.seller_staff_id /
 *   package_sessions.performed_by / customers.{assigned_staff_id,designated_therapist_id,assigned_consultant_id} /
 *   reservations.preferred_therapist_id
 *
 * mechanism = app-level(순수 코드 + 읽기 census) → db_change=false (신규 컬럼/스키마 0, active 재사용).
 *   이 spec 은 삭제 판정·필터 빌드·FK 에러 분류·census 커버리지의 순수 로직 검증(page/auth/server 불요).
 *
 * 검증축:
 *   (A) 삭제 판정 — 참조 0건 allow / 참조 있음 block(hitLabels 동반).
 *   (B) census 커버리지 — 태스크 명시 축(예약·수납·차트·시술 처리자) 전부 프로브에 포함.
 *   (C) .or() 필터 빌드 — 다중 컬럼 → PostgREST or 식 정합.
 *   (D) FK(23503) 백스톱 분류 — RESTRICT 축이 놓쳐도 DB 거부를 friendly 로 분류.
 */
import { test, expect } from '@playwright/test';
import {
  STAFF_REF_PROBES,
  buildStaffRefOrExpr,
  evaluateStaffDeletion,
  isForeignKeyError,
  type StaffRefCensus,
} from '../../src/lib/staffDeletion';

const mkCensus = (byTable: Record<string, number>): StaffRefCensus => {
  const hits: { label: string; count: number }[] = [];
  for (const p of STAFF_REF_PROBES) {
    const n = byTable[p.table] ?? 0;
    if (n > 0) hits.push({ label: p.label, count: n });
  }
  hits.sort((a, b) => b.count - a.count);
  return {
    total: Object.values(byTable).reduce((s, n) => s + n, 0),
    hitLabels: hits.map((h) => h.label),
    byTable,
  };
};

test.describe('T-20260814 STAFF-DEACTIVATE-DELETE-SPLIT — 삭제 판정', () => {
  // ── (A) 삭제 판정 ────────────────────────────────────────────
  test('A1: 참조 0건(테스트/미사용) → allow', () => {
    const v = evaluateStaffDeletion(mkCensus({}));
    expect(v.kind).toBe('allow');
  });

  test('A2: 예약 지정 참조 1건 → block + hitLabels', () => {
    const v = evaluateStaffDeletion(mkCensus({ reservations: 1 }));
    expect(v.kind).toBe('block');
    if (v.kind === 'block') {
      expect(v.total).toBe(1);
      expect(v.hitLabels).toContain('예약 지정');
    }
  });

  test('A3: 다축 참조 → total 합산 + hitLabels 건수 내림차순', () => {
    const v = evaluateStaffDeletion(mkCensus({ check_ins: 5, package_sessions: 2, customers: 9 }));
    expect(v.kind).toBe('block');
    if (v.kind === 'block') {
      expect(v.total).toBe(16);
      // 건수: customers(9) > check_ins(5) > package_sessions(2)
      expect(v.hitLabels[0]).toBe('담당 고객');
      expect(v.hitLabels).toEqual(['담당 고객', '방문·차트 처리', '패키지 시술']);
    }
  });

  test('A4: 참조 총합이 0 이면(모든 축 0) allow — 경계값', () => {
    const v = evaluateStaffDeletion(mkCensus({ check_ins: 0, customers: 0, reservations: 0 }));
    expect(v.kind).toBe('allow');
  });

  // ── (B) census 커버리지 — 태스크 명시 축 포함 ──────────────────
  test('B1: 예약 축 포함 (reservations.preferred_therapist_id)', () => {
    const t = STAFF_REF_PROBES.find((p) => p.table === 'reservations');
    expect(t).toBeTruthy();
    expect(t?.cols).toContain('preferred_therapist_id');
  });

  test('B2: 수납/판매 축 포함 (check_in_services.seller_staff_id)', () => {
    const t = STAFF_REF_PROBES.find((p) => p.table === 'check_in_services');
    expect(t?.cols).toContain('seller_staff_id');
  });

  test('B3: 차트/상담/시술 처리자 축 포함 (check_ins 4컬럼)', () => {
    const t = STAFF_REF_PROBES.find((p) => p.table === 'check_ins');
    expect(t?.cols).toEqual(
      expect.arrayContaining(['consultant_id', 'therapist_id', 'technician_id', 'assigned_counselor_id']),
    );
  });

  test('B4: 패키지 시술 차감 축 포함 (package_sessions.performed_by)', () => {
    const t = STAFF_REF_PROBES.find((p) => p.table === 'package_sessions');
    expect(t?.cols).toContain('performed_by');
  });

  test('B5: 담당 고객 축 포함 (customers 3컬럼)', () => {
    const t = STAFF_REF_PROBES.find((p) => p.table === 'customers');
    expect(t?.cols).toEqual(
      expect.arrayContaining(['assigned_staff_id', 'designated_therapist_id', 'assigned_consultant_id']),
    );
  });

  // ── (C) .or() 필터 빌드 ──────────────────────────────────────
  test('C1: 단일 컬럼 → 단일 eq 식', () => {
    expect(buildStaffRefOrExpr(['seller_staff_id'], 'S1')).toBe('seller_staff_id.eq.S1');
  });

  test('C2: 다중 컬럼 → 콤마 결합 or 식', () => {
    expect(buildStaffRefOrExpr(['a_id', 'b_id', 'c_id'], 'UUID-9')).toBe(
      'a_id.eq.UUID-9,b_id.eq.UUID-9,c_id.eq.UUID-9',
    );
  });

  test('C3: 모든 프로브가 유효한 or 식을 생성(빈 컬럼 없음)', () => {
    for (const p of STAFF_REF_PROBES) {
      expect(p.cols.length).toBeGreaterThan(0);
      const expr = buildStaffRefOrExpr(p.cols, 'X');
      expect(expr.split(',').length).toBe(p.cols.length);
      expect(expr).toContain('.eq.X');
    }
  });

  // ── (D) FK(23503) 백스톱 분류 ─────────────────────────────────
  test('D1: code=23503 → FK 위반으로 분류', () => {
    expect(isForeignKeyError({ code: '23503', message: 'whatever' })).toBe(true);
  });

  test('D2: message 에 foreign key 문구 → FK 위반으로 분류(code 부재 방어)', () => {
    expect(isForeignKeyError({ message: 'update or delete violates foreign key constraint' })).toBe(true);
  });

  test('D3: 일반 에러/누락 → FK 아님', () => {
    expect(isForeignKeyError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isForeignKeyError(null)).toBe(false);
    expect(isForeignKeyError(undefined)).toBe(false);
  });
});

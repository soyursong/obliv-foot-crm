/**
 * E2E spec — T-20260609-foot-DRUG-INSURANCE-GATE Phase1 (DECISION 2-B)
 * 약품 급여여부 처방 게이트(checkRxInsuranceGate) 순수 로직 회귀.
 *
 * 정책:
 *   - 차단상태(non_covered/deleted/criteria_changed) 약 → 처방 차단(allowed=false).
 *   - covered(급여) / NULL(미설정) → 통과(allowed=true, fail-open degrade).
 *   - 관리자 권한(admin/manager/director)은 차단상태도 override 가능(overridable=true) — "확인 후 해제".
 *   - 비-관리자(consultant/coordinator/therapist 등)는 override 불가(overridable=false) → 관리자 해제 필요.
 *   - prescription_code_id 기준만 매칭(금기증 게이트 AC-2 동일). 코드 없는(자유텍스트) 약은 게이트 대상 외.
 *
 * 본 spec 은 구현 정본 모듈(src/lib/prescriptionGate)을 직접 import 해 순수 게이트 회귀를 잡는다.
 * 적용 진입점(차트 addRxItems · 빠른처방 QuickRxBar · 진료패널 handleRxSetSelect)은
 * evaluateRxInsuranceGate(prescribableDrugs) 로 insurance_status 조회 후 이 단일 게이트를 경유한다.
 */
import { test, expect } from '@playwright/test';
import {
  checkRxInsuranceGate,
  isInsuranceBlockedStatus,
  canOverrideRxInsuranceGate,
  insuranceStatusLabel,
  rxInsuranceGateMessage,
  rxInsuranceOverrideConfirm,
  INSURANCE_BLOCKED_STATUSES,
  RX_INSURANCE_OVERRIDE_ROLES,
} from '../../src/lib/prescriptionGate';

// 픽스처 — insurance_status 부착 항목 ──────────────────────────────────────────
const COVERED = { name: '록소프로펜', prescription_code_id: 'rx-001', insurance_status: 'covered' };
const NON_COVERED = { name: '비급여연고', prescription_code_id: 'rx-002', insurance_status: 'non_covered' };
const DELETED = { name: '삭제된약', prescription_code_id: 'rx-003', insurance_status: 'deleted' };
const CRITERIA = { name: '기준변경약', prescription_code_id: 'rx-004', insurance_status: 'criteria_changed' };
const UNSET = { name: '미설정약', prescription_code_id: 'rx-005', insurance_status: null };
const FREETEXT = { name: '자유텍스트', prescription_code_id: null }; // insurance_status 필드 없음

const NON_ADMIN_ROLES = ['consultant', 'coordinator', 'therapist', 'technician', 'tm', 'staff'];

// ═══════════════════════════════════════════════════════════════════════════
// 1) 차단상태 판정 (covered/NULL 통과, 3종 차단)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('급여 차단상태 판정', () => {
  test('차단상태 집합 = non_covered/deleted/criteria_changed (3종)', () => {
    expect(INSURANCE_BLOCKED_STATUSES.has('non_covered')).toBe(true);
    expect(INSURANCE_BLOCKED_STATUSES.has('deleted')).toBe(true);
    expect(INSURANCE_BLOCKED_STATUSES.has('criteria_changed')).toBe(true);
    expect(INSURANCE_BLOCKED_STATUSES.size).toBe(3);
  });

  test('covered/NULL/미설정은 차단 아님(통과)', () => {
    expect(isInsuranceBlockedStatus('covered')).toBe(false);
    expect(isInsuranceBlockedStatus(null)).toBe(false);
    expect(isInsuranceBlockedStatus(undefined)).toBe(false);
    expect(isInsuranceBlockedStatus('')).toBe(false);
  });

  test('3종 차단상태는 isInsuranceBlockedStatus=true', () => {
    expect(isInsuranceBlockedStatus('non_covered')).toBe(true);
    expect(isInsuranceBlockedStatus('deleted')).toBe(true);
    expect(isInsuranceBlockedStatus('criteria_changed')).toBe(true);
  });

  test('알 수 없는 상태값은 차단 아님(보수적 통과 — fail-open degrade)', () => {
    expect(isInsuranceBlockedStatus('unknown_status')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) 비-관리자 — 차단상태 약 처방 차단(override 불가)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('비-관리자 차단', () => {
  for (const role of NON_ADMIN_ROLES) {
    test(`${role}: non_covered 약 차단(overridable=false)`, () => {
      const r = checkRxInsuranceGate(role, [NON_COVERED]);
      expect(r.allowed).toBe(false);
      expect(r.overridable).toBe(false);
      expect(r.blocked.map((b) => b.name)).toContain('비급여연고');
    });
  }

  test('consultant: deleted/criteria_changed 도 차단', () => {
    expect(checkRxInsuranceGate('consultant', [DELETED]).allowed).toBe(false);
    expect(checkRxInsuranceGate('consultant', [CRITERIA]).allowed).toBe(false);
  });

  test('covered/미설정 약은 비-관리자도 통과', () => {
    expect(checkRxInsuranceGate('consultant', [COVERED, UNSET]).allowed).toBe(true);
    expect(checkRxInsuranceGate('therapist', [COVERED]).blocked).toHaveLength(0);
  });

  test('코드+차단 혼합 시 전체 차단(차단상태 1건이라도 있으면)', () => {
    const r = checkRxInsuranceGate('consultant', [COVERED, DELETED]);
    expect(r.allowed).toBe(false);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].status).toBe('deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) 관리자 — 차단상태도 override 가능 (확인 후 해제)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('관리자 override', () => {
  for (const role of ['admin', 'manager', 'director']) {
    test(`${role}: canOverride=true`, () => {
      expect(canOverrideRxInsuranceGate(role)).toBe(true);
    });
    test(`${role}: 차단상태 약 — allowed=false 지만 overridable=true(해제 가능)`, () => {
      const r = checkRxInsuranceGate(role, [NON_COVERED, DELETED]);
      expect(r.allowed).toBe(false); // 순수 차단 판정은 role 무관
      expect(r.overridable).toBe(true); // 관리자는 확인 후 해제 가능
      expect(r.blocked).toHaveLength(2);
    });
  }

  test('override 가능 role 집합 = admin/manager/director', () => {
    expect(RX_INSURANCE_OVERRIDE_ROLES.has('admin')).toBe(true);
    expect(RX_INSURANCE_OVERRIDE_ROLES.has('manager')).toBe(true);
    expect(RX_INSURANCE_OVERRIDE_ROLES.has('director')).toBe(true);
    expect(RX_INSURANCE_OVERRIDE_ROLES.has('consultant')).toBe(false);
    expect(RX_INSURANCE_OVERRIDE_ROLES.has('vice_director')).toBe(false);
  });

  test('관리자라도 차단상태 약이 없으면 allowed=true', () => {
    expect(checkRxInsuranceGate('admin', [COVERED, UNSET]).allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) 코드 없는(자유텍스트) 약 — 게이트 대상 외
// ═══════════════════════════════════════════════════════════════════════════
test.describe('자유텍스트 제외 / 회귀', () => {
  test('insurance_status 없는 자유텍스트는 차단 안 됨', () => {
    expect(checkRxInsuranceGate('consultant', [FREETEXT]).allowed).toBe(true);
  });

  test('빈 배열 통과', () => {
    expect(checkRxInsuranceGate('consultant', []).allowed).toBe(true);
  });

  test('게이트는 입력 배열을 변경하지 않음(순수 함수)', () => {
    const items = [COVERED, NON_COVERED];
    const snapshot = JSON.stringify(items);
    checkRxInsuranceGate('admin', items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  test('이름 없는 차단 약은 (이름 없음)으로 표기', () => {
    const r = checkRxInsuranceGate('consultant', [{ name: '', prescription_code_id: 'x', insurance_status: 'deleted' }]);
    expect(r.blocked[0].name).toBe('(이름 없음)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5) 라벨 / 안내문구
// ═══════════════════════════════════════════════════════════════════════════
test.describe('라벨·문구', () => {
  test('한국어 라벨 매핑', () => {
    expect(insuranceStatusLabel('covered')).toBe('급여');
    expect(insuranceStatusLabel('non_covered')).toBe('비급여');
    expect(insuranceStatusLabel('deleted')).toBe('급여 삭제');
    expect(insuranceStatusLabel('criteria_changed')).toBe('급여기준 변경');
    expect(insuranceStatusLabel(null)).toBe('미설정');
  });

  test('비-관리자 차단 안내에 약명+상태+관리자 해제 노출', () => {
    const r = checkRxInsuranceGate('consultant', [NON_COVERED]);
    const msg = rxInsuranceGateMessage(r.blocked);
    expect(msg).toContain('비급여연고');
    expect(msg).toContain('비급여');
    expect(msg).toContain('관리자 해제');
  });

  test('관리자 override 확인문구에 약명+상태 노출', () => {
    const r = checkRxInsuranceGate('admin', [DELETED]);
    const msg = rxInsuranceOverrideConfirm(r.blocked);
    expect(msg).toContain('삭제된약');
    expect(msg).toContain('급여 삭제');
    expect(msg).toContain('계속 진행');
  });

  test('차단 약 없으면 안내문구 빈 문자열', () => {
    expect(rxInsuranceGateMessage([])).toBe('');
  });
});

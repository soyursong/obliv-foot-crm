import { test, expect } from '@playwright/test';
import {
  PAYINFO_INACTIVE_MESSAGE,
  isPayInfoAvailable,
  payInfoButtonClass,
} from '../../src/lib/cband/payInfoView';

/**
 * T-20260813-foot-PAYINFO-CONFIRM-ROWGATE-VISUAL
 *   일마감 결제내역 [결제정보 확인] 컬럼 — ①활성행 시각 구분 + ②현금/기존카드 게이팅
 * ────────────────────────────────────────────────────────────────────────────
 * 부모: T-20260813-foot-PLANA-PAYINFO-CONFIRM-COLUMN (컬럼/모달 신규).
 *
 * 현장(최필경 총괄) 관찰: [결제정보 확인] 버튼이 '모든 행 같은 색' → 어느 행이 열리는지 구분 안 됨.
 *   옆 [단말기 취소 BETA]는 플랜A 행만 색 다름(활성=rose accent / 비활성=gray).
 *
 * 본 스펙(순수 로직 결정론 — supabase/auth/seed 비의존):
 *   시나리오 1: 활성(플랜A) 행만 색 구분 = payInfoButtonClass(active) 불변식.
 *   시나리오 2: 현금·기존카드 행 게이팅 = isPayInfoAvailable(false) → 비활성 클래스 + 안내 문구.
 *
 * 브라우저 실렌더(색상 픽셀) 검증은 물리 환경 필요 → 클래스 산출 SSOT(payInfoButtonClass)를
 *   결정론으로 고정한다. 실기기(갤탭) 현장 confirm 은 supervisor QA + 총괄 확인 게이트에서 수행.
 */

test.describe('시나리오 1: 활성행 시각 구분 (플랜A 행만 색 다름)', () => {
  test('활성(플랜A) 버튼 = 채도 accent + 상시 bg tint(chip) — 참조 컬럼 pop 등가', () => {
    const cls = payInfoButtonClass(true);
    // benign teal-emerald accent(참조 rose 를 조회 액션 의미로 매핑) + 상시 배경 tint 로 '색 다름' pop.
    expect(cls).toContain('text-teal-700');
    expect(cls).toContain('font-semibold');
    expect(cls).toContain('bg-teal-50'); // 상시 chip fill = 플랜A 행 확실 구분(text-only teal 실패 보정)
  });

  test('비활성 버튼 = gray + 배경 tint 없음(색 구분 축)', () => {
    const cls = payInfoButtonClass(false);
    expect(cls).toContain('text-gray-400');
    expect(cls).toContain('cursor-not-allowed');
    // 비활성엔 활성의 구분자(bg tint)가 없어야 '플랜A 행만 색 다름'이 성립.
    expect(cls).not.toContain('bg-teal-50');
    expect(cls).not.toContain('text-teal-700');
  });

  test('불변식 — 활성/비활성 클래스는 반드시 상이(모든 행 같은 색 금지)', () => {
    expect(payInfoButtonClass(true)).not.toBe(payInfoButtonClass(false));
    // 활성만 가진 배경 tint 토큰 존재(구분 근거) — 참조 [단말기 취소 BETA]와 동형(활성=accent, 비활성=gray).
    const activeHasTint = payInfoButtonClass(true).includes('bg-teal-50');
    const inactiveHasTint = payInfoButtonClass(false).includes('bg-teal-50');
    expect(activeHasTint && !inactiveHasTint).toBe(true);
  });

  test('색 구분 활성 조건 = 부모 축 동일(payment_attempt_id ∧ external_approval_no)', () => {
    // 활성 판별과 색 구분이 동일 축(VG-4)에서 갈림 — 색만 따로 놀지 않음.
    const planA = { payment_attempt_id: 'att-1', external_approval_no: '29258831' };
    expect(isPayInfoAvailable(planA)).toBe(true);
    // 활성 → 활성 클래스(색 구분 on).
    expect(payInfoButtonClass(isPayInfoAvailable(planA))).toContain('bg-teal-50');
  });
});

test.describe('시나리오 2: 현금·기존카드 게이팅 (모달 미오픈 + 안내 문구)', () => {
  test('현금/이체/기존카드 행 → 비활성(모달 미오픈 = disabled 버튼, onClick 미배선)', () => {
    // 비활성 판별 시 컴포넌트는 disabled 버튼(클릭 핸들러 없음) 렌더 → 모달 open 불가(게이팅).
    const cash = { payment_attempt_id: null, external_approval_no: null };
    const legacyCard = { payment_attempt_id: null, external_approval_no: '29258831' }; // attempt 없는 기존 카드
    expect(isPayInfoAvailable(cash)).toBe(false);
    expect(isPayInfoAvailable(legacyCard)).toBe(false);
    // 비활성 → 비활성(gray) 클래스 = 클릭해도 열리지 않는 상태 신호.
    expect(payInfoButtonClass(isPayInfoAvailable(cash))).toContain('cursor-not-allowed');
  });

  test('안내 문구 노출 — 현장 명시 문구 정확 일치', () => {
    // 비활성 행 tooltip/title/aria-label 로 노출되는 안내 문구.
    expect(PAYINFO_INACTIVE_MESSAGE).toBe('CRM 결제로 진행한 건만 확인할 수 있습니다');
  });

  test('경계 — external_approval_no 공백/부분충족은 비활성(게이팅 유지)', () => {
    expect(isPayInfoAvailable({ payment_attempt_id: 'att-1', external_approval_no: '   ' })).toBe(false);
    expect(isPayInfoAvailable({ payment_attempt_id: 'att-1', external_approval_no: null })).toBe(false);
  });
});

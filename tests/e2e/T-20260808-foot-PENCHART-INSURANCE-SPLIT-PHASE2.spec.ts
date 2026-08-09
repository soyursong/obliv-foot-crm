import { test, expect } from '@playwright/test';
import {
  isInsuranceSplitValid,
  isInsuranceSplitBothEntered,
  formatInsuranceSplit,
} from '../../src/lib/insuranceSessionSplit';

/**
 * T-20260808-foot-PENCHART-INSURANCE-SPLIT-PHASE2
 * packages 헤더 급여(가)/비급여(비) 회차 split (데이터 leg).
 *
 * 설계(DA PRIMARY A, da_decision_foot_penchart_autorecord_visitlog_2chart_20260809.md):
 *  - packages.covered_sessions / noncovered_sessions = nullable 헤더 컬럼(스태프 판매시 수동입력).
 *  - 표시 = 펜차트 '12회 (비11/가1)'. ⚠표시 leg 는 REWORK 편집형 폼(별 티켓)에 착지.
 *
 * HARD verify-gate:
 *  VG1(dispositive) package_sessions=per-deduction 생성 → 헤더 2컬럼 유일 canonical (census 확증).
 *  VG2 covered+noncovered=total 자기검증 + DB partial CHECK 동형(둘 중 NULL 이거나 합=total).
 *  VG3 firewall: 매출 split read-path 0 (본 spec 은 순수 회차 로직만 — 매출 무접점).
 *  VG4 nullable forward-only (미입력=NULL·기존행 backfill 0).
 *
 * 본 spec = VG2 자기검증 규칙 + 펜차트 표시 포맷의 순수 로직 커버(src/lib/insuranceSessionSplit.ts).
 */

// ── VG2: 자기검증(합=total) ──────────────────────────────────────────────
test('VG2 둘 다 입력 + 합=총회차 → 유효', () => {
  expect(isInsuranceSplitValid(1, 11, 12)).toBe(true);
  expect(isInsuranceSplitValid(0, 12, 12)).toBe(true);
  expect(isInsuranceSplitValid(6, 6, 12)).toBe(true);
});

test('VG2 둘 다 입력 + 합≠총회차 → 무효(submit 차단)', () => {
  expect(isInsuranceSplitValid(2, 11, 12)).toBe(false); // 합 13 ≠ 12
  expect(isInsuranceSplitValid(1, 1, 12)).toBe(false);  // 합 2 ≠ 12
  expect(isInsuranceSplitValid(5, 6, 12)).toBe(false);  // 합 11 ≠ 12
});

test('VG2/VG4 하나라도 미입력(null) → 미분류 → 유효(NULL 저장·기존행 무손상)', () => {
  expect(isInsuranceSplitValid(null, null, 12)).toBe(true); // 둘 다 미입력
  expect(isInsuranceSplitValid(3, null, 12)).toBe(true);    // 급여만
  expect(isInsuranceSplitValid(null, 9, 12)).toBe(true);    // 비급여만
});

test('isInsuranceSplitBothEntered — 합 검증 대상 판별', () => {
  expect(isInsuranceSplitBothEntered(1, 11)).toBe(true);
  expect(isInsuranceSplitBothEntered(0, 0)).toBe(true);
  expect(isInsuranceSplitBothEntered(1, null)).toBe(false);
  expect(isInsuranceSplitBothEntered(null, 11)).toBe(false);
  expect(isInsuranceSplitBothEntered(null, null)).toBe(false);
});

// ── 펜차트 표시 포맷 '12회 (비11/가1)' ────────────────────────────────────
test('표시 포맷 — 둘 다 입력 시 12회 (비11/가1)', () => {
  expect(formatInsuranceSplit(1, 11, 12)).toBe('12회 (비11/가1)');
  expect(formatInsuranceSplit(0, 12, 12)).toBe('12회 (비12/가0)');
  expect(formatInsuranceSplit(6, 4, 10)).toBe('10회 (비4/가6)');
});

test('표시 포맷 — 미분류(하나라도 null) → null(분해 표시 생략)', () => {
  expect(formatInsuranceSplit(null, null, 12)).toBeNull();
  expect(formatInsuranceSplit(1, null, 12)).toBeNull();
  expect(formatInsuranceSplit(null, 11, 12)).toBeNull();
});

// ── 회귀: total=1(단건 회수1 패키지) 경계 ─────────────────────────────────
test('경계 — 총 1회 패키지의 split', () => {
  expect(isInsuranceSplitValid(1, 0, 1)).toBe(true);
  expect(isInsuranceSplitValid(0, 1, 1)).toBe(true);
  expect(isInsuranceSplitValid(1, 1, 1)).toBe(false); // 합 2 ≠ 1
  expect(formatInsuranceSplit(1, 0, 1)).toBe('1회 (비0/가1)');
});

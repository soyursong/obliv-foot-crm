/**
 * E2E spec — T-20260603-foot-RX-CHART-FOLLOWUP2 #8-1b (role 게이트)
 *
 * ⚠️ SUPERSEDED 정책 반영: T-20260606-foot-RX-DRUG-WHITELIST (2026-06-15 대표원장 문지은 확정)
 *   #8-1b 의 "부원장(vice_director) 자유텍스트 차단"은 '등록약 스코프 미구현' 상태의 잠정 통제였다.
 *   이제 처방 가능 약 통제는 **검색 출처를 처방세트 등록약(services 처방약)으로 제한하는 화이트리스트**가
 *   **전직원 동일하게**(역할 분기 없음) 담당한다(AC-2). → 부원장 역할 분기는 retire.
 *
 * 신정책(전직원 동일):
 *   - 모든 role(부원장 포함)에 대해 checkRxRoleGate 는 항상 allowed=true(자유텍스트 약명 차단 없음).
 *   - isFreeTextRxBlockedRole 은 모든 role 에 대해 false(차단 대상 role 없음).
 *   - checkRxRoleGate/시그니처는 호출부 호환 위해 보존(항상 통과). 향후 차단 정책 부활 시 단일 지점.
 *
 * 본 spec 은 구현 정본 모듈(src/lib/prescriptionGate)을 직접 import 해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';
import {
  checkRxRoleGate,
  isFreeTextRxBlockedRole,
  VICE_DIRECTOR_ROLE,
} from '../../src/lib/prescriptionGate';

// 테스트 픽스처 ──────────────────────────────────────────────────────────────
const CODE_ITEM = { name: '아목시실린', prescription_code_id: 'rx-499-001' }; // 코드 보유 약
const CODE_ITEM_2 = { name: '세파클러', prescription_code_id: 'rx-499-002' };
const FREE_ITEM = { name: '자체조제 연고', prescription_code_id: null }; // 코드 없는 약(services 처방약 등)
const FREE_ITEM_UNDEF = { name: '임의 약' }; // code_id 필드 자체 없음

// ═══════════════════════════════════════════════════════════════════════════
// 1) 전직원 동일 — 모든 role 이 코드 유무와 무관하게 처방 추가 통과
// ═══════════════════════════════════════════════════════════════════════════
test.describe('RX-DRUG-WHITELIST 전직원 동일 — role 분기 없음', () => {
  for (const role of ['director', 'manager', 'admin', 'vice_director', 'nurse', 'therapist']) {
    test(`${role}: 코드 없는 약(services 처방약 등)도 처방 추가 허용`, () => {
      const r = checkRxRoleGate(role, [CODE_ITEM, FREE_ITEM, FREE_ITEM_UNDEF]);
      expect(r.allowed).toBe(true);
      expect(r.blockedNames).toHaveLength(0);
    });
    test(`${role}: 코드 보유 약도 당연히 허용`, () => {
      expect(checkRxRoleGate(role, [CODE_ITEM, CODE_ITEM_2]).allowed).toBe(true);
    });
    test(`${role}: isFreeTextRxBlockedRole=false (차단 대상 role 없음)`, () => {
      expect(isFreeTextRxBlockedRole(role)).toBe(false);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) 부원장(vice_director) 회귀 — 더 이상 차단되지 않음(supersession 핵심)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('vice_director 차단 retire (전직원 동일)', () => {
  test('코드 없는 약(services 처방약) 추가 — 부원장도 통과', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [FREE_ITEM]);
    expect(r.allowed).toBe(true);
    expect(r.blockedNames).toHaveLength(0);
  });

  test('code_id 필드 자체가 없어도 부원장 통과(undefined)', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, [FREE_ITEM_UNDEF]).allowed).toBe(true);
  });

  test('코드+코드없음 혼합도 부원장 통과', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, [CODE_ITEM, FREE_ITEM]).allowed).toBe(true);
  });

  test('isFreeTextRxBlockedRole(vice_director)=false (역할 분기 제거됨)', () => {
    expect(isFreeTextRxBlockedRole(VICE_DIRECTOR_ROLE)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) 회귀 — 미지정/불명 role 통과 + 순수 함수(부작용 없음) 유지
// ═══════════════════════════════════════════════════════════════════════════
test.describe('회귀 가드', () => {
  test('빈/null/undefined role 통과', () => {
    expect(checkRxRoleGate('', [FREE_ITEM]).allowed).toBe(true);
    expect(checkRxRoleGate(null, [FREE_ITEM]).allowed).toBe(true);
    expect(checkRxRoleGate(undefined, [FREE_ITEM]).allowed).toBe(true);
  });

  test('빈 항목 배열도 통과', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, []).allowed).toBe(true);
  });

  test('게이트는 입력 배열을 변경하지 않음(순수 함수)', () => {
    const items = [CODE_ITEM, FREE_ITEM];
    const snapshot = JSON.stringify(items);
    checkRxRoleGate(VICE_DIRECTOR_ROLE, items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

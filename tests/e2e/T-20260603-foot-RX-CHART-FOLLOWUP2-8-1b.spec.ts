/**
 * E2E spec — T-20260603-foot-RX-CHART-FOLLOWUP2 #8-1b
 * 부원장(vice_director) 처방 자유텍스트 차단 role 게이트.
 *
 * 정책(#8-1b):
 *   - vice_director 는 prescription_code_id 없는 "자유텍스트 임의입력" 처방 추가 금지.
 *   - director / manager / admin 은 자유텍스트 허용(종전 동작 유지).
 *   - official(보험등재 499) 코드는 항상 prescription_code_id 보유 → vice_director 도 정상 선택 가능.
 *     (8-1b 차단 대상은 "자유 약명 임의입력"이지 "코드 선택"이 아님 → 8-1 결정과 독립 선행.)
 *   - fail-closed: code_id 가 없으면(=확인 불가) vice_director 는 차단.
 *
 * 본 spec 은 구현 정본 모듈(src/lib/prescriptionGate)을 직접 import 해 회귀를 잡는다.
 * 적용 진입점(차트 addRxItems · 빠른처방 QuickRxBar · 처방세트 로드 · 처방 저장/확정)이
 * 모두 이 단일 게이트를 경유한다.
 */
import { test, expect } from '@playwright/test';
import {
  checkRxRoleGate,
  isFreeTextRxBlockedRole,
  rxRoleGateMessage,
  VICE_DIRECTOR_ROLE,
} from '../../src/lib/prescriptionGate';

// 테스트 픽스처 ──────────────────────────────────────────────────────────────
const CODE_ITEM = { name: '아목시실린', prescription_code_id: 'rx-499-001' }; // official 499 코드 선택
const CODE_ITEM_2 = { name: '세파클러', prescription_code_id: 'rx-499-002' };
const FREE_ITEM = { name: '자체조제 연고', prescription_code_id: null }; // 자유텍스트
const FREE_ITEM_UNDEF = { name: '임의 약' }; // code_id 필드 자체 없음

// ═══════════════════════════════════════════════════════════════════════════
// 1) 허용 role 통과 — director/manager/admin 은 자유텍스트도 통과
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#8-1b 허용 role 통과', () => {
  for (const role of ['director', 'manager', 'admin']) {
    test(`${role}: 자유텍스트 약도 처방 추가 허용`, () => {
      const r = checkRxRoleGate(role, [CODE_ITEM, FREE_ITEM, FREE_ITEM_UNDEF]);
      expect(r.allowed).toBe(true);
      expect(r.blockedNames).toHaveLength(0);
    });
    test(`${role}: 코드 처방도 당연히 허용`, () => {
      expect(checkRxRoleGate(role, [CODE_ITEM, CODE_ITEM_2]).allowed).toBe(true);
    });
    test(`${role}: isFreeTextRxBlockedRole=false`, () => {
      expect(isFreeTextRxBlockedRole(role)).toBe(false);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) vice_director 차단 — 자유텍스트는 막고, official 코드는 통과
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#8-1b vice_director 차단', () => {
  test('자유텍스트(code_id=null) 약 추가 차단', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [FREE_ITEM]);
    expect(r.allowed).toBe(false);
    expect(r.blockedNames).toContain('자체조제 연고');
  });

  test('code_id 필드 자체가 없어도 차단(undefined)', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [FREE_ITEM_UNDEF]);
    expect(r.allowed).toBe(false);
    expect(r.blockedNames).toContain('임의 약');
  });

  test('official 499 코드 선택은 통과(차단 대상 아님)', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [CODE_ITEM, CODE_ITEM_2]);
    expect(r.allowed).toBe(true);
    expect(r.blockedNames).toHaveLength(0);
  });

  test('코드+자유텍스트 혼합 시 전체 차단(자유텍스트 1건이라도 있으면)', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [CODE_ITEM, FREE_ITEM]);
    expect(r.allowed).toBe(false);
    expect(r.blockedNames).toEqual(['자체조제 연고']);
  });

  test('isFreeTextRxBlockedRole(vice_director)=true', () => {
    expect(isFreeTextRxBlockedRole(VICE_DIRECTOR_ROLE)).toBe(true);
  });

  test('차단 안내 문구에 약 이름 노출', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [FREE_ITEM]);
    const msg = rxRoleGateMessage(r.blockedNames);
    expect(msg).toContain('부원장');
    expect(msg).toContain('약품 검색');
    expect(msg).toContain('자체조제 연고');
  });

  test('이름 없는 자유텍스트는 (이름 없음)으로 표기', () => {
    const r = checkRxRoleGate(VICE_DIRECTOR_ROLE, [{ name: '', prescription_code_id: null }]);
    expect(r.allowed).toBe(false);
    expect(r.blockedNames).toContain('(이름 없음)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) fail-closed — 빈 문자열 code_id / 공백도 "코드 없음"으로 간주해 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#8-1b fail-closed', () => {
  test('빈 문자열 code_id 는 자유텍스트로 간주 → vice_director 차단', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, [{ name: 'x', prescription_code_id: '' }]).allowed).toBe(false);
  });

  test('공백 code_id 도 차단', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, [{ name: 'x', prescription_code_id: '   ' }]).allowed).toBe(false);
  });

  test('빈 항목 배열은 통과(추가할 게 없음)', () => {
    expect(checkRxRoleGate(VICE_DIRECTOR_ROLE, []).allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) 회귀 — 미지정/불명 role 은 게이트 비적용(기존 동작 보존), 게이트는 부작용 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('#8-1b 회귀 가드', () => {
  test('빈/null/undefined role 은 게이트 미적용(자유텍스트 통과)', () => {
    expect(checkRxRoleGate('', [FREE_ITEM]).allowed).toBe(true);
    expect(checkRxRoleGate(null, [FREE_ITEM]).allowed).toBe(true);
    expect(checkRxRoleGate(undefined, [FREE_ITEM]).allowed).toBe(true);
  });

  test('director 회귀 — 8-2 처방세트 관리 권한 집합(director/manager/admin)과 무충돌', () => {
    // 8-1b 는 8-2(관리 권한)와 직교: 허용 role 은 동일 집합이지만 vice_director 만 추가 차단.
    expect(isFreeTextRxBlockedRole('director')).toBe(false);
    expect(isFreeTextRxBlockedRole('manager')).toBe(false);
    expect(isFreeTextRxBlockedRole('admin')).toBe(false);
    expect(isFreeTextRxBlockedRole('vice_director')).toBe(true);
  });

  test('게이트는 입력 배열을 변경하지 않음(순수 함수)', () => {
    const items = [CODE_ITEM, FREE_ITEM];
    const snapshot = JSON.stringify(items);
    checkRxRoleGate(VICE_DIRECTOR_ROLE, items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

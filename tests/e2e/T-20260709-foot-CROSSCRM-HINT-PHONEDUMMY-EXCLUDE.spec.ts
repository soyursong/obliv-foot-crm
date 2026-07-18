import { test, expect } from '@playwright/test';
import {
  PLACEHOLDER_PHONE_SET,
  isPlaceholderPhoneValue,
  isHintExcluded,
  filterHintCandidates,
  HINT_ELIGIBLE_SQL_PREDICATE,
} from '@/lib/crossCrmHintExclusion';

// ─────────────────────────────────────────────────────────────────────────────
// T-20260709-foot-CROSSCRM-HINT-PHONEDUMMY-EXCLUDE
//   cross-CRM 다지점 인지 hint 제외술어 선반영(각인) 스모크.
//   hint UI 는 아직 code 0 → 순수-로직 스모크(브라우저/DB 무접점). hint UI 동반 시
//   현장 클릭 시나리오(phone 입력→hint 노출)를 별도 추가하며 이 파일을 확장한다.
//
//   AC: `DUMMY-<uuid>` 무전화 워크인 시드 → hint 매칭 결과에 미포함 (false-hint 0).
// ─────────────────────────────────────────────────────────────────────────────

test.describe('cross-CRM hint placeholder 제외술어 (§68/§69 canonical)', () => {
  test('값-술어: DUMMY-<uuid> 무전화 워크인은 placeholder 로 제외', () => {
    expect(isPlaceholderPhoneValue('DUMMY-3f2a9c7e-4b1d-4a2e-9f8c-0a1b2c3d4e5f')).toBe(true);
    expect(isPlaceholderPhoneValue('DUMMY-')).toBe(true);
  });

  test('값-술어: 동행 기본값/raw 변형/all-zero/미상 전부 제외', () => {
    for (const v of [
      '+821000000000', // canonical 동행 기본값
      '01000000000', // raw 변형
      '010-0000-0000', // 하이픈 raw 변형
      '+8210-0000-0000',
      '+821011111111', // all-same-subscriber (regex)
      '00000000', // all-zero
      'UNKNOWN',
      '', // 빈문자
      '   ', // 공백-only
    ]) {
      expect(isPlaceholderPhoneValue(v), `"${v}" 는 placeholder 여야 함`).toBe(true);
    }
    // NULL/undefined 도 placeholder(전화 아님)
    expect(isPlaceholderPhoneValue(null)).toBe(true);
    expect(isPlaceholderPhoneValue(undefined)).toBe(true);
  });

  test('값-술어: 진성 번호는 제외되지 않음 (다지점 hint 후보 유지)', () => {
    for (const v of ['+821012345678', '+821023456789']) {
      expect(isPlaceholderPhoneValue(v), `"${v}" 는 진성 번호`).toBe(false);
    }
  });

  test('canonical 제외술어 = 플래그 OR 값', () => {
    // 플래그-술어: phone_dummy=true 면 진성 형태 phone 이어도 제외
    expect(isHintExcluded({ phone: '+821012345678', phone_dummy: true })).toBe(true);
    // 값-술어: 플래그 미설정(false/누락)이어도 값이 placeholder 면 제외 (값-영속 경로 방어)
    expect(isHintExcluded({ phone: '+821000000000', phone_dummy: false })).toBe(true);
    expect(isHintExcluded({ phone: 'DUMMY-abc', phone_dummy: null })).toBe(true);
    expect(isHintExcluded({ phone: '+821000000000' })).toBe(true);
    // 포함: 플래그 clean + 값 진성 → hint 후보
    expect(isHintExcluded({ phone: '+821012345678', phone_dummy: false })).toBe(false);
    expect(isHintExcluded({ phone: '+821012345678' })).toBe(false);
  });

  test('false-hint 0: DUMMY 워크인 시드가 매칭 후보에서 미포함', () => {
    // "다지점 매칭 후보" 모집단 시드 — 진성 2 + 더미/placeholder 다수
    const candidates = [
      { id: 'real-1', phone: '+821012345678', phone_dummy: false },
      { id: 'walkin-dummy', phone: 'DUMMY-3f2a9c7e-4b1d-4a2e-9f8c-0a1b2c3d4e5f', phone_dummy: true },
      { id: 'companion-placeholder', phone: '+821000000000', phone_dummy: false }, // 플래그 안 붙은 값-영속
      { id: 'real-2', phone: '+821023456789', phone_dummy: false },
      { id: 'raw-variant', phone: '010-0000-0000', phone_dummy: false },
      { id: 'empty', phone: '', phone_dummy: false },
    ];

    const eligible = filterHintCandidates(candidates);
    const ids = eligible.map((c) => c.id).sort();

    // 진성 2건만 남고 더미/placeholder 전량 배제 → false-hint 0
    expect(ids).toEqual(['real-1', 'real-2']);
  });

  test('SQL 술어에 flag+DUMMY+리터럴집합+regex 4축이 모두 각인됨', () => {
    expect(HINT_ELIGIBLE_SQL_PREDICATE).toContain('phone_dummy IS NULL OR phone_dummy = false');
    expect(HINT_ELIGIBLE_SQL_PREDICATE).toContain("phone NOT LIKE 'DUMMY-%'");
    expect(HINT_ELIGIBLE_SQL_PREDICATE).toContain("'+821000000000'");
    expect(HINT_ELIGIBLE_SQL_PREDICATE).toContain('1[016789]'); // all-same-subscriber regex
    // 값-집합의 전 리터럴이 SQL enumeration 에 반영
    for (const v of PLACEHOLDER_PHONE_SET) {
      expect(HINT_ELIGIBLE_SQL_PREDICATE).toContain(`'${v}'`);
    }
  });
});

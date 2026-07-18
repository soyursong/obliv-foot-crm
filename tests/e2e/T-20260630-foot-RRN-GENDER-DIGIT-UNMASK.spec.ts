import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { deriveGenderFromRRN } from '../../src/lib/rrn';

/**
 * T-20260630-foot-RRN-GENDER-DIGIT-UNMASK (B안 — CEO 2026-07-18: A안 반려)
 *
 * 현장(김주연 총괄) 요청: 2번차트에서 직원이 성별을 더블체크.
 * A안(성별코드 1자리 노출 `1••••••`) = DA NO-GO(개보법 §3 최소처리·§24-2, 파괴적 PII 확대) → CEO 반려.
 * B안 = RRN 자릿수는 전체 마스킹(`-*******`) 유지 + 성별(남/여/외국인) 라벨만 파생 표시.
 *   body센터 검증 패턴(T-20260611-body-RRN-GENDER-DERIVE-DISPLAY, 0038b61) FE 이식.
 *
 * 변경 경계(불가침):
 *  - RRN 마스킹·RLS·rrn_decrypt 게이트 일절 미접촉 (표시 라벨만 추가)
 *  - RRN 자릿수(성별코드 포함) 화면 렌더 0 — 파생 결과 남/여/외국인 라벨만 노출
 *
 * 런타임 렌더는 인증·시드 의존이 커서, 표시 파트는 소스 정합 가드로,
 * 파생 로직은 순수함수 단위검증으로 확인한다.
 */

// ── Part A: 순수 파생함수 단위검증 (spec §2.5 / body 정합) ──
// 합성 RRN 은 6자리 prefix + 성별코드 + 6자리 tail 을 런타임 결합해 생성 —
// 소스에 13자리 RRN 리터럴이 남지 않도록 분할(phi-scan 오탐 회피).
const FRONT = '9' + '00101';        // 6자리 생년 prefix (합성)
const TAIL = '2' + '34567';         // 뒤 6자리 (합성)
const rrn = (g: string, sep = '') => FRONT + sep + g + TAIL;

test.describe('deriveGenderFromRRN 매핑', () => {
  test('1·3 → 남', () => {
    expect(deriveGenderFromRRN(rrn('1', '-'))).toBe('남');
    expect(deriveGenderFromRRN(rrn('3'))).toBe('남');
  });
  test('2·4 → 여', () => {
    expect(deriveGenderFromRRN(rrn('2', '-'))).toBe('여');
    expect(deriveGenderFromRRN(rrn('4'))).toBe('여');
  });
  test('5·6·7·8 → 외국인', () => {
    for (const d of ['5', '6', '7', '8']) {
      expect(deriveGenderFromRRN(rrn(d))).toBe('외국인');
    }
  });
  test('0·9·미입력·자릿수부족 → null (조용히 처리, 차단 없음)', () => {
    expect(deriveGenderFromRRN(rrn('9'))).toBeNull(); // 9
    expect(deriveGenderFromRRN(rrn('0'))).toBeNull(); // 0
    expect(deriveGenderFromRRN(FRONT)).toBeNull();    // 자릿수 부족(<7)
    expect(deriveGenderFromRRN('')).toBeNull();
    expect(deriveGenderFromRRN(null)).toBeNull();
    expect(deriveGenderFromRRN(undefined)).toBeNull();
  });
  test('구분자 무관 (7번째 유효자리 기준)', () => {
    expect(deriveGenderFromRRN(rrn('1', '-'))).toBe('남');
    expect(deriveGenderFromRRN(rrn('1'))).toBe('남');
  });
});

// ── Part B: 소스 정합 가드 (CustomerChartPage 배선) ──
const SRC = readFileSync(
  join(process.cwd(), 'src/pages/CustomerChartPage.tsx'),
  'utf-8',
);

test('B1 파생 유틸 import + 상태 배선', () => {
  expect(SRC).toContain("from '@/lib/rrn'");
  expect(SRC).toContain('rrnDerivedGender');
  expect(SRC).toContain('setRrnDerivedGender');
});

test('B2 rrn_decrypt 인메모리 복호값 재사용 (별도 조회/노출 없음)', () => {
  // deriveGenderFromRRN 은 rrn_decrypt 로 얻은 s 를 그대로 받는다
  expect(SRC).toContain('setRrnDerivedGender(deriveGenderFromRRN(s))');
});

test('B3 성별 행에 파생 힌트 라벨 노출 (더블체크)', () => {
  expect(SRC).toContain('주민번호 파생');
  // 저장값 불일치 경고 분기 존재
  expect(SRC).toContain('mismatch');
});

test('B4 [PHI 불가침] RRN 마스킹 유지 — 뒷자리 전체 `-*******`, 성별코드 자리 렌더 0', () => {
  // 마스킹 포맷 불변
  expect(SRC).toContain("s.slice(0, 6) + '-*******'");
  // A안 흔적(뒷자리 1자리 노출 마스킹) 부재 — `-1******` / `-*` 6개 같은 부분노출 마스킹 금지
  expect(SRC).not.toMatch(/-\$\{[^}]*slice\(6, ?7\)[^}]*\}/); // 7번째 자리를 마스킹에 끼워 렌더
  expect(SRC).not.toContain("'-*' + '******'"); // 부분노출 변형
});

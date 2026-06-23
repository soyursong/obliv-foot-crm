/**
 * Unit spec — T-20260623-foot-DOCGEN-CONTRAIND-COMBINE (Phase 1a 엔진 선착수)
 *
 * 대상: src/lib/contraindicationCombine.ts 순수 함수 엔진
 *   - combineDiagnoses(selectedKeys, templates) : 금기증 복수선택 조합 (MD §3)
 *   - substituteHepatitisType(text, type)       : 간염 B(C) → B형/C형 전체 치환 (MD §2-2)
 *
 * 픽스처는 CSV(`서류상용구_양식_20260623.csv`) 미수신 상태에서 MD 예시 문자열을 인라인으로
 *   구성한다(CSV 불요). 엔진 계약 `(keys)→string` 검증 — CSV 도착 시 템플릿 상수만 결선.
 *
 * auth/page 미사용 순수 함수 테스트 → playwright.config.ts `unit` 프로젝트에 등록.
 *
 * AC-1 0개 → '' / 1개 → 원문 그대로(가공 없음)
 * AC-2 MD §3-3 워크드 예시(고지혈증+위장장애+혈압약) 1:1 — 첫(마지막문장제거)·중간(양끝제거+또한)·마지막(첫문장제거+또한+향후유지)
 * AC-3 입력 순서 무관 — 우선순위(priority) 오름차순 정렬
 * AC-4 2개 경계 — 중간 항목 없이 첫+마지막만
 * AC-5 B(C) 전체 치환(모든 위치) + 조합 前 적용 시 잔존 0
 */
import { test, expect } from '@playwright/test';
import {
  combineDiagnoses,
  substituteHepatitisType,
  CONTRAIND_LAST_SENTENCE,
  CONTRAIND_PRIORITY,
  type ContraindTemplate,
} from '../../src/lib/contraindicationCombine';

// ─────────────────────────────────────────────────────────────────────────────
// 인라인 픽스처 — MD §3 예시 형태(마지막 문장은 `\n`으로 이어지는 패턴) 재현.
// CSV 도착 전이므로 의학 문구는 알고리즘 검증용 대표 문자열.
// ─────────────────────────────────────────────────────────────────────────────
const LAST = CONTRAIND_LAST_SENTENCE; // '향후 12-15개월간 외래 추시 및 반복적 보존적 치료를 요함.'

const BODY_고지혈증 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 고지혈증 약을 복용중으로 내원하심. ' +
  '레이저 치료와 도포제 치료의 병행이 필요할 것으로 보임.\n' +
  LAST;

const BODY_위장장애 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 위장장애로 내원하심. ' +
  '환자는 현재 만성적인 위장관 질환으로 약물 복용에 주의가 필요할 것으로 보임.\n' +
  LAST;

const BODY_혈압약 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 고혈압으로 내원하심. ' +
  '환자는 현재 고혈압 치료를 위해 혈압약을 복용중으로 보임.\n' +
  LAST;

const TEMPLATES: Record<string, ContraindTemplate> = {
  고지혈증: { key: '고지혈증', priority: 1, body: BODY_고지혈증 },
  위장장애: { key: '위장장애', priority: 2, body: BODY_위장장애 },
  혈압약: { key: '혈압약', priority: 3, body: BODY_혈압약 },
};

// 가공 단편(독립 오라클) — 함수를 거치지 않고 손으로 계산한 기대값 구성요소
const 고지혈증_첫 =
  '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 고지혈증 약을 복용중으로 내원하심. ' +
  '레이저 치료와 도포제 치료의 병행이 필요할 것으로 보임.';
const 위장장애_중간 =
  '또한 환자는 현재 만성적인 위장관 질환으로 약물 복용에 주의가 필요할 것으로 보임.';
const 혈압약_마지막 =
  '또한 환자는 현재 고혈압 치료를 위해 혈압약을 복용중으로 보임.\n' + LAST;
const 위장장애_마지막 =
  '또한 환자는 현재 만성적인 위장관 질환으로 약물 복용에 주의가 필요할 것으로 보임.\n' + LAST;

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 경계 0개 / 1개
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1a: 선택 0개 → 빈 문자열', () => {
  expect(combineDiagnoses([], TEMPLATES)).toBe('');
});

test('AC-1b: 선택 1개 → 원문 그대로(가공 없음, 향후문장 포함)', () => {
  expect(combineDiagnoses(['고지혈증'], TEMPLATES)).toBe(BODY_고지혈증);
  // 단일 선택은 마지막 문장도 그대로 유지되어야 한다
  expect(combineDiagnoses(['고지혈증'], TEMPLATES).endsWith(LAST)).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: MD §3-3 워크드 예시 (3개 선택) 1:1
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 고지혈증+위장장애+혈압약 → 첫/중간/마지막 가공 + 공백1칸 결합', () => {
  const expected = `${고지혈증_첫} ${위장장애_중간} ${혈압약_마지막}`;
  expect(combineDiagnoses(['고지혈증', '위장장애', '혈압약'], TEMPLATES)).toBe(expected);

  const result = combineDiagnoses(['고지혈증', '위장장애', '혈압약'], TEMPLATES);
  // 첫 항목은 향후문장 제거 → 결과 중간에 LAST 가 단 1회(마지막 항목)만 등장
  expect(result.split(LAST).length - 1).toBe(1);
  // 중간/마지막 항목은 '또한 '으로 시작하는 절을 가진다 (도입부 중복 제거 확인)
  expect(result.includes(' 또한 환자는 현재 만성적인 위장관')).toBe(true);
  expect(result.includes(' 또한 환자는 현재 고혈압 치료를 위해')).toBe(true);
  // 마지막 항목만 향후문장 보존
  expect(result.endsWith(LAST)).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 입력 순서 무관 — 우선순위 오름차순 정렬
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 입력 순서 뒤섞여도 우선순위(1<2<3) 정렬 결과 동일', () => {
  const canonical = combineDiagnoses(['고지혈증', '위장장애', '혈압약'], TEMPLATES);
  expect(combineDiagnoses(['혈압약', '고지혈증', '위장장애'], TEMPLATES)).toBe(canonical);
  expect(combineDiagnoses(['위장장애', '혈압약', '고지혈증'], TEMPLATES)).toBe(canonical);
});

test('AC-3b: MD §4 우선순위표 정합 — 고지혈증<위장장애<혈압약', () => {
  expect(CONTRAIND_PRIORITY['고지혈증']).toBe(1);
  expect(CONTRAIND_PRIORITY['위장장애']).toBe(2);
  expect(CONTRAIND_PRIORITY['혈압약']).toBe(3);
  expect(Object.keys(CONTRAIND_PRIORITY).length).toBe(24);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 2개 경계 — 중간 항목 없음 (첫 + 마지막)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 2개 선택 → 첫(향후제거) + 마지막(첫문장제거+또한+향후유지)', () => {
  const expected = `${고지혈증_첫} ${위장장애_마지막}`;
  expect(combineDiagnoses(['고지혈증', '위장장애'], TEMPLATES)).toBe(expected);
  // 2개일 때도 향후문장은 마지막 1회만
  const result = combineDiagnoses(['위장장애', '고지혈증'], TEMPLATES);
  expect(result.split(LAST).length - 1).toBe(1);
  expect(result.endsWith(LAST)).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: 간염 B(C) → B형/C형 전체 치환 (MD §2-2) + 조합 前 적용
// ─────────────────────────────────────────────────────────────────────────────
const BODY_간염 =
  'B(C)형 간염 바이러스 보균자로 항진균제 복용에 주의가 필요하며, ' +
  'B(C)형 보균 상태가 지속됨.\n' +
  LAST;

test('AC-5a: B(C) → C형 전체 치환(모든 위치)', () => {
  const c = substituteHepatitisType(BODY_간염, 'C');
  expect(c.includes('B(C)')).toBe(false);
  expect(c.startsWith('C형 간염 바이러스 보균자로')).toBe(true);
  // 두 위치 모두 치환
  expect((c.match(/C형/g) || []).length).toBe(2);
});

test('AC-5b: B(C) → B형 전체 치환', () => {
  const b = substituteHepatitisType(BODY_간염, 'B');
  expect(b.includes('B(C)')).toBe(false);
  expect(b.startsWith('B형 간염 바이러스 보균자로')).toBe(true);
  expect((b.match(/B형/g) || []).length).toBe(2);
});

test('AC-5c: 치환은 조합 前 — 치환 후 조합 결과에 B(C) 잔존 0', () => {
  // 조합용 간염 원문(문장 구분 `. ` 포함 → 마지막 항목 첫문장 제거가 의미 있게 동작)
  const BODY_간염_COMBINE =
    '상기환자는 상기증상 및 병명으로 [날짜]에 내원하였고 B(C)형 간염 바이러스 보균자로 내원하심. ' +
    '환자는 B(C)형 보균 상태로 항진균제 복용에 주의가 필요할 것으로 보임.\n' +
    LAST;
  const tpls: Record<string, ContraindTemplate> = {
    고지혈증: TEMPLATES['고지혈증'],
    // 간염보균자 원문을 조합 前 C형으로 치환하여 결선
    간염보균자: {
      key: '간염보균자',
      priority: CONTRAIND_PRIORITY['간염보균자'],
      body: substituteHepatitisType(BODY_간염_COMBINE, 'C'),
    },
  };
  const result = combineDiagnoses(['고지혈증', '간염보균자'], tpls);
  expect(result.includes('B(C)')).toBe(false);
  expect(result.includes('C형 보균 상태로')).toBe(true);
  expect(result.endsWith(LAST)).toBe(true);
});

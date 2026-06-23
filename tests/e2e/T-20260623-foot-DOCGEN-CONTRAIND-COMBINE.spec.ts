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
  buildContraindTemplates,
  normalizeContraindLabel,
  CONTRAIND_LAST_SENTENCE,
  CONTRAIND_PRIORITY,
  type ContraindTemplate,
  type OpinionSourceSection,
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

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: 데이터소스 결선 — buildContraindTemplates (결정②/옵션B, MSG-6e2x)
//   form_templates(opinion_doc).field_map.sections → 엔진 템플릿 맵.
//   키 공간 브리지: option.key(영문) ↔ CONTRAIND_PRIORITY(무공백 한국어)는 라벨로 연결.
// ─────────────────────────────────────────────────────────────────────────────

// 실제 OPINION_SECTIONS(form_templates opinion_doc 폴백)의 금기증 24종 라벨 — 키 브리지 정합 검증용.
// (OpinionDocTab.tsx OPINION_SECTIONS 금기증 라벨 1:1 미러. 라벨 변경 시 본 배열도 동기화.)
const 금기증_24_LABELS: ReadonlyArray<string> = [
  '고지혈증', '위장장애', '경구약 효과미비', '경구약복용후 위장장애', '혈압약', '심혈관약',
  '간질환', '간염보균자', '신장질환', '통풍약', '갑상선약', '남성 탈모약', '여성 탈모약',
  '항정신과약', '항암중', '항암 후 추적', '임신준비중', '임신중', '수유중', '파일럿',
  '운전기사', '면역질환', '당뇨', '소아',
];

test('AC-6a: normalizeContraindLabel — 공백 제거(우선순위표 키 공간 정합)', () => {
  expect(normalizeContraindLabel('경구약복용후 위장장애')).toBe('경구약복용후위장장애');
  expect(normalizeContraindLabel('항암 후 추적')).toBe('항암후추적');
  expect(normalizeContraindLabel('남성 탈모약')).toBe('남성탈모약');
  expect(normalizeContraindLabel('고지혈증')).toBe('고지혈증');
});

test('AC-6b: 금기증 24종 라벨 전부 우선순위표(1~24)에 매핑(누락 0)', () => {
  // 라벨 브리지가 깨지면(공백/오타) priority 가 fallback 으로 떨어져 조합 정렬이 망가진다.
  const unmapped = 금기증_24_LABELS.filter(
    (label) => CONTRAIND_PRIORITY[normalizeContraindLabel(label)] === undefined,
  );
  expect(unmapped).toEqual([]);
  expect(금기증_24_LABELS.length).toBe(24);
});

test('AC-6c: buildContraindTemplates — sections → key(영문)→{priority,body} 맵', () => {
  const sections: OpinionSourceSection[] = [
    {
      title: '진단서',
      // 우선순위표 미등재(단일선택) → fallback priority(1000+), 정렬 영향 최소
      options: [
        { key: 'oral_o', label: '경구약 O', phrase: '경구약 복용이 가능한 상태로 확인됩니다.' },
        { key: 'oral_x', label: '경구약 X', phrase: '경구약 복용이 어려운 상태로 확인됩니다.' },
      ],
    },
    {
      title: '금기증',
      options: [
        { key: 'hyperlipidemia', label: '고지혈증', phrase: BODY_고지혈증 },
        { key: 'gi_disorder', label: '위장장애', phrase: BODY_위장장애 },
        { key: 'bp_med', label: '혈압약', phrase: BODY_혈압약 },
        // 공백 포함 라벨도 정규화로 우선순위 매핑되는지
        { key: 'gi_after_oral', label: '경구약복용후 위장장애', phrase: '경구약 복용 후 위장장애.' },
      ],
    },
  ];
  const map = buildContraindTemplates(sections);

  // map 은 option.key(영문)로 키잉 — UI selectedKeys 와 동일 공간
  expect(map['hyperlipidemia'].priority).toBe(CONTRAIND_PRIORITY['고지혈증']); // 1
  expect(map['gi_disorder'].priority).toBe(CONTRAIND_PRIORITY['위장장애']); // 2
  expect(map['bp_med'].priority).toBe(CONTRAIND_PRIORITY['혈압약']); // 3
  expect(map['gi_after_oral'].priority).toBe(CONTRAIND_PRIORITY['경구약복용후위장장애']); // 13
  // body = phrase 원문 그대로
  expect(map['hyperlipidemia'].body).toBe(BODY_고지혈증);
  // 진단서 단일선택 옵션은 fallback priority(>=1000)
  expect(map['oral_o'].priority).toBeGreaterThanOrEqual(1000);
  expect(map['oral_x'].priority).toBeGreaterThanOrEqual(1000);
});

test('AC-6d: 결선 맵으로 combineDiagnoses 정상 동작 — rework 0 (계약 고정)', () => {
  const sections: OpinionSourceSection[] = [
    {
      title: '금기증',
      options: [
        // 입력 순서를 우선순위와 뒤바꿔도 정렬되어야 함
        { key: 'bp_med', label: '혈압약', phrase: BODY_혈압약 },
        { key: 'hyperlipidemia', label: '고지혈증', phrase: BODY_고지혈증 },
        { key: 'gi_disorder', label: '위장장애', phrase: BODY_위장장애 },
      ],
    },
  ];
  const map = buildContraindTemplates(sections);
  // option.key(영문)로 선택 — Phase 1a 워크드 예시와 동일 결과(우선순위 1<2<3 정렬)
  const result = combineDiagnoses(['bp_med', 'hyperlipidemia', 'gi_disorder'], map);
  const expected = `${고지혈증_첫} ${위장장애_중간} ${혈압약_마지막}`;
  expect(result).toBe(expected);
  expect(result.split(LAST).length - 1).toBe(1); // 향후문장 1회만
});

test('AC-6e: empty-safe — null/빈 sections → 빈 맵', () => {
  expect(buildContraindTemplates(null)).toEqual({});
  expect(buildContraindTemplates(undefined)).toEqual({});
  expect(buildContraindTemplates([])).toEqual({});
  // 옵션 없는 섹션도 스킵
  expect(buildContraindTemplates([{ title: '금기증', options: [] }])).toEqual({});
});

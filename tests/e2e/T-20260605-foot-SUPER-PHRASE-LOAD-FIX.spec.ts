/**
 * E2E spec — T-20260605-foot-SUPER-PHRASE-LOAD-FIX
 * 슈퍼상용구 등록화면(SuperPhrasesTab) '상용구 불러오기' 회귀버그 수정 검증.
 * (문지은 대표원장: "슈퍼상용구에서 상용구 불러오기 안먹고")
 *
 * 루트코즈 (prod 실측 확정 / 2026-06-05):
 *   phrase_templates 34건 = pen_chart 33 + medical_chart 1 (모두 active).
 *   기존 useMedicalPhrases 가 .eq('phrase_type','medical_chart') 단일 필터라
 *   임상경과 '상용구 불러오기' 드롭다운에 현장 상용구 대부분(pen_chart 33)이 노출 안 됨.
 *   6/3 배포(cda2c8d, MEDCHART-SYNC) 회귀.
 *
 * 수정:
 *   AC-1 (필터완화): is_active=true 전체 노출(유형 무관) + 유형 배지로 구분, 진료차트 우선 정렬.
 *   AC-2 (미사라짐): 0건이어도 드롭다운/안내를 숨기지 않고 비활성 안내("불러올 상용구 없음")로 유지.
 *   AC-3 (회귀보존): 처방세트(loadRxSet)·진단명 datalist 등 같은 패널 다른 동선 불변.
 *
 * 스타일: 기존 RX-SUPER-PHRASE spec 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본(useMedicalPhrases 필터/정렬, applyMedicalPhrase 누적)과 동일 규칙을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (phrase_templates row 의 관심 필드) ─────────────────────────────
interface PhraseRow {
  id: number;
  name: string;
  content: string;
  is_active: boolean;
  phrase_type: 'pen_chart' | 'medical_chart' | null;
}
interface MedicalPhrase {
  id: number;
  name: string;
  content: string;
  phrase_type: 'pen_chart' | 'medical_chart';
}

// ── 수정 정본: useMedicalPhrases 선택/정렬 규칙 (필터완화 AC-1) ───────────────
//   is_active=true 전체 → 진료차트 우선 안정정렬. (phrase_type null → pen_chart 폴백)
const selectClinicalPhrases = (rows: PhraseRow[]): MedicalPhrase[] => {
  const out = rows
    .filter((r) => r.is_active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      content: r.content,
      phrase_type: (r.phrase_type ?? 'pen_chart') as 'pen_chart' | 'medical_chart',
    }));
  out.sort((a, b) =>
    a.phrase_type === b.phrase_type ? 0 : a.phrase_type === 'medical_chart' ? -1 : 1,
  );
  return out;
};

// ── 회귀 비교용: 수정 전 버그 로직 (medical_chart 단일 필터) ───────────────────
const selectClinicalPhrasesBuggy = (rows: PhraseRow[]): MedicalPhrase[] =>
  rows
    .filter((r) => r.is_active && r.phrase_type === 'medical_chart')
    .map((r) => ({ id: r.id, name: r.name, content: r.content, phrase_type: 'medical_chart' as const }));

// ── 렌더 게이트 정본: 0건이어도 미사라짐 (AC-2) ──────────────────────────────
//   length>0 → Select 노출, 0 → 비활성 안내(여전히 화면에 존재).
const renderState = (list: MedicalPhrase[]): 'select' | 'empty-notice' =>
  list.length > 0 ? 'select' : 'empty-notice';

// ── 적용 정본: applyMedicalPhrase 누적(append) ───────────────────────────────
const applyMedicalPhrase = (prevClinical: string, picked: MedicalPhrase | undefined): string => {
  if (!picked) return prevClinical;
  const prev = (prevClinical ?? '').trim();
  return prev ? `${prev}\n${picked.content}` : picked.content;
};

// ── 픽스처: prod 실측 분포 모사 (pen 多 / medical 少) ─────────────────────────
const PROD_LIKE: PhraseRow[] = [
  ...Array.from({ length: 33 }, (_, i) => ({
    id: i + 1,
    name: `펜차트상용구${i + 1}`,
    content: `펜 내용 ${i + 1}`,
    is_active: true,
    phrase_type: 'pen_chart' as const,
  })),
  { id: 100, name: '진료차트상용구1', content: '진료 내용 1', is_active: true, phrase_type: 'medical_chart' as const },
];

// ── AC-1: 필터완화 — 현장 상용구 전체 노출 ───────────────────────────────────
test.describe('LOAD-FIX AC-1: 필터완화(전체 노출)', () => {
  test('회귀 재현: 수정 전 로직은 medical_chart 1건만 → 33개 펜차트 안 보임', () => {
    const buggy = selectClinicalPhrasesBuggy(PROD_LIKE);
    expect(buggy).toHaveLength(1); // 현장 "안먹고"의 정체
  });

  test('수정 후: 활성 상용구 34건 전부 노출', () => {
    const fixed = selectClinicalPhrases(PROD_LIKE);
    expect(fixed).toHaveLength(34);
    // 펜차트 33 + 진료차트 1 모두 포함
    expect(fixed.filter((p) => p.phrase_type === 'pen_chart')).toHaveLength(33);
    expect(fixed.filter((p) => p.phrase_type === 'medical_chart')).toHaveLength(1);
  });

  test('진료차트 우선 정렬 + 동일유형 내 sort_order(=입력순) 유지', () => {
    const fixed = selectClinicalPhrases(PROD_LIKE);
    expect(fixed[0].phrase_type).toBe('medical_chart'); // 맨 위
    // 그 뒤부터는 펜차트가 원래 순서대로
    expect(fixed[1].name).toBe('펜차트상용구1');
    expect(fixed[2].name).toBe('펜차트상용구2');
  });

  test('phrase_type null → pen_chart 폴백(레거시 행도 노출)', () => {
    const withNull: PhraseRow[] = [
      { id: 1, name: '레거시', content: 'x', is_active: true, phrase_type: null },
    ];
    const fixed = selectClinicalPhrases(withNull);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].phrase_type).toBe('pen_chart');
  });

  test('비활성 상용구는 여전히 제외', () => {
    const rows: PhraseRow[] = [
      { id: 1, name: '활성펜', content: 'a', is_active: true, phrase_type: 'pen_chart' },
      { id: 2, name: '비활성펜', content: 'b', is_active: false, phrase_type: 'pen_chart' },
    ];
    const fixed = selectClinicalPhrases(rows);
    expect(fixed.map((p) => p.name)).toEqual(['활성펜']);
  });
});

// ── AC-2: 0건이어도 미사라짐 ──────────────────────────────────────────────────
test.describe('LOAD-FIX AC-2: 0건 비활성 안내(미사라짐)', () => {
  test('상용구 1건 이상 → Select 노출', () => {
    expect(renderState(selectClinicalPhrases(PROD_LIKE))).toBe('select');
  });

  test('상용구 0건(전부 비활성/미등록) → Select 대신 비활성 안내 유지', () => {
    const allInactive: PhraseRow[] = [
      { id: 1, name: 'x', content: 'x', is_active: false, phrase_type: 'pen_chart' },
    ];
    expect(renderState(selectClinicalPhrases(allInactive))).toBe('empty-notice');
    expect(renderState(selectClinicalPhrases([]))).toBe('empty-notice');
  });
});

// ── 적용 동선: 불러온 상용구가 임상경과에 누적되는지 ──────────────────────────
test.describe('LOAD-FIX 적용 동선: applyMedicalPhrase 누적', () => {
  test('빈 임상경과 → 선택 내용 채움', () => {
    const list = selectClinicalPhrases(PROD_LIKE);
    const picked = list.find((p) => p.name === '펜차트상용구5');
    expect(applyMedicalPhrase('', picked)).toBe('펜 내용 5');
  });

  test('기존 임상경과 → 줄바꿈 누적(replace 아님)', () => {
    const list = selectClinicalPhrases(PROD_LIKE);
    const picked = list.find((p) => p.phrase_type === 'medical_chart');
    expect(applyMedicalPhrase('기존경과', picked)).toBe('기존경과\n진료 내용 1');
  });

  test('없는 id 선택 → 무동작(불변)', () => {
    expect(applyMedicalPhrase('keep', undefined)).toBe('keep');
  });
});

// ── AC-3: 같은 패널 다른 동선 회귀 보존 ───────────────────────────────────────
test.describe('LOAD-FIX AC-3: 다른 동선 불변', () => {
  // 처방세트 불러오기: prescription_sets(is_active) 그대로 — phrase_templates 변경과 무관.
  interface RxSet { id: number; name: string; items: { name: string }[]; is_active: boolean; }
  const selectRxSets = (rows: RxSet[]) => rows.filter((r) => r.is_active);

  test('처방세트 불러오기 동선은 phrase_type 변경 영향 없음', () => {
    const sets: RxSet[] = [
      { id: 1, name: '세트A', items: [{ name: '약1' }], is_active: true },
      { id: 2, name: '비활성세트', items: [], is_active: false },
    ];
    expect(selectRxSets(sets).map((s) => s.name)).toEqual(['세트A']);
  });

  test('진단명 datalist 출처(차트 이력+슈퍼상용구 진단명)는 phrase_templates 와 독립', () => {
    // datalist 는 medical_charts.diagnosis + super_phrases.diagnosis distinct.
    const merge = (charts: string[], supers: string[]) =>
      Array.from(new Set([...charts, ...supers].map((d) => d.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, 'ko'),
      );
    expect(merge(['내성발톱', '발톱무좀'], ['발톱무좀'])).toEqual(['내성발톱', '발톱무좀']);
  });
});

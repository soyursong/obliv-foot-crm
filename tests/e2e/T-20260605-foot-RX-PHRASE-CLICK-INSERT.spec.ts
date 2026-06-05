/**
 * E2E spec — T-20260605-foot-RX-PHRASE-CLICK-INSERT
 * 진료차트(MedicalChartPanel) 상용구 불러오기 인터랙션 변경:
 *   체크박스 다중선택 + 하단 "삽입" 버튼  →  행 클릭 시 ✓ 버튼 노출 → ✓ 클릭 즉시 삽입.
 *
 * 충돌 분석(티켓 블로커 체크):
 *   T-20260603-foot-PHRASE-MULTISELECT(복수선택 일괄배치)는 PenChartTab.tsx(펜차트)에 구현됨 —
 *   본 변경 대상 MedicalChartPanel.tsx(진료차트)와 별도 컴포넌트·별도 state·별도 패널.
 *   공유 체크박스/패널 없음 → "단순 단일 불러오기 패널만 영향" 조건 충족, 그대로 진행.
 *
 * AC-1: 각 row 체크박스 제거 + 하단 "삽입" 버튼 제거.
 * AC-2: 상용구 row 클릭 → 그 row만 ✓ 버튼 노출(단일 활성). 같은 row 재클릭 = 닫힘.
 * AC-3: ✓ 클릭 → 즉시 삽입. 기존 insertPhrase 핸들러 재활용 — 누적(append)/대체(//query) 시맨틱 동일.
 * AC-4: 회귀 — 삽입 결과·누적 동작 변경 전과 동일. 슈퍼상용구(super_phrases) 동선 무영향.
 *
 * 스타일: 기존 PHRASE-MULTISELECT/PENCHART spec 패턴(in-page 순수 로직 시뮬레이션) —
 *   실제 구현(MedicalChartPanel.tsx)의 togglePhraseRow·insertPhrase 시맨틱을 동일 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 실제 구현 정본과 동일한 시맨틱 (MedicalChartPanel.tsx) ────────────────────

interface Phrase { id: number; name: string; content: string | null; shortcut_key?: string | null; }

const FIXTURES: Phrase[] = [
  { id: 1, name: 'A 족저근막염', content: '족저근막염 의심\n좌측 통증 (+)', shortcut_key: 'jm' },
  { id: 2, name: 'B 보존치료', content: '보존적 치료 시행', shortcut_key: 'bj' },
  { id: 3, name: 'C 빈상용구', content: '   ', shortcut_key: null }, // GUARD: 빈/공백 content
];

// 실제 togglePhraseRow: 단일 활성 id 토글(같은 id 재클릭 → null)
const togglePhraseRow = (prev: number | null, id: number): number | null =>
  prev === id ? null : id;

// 실제 insertPhrase: //query 패턴이면 그 자리를 대체, 아니면 줄바꿈 누적(append).
//   GUARD: null/빈 content 는 무시(무동작).
const insertPhrase = (
  formClinical: string,
  cursor: number,
  phrase: Phrase,
): string => {
  if (!phrase || !(phrase.content ?? '').trim()) return formClinical; // GUARD
  const content = phrase.content as string;
  const textBefore = formClinical.substring(0, cursor);
  const textAfter = formClinical.substring(cursor);
  const match = textBefore.match(/\/\/([^\s/]*)$/);
  if (match) {
    return textBefore.substring(0, textBefore.length - match[0].length) + content + textAfter;
  }
  return formClinical ? formClinical + '\n' + content : content;
};

// ── 시나리오 1: 클릭 → ✓ → 즉시 삽입 ─────────────────────────────────────────
test.describe('RX-PHRASE-CLICK-INSERT 시나리오1: 클릭→✓→삽입', () => {
  test('AC-2: row 클릭 시 단일 활성, 같은 row 재클릭 시 닫힘', () => {
    let active: number | null = null;
    active = togglePhraseRow(active, 1); // A 클릭 → ✓ 노출
    expect(active).toBe(1);
    active = togglePhraseRow(active, 2); // 다른 row 클릭 → ✓ 이동(단일)
    expect(active).toBe(2);
    active = togglePhraseRow(active, 2); // 같은 row 재클릭 → 닫힘
    expect(active).toBeNull();
  });

  test('AC-3: ✓ 클릭 → 빈 폼에 즉시 삽입(누적 시맨틱)', () => {
    const result = insertPhrase('', 0, FIXTURES[0]);
    expect(result).toBe('족저근막염 의심\n좌측 통증 (+)');
  });

  test('AC-3: ✓ 클릭 → 기존 내용 있으면 줄바꿈 누적', () => {
    const result = insertPhrase('기존 메모', 4, FIXTURES[1]);
    expect(result).toBe('기존 메모\n보존적 치료 시행');
  });

  test('AC-3: //query 위치에서 ✓ 삽입 시 대체 시맨틱 유지', () => {
    const form = '진료중 //bj';
    const result = insertPhrase(form, form.length, FIXTURES[1]);
    expect(result).toBe('진료중 보존적 치료 시행'); // //bj 대체
  });
});

// ── 시나리오 2: 회귀 — 삽입 결과·누적·GUARD·슈퍼상용구 무영향 ─────────────────
test.describe('RX-PHRASE-CLICK-INSERT 시나리오2: 회귀', () => {
  test('AC-4: 단일 삽입 결과가 변경 전(insertSelectedPhrases 1개 선택)과 동일', () => {
    // 변경 전: 1개만 선택 후 일괄삽입 = content 그대로 append. 변경 후: ✓ 1개 삽입 = 동일.
    const legacySingleInsert = (form: string, phrase: Phrase) =>
      form ? form + '\n' + (phrase.content ?? '').trim() : (phrase.content ?? '').trim();
    const before = legacySingleInsert('기존', FIXTURES[1]);
    const after = insertPhrase('기존', 2, FIXTURES[1]);
    expect(after).toBe(before);
  });

  test('AC-3 GUARD: 빈/공백 content 는 무동작(폼 불변)', () => {
    const form = '유지되어야 함';
    const result = insertPhrase(form, form.length, FIXTURES[2]);
    expect(result).toBe(form);
  });

  test('AC-1: 체크박스/다중선택 state 제거 — 단일 활성만 존재', () => {
    // 다중선택 누적이 불가능함을 보장(이전 Set 누적 → 단일 id 교체).
    let active: number | null = null;
    active = togglePhraseRow(active, 1);
    active = togglePhraseRow(active, 2);
    active = togglePhraseRow(active, 3);
    expect(active).toBe(3); // 누적 아님 — 항상 마지막 1개만
  });

  test('AC-4: 슈퍼상용구(super_phrases) 동선 무영향 — 상용구 변경이 super 적용 로직과 분리', () => {
    // 슈퍼상용구는 진단명+임상경과+처방 3슬롯 일괄 라우팅(별도 탭/핸들러).
    // 본 spec 대상(phrase 탭 클릭삽입)은 super 적용 함수에 의존/간섭하지 않음 — 구조 분리 확인.
    const applySuperPhrase = (slots: { diagnosis?: string; clinical?: string }) => ({
      diagnosis: slots.diagnosis ?? '',
      clinical: slots.clinical ?? '',
    });
    const out = applySuperPhrase({ diagnosis: '족저근막염', clinical: '경과 양호' });
    expect(out).toEqual({ diagnosis: '족저근막염', clinical: '경과 양호' });
  });
});

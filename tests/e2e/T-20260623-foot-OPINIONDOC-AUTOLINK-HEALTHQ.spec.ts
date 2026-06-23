/**
 * E2E spec — T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ
 *
 * 소견서(OpinionDocTab) 체크박스 ← 발건강 질문지(health_q_results) 자동 pre-check + 발건강 질문지에 '간염보균자' 추가.
 *
 * 검증 대상:
 *   S1 매핑(computeAutoCheckedKeys) — medical_history/medications 라벨 → 소견서 옵션 key (AC-1).
 *   S2 질문지 없음/매칭 0 → 빈 배열(자동화 스킵=수동 모드, AC-1.4).
 *   S3 §확인-1 A안 — '임신중 또는 임신준비중' 1개 선택 → pregnant + preparing_pregnancy 둘 다 pre-check.
 *   S4 hyperlipidemia OR 매핑 — medical_history '고지혈증' 또는 medications '콜레스테롤약' 어느 쪽이든.
 *   S5 자동체크 → editor 문구 합성(togglePhraseInText) + 이미 선택된 키는 재삽입 안 함(상보).
 *   S6 AC-1.3 — 의사 수동 토글 시 QR입력 뱃지(autoChecked) 제거.
 *   S7 AC-2 — HealthQMobilePage.MEDICAL_HISTORY_OPTIONS 에 '간염보균자' 존재 + hbv_carrier 매핑 활성.
 *   S8 소스 정합 가드 — OpinionDocTab 에 HEALTHQ_AUTOCHECK_MAP·useLatestHealthQ(read-only)·QR입력 뱃지 wiring.
 *      + TabletChecklistPage(별개 폼=checklists, health_q_results 미기록)는 본 매핑과 무관(미변경) 가드.
 *
 * 스타일: 정본(OpinionDocTab) 로직 1:1 모사 — auth/DB 비의존 순수 검증(KOH/OPINION-DOC-FEATURE 동일 컨벤션).
 *   매핑 라벨은 HealthQMobilePage 상수와 정확 일치해야 하므로 소스 정적 가드로 동기화 lock.
 *
 * ⚠ GUARD(AC-1.5): 자동 pre-check 는 '출발점'일 뿐 — 최종 발행은 의사 publish_opinion_doc RPC(window.confirm)
 *   게이트 그대로. 본 티켓은 발행 경로 무변경(진입 시 pre-check 표시 + 시각구분만 추가).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION = 'src/components/doctor/OpinionDocTab.tsx';
const HEALTHQ = 'src/pages/HealthQMobilePage.tsx';
const TABLET = 'src/pages/TabletChecklistPage.tsx';

// ── 정본 모사: HEALTHQ_AUTOCHECK_MAP (OpinionDocTab.tsx) ───────────────────────
//   값(라벨)은 HealthQMobilePage MEDICAL_HISTORY_OPTIONS/MEDICATION_OPTIONS 와 정확 일치(S7/S8 가드로 lock).
const HEALTHQ_AUTOCHECK_MAP: Record<string, { medical_history?: string[]; medications?: string[] }> = {
  diabetes:            { medical_history: ['당뇨'] },
  liver_disease:       { medical_history: ['간질환'] },
  hyperlipidemia:      { medical_history: ['고지혈증'], medications: ['콜레스테롤약'] },
  immune_disease:      { medical_history: ['자가면역질환'] },
  thyroid_med:         { medical_history: ['갑상선질환'] },
  gi_disorder:         { medical_history: ['위장장애·역류성식도염'] },
  pregnant:            { medical_history: ['임신중 또는 임신준비중'] },
  preparing_pregnancy: { medical_history: ['임신중 또는 임신준비중'] },
  psychiatric_med:     { medications: ['정신과약'] },
  bp_med:              { medications: ['혈압약'] },
  cardio_med:          { medications: ['협심증약'] },
  on_chemo:            { medications: ['항암제'] },
  hbv_carrier:         { medical_history: ['간염보균자'] },
};

// ── 정본 모사: computeAutoCheckedKeys (OpinionDocTab.tsx) ──────────────────────
function computeAutoCheckedKeys(formData: Record<string, unknown> | null | undefined): string[] {
  if (!formData) return [];
  const toStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const mh = toStrArr(formData['medical_history']);
  const meds = toStrArr(formData['medications']);
  const keys: string[] = [];
  for (const [key, rule] of Object.entries(HEALTHQ_AUTOCHECK_MAP)) {
    const hitMH = (rule.medical_history ?? []).some((v) => mh.includes(v));
    const hitMed = (rule.medications ?? []).some((v) => meds.includes(v));
    if (hitMH || hitMed) keys.push(key);
  }
  return keys;
}

// ── 정본 모사: togglePhraseInText (OpinionDocTab.tsx) ──────────────────────────
const togglePhraseInText = (text: string, phrase: string): string => {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const idx = lines.findIndex((l) => l.trim() === phrase.trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${phrase}` : phrase;
};

// ── 정본 모사: 자동체크 적용(effect) — newKeys 만 문구 삽입(이미 선택된 키 무변경) ──
function applyAutoCheck(
  initialText: string,
  initialSelected: Set<string>,
  autoKeys: string[],
  phraseByKey: Map<string, string>,
): { text: string; selected: Set<string>; autoChecked: Set<string> } {
  const valid = autoKeys.filter((k) => phraseByKey.has(k));
  if (valid.length === 0) return { text: initialText, selected: initialSelected, autoChecked: new Set() };
  const newKeys = valid.filter((k) => !initialSelected.has(k));
  let t = initialText;
  for (const k of newKeys) {
    const phrase = phraseByKey.get(k);
    if (phrase) t = togglePhraseInText(t, phrase);
  }
  const sel = new Set(initialSelected);
  for (const k of newKeys) sel.add(k);
  return { text: t, selected: sel, autoChecked: new Set(valid) };
}

// ── 정본 모사: handleOptionClick 의 autoChecked 제거(AC-1.3) ───────────────────
function manualToggle(autoChecked: Set<string>, key: string): Set<string> {
  if (!autoChecked.has(key)) return autoChecked;
  const next = new Set(autoChecked);
  next.delete(key);
  return next;
}

test.describe('T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ — 매핑/로직', () => {
  // S1 — 대표 매핑: medical_history·medications 라벨 → 소견서 key.
  test('S1: 당뇨(medical_history) → diabetes, 혈압약(medications) → bp_med', () => {
    const keys = computeAutoCheckedKeys({ medical_history: ['당뇨'], medications: ['혈압약'] });
    expect(keys).toContain('diabetes');
    expect(keys).toContain('bp_med');
    // 매칭 안 된 키는 미포함
    expect(keys).not.toContain('on_chemo');
    expect(keys).not.toContain('liver_disease');
  });

  test('S1: 전 매핑 13키 라벨 정합 (각 키 단독 트리거)', () => {
    expect(computeAutoCheckedKeys({ medical_history: ['당뇨'] })).toEqual(['diabetes']);
    expect(computeAutoCheckedKeys({ medical_history: ['간질환'] })).toEqual(['liver_disease']);
    expect(computeAutoCheckedKeys({ medical_history: ['자가면역질환'] })).toEqual(['immune_disease']);
    expect(computeAutoCheckedKeys({ medical_history: ['갑상선질환'] })).toEqual(['thyroid_med']);
    expect(computeAutoCheckedKeys({ medical_history: ['위장장애·역류성식도염'] })).toEqual(['gi_disorder']);
    expect(computeAutoCheckedKeys({ medications: ['정신과약'] })).toEqual(['psychiatric_med']);
    expect(computeAutoCheckedKeys({ medications: ['협심증약'] })).toEqual(['cardio_med']);
    expect(computeAutoCheckedKeys({ medications: ['항암제'] })).toEqual(['on_chemo']);
    expect(computeAutoCheckedKeys({ medical_history: ['간염보균자'] })).toEqual(['hbv_carrier']);
  });

  // S2 — 질문지 없음/빈/매칭 0 → 빈 배열(AC-1.4 자동화 스킵, 수동 모드 유지).
  test('S2: null/빈/미매칭 → 빈 배열(수동 모드, 에러 없음)', () => {
    expect(computeAutoCheckedKeys(null)).toEqual([]);
    expect(computeAutoCheckedKeys(undefined)).toEqual([]);
    expect(computeAutoCheckedKeys({})).toEqual([]);
    expect(computeAutoCheckedKeys({ medical_history: [], medications: [] })).toEqual([]);
    expect(computeAutoCheckedKeys({ medical_history: ['고혈압'] })).toEqual([]); // 고혈압은 매핑 대상 아님
  });

  // S3 — §확인-1 A안: '임신중 또는 임신준비중' 단일 옵션 → pregnant + preparing_pregnancy 둘 다.
  test('S3: 임신 단일옵션 → pregnant + preparing_pregnancy 둘 다 pre-check (§확인-1 A안)', () => {
    const keys = computeAutoCheckedKeys({ medical_history: ['임신중 또는 임신준비중'] });
    expect(keys).toContain('pregnant');
    expect(keys).toContain('preparing_pregnancy');
  });

  // S4 — hyperlipidemia OR 매핑: medical_history '고지혈증' OR medications '콜레스테롤약'.
  test('S4: hyperlipidemia = 고지혈증 OR 콜레스테롤약 (어느 쪽이든)', () => {
    expect(computeAutoCheckedKeys({ medical_history: ['고지혈증'] })).toContain('hyperlipidemia');
    expect(computeAutoCheckedKeys({ medications: ['콜레스테롤약'] })).toContain('hyperlipidemia');
    expect(computeAutoCheckedKeys({ medical_history: ['고지혈증'], medications: ['콜레스테롤약'] }))
      .toEqual(['hyperlipidemia']); // 중복 키 없음
  });

  // S5 — 자동체크 → editor 문구 합성 + 이미 선택된 키 재삽입 안 함(상보, 큐 prefill 공존).
  test('S5: 자동체크 문구 합성 + 기 선택 키 무변경(상보)', () => {
    const phraseByKey = new Map<string, string>([
      ['diabetes', '당뇨 관련 사항을 확인하였습니다.'],
      ['bp_med', '혈압약 복용 이력을 확인하였습니다.'],
    ]);
    // 빈 상태에서 자동체크 → 두 문구 줄단위 합성 + 두 키 선택 + 둘 다 QR입력.
    const r1 = applyAutoCheck('', new Set(), ['diabetes', 'bp_med'], phraseByKey);
    expect(r1.text).toBe('당뇨 관련 사항을 확인하였습니다.\n혈압약 복용 이력을 확인하였습니다.');
    expect([...r1.selected].sort()).toEqual(['bp_med', 'diabetes']);
    expect([...r1.autoChecked].sort()).toEqual(['bp_med', 'diabetes']);

    // diabetes 가 이미 (큐 prefill 로) 선택돼 있으면 → 그 문구는 재삽입 안 함, bp_med 만 추가.
    const r2 = applyAutoCheck('당뇨 관련 사항을 확인하였습니다.', new Set(['diabetes']), ['diabetes', 'bp_med'], phraseByKey);
    expect(r2.text).toBe('당뇨 관련 사항을 확인하였습니다.\n혈압약 복용 이력을 확인하였습니다.');
    expect([...r2.selected].sort()).toEqual(['bp_med', 'diabetes']);
    // 뱃지(autoChecked)는 매칭 전 키 전부 표기(이미 선택돼 있던 것 포함).
    expect([...r2.autoChecked].sort()).toEqual(['bp_med', 'diabetes']);
  });

  test('S5: phraseByKey 에 없는 키(템플릿 override 로 옵션 누락)는 무시 — empty-safe', () => {
    const phraseByKey = new Map<string, string>([['diabetes', 'p']]);
    const r = applyAutoCheck('', new Set(), ['diabetes', 'on_chemo'], phraseByKey);
    expect([...r.selected]).toEqual(['diabetes']); // on_chemo 는 옵션 없음 → 스킵
    expect([...r.autoChecked]).toEqual(['diabetes']);
  });

  // S6 — AC-1.3: 의사 수동 토글 → QR입력 뱃지 제거(의사확인).
  test('S6: 의사 수동 토글 → autoChecked 에서 제거(뱃지 사라짐)', () => {
    const auto = new Set(['diabetes', 'bp_med']);
    const after = manualToggle(auto, 'bp_med');
    expect(after.has('bp_med')).toBe(false);
    expect(after.has('diabetes')).toBe(true);
    // 자동체크 아니던 키 토글은 무영향(동일 참조 반환)
    expect(manualToggle(auto, 'on_chemo')).toBe(auto);
  });
});

// ── 소스 정적 가드 (정본 소스, 데이터·로그인 비의존) ─────────────────────────────
test.describe('T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ — 소스 정합', () => {
  // S7 — AC-2: HealthQMobilePage 질문지에 '간염보균자' 추가 + 매핑 활성.
  test('S7: HealthQMobilePage MEDICAL_HISTORY_OPTIONS 에 간염보균자 존재', () => {
    const src = read(HEALTHQ);
    const block = src.slice(src.indexOf('const MEDICAL_HISTORY_OPTIONS'), src.indexOf('const MEDICATION_OPTIONS'));
    expect(block).toContain("'간염보균자'");
    // 기존 옵션 무회귀(임신 단일 옵션 보존)
    expect(block).toContain("'임신중 또는 임신준비중'");
  });

  test('S7: hbv_carrier 매핑이 간염보균자 라벨과 일치(활성)', () => {
    expect(HEALTHQ_AUTOCHECK_MAP.hbv_carrier.medical_history).toEqual(['간염보균자']);
    expect(computeAutoCheckedKeys({ medical_history: ['간염보균자'] })).toEqual(['hbv_carrier']);
  });

  // S8 — OpinionDocTab wiring: 매핑·read-only 조회·QR입력 뱃지.
  test('S8: OpinionDocTab 에 HEALTHQ_AUTOCHECK_MAP·useLatestHealthQ·QR입력 뱃지 wiring', () => {
    const src = read(OPINION);
    expect(src).toContain('HEALTHQ_AUTOCHECK_MAP');
    expect(src).toContain('computeAutoCheckedKeys');
    expect(src).toContain('useLatestHealthQ');
    // read-only 조회(health_q_results) — write 경로 없음.
    expect(src).toContain("from('health_q_results')");
    expect(src).not.toMatch(/health_q_results'\)\s*\.(insert|update|delete|upsert)/);
    // QR입력 뱃지 + 자동체크 안내.
    expect(src).toContain('QR입력');
    expect(src).toContain('opinion-autocheck-hint');
    // 발행 경로 무변경 — publish_opinion_doc RPC + window.confirm 게이트 보존(GUARD AC-1.5).
    expect(src).toContain('publish_opinion_doc');
    expect(src).toContain('window.confirm');
  });

  // S8 — TabletChecklistPage(별개 폼=checklists, health_q_results 미기록)는 본 매핑과 무관 → 미변경 가드.
  //   ticket 의 "동일 상수" 가정과 달리 두 폼의 옵션 리스트는 상이(코드 사실). 자동 pre-check 소스는 health_q_results 뿐.
  test('S8: TabletChecklistPage 는 간염보균자 미추가(별개 폼, AC-1 무관)', () => {
    const src = read(TABLET);
    // checklists 경로(health_q_results 아님) 확인 — 자동연동 소스 아님.
    expect(src).toContain('fn_complete_prescreen_checklist');
    expect(src).not.toContain("from('health_q_results')");
    // 별개 옵션 리스트 보존(고혈압/혈관질환/면역질환) — 본 티켓이 건드리지 않음.
    const block = src.slice(src.indexOf('const MEDICAL_HISTORY_OPTIONS'), src.indexOf('const MEDICATION_OPTIONS'));
    expect(block).toContain("'혈관질환'");
    expect(block).not.toContain("'간염보균자'");
  });
});

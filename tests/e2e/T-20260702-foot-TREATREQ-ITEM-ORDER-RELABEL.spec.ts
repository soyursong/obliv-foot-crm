/**
 * T-20260702-foot-TREATREQ-ITEM-ORDER-RELABEL
 *   2번차트 [치료신청] 5항목 체크박스 표시 순서 재정렬 + 라벨 문구 수정.
 *   지정 순서: 피검사 → KOH균검사 → 무좀 (PC+NL) → 내성 (PD) → 각질 (RB).
 *   라벨 수정: 무좀PC+NL→무좀 (PC+NL) / 내성(PD)→내성 (PD) / 각질(RB)→각질 (RB).
 *
 * ⚠ SCOPE: TREATMENT_REQUEST_ITEMS 표시 배열 순서 + label 문자열만.
 *          key/axis/codes/existingEntity(코드매핑·저장·배정) 무접촉 = 회귀 가드.
 *
 * 검증 방식: SSOT 배열(treatmentRequestCodes.ts)의 순서·라벨·(key↔code) 페어 불변식.
 *   컴포넌트가 TREATMENT_REQUEST_ITEMS.map 으로 순서·라벨을 그대로 렌더하므로 배열이 렌더 진실.
 *   ⚠ AC-5(실제 브라우저 육안 확인)는 dev-foot 이 별도 렌더 확인으로 충족 — 본 spec 은 구조 회귀 가드.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');

const SRC = read('src/lib/treatmentRequestCodes.ts');
const BOX = read('src/components/TreatmentRequestBox.tsx');

// TREATMENT_REQUEST_ITEMS 배열 리터럴 창을 추출한다.
const ARRAY_WINDOW = (() => {
  const start = SRC.indexOf('export const TREATMENT_REQUEST_ITEMS');
  const end = SRC.indexOf('] as const;', start);
  return start >= 0 && end > start ? SRC.slice(start, end) : '';
})();

// 배열 창에서 (key, label) 페어를 등장 순서대로 뽑는다.
const ITEMS = (() => {
  const out: { key: string; label: string }[] = [];
  const re = /key:\s*'([^']+)'[\s\S]*?label:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ARRAY_WINDOW)) !== null) out.push({ key: m[1], label: m[2] });
  return out;
})();

// ── AC-1 표시 순서 ────────────────────────────────────────────────────────────
test.describe('AC-1 — 5항목 지정 순서', () => {
  test('key 순서 = blood_test → koh_fungal_test → athlete_foot → podologue_pd → ribbon_rb', () => {
    expect(ITEMS.map((i) => i.key)).toEqual([
      'blood_test',
      'koh_fungal_test',
      'athlete_foot',
      'podologue_pd',
      'ribbon_rb',
    ]);
  });

  test('label 순서(위→아래) = 피검사 / KOH균검사 / 무좀 (PC+NL) / 내성 (PD) / 각질 (RB)', () => {
    expect(ITEMS.map((i) => i.label)).toEqual([
      '피검사',
      'KOH균검사',
      '무좀 (PC+NL)',
      '내성 (PD)',
      '각질 (RB)',
    ]);
  });
});

// ── AC-2 라벨 문구(괄호 앞 공백 포함) + 구 라벨 잔존 금지 ─────────────────────────
test.describe('AC-2 — 라벨 문구 수정', () => {
  test('신규 라벨 정확 일치(괄호 앞 공백)', () => {
    const byKey = Object.fromEntries(ITEMS.map((i) => [i.key, i.label]));
    expect(byKey['athlete_foot']).toBe('무좀 (PC+NL)');
    expect(byKey['podologue_pd']).toBe('내성 (PD)');
    expect(byKey['ribbon_rb']).toBe('각질 (RB)');
  });

  test('구 라벨(무좀PC+NL / 내성(PD) / 각질(RB) — 공백 없는 형태) 잔존 금지', () => {
    expect(ARRAY_WINDOW).not.toMatch(/label:\s*'무좀PC\+NL'/);
    expect(ARRAY_WINDOW).not.toMatch(/label:\s*'내성\(PD\)'/);
    expect(ARRAY_WINDOW).not.toMatch(/label:\s*'각질\(RB\)'/);
  });
});

// ── AC-3 코드매핑·저장·배정 무접촉(회귀 가드) ────────────────────────────────────
test.describe('AC-3 — (key↔code/axis/existingEntity) 매핑 회귀 0', () => {
  test('각 key 의 codes/axis/existingEntity 매핑 불변', () => {
    // 순서와 무관하게 (key, 코드매핑) 페어가 통째로 이동했는지 확인.
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'blood_test'[\s\S]*?axis:\s*'exam'[\s\S]*?codes:\s*\[\][\s\S]*?existingEntity:\s*'blood_flag'/,
    );
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'koh_fungal_test'[\s\S]*?axis:\s*'exam'[\s\S]*?codes:\s*\[\][\s\S]*?existingEntity:\s*'koh_flag'/,
    );
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'athlete_foot'[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['preconditioning',\s*'unheated_laser'\][\s\S]*?existingEntity:\s*null/,
    );
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'podologue_pd'[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['podologue'\][\s\S]*?existingEntity:\s*null/,
    );
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'ribbon_rb'[\s\S]*?axis:\s*'treatment'[\s\S]*?codes:\s*\['ribbon'\][\s\S]*?existingEntity:\s*null/,
    );
  });
});

// ── AC-4 렌더 계약 회귀 0(COMPACT 무접촉) ────────────────────────────────────────
// T-20260708 co-reconcile: SPLIT '5항목 일괄 신청' 프레이밍이 policy_superseded 되어
//   컴포넌트가 APPLY_LIST_ITEMS(신청=exam) + TREATMENT_CONTENT_ITEMS(치료내용=treatment) 두 그룹으로
//   렌더한다. 두 배열은 SSOT(TREATMENT_REQUEST_ITEMS)의 axis 파생 뷰라 순서·라벨은 여전히 SSOT가 진실.
test.describe('AC-4 — 렌더 계약 회귀 0', () => {
  test('컴포넌트가 SSOT 파생 그룹(APPLY_LIST_ITEMS + TREATMENT_CONTENT_ITEMS).map 으로 렌더', () => {
    expect(BOX).toMatch(/APPLY_LIST_ITEMS\.map/);
    expect(BOX).toMatch(/TREATMENT_CONTENT_ITEMS\.map/);
    // 방문유형 기반 필터 금지(재진에서 항목 소실 방지)
    expect(BOX).not.toMatch(/\.filter\([^)]*visit/i);
  });

  test('라벨은 배열의 item.label 로 렌더(하드코딩 라벨 없음)', () => {
    expect(BOX).toMatch(/\{item\.label\}/);
  });
});

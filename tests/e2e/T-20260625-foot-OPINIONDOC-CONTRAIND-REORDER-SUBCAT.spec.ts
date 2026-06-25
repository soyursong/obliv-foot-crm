/**
 * Unit spec — T-20260625-foot-OPINIONDOC-CONTRAIND-REORDER-SUBCAT (김주연 총괄 / 문지은 대표원장 confirm)
 *
 * 대상: 2번차트 상담내역 → 소견서·진단서(OpinionDocTab) 금기증 항목.
 *   요청1 — 항목 리스트 재정렬(현장 4×5 row-major 20항목 + 면역질환).
 *   요청2 — 대분류-소분류 표시 구조(경구약/간질환/탈모약/임신). 간염보균자 B/C = 기존 드롭다운 유지.
 *
 * ★문지은 대표원장 confirm(2026-06-25, ts 1782360775.473999) = 전부 비파괴:
 *   ① 탈모약 남/여 = 병합X, 소분류 분리유지(male/female 2키 보존).
 *   ② 면역질환(immune_disease) = 제거X, 유지(HEALTHQ 자동체크·priority 21 고아화 방지).
 *   ③ 신규: 고령자 + 간질환 소분류 3개(간기능 이상/검사 이상/상시 음주), 조합 포함. phrase=dev 초안.
 *   ④ 비파괴 재정렬 착수 OK.
 *
 * 회귀 핵심(CONFLICT-DETAIL, COMBINE 티켓과 좌표):
 *   표시순서(OPINION_SECTIONS 배열) ≠ 조합우선순위(CONTRAIND_PRIORITY/COMBINE SSOT).
 *   라벨을 짧게 바꾼 항목은 OpinionOption.priority 로 우선순위를 고정 → buildContraindTemplates 가
 *   기존 조합 출력순서를 그대로 보존해야 한다(조합 회귀 0).
 *
 * 데이터 모델 = flat 유지(소분류도 section.options 최상위 항목). 대분류는 표시 전용(CONTRAIND_DISPLAY_GROUPS).
 *   → buildContraindKeySet/조합엔진/스냅샷/상담요청박스/상용구관리 등 모든 flat 소비자 회귀 0.
 *
 * auth/page 미사용 순수 로직·소스 가드 → playwright.config.ts `unit` 프로젝트.
 * 실제 브라우저 렌더(그리드 순서·펼침 토글·발행)는 권한자(원장) 계정 라이브 확인(단계별 브라우저 테스트 의무).
 *
 * 실행: npx playwright test T-20260625-foot-OPINIONDOC-CONTRAIND-REORDER-SUBCAT.spec.ts --project=unit
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OPINION_SECTIONS,
  CONTRAIND_DISPLAY_GROUPS,
  parseOpinionSections,
} from '../../src/components/doctor/OpinionDocTab';
import { buildContraindTemplates } from '../../src/lib/contraindicationCombine';
import { buildContraindKeySet, isContraindSection } from '../../src/lib/opinionDocCompose';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const OPINION_DOC = 'src/components/doctor/OpinionDocTab.tsx';

const contraindSection = () => OPINION_SECTIONS.find((s) => isContraindSection(s.title))!;
const keyToLabel = () => {
  const m = new Map<string, string>();
  for (const o of contraindSection().options) m.set(o.key, o.label);
  return m;
};

// 렌더 fold 미러 — 소분류를 대분류로 접어 표시 셀 라벨 시퀀스를 만든다(첫 출현 위치 보존).
function foldedCellLabels(): string[] {
  const groupOf = new Map<string, string>();
  for (const g of CONTRAIND_DISPLAY_GROUPS) for (const k of g.keys) groupOf.set(k, g.label);
  const emitted = new Set<string>();
  const cells: string[] = [];
  for (const opt of contraindSection().options) {
    const grp = groupOf.get(opt.key);
    if (grp) {
      if (emitted.has(grp)) continue;
      emitted.add(grp);
      cells.push(grp);
    } else {
      cells.push(opt.label);
    }
  }
  return cells;
}

// ── 시나리오 1: 항목 재정렬 — 현장 4×5 row-major 순서 (요청1) ────────────────────
test.describe('시나리오 1 — 항목 재정렬(요청1, row-major)', () => {
  test('대분류 셀 시퀀스가 현장 그리드 row-major 순서와 일치(+면역질환 유지)', () => {
    expect(foldedCellLabels()).toEqual([
      // 행1
      '위장장애', '경구약', '간염보균자', '당뇨',
      // 행2
      '혈압약', '고지혈증', '심혈관약', '간질환',
      // 행3
      '신장질환', '통풍약', '갑상선약', '항정신과약',
      // 행4
      '탈모약', '항암중', '항암 후 추적', '임신',
      // 행5
      '고령자', '소아', '운전기사', '파일럿',
      // 면역질환 — 원장 confirm #2(제거X 유지)
      '면역질환',
    ]);
  });
});

// ── 시나리오 2: 비파괴 — 기존 key 전부 보존 + 신규 key 추가 (confirm #1/#2/#3) ──────
test.describe('시나리오 2 — 비파괴(기존 보존 + 신규 추가)', () => {
  const keys = new Set(contraindSection().options.map((o) => o.key));

  test('기존 24개 금기증 key 전부 보존(병합X·제거X)', () => {
    const original = [
      'hyperlipidemia', 'gi_disorder', 'oral_ineffective', 'gi_after_oral', 'bp_med',
      'cardio_med', 'liver_disease', 'hbv_carrier', 'kidney_disease', 'gout_med',
      'thyroid_med', 'male_hairloss_med', 'female_hairloss_med', 'psychiatric_med',
      'on_chemo', 'post_chemo_followup', 'preparing_pregnancy', 'pregnant',
      'breastfeeding', 'pilot', 'driver', 'immune_disease', 'diabetes', 'pediatric',
    ];
    for (const k of original) expect(keys.has(k), `보존 key 누락: ${k}`).toBe(true);
  });

  test('탈모약 남/여 2키 분리 유지(병합X — confirm #1)', () => {
    expect(keys.has('male_hairloss_med')).toBe(true);
    expect(keys.has('female_hairloss_med')).toBe(true);
  });

  test('면역질환 유지(제거X — confirm #2)', () => {
    expect(keys.has('immune_disease')).toBe(true);
  });

  test('신규 4항목 추가(고령자 + 간질환 소분류 3개 — confirm #3)', () => {
    for (const k of ['elderly', 'liver_func_abnormal', 'liver_func_test_abnormal', 'regular_drinking']) {
      expect(keys.has(k), `신규 key 누락: ${k}`).toBe(true);
    }
  });

  test('신규 항목에 phrase(조합 본문) 초안 존재(빈 문자열 아님)', () => {
    const labelMap = contraindSection().options;
    for (const k of ['elderly', 'liver_func_abnormal', 'liver_func_test_abnormal', 'regular_drinking']) {
      const o = labelMap.find((x) => x.key === k)!;
      expect(o.phrase.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── 시나리오 3: 대분류-소분류 표시 그룹 (요청2) ─────────────────────────────────
test.describe('시나리오 3 — 대분류-소분류 표시 구조(요청2)', () => {
  const byLabel = new Map(CONTRAIND_DISPLAY_GROUPS.map((g) => [g.label, g.keys]));

  test('경구약 = [효과미비, 복용후위장장애]', () => {
    expect(byLabel.get('경구약')).toEqual(['oral_ineffective', 'gi_after_oral']);
  });
  test('간질환 = [전반, 간기능이상, 간기능검사이상, 상시음주]', () => {
    expect(byLabel.get('간질환')).toEqual([
      'liver_disease', 'liver_func_abnormal', 'liver_func_test_abnormal', 'regular_drinking',
    ]);
  });
  test('탈모약 = [남성, 여성]', () => {
    expect(byLabel.get('탈모약')).toEqual(['male_hairloss_med', 'female_hairloss_med']);
  });
  test('임신 = [준비중, 임신중, 수유중]', () => {
    expect(byLabel.get('임신')).toEqual(['preparing_pregnancy', 'pregnant', 'breastfeeding']);
  });
  test('간염보균자는 표시그룹 아님 — B/C는 기존 간염타입 드롭다운 유지(회귀 금지)', () => {
    const allGroupKeys = CONTRAIND_DISPLAY_GROUPS.flatMap((g) => g.keys);
    expect(allGroupKeys).not.toContain('hbv_carrier');
  });
  test('모든 그룹 멤버 key 가 실제 옵션으로 존재(고아 매핑 0)', () => {
    const keys = new Set(contraindSection().options.map((o) => o.key));
    for (const g of CONTRAIND_DISPLAY_GROUPS) for (const k of g.keys) {
      expect(keys.has(k), `그룹 '${g.label}' 멤버 key 없음: ${k}`).toBe(true);
    }
  });
});

// ── 시나리오 4: 조합우선순위 회귀가드 (표시순서 ≠ 조합우선순위, COMBINE 좌표) ────────
test.describe('시나리오 4 — 조합우선순위 보존(조합 회귀 0)', () => {
  // form_templates 없는 폴백(FE 상수) 경로 — OPINION_SECTIONS 를 엔진 템플릿 맵으로 빌드.
  const tpl = buildContraindTemplates(contraindSection().options.length
    ? [{ title: '금기증', options: contraindSection().options }]
    : []);

  test('라벨 단축 항목의 priority 고정 — 기존 조합순서 유지', () => {
    // 효과미비/복용후위장장애/남성/여성/간질환(전반) = 라벨 바뀜 → 명시 priority 로 원래 값 보존.
    expect(tpl['oral_ineffective'].priority).toBe(24);
    expect(tpl['gi_after_oral'].priority).toBe(13);
    expect(tpl['male_hairloss_med'].priority).toBe(9);
    expect(tpl['female_hairloss_med'].priority).toBe(10);
    expect(tpl['liver_disease'].priority).toBe(12);
  });

  test('라벨 유지 항목은 라벨매핑으로 기존 priority 그대로', () => {
    expect(tpl['hyperlipidemia'].priority).toBe(1);
    expect(tpl['gi_disorder'].priority).toBe(2);
    expect(tpl['hbv_carrier'].priority).toBe(5);
    expect(tpl['on_chemo'].priority).toBe(14);
    expect(tpl['post_chemo_followup'].priority).toBe(15);
    expect(tpl['pregnant'].priority).toBe(17);
    expect(tpl['immune_disease'].priority).toBe(21); // 면역질환 유지 → 21 그대로
    expect(tpl['diabetes'].priority).toBe(22);
  });

  test('신규 항목도 조합 포함(priority 존재 + 본문 비어있지 않음)', () => {
    for (const k of ['elderly', 'liver_func_abnormal', 'liver_func_test_abnormal', 'regular_drinking']) {
      expect(typeof tpl[k].priority).toBe('number');
      expect(tpl[k].body.length).toBeGreaterThan(0);
    }
  });
});

// ── 시나리오 5: buildContraindKeySet — flat 소비자 회귀 가드 ──────────────────────
test.describe('시나리오 5 — flat 소비자(buildContraindKeySet) 신규/기존 key 인식', () => {
  const set = buildContraindKeySet(OPINION_SECTIONS);
  test('기존+신규 금기증 key 모두 금기증 그룹으로 인식', () => {
    for (const k of [
      'immune_disease', 'male_hairloss_med', 'female_hairloss_med', 'liver_disease',
      'elderly', 'liver_func_abnormal', 'liver_func_test_abnormal', 'regular_drinking',
    ]) {
      expect(set.has(k), `금기증 key 미인식: ${k}`).toBe(true);
    }
  });
  test('진단서 단일배타 key 는 금기증 아님', () => {
    for (const k of ['oral_o', 'oral_x', 'after_1m', 'medical_staff']) {
      expect(set.has(k)).toBe(false);
    }
  });
});

// ── 시나리오 6: parseOpinionSections — priority round-trip 보존 (DB override 안전) ──
test.describe('시나리오 6 — priority round-trip(DB override·상용구관리 유실 방지)', () => {
  test('parseOpinionSections 가 priority 를 read 시 보존', () => {
    const parsed = parseOpinionSections({
      sections: [{
        title: '금기증',
        options: [{ key: 'oral_ineffective', label: '효과미비', phrase: 'p', priority: 24 }],
      }],
    });
    expect(parsed[0].options[0].priority).toBe(24);
  });
  test('priority 없는 기존 option 은 undefined 안전(backward-compat)', () => {
    const parsed = parseOpinionSections({
      sections: [{ title: '금기증', options: [{ key: 'x', label: 'X', phrase: 'p' }] }],
    });
    expect(parsed[0].options[0].priority).toBeUndefined();
  });
});

// ── 시나리오 7: 소스 가드 — 그룹 렌더 분기 + 표시 전용 + 펼침 상태 ─────────────────
test.describe('시나리오 7 — 소스 구조 가드', () => {
  const doc = read(OPINION_DOC);
  test('OpinionOption.priority ADDITIVE 필드 선언', () => {
    expect(doc).toContain('priority?: number');
  });
  test('금기증 섹션은 renderContraindSection 분기로 렌더', () => {
    expect(doc).toContain('isContraindSection(section.title)');
    expect(doc).toContain('renderContraindSection');
  });
  test('대분류 펼침 상태(expandedGroups) 존재', () => {
    expect(doc).toContain('expandedGroups');
    expect(doc).toContain('setExpandedGroups');
  });
  test('CONTRAIND_DISPLAY_GROUPS 표시 전용 상수 export', () => {
    expect(doc).toContain('export const CONTRAIND_DISPLAY_GROUPS');
  });
});

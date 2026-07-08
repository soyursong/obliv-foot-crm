/**
 * T-20260708-foot-TREATREQ-EXAMONLY-APPLYLIST-SCHEMAFIX
 *   2번차트 > 패키지 탭 치료신청 스펙 정정 (순수 FE 렌더-라우팅, 데이터 계약 불변).
 *
 *   ① 신청리스트(신청) 스코프 축소 = 피검사·균검사(KOH) exam 2항목만. 동시 다중선택(multiselect).
 *      → 기존 request_blood_test_for_customer()/request_koh_for_customer() RPC = 리스트업 SSOT 그대로.
 *   ② treatment 3항목(무좀 PC+NL·내성 PD·각질 RB) 표기 분리 = '신청' 아님 → 고객 치료내용 표기 별도 섹션.
 *      신청리스트 미반영. 단 초진 선택/기록·재진 package_derived 저장(chart_treatment_requests)은 유지.
 *   ③ "치료신청 저장 준비 중입니다(스키마 적용 대기)" 저장불가 = 부모 SPLIT ADDITIVE 마이그 prod 미착지가
 *      근본원인(supervisor DDL-diff 소관). FE 는 42P01 graceful 유지 → 스키마 착지 후 정상 저장.
 *
 *   ⚠ SCOPE GUARD (DA GO ADDITIVE, MSG-20260708-124735-fcnl): request_axis 2축 · chart_treatment_requests grain ·
 *      session_type CHECK(ribbon) · 초진 배정 필터 입력 회귀 금지. 표기 분리는 read/render 규칙이지 저장 축 삭제가 아님.
 *
 * 검증 방식: 정적 소스 불변식(라이브 env 비의존) — 자매 SPLIT/RELABEL/COMPACT spec 계열과 동일.
 *   AC-6(실제 브라우저 육안 확인)는 dev-foot 이 별도 렌더 확인으로 충족.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = (p: string) => resolve(__dirname, '../../', p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CODES = read('src/lib/treatmentRequestCodes.ts');
const CODES_C = stripComments(CODES);
const BOX = read('src/components/TreatmentRequestBox.tsx');
const BOX_C = stripComments(BOX);

// SSOT 배열 창(순서·라벨 진실)
const ARRAY_WINDOW = (() => {
  const start = CODES.indexOf('export const TREATMENT_REQUEST_ITEMS');
  const end = CODES.indexOf('] as const;', start);
  return start >= 0 && end > start ? CODES.slice(start, end) : '';
})();

// ── AC-1 신청리스트(신청) 스코프 = 피검사·KOH exam 2항목만 ─────────────────────────
test.describe('AC-1 — 신청(신청리스트) 스코프 = 피검사·KOH exam 2항목만', () => {
  test('APPLY_LIST_ITEMS = exam 축만(피검사·KOH)', () => {
    expect(CODES_C).toMatch(/export const APPLY_LIST_ITEMS[\s\S]*?filter\(\(i\) => i\.axis === 'exam'\)/);
  });

  test('신청 섹션(treatreq-apply-section)이 APPLY_LIST_ITEMS.map 으로 렌더', () => {
    expect(BOX_C).toContain('data-testid="treatreq-apply-section"');
    expect(BOX_C).toMatch(/data-testid="treatreq-apply-section"[\s\S]*?APPLY_LIST_ITEMS\.map/);
  });

  test('exam 2항목의 key = blood_test, koh_fungal_test (SSOT 매핑 불변)', () => {
    expect(ARRAY_WINDOW).toMatch(/key:\s*'blood_test'[\s\S]*?axis:\s*'exam'/);
    expect(ARRAY_WINDOW).toMatch(/key:\s*'koh_fungal_test'[\s\S]*?axis:\s*'exam'/);
  });
});

// ── AC-2 exam 축 → 既존 RPC 리스트업 연동(신규 insert/테이블 금지) ─────────────────
test.describe('AC-2 — 피검사·KOH → 既존 request_*_for_customer RPC(리스트업 SSOT 그대로)', () => {
  test('피검사/KOH 는 기존 RPC 위임(set_* 회귀 금지)', () => {
    expect(BOX_C).toContain('request_blood_test_for_customer');
    expect(BOX_C).toContain('request_koh_for_customer');
    expect(BOX_C).not.toContain('set_blood_test_requested');
    expect(BOX_C).not.toContain('set_koh_requested');
  });

  test('exam 체크 시 리스트업 목록 즉시 반영 — exam_targets / koh_report invalidate', () => {
    expect(BOX_C).toContain("queryKey: ['exam_targets']");
    expect(BOX_C).toContain("queryKey: ['koh_report']");
  });

  test('multiselect — 피검사·KOH 각각 독립 토글(단일선택 라디오 강제 없음)', () => {
    // 각 항목이 독립 버튼(aria-pressed)으로 렌더 = 동시 체크 허용. 상호배타 라디오/그룹 강제 없음.
    expect(BOX_C).toMatch(/aria-pressed=\{checked\}/);
    expect(BOX_C).not.toMatch(/role="radio"/);
  });
});

// ── AC-3 treatment 3항목 표기 분리(신청 아님, 신청리스트 미반영) ────────────────────
test.describe('AC-3 — 무좀·내성·각질 = 치료내용 표기 별도 섹션(신청 아님)', () => {
  test('TREATMENT_CONTENT_ITEMS = treatment 축만(무좀·내성·각질)', () => {
    expect(CODES_C).toMatch(/export const TREATMENT_CONTENT_ITEMS[\s\S]*?filter\(\(i\) => i\.axis === 'treatment'\)/);
  });

  test('치료내용 섹션(treatreq-content-section)이 TREATMENT_CONTENT_ITEMS.map 으로 별도 렌더', () => {
    expect(BOX_C).toContain('data-testid="treatreq-content-section"');
    expect(BOX_C).toMatch(/data-testid="treatreq-content-section"[\s\S]*?TREATMENT_CONTENT_ITEMS\.map/);
  });

  test('신청 섹션과 치료내용 섹션이 분리 렌더(서로 다른 컨테이너)', () => {
    const applyIdx = BOX_C.indexOf('data-testid="treatreq-apply-section"');
    const contentIdx = BOX_C.indexOf('data-testid="treatreq-content-section"');
    expect(applyIdx).toBeGreaterThan(0);
    expect(contentIdx).toBeGreaterThan(applyIdx); // 신청 → 치료내용 순서(분리 확인)
  });

  test('treatment 항목이 exam RPC(신청리스트 경로)로 넘어가지 않음 — existingEntity=null 분기', () => {
    // treatment(existingEntity=null)는 examMutation(RPC=신청리스트)이 아니라 ctrMutation 경유.
    expect(BOX_C).toMatch(/item\.existingEntity === 'blood_flag' \|\| item\.existingEntity === 'koh_flag'/);
    expect(BOX_C).toMatch(/examMutation\.mutate/);
    expect(BOX_C).toMatch(/ctrMutation\.mutate/);
  });
});

// ── AC-4 저장 정상화 (42P01 graceful 유지 — 스키마 착지 후 정상 저장) ────────────────
test.describe('AC-4 — 저장 경로 정상화(스키마 착지 후) + 42P01 graceful 유지', () => {
  test('스키마 미착지 시 graceful — 42P01 조회 빈배열 / 저장 안내 토스트', () => {
    expect(BOX_C).toMatch(/42P01/);
    expect(BOX_C).toContain('치료신청 저장 준비 중입니다(스키마 적용 대기)');
  });

  test('저장 grain 불변 — upsert onConflict check_in_id,request_code', () => {
    expect(BOX_C).toMatch(/onConflict:\s*'check_in_id,request_code'/);
  });
});

// ── AC-5 배정 필터 입력 보존(회귀 금지) — 표기 분리 ≠ 저장 축 삭제 ────────────────────
test.describe('AC-5 — 초진 배정 필터 입력 보존(treatment 축 저장·매핑 회귀 0)', () => {
  test('treatment 축 저장 유지 — chart_treatment_requests upsert + request_axis 기록', () => {
    expect(BOX_C).toMatch(/from\('chart_treatment_requests'\)/);
    expect(BOX_C).toMatch(/request_axis:\s*item\.axis/);
  });

  test('재진 package_derived 자동표기 스냅샷 게이트 불변', () => {
    expect(BOX_C).toMatch(/visitType !== 'returning'/);
    expect(BOX_C).toMatch(/source:\s*'package_derived'/);
  });

  test('배정 필터 코드 집합(TREATMENT_AXIS_CODES) + gated capability 매핑 불변', () => {
    expect(CODES_C).toMatch(/export const TREATMENT_AXIS_CODES/);
    expect(CODES_C).toMatch(/podologue/);
    expect(CODES_C).toMatch(/ribbon/);
    expect(CODES_C).toMatch(/preconditioning/);
    expect(CODES_C).toMatch(/unheated_laser/);
  });

  test('treatment 3항목 key↔code 매핑 회귀 0(SSOT 불변)', () => {
    expect(ARRAY_WINDOW).toMatch(
      /key:\s*'athlete_foot'[\s\S]*?codes:\s*\['preconditioning',\s*'unheated_laser'\][\s\S]*?existingEntity:\s*null/,
    );
    expect(ARRAY_WINDOW).toMatch(/key:\s*'podologue_pd'[\s\S]*?codes:\s*\['podologue'\]/);
    expect(ARRAY_WINDOW).toMatch(/key:\s*'ribbon_rb'[\s\S]*?codes:\s*\['ribbon'\]/);
  });
});

// ── AC-6 레이아웃 회귀 0 (RELABEL 순서/라벨 · COMPACT 세로스택/컴팩트) ────────────────
test.describe('AC-6 — RELABEL/COMPACT 레이아웃 회귀 0', () => {
  test('RELABEL 순서·라벨 SSOT 불변(피검사→KOH균검사→무좀→내성→각질)', () => {
    const keys: string[] = [];
    const re = /key:\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ARRAY_WINDOW)) !== null) keys.push(m[1]);
    expect(keys).toEqual(['blood_test', 'koh_fungal_test', 'athlete_foot', 'podologue_pd', 'ribbon_rb']);
  });

  test('COMPACT — 두 섹션 그리드 모두 flex flex-col 세로 스택 + 항목 px-2.5 py-1.5 min-h-[36px]', () => {
    expect(BOX_C).toMatch(/data-testid="treatreq-checkbox-grid"/);
    expect(BOX_C).toMatch(/data-testid="treatreq-content-grid"/);
    expect(BOX_C).toMatch(/px-2\.5 py-1\.5/);
    expect(BOX_C).toMatch(/min-h-\[36px\]/);
    expect(BOX_C).not.toMatch(/grid grid-cols/);
  });
});

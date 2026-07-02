/**
 * T-20260702-foot-CHART2-TREATREQ-COMPACT-ONELINE
 *   2번차트 [치료신청] 박스 5항목 체크박스 레이아웃 컴팩트화 — 한 줄에 하나씩(1항목/행) 세로 스택 + 여백 최소.
 *   부모 T-20260701-foot-CHART2-TREATREQ-SPLIT 의 데이터·저장·배정 계약은 무접촉(FE-only cosmetic).
 *
 * 검증 방식: 정적 소스 불변식(라이브 env 비의존). 컴팩트·한줄씩 배치를 소스 계약으로 고정.
 *   ⚠ AC-5(실제 브라우저 육안 확인)는 dev-foot 이 별도 렌더 확인으로 충족 — 본 spec 은 구조 회귀 가드.
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

const BOX = read('src/components/TreatmentRequestBox.tsx');
const BOX_C = stripComments(BOX);

// 5항목 체크박스 컨테이너(treatreq-checkbox-grid) 의 className 창을 추출한다.
const CONTAINER_CLASS = (() => {
  const idx = BOX_C.indexOf('data-testid="treatreq-checkbox-grid"');
  if (idx < 0) return '';
  // 같은 <div ...> 여는 태그 안의 className 을 뒤로 스캔.
  const open = BOX_C.lastIndexOf('<div', idx);
  const close = BOX_C.indexOf('>', idx);
  return open >= 0 && close > open ? BOX_C.slice(open, close + 1) : '';
})();

// ── AC-1 한 줄에 하나씩(1항목/행) 세로 스택 ──────────────────────────────────────
test.describe('AC-1 — 5항목 체크박스 세로 스택(1항목/행)', () => {
  test('컨테이너가 flex flex-col 세로 스택 — 기존 2~3열 grid 폐기', () => {
    expect(CONTAINER_CLASS.length).toBeGreaterThan(0);
    expect(CONTAINER_CLASS).toMatch(/flex flex-col/);
    // 가로 나열/2열 그리드 잔존 금지(컨테이너 창 한정). ※ testid 'checkbox-grid' 는 별개 — grid-cols* 만 확인.
    expect(CONTAINER_CLASS).not.toMatch(/grid-cols-2/);
    expect(CONTAINER_CLASS).not.toMatch(/sm:grid-cols-3/);
    expect(CONTAINER_CLASS).not.toMatch(/grid grid-cols/);
  });

  test('항목 순서·구성 회귀0 — 여전히 TREATMENT_REQUEST_ITEMS 무조건 map(방문유형 필터 없음)', () => {
    expect(BOX_C).toMatch(/TREATMENT_REQUEST_ITEMS\.map/);
    expect(BOX_C).not.toMatch(/TREATMENT_REQUEST_ITEMS[\s\S]{0,60}\.filter\(/);
  });

  test('각 항목 버튼이 행 전체 폭(w-full) 차지 — 한 줄에 하나씩', () => {
    expect(BOX_C).toMatch(/w-full[\s\S]{0,80}rounded-md border/);
  });
});

// ── AC-2 컴팩트 여백 ─────────────────────────────────────────────────────────────
test.describe('AC-2 — 여백 컴팩트(불필요한 빈 공간 제거)', () => {
  test('행 간 간격 축소(gap-1) — 넓은 gap-2 폐기', () => {
    expect(CONTAINER_CLASS).toMatch(/gap-1\b/);
    expect(CONTAINER_CLASS).not.toMatch(/gap-2\b/);
  });

  test('박스 안쪽 패딩 컴팩트(p-2) + 항목 세로 패딩 축소(py-1.5, min-h 하향)', () => {
    expect(BOX_C).toMatch(/p-2"[\s\S]{0,40}data-testid="pkg-tab-treatreq-section"/);
    expect(BOX_C).toMatch(/px-2\.5 py-1\.5/);
    expect(BOX_C).toMatch(/min-h-\[36px\]/);
    // 넓은 py-2.5 / min-h-44 잔존 금지
    expect(BOX_C).not.toMatch(/py-2\.5/);
    expect(BOX_C).not.toMatch(/min-h-\[44px\]/);
  });
});

// ── AC-4 데이터·저장·배정 회귀0 (순수 레이아웃 변경 — 값/핸들러 불변) ────────────────
test.describe('AC-4 — 저장·재진입·재진 자동채움·배정 필터 회귀0', () => {
  test('저장 grain·핸들러 불변 — onConflict / examMutation / ctrMutation 유지', () => {
    expect(BOX_C).toMatch(/onConflict:\s*'check_in_id,request_code'/);
    expect(BOX_C).toMatch(/examMutation\.mutate/);
    expect(BOX_C).toMatch(/ctrMutation\.mutate/);
  });

  test('재진 자동 파생 스냅샷 게이트 불변(package_derived, returning 한정)', () => {
    expect(BOX_C).toMatch(/visitType !== 'returning'/);
    expect(BOX_C).toMatch(/source:\s*'package_derived'/);
  });

  test('재진입 checked 판정 로직 불변(codeSet 전 코드 present)', () => {
    expect(BOX_C).toMatch(/item\.codes\.every\(\(c\) => codeSet\.has\(c\)\)/);
  });

  test('피검사/KOH 既존 RPC 위임 불변', () => {
    expect(BOX_C).toContain('request_blood_test_for_customer');
    expect(BOX_C).toContain('request_koh_for_customer');
  });
});

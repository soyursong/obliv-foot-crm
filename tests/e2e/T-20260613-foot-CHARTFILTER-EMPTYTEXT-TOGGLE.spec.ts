/**
 * E2E spec — T-20260613-foot-CHARTFILTER-EMPTYTEXT-TOGGLE
 * 진료차트 좌측 필터 패널 UI 개선 2건 (UI-only, DB 무변경).
 * reporter: 문지은 대표원장 (C0ATE5P6JTH, thread 1781317727.374789).
 *
 * AC:
 *   ① 필터 적용 후 빈상태 안내 텍스트("...없음") → "-"(대시 하나)로 축약.
 *      - 미리보기(collapsed) 빈상태: "표시할 메모 없음" → "-"
 *      - 펼침 상세 필터적용 빈상태: "선택한 유형의 메모 없음" → "-"
 *      - 필터 무적용·데이터 자체 없음("저장된 메모 없음")은 필터 빈상태가 아니므로 보존.
 *   ② 모두펼침/모두접기 토글 — 현재 상태인 쪽 버튼을 solid 강조(스위치 ON 느낌:
 *      진한 배경 bg-*-600/700 + text-white)로 표시해 ON/OFF 혼란 해소.
 *      allExpanded=펼침 ON / expandedCount===0=접기 ON / 부분=둘 다 중립.
 *   ③ 필터 동작 로직 불변(회귀 없음) — expandAll/collapseAll·disabled 조건·toggleFilter 무변경.
 *
 * 스타일: 동일 파일 형제 티켓(MEDREC/MEDCHART 계열)과 동일 — 정본 소스 정적 가드.
 *   MedicalChartPanel은 6월 연속변형 핫스팟이라 시드/권한 의존 라이브 시나리오는 flaky →
 *   presence/absence 가드로 AC를 결정론적으로 고정. 라이브 실화면 최종판정은 supervisor QA.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 필터 빈상태 텍스트 "-" 축약
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 필터 빈상태 "-" 축약', () => {
  test('미리보기 빈상태(collapsed) — "표시할 메모 없음" 문구 제거', () => {
    const src = PANEL();
    // 필터 적용 후 미리보기 세그먼트 0건 빈상태 안내문은 더 이상 "...없음" 노출 안 함.
    expect(src).not.toContain('표시할 메모 없음');
  });

  test('미리보기 빈상태 — timeline-preview 세그먼트 0건 시 "-" 표시', () => {
    const src = PANEL();
    // segs.length>0 ? join : "-" 구조 (대시 하나).
    expect(src).toMatch(/segs\.length\s*>\s*0[\s\S]*?segs\.join[\s\S]*?>-<\/span>/);
  });

  test('펼침 상세 필터적용 빈상태 — "선택한 유형의 메모 없음" 문구 제거', () => {
    const src = PANEL();
    expect(src).not.toContain('선택한 유형의 메모 없음');
  });

  test('펼침 상세 — 필터 적용 시 "-", 무필터·무데이터는 "저장된 메모 없음" 보존', () => {
    const src = PANEL();
    // memoFilters.size > 0 ? '-' : '저장된 메모 없음'  (필터 빈상태만 대시화, 데이터 자체 없음은 보존)
    expect(src).toMatch(/memoFilters\.size\s*>\s*0\s*\?\s*'-'\s*:\s*'저장된 메모 없음'/);
    expect(src).toContain('저장된 메모 없음'); // 비-필터 빈상태는 보존(회귀 가드)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 모두펼침/모두접기 active 강조 (스위치 ON)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 펼침/접기 토글 active 강조', () => {
  test('두 토글 버튼 testid 보존 (회귀 가드)', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="expand-all-btn"');
    expect(src).toContain('data-testid="collapse-all-btn"');
  });

  test('모두펼침 — allExpanded일 때 solid teal 강조(흰 글씨)', () => {
    const src = PANEL();
    // allExpanded 분기에서 진한 배경 + 흰 글씨 = 스위치 ON.
    expect(src).toMatch(/allExpanded[\s\S]*?bg-teal-600 text-white/);
  });

  test('모두접기 — expandedCount===0일 때 solid gray 강조(흰 글씨)', () => {
    const src = PANEL();
    expect(src).toMatch(/expandedCount === 0[\s\S]*?bg-gray-700 text-white/);
  });

  test('상태 표현 — aria-pressed로 ON/OFF 접근성 노출', () => {
    const src = PANEL();
    expect(src).toContain('aria-pressed={allExpanded}');
    expect(src).toContain('aria-pressed={expandedCount === 0}');
  });

  test('비활성/중립 상태는 약한 outline (강조 대비 분명)', () => {
    const src = PANEL();
    // 중립(클릭 가능) 상태는 hover:bg-*-50 outline 스타일 유지 → solid 강조와 시각 대비.
    expect(src).toContain('hover:bg-teal-50');
    expect(src).toContain('hover:bg-gray-50');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 필터 동작 로직 불변 (회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 필터 동작 로직 불변', () => {
  test('expandAll / collapseAll 핸들러 + disabled 조건 보존', () => {
    const src = PANEL();
    expect(src).toContain('onClick={expandAll}');
    expect(src).toContain('onClick={collapseAll}');
    // disabled 조건(동작) 무변경.
    expect(src).toContain('disabled={filteredDisplayCharts.length === 0 || allExpanded}');
    expect(src).toContain('disabled={expandedCount === 0}');
  });

  test('필터 칩 토글(toggleFilter) + 필터 옵션 보존', () => {
    const src = PANEL();
    expect(src).toContain('onClick={() => toggleFilter(key)}');
    expect(src).toMatch(/data-testid=\{`memo-filter-\$\{key\}`\}/);
    expect(src).toContain('data-testid="memo-filter-clear"');
  });
});

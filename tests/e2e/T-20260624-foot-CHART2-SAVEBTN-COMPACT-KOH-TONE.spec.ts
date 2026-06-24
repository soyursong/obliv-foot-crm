/**
 * T-20260624-foot-CHART2-SAVEBTN-COMPACT-KOH-TONE
 *   2번차트(고객차트) 메모 저장버튼 컴팩트화(라벨 우측 끝) + 균검사(KOH) 탭 초록 → 쿨그레이 모노톤.
 *
 * 김주연 총괄(풋센터) 현장 디자인 QA. 첨부 스크린샷 빨간 박스 3곳 + 균검사 탭 초록 지적.
 *
 * AC1 — 저장버튼 컴팩트화 + 라벨 우측 정렬 (1구역·3구역 공통)
 *   full-width 회색 막대 버튼 → 라벨 줄 우측 끝 컴팩트 버튼. 동작·핸들러·토스트는 유지.
 *   대상: ① 1구역 고객메모 저장 ② 3구역 상세 고객메모 추가(MemoHistoryPanel) ③ 3구역 기타메모 저장.
 * AC2 — 균검사(KOH) 탭 emerald(초록) → slate(쿨그레이). 결과유형 색구분(rose/emerald)은 보존,
 *   KOH 호출부 accent 만 slate 로 교체(blast-radius 차단).
 *
 * 본 spec 은 코드베이스 CHART2 spec 관행(정적 소스 미러링 가드)을 따른다 —
 * 컴팩트화/모노톤 불변식이 회귀하면 즉시 실패.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const chartSrc = readFileSync(resolve(__dir, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');
const prfSrc = readFileSync(resolve(__dir, '../../src/components/PatientResultFiles.tsx'), 'utf-8');

// ── AC1 시나리오 1: 1구역 고객메모 저장 (컴팩트 버튼) ───────────────────────────
test.describe('AC1 — 1구역 고객메모 저장 버튼 컴팩트화', () => {
  test('저장 핸들러·testid·토스트 보존 (동작 불변)', () => {
    expect(chartSrc).toContain('chart-customer-note-save-btn');
    expect(chartSrc).toContain('const saveCustomerNote');
    expect(chartSrc).toContain("saveCustomerField({ customer_note: customerNoteText.trim() || null })");
    expect(chartSrc).toContain("toast.success('고객메모 저장됨')");
    // 저장 중 비활성·라벨 보존
    expect(chartSrc).toContain("{savingField ? '저장 중…' : '저장'}");
  });

  test('컴팩트 배치: full-width 막대 제거 + 라벨 우측 끝(justify-end) 컴팩트 버튼', () => {
    // 1구역 고객메모 저장 버튼은 컴팩트(px-2.5 py-0.5)로, full-width(w-full ... py-1) 가 아님
    const btnBlock = chartSrc.slice(
      chartSrc.indexOf('chart-customer-note-save-btn') - 400,
      chartSrc.indexOf('chart-customer-note-save-btn') + 200,
    );
    expect(btnBlock).toContain('justify-end');
    expect(btnBlock).toContain('px-2.5 py-0.5');
    expect(btnBlock).not.toContain('w-full');
  });
});

// ── AC1 시나리오 2: 3구역 기타메모 저장 (컴팩트 버튼) ───────────────────────────
test.describe('AC1 — 3구역 기타메모 저장 버튼 컴팩트화', () => {
  test('저장 핸들러·testid 보존', () => {
    expect(chartSrc).toContain('etc-memo-save-btn');
    expect(chartSrc).toContain('onClick={saveResvDetail}');
    expect(chartSrc).toContain("{savingResvDetail ? '저장 중…' : '저장'}");
  });

  test('컴팩트 배치: 라벨 같은 줄(justify-between) + 컴팩트 버튼, full-width 제거', () => {
    const idx = chartSrc.indexOf('etc-memo-save-btn');
    const block = chartSrc.slice(idx - 500, idx + 100);
    expect(block).toContain('기타메모');
    expect(block).toContain('justify-between');
    expect(block).toContain('px-2.5 py-0.5');
    // 기타메모 버튼은 더 이상 full-width 막대가 아님
    expect(block).not.toContain('w-full rounded bg-[#666666]');
  });
});

// ── AC1 시나리오(공용): MemoHistoryPanel 추가 버튼 컴팩트화 (2번차트 메모탭) ────────
test.describe('AC1 — MemoHistoryPanel(고객/상담/치료메모 추가) 버튼 컴팩트화', () => {
  test('추가 핸들러·testid·disabled 보존', () => {
    expect(chartSrc).toContain('${testidPrefix}-add-btn');
    expect(chartSrc).toContain('onClick={hook.saveNew}');
    expect(chartSrc).toContain('disabled={hook.savingNew || !hook.newText.trim()}');
    expect(chartSrc).toContain("{hook.savingNew ? '저장 중…' : addBtnLabel}");
  });

  test('컴팩트 배치: addLabel 줄 우측 끝(justify-between) + 컴팩트 버튼, full-width 제거', () => {
    const idx = chartSrc.indexOf('${testidPrefix}-add-btn');
    const block = chartSrc.slice(idx - 500, idx + 120);
    expect(block).toContain('justify-between');
    expect(block).toContain('{addLabel}');
    expect(block).toContain('px-2.5 py-0.5');
    // dark accent 보존(bg-[#333333]) + full-width 막대 제거
    expect(block).toContain('bg-[#333333]');
    expect(block).not.toContain('w-full rounded bg-[#333333]');
  });
});

// ── AC2 시나리오 3: 균검사(KOH) 탭 모노톤 (emerald → slate) ──────────────────────
test.describe('AC2 — 균검사(KOH) 결과지 업로드 쿨그레이 모노톤 정합', () => {
  test('PatientResultFiles: slate accent 추가 + 쿨그레이 토큰', () => {
    expect(prfSrc).toContain("type Accent = 'rose' | 'emerald' | 'slate'");
    expect(prfSrc).toContain('border-slate-200');
    expect(prfSrc).toContain('bg-slate-600 text-white hover:bg-slate-700');
  });

  test('blast-radius 차단: rose/emerald 결과유형 색구분 토큰 보존', () => {
    // 다른 결과유형 색구분을 깨지 않음 (emerald/rose 토큰 정의 유지)
    expect(prfSrc).toContain('border-rose-200');
    expect(prfSrc).toContain('bg-emerald-600 text-white hover:bg-emerald-700');
  });

  test('KOH 호출부 accent=slate 로 교체 (emerald → slate)', () => {
    const kohIdx = chartSrc.indexOf('kind="koh_result"');
    expect(kohIdx).toBeGreaterThan(-1);
    const kohBlock = chartSrc.slice(kohIdx - 100, kohIdx + 300);
    expect(kohBlock).toContain('accent="slate"');
    expect(kohBlock).not.toContain('accent="emerald"');
  });
});

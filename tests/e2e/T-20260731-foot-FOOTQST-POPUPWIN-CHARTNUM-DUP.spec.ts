/**
 * E2E spec — T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP
 * 발건강 질문지 [별도창 보기]에서 차트번호가 'F-F-NNNN'(별도창 'F - F') 이중접두로 중복 표시되는 회귀 가드.
 *
 * 현장 리포트(C0ATE5P6JTH, 재현 스샷 F0BM70SNWBE / 20260731_145252.png):
 *   "별도창 차트번호가 'F - F' 형태로 중복. 기대 = 'F-XXXXX' 1회."
 *   원인 티켓 T-20260731-foot-FOOTQST-POPUPWIN-BROKEN(deployed c0f93235) 배포 직후 회귀.
 *
 * ── 근본원인 ──
 *   customers.chart_number 는 DB 트리거 assign_foot_customer_chart_number() 가
 *   'F-' || LPAD(next_no,4,'0') → 이미 'F-NNNN'(F- 접두 포함) 형태로 발번한다.
 *   그런데 별도창 진입점(CustomerChartPage openHealthQDocumentWindow 호출부)은
 *     chartNumber: `F-${String(customer.chart_number).padStart(6,'0')}`
 *   로 'F-' 를 한 번 더 재부착 → 'F-F-NNNN'(별도창 'F - F') 이중접두.
 *   메인 차트 화면은 chartNoDisplay(customer.chart_number) 로 저장값을 그대로 렌더(접두 재부착 없음)
 *   → 별도창만 렌더 경로가 갈라져 발생.
 *
 * ── 수정 ──
 *   별도창 진입점을 메인 차트 화면과 동일 포맷터 chartNoDisplay(customer.chart_number) 재사용으로 수렴.
 *   'F-' 재부착 로직 제거 → 저장값 그대로 1회 표기.
 *
 * AC-1: 별도창 차트번호 'F-NNNN' 1회만(이중접두 없음).
 * AC-2: 메인 차트 화면 표기(chartNoDisplay)와 동일 포맷 일치.
 * AC-3: chart_number 값·발번·저장 무변경 — 표시 레이어만(호출부에 write 경로 없음).
 * AC-4: POPUPWIN(c0f93235) 창 열기 동작 회귀 없이 유지(noopener 미재유입 — sibling BROKEN 가드와 정합).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartNoDisplay } from '../../src/lib/format';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHART_SRC = readFileSync(join(HERE, '../../src/pages/CustomerChartPage.tsx'), 'utf-8');
const DOC_SRC = readFileSync(join(HERE, '../../src/lib/healthQDocument.ts'), 'utf-8');

// 저장된 차트번호 표본(트리거 발번 형태): 'F-' || LPAD(n,4,'0')
const STORED = ['F-0001', 'F-0042', 'F-4903', 'F-1234'];

test.describe('T-20260731-foot-FOOTQST-POPUPWIN-CHARTNUM-DUP — 별도창 차트번호 이중접두 회귀 가드', () => {
  // AC-1: 별도창에 넣는 포맷터가 저장값을 그대로 1회 표기 — 'F-' 이중접두 없음.
  test('AC-1 chartNoDisplay(저장값)는 F- 이중접두를 만들지 않는다', () => {
    for (const s of STORED) {
      const out = chartNoDisplay(s);
      expect(out).toBe(s);                         // 저장값 그대로 1회
      expect(out.startsWith('F-F-')).toBe(false);  // 이중접두 아님
      expect((out.match(/F-/g) || []).length).toBe(1); // 'F-' 정확히 1회
    }
  });

  // AC-1(대조): 과거 버그 식(F- 재부착)이 실제로 이중접두를 만들었음을 고정 — 회귀 방향 명시.
  test('AC-1b 과거 버그식 `F-${padStart}` 은 F-F- 이중접두를 생성(회귀 대조)', () => {
    const buggy = (cn: string) => `F-${String(cn).padStart(6, '0')}`;
    expect(buggy('F-0001')).toBe('F-F-0001'); // ← 현장 'F - F' 중복의 실체
    expect(buggy('F-4903')).toBe('F-F-4903');
  });

  // AC-1/AC-2(★근본원인 회귀 가드): 별도창 진입점 소스에 'F-' 재부착이 재유입 못하게 잠금.
  test('AC-2 별도창 호출부는 F- 재부착 없이 chartNoDisplay 재사용', () => {
    // openHealthQDocumentWindow(...) 호출부 2곳(진입 버튼 + 모달) 모두 존재
    const calls = CHART_SRC.match(/openHealthQDocumentWindow\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // 호출부 인자에 'F-' 재부착 템플릿리터럴이 없어야 함(정확히 이 버그의 회귀 가드)
    expect(CHART_SRC).not.toMatch(/chartNumber:\s*[^,\n]*`F-\$\{/);
    // padStart 기반 접두 재부착 패턴도 금지
    expect(CHART_SRC).not.toMatch(/`F-\$\{String\(customer\.chart_number\)\.padStart/);

    // 별도창 chartNumber 는 메인 화면과 동일 포맷터(chartNoDisplay) 사용
    const optBlocks = CHART_SRC.match(/chartNumber:\s*chartNoDisplay\(customer\.chart_number\)/g) || [];
    expect(optBlocks.length).toBeGreaterThanOrEqual(2); // 진입 버튼 + 모달 두 경로 모두
  });

  // AC-2: 메인 차트 화면도 동일 포맷터를 쓰는지 확인(파리티 근거).
  test('AC-2b 메인 차트 화면과 별도창이 동일 포맷터(chartNoDisplay) 공유', () => {
    // 메인 화면 고객번호 서브텍스트가 chartNoDisplay 사용(파리티 앵커)
    expect(CHART_SRC).toMatch(/chartNoDisplay\(customer\.chart_number\)/);
  });

  // AC-1: 별도창 문서 템플릿은 chartNumber 를 정확히 1회 렌더(문서 레이어 이중 표기 없음).
  test('AC-1c 문서 템플릿은 chartNumber 를 1회만 렌더', () => {
    const hits = DOC_SRC.match(/opts\.chartNumber/g) || [];
    expect(hits.length).toBe(1); // 차트번호 셀 단일 렌더 — 템플릿 이중 concat 없음
    // 템플릿 내부에서 'F-' 를 재부착하지 않음
    expect(DOC_SRC).not.toMatch(/`F-\$\{[^}]*chartNumber/);
  });

  // AC-3: 표시 레이어 전용 — 포맷터는 값을 변형/저장하지 않음(순수).
  test('AC-3 chartNoDisplay 는 순수 표시 함수(값·발번·저장 무변경)', () => {
    const input = 'F-0777';
    const before = input;
    void chartNoDisplay(input);
    expect(input).toBe(before);                 // 인자 불변
    expect(chartNoDisplay(null)).toBe('(미발번)'); // null→(미발번), 메인 화면과 동일
    expect(chartNoDisplay(undefined)).toBe('(미발번)');
  });

  // AC-4: POPUPWIN(c0f93235) 창 열기 동작 회귀 없음 — noopener 미재유입(sibling BROKEN 가드 정합).
  test('AC-4 별도창 오픈 경로 유지 — window.open features 에 noopener 미재유입', () => {
    const m = DOC_SRC.match(/window\.open\(\s*''\s*,\s*'_blank'\s*,\s*'([^']*)'\s*\)/);
    expect(m, "window.open('', '_blank', '<features>') 호출을 찾지 못함").not.toBeNull();
    expect(m![1]).not.toContain('noopener');
    expect(DOC_SRC).not.toMatch(/window\.open\([^)]*noopener[^)]*\)/);
  });
});

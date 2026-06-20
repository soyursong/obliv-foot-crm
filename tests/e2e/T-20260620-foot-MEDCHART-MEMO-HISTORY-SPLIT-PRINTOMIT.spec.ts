/**
 * E2E spec — T-20260620-foot-MEDCHART-MEMO-HISTORY-SPLIT-PRINTOMIT (문지은 대표원장, P1)
 * 진료차트(MedicalChartPanel) 치료메모 영역: '(이전 기록)' inline 노출 → 분리 + 출력 제외.
 *
 * discovery 정정: 리포트된 component는 "MedicalChartPanel.tsx — 치료메모 우측 컬럼 viewer".
 *   "(이전 기록)" 문자열은 CustomerChartPage 의 created_by_name(legacy migration) 이고,
 *   화면에 그 라벨을 노출하는 surface 가 MedicalChartPanel treatMemos viewer(line ~3332) 다.
 *   (스크린샷 포맷 = 날짜·작성자 한 줄 → 본문 = MedicalChartPanel 렌더와 정확히 일치).
 *
 * AC 매핑:
 *   AC-1 기본 표시 = 현재(최신, treatMemos[0]) 메모만. '(이전 기록)' 블록 기본 접힘.
 *   AC-2 이전 방문 메모·변경이력 → 별도 "이전 이력 보기" 토글(기본 접힘, 펼치면 타임라인).
 *   AC-3 인쇄/출력(window.print, @media print) 화면에서 이전기록·변경이력 블록 제외(print:hidden).
 *   AC-4 [GUARD] MEMO-HISTORY(5/20, 김주연 총괄) 이력 데이터·누적로직·열람 무변경(표시 기본값만 변경).
 *        치료사차트/치료메모 섹션 병합·분리(THERAPIST-MEMO-DEDUP territory) 미진입.
 *   AC-5 빌드 성공 + 기존 TIMELINE-REFINE/MEMO-HISTORY presentation 회귀 없음.
 *
 * 컨벤션: 기구현 presentation 검증(소스 정적 검증 + 회귀 가드). 100% FE(저장·데이터·NO-DDL).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// A. AC-1 — 현재(최신) 메모만 기본 노출
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A. 현재 메모 클린화(AC-1)', () => {
  test('AC-1 현재=최신(uniqMemos[0])만 기본 렌더, 이전은 slice(1)로 분리', () => {
    const src = PANEL();
    // 최신순 DESC 쿼리 보존 → [0] = 현재 메모.
    expect(src).toMatch(/from\('customer_treatment_memos'\)[\s\S]{0,200}order\('created_at', \{ ascending: false \}\)/);
    // 현재/이전 분리: current = uniqMemos[0]; previous = uniqMemos.slice(1)
    expect(src).toContain('const current = uniqMemos[0];');
    expect(src).toContain('const previous = uniqMemos.slice(1);');
    // 현재 메모는 항상 렌더(renderMemo(current)).
    expect(src).toMatch(/\{current && renderMemo\(current\)\}/);
  });

  test('AC-1 회귀: byte-identical dedup(content+작성자+created_at) 보존 — 영속 데이터 무변경', () => {
    const src = PANEL();
    expect(src).toMatch(/treat-memo-in-chart-section[\s\S]{0,500}const seen = new Set<string>\(\)/);
    expect(src).toMatch(/uniqMemos = treatMemos\.filter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. AC-2 — 이전 이력 분리(기본 접힘 토글)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('B. 이전 이력 분리 토글(AC-2)', () => {
  test('AC-2 토글 state 기본 false(접힘)', () => {
    const src = PANEL();
    expect(src).toContain('const [treatMemoHistoryOpen, setTreatMemoHistoryOpen] = useState(false);');
  });

  test('AC-2 "이전 이력 보기" 토글 버튼 + 펼침 시에만 이전 목록 노출', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="treat-memo-history-toggle"');
    expect(src).toContain('이전 이력 보기');
    // 토글 버튼 onClick → 상태 반전 (onClick 이 data-testid 보다 앞).
    expect(src).toMatch(/setTreatMemoHistoryOpen\(\(o\) => !o\)[\s\S]{0,200}data-testid="treat-memo-history-toggle"/);
    // 펼침(open)일 때만 이전 목록 렌더(previous.map).
    expect(src).toMatch(/\{treatMemoHistoryOpen && \([\s\S]{0,260}treat-memo-history-list[\s\S]{0,120}previous\.map\(renderMemo\)/);
  });

  test('AC-2 이전 이력 건수 표기(previous.length)', () => {
    const src = PANEL();
    expect(src).toMatch(/이전 이력 보기 \(\{previous\.length\}\)/);
    // 이전이 있을 때만 토글 블록 노출.
    expect(src).toMatch(/\{previous\.length > 0 && \(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. AC-3 — 출력(인쇄) 화면 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('C. 출력 제외(AC-3)', () => {
  test('AC-3 이전 이력 블록 print:hidden — 출력 화면 제외', () => {
    const src = PANEL();
    // 이전 이력 wrapper 에 print:hidden.
    expect(src).toMatch(/className="print:hidden" data-testid="treat-memo-history-block"/);
  });

  test('AC-3 진료의 변경이력(signer audit) 블록도 print:hidden', () => {
    const src = PANEL();
    expect(src).toMatch(/w-full max-w-md text-right print:hidden"/);
    // 변경이력 토글 자체는 화면 열람 보존(원장/어드민).
    expect(src).toContain('data-testid="signer-audit-toggle"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. AC-4 — GUARD: MEMO-HISTORY(5/20) 비파괴 + DEDUP territory 미진입
// ─────────────────────────────────────────────────────────────────────────────
test.describe('D. 비파괴 GUARD(AC-4)', () => {
  test('AC-4 이력 데이터·열람 보존 — DB delete/제거 없음(표시 기본값만 변경)', () => {
    const src = PANEL();
    // 치료메모 조회 경로 보존.
    expect(src).toContain("from('customer_treatment_memos')");
    // 화면에서 customer_treatment_memos delete 호출 부재(이력 제거 금지).
    expect(src).not.toMatch(/customer_treatment_memos[\s\S]{0,80}\.delete\(\)/);
    // 이전 메모도 토글로 동일 renderMemo 로 열람 가능(누락 없음).
    expect(src).toMatch(/previous\.map\(renderMemo\)/);
  });

  test('AC-4 치료사차트/치료메모 2단 구조(THERAPIST-MEMO-DEDUP territory) 무변경', () => {
    const src = PANEL();
    // 좌(치료사차트)·우(치료메모) 2단 row 보존 — 섹션 병합/분리 미진입.
    expect(src).toContain('data-testid="chart-tx-treatmemo-row"');
    expect(src).toContain('data-testid="medical-chart-treatment"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀 가드 — TIMELINE-REFINE / 데이터 동선 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('회귀 가드', () => {
  test('TIMELINE-REFINE 미니멀(border-l 항목 + 우측 메타) 보존', () => {
    const src = PANEL();
    expect(src).toMatch(/border-l-2 border-blue-300 pl-2 py-0\.5"[\s\S]{0,80}data-testid="treat-memo-item"/);
    expect(src).toContain('data-testid="treat-memo-recorder"');
  });

  test('진료의 NOT NULL(의료법) + loadData 경로 무변경', () => {
    const src = PANEL();
    expect(src).toContain('formSigningDoctorId');
    expect(src).toContain('data-testid="treat-memo-empty"');
  });
});

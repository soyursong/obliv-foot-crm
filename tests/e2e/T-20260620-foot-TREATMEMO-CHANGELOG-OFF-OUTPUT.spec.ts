/**
 * E2E spec — T-20260620-foot-TREATMEMO-CHANGELOG-OFF-OUTPUT (풋센터 현장 U0ALGAAAJAV, P2)
 *
 * discovery 결론(중복 수렴):
 *   본 요청("치료메모 이전기록이 출력화면에 노출됨 → 변경이력은 따로 보게")은
 *   자매 티켓 T-20260620-foot-MEDCHART-MEMO-HISTORY-SPLIT-PRINTOMIT(문지은 대표원장, commit 9a48e503)이
 *   동일 피드백 메시지(강혜인 작성 / '원내직원지인·발톱&발각질' 이전기록)에서 이미 구현 완료.
 *   → 가열된 메모 surface(THERAPIST-MEMO-DEDUP/MEMO-WIDTH-25P 진행 중) 재-churn 금지(REDEFINITION_RISK).
 *   본 spec 은 본 티켓 ID(제3 reporter 관심사) 기준의 회귀 가드 — 자매 구현이 본 티켓 AC 를 충족함을 고정 검증.
 *
 * AC 매핑(본 티켓):
 *   AC-1 출력/인쇄 화면에 이전기록·변경이력 미노출 → print:hidden(현재 방문 메모만 출력).
 *   AC-2 변경이력/이전기록은 별도 동선(기본 접힘 토글)으로 분리 — 기본 화면 인라인 혼재 없음.
 *   AC-3 이력 데이터 보존 — MEMO-HISTORY 누적 모델 미손상(delete 부재, 토글로 전건 열람).
 *   AC-4 치료메모 저장·차트 동선 회귀 0(저장/조회 경로 무변경).
 *
 * 컨벤션: presentation 정적 검증 + 회귀 가드(100% FE, NO-DDL). 소스 무변경 — 가드만 추가.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 출력(인쇄) 화면에서 이전기록·변경이력 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 출력 제외', () => {
  test('이전 이력 블록은 print:hidden — 출력화면 미노출(현재 방문 메모만 출력)', () => {
    const src = PANEL();
    expect(src).toMatch(/className="print:hidden" data-testid="treat-memo-history-block"/);
    // 현재(최신) 메모는 항상 렌더 → 출력에 현재 방문 메모만 남음.
    expect(src).toMatch(/\{current && renderMemo\(current\)\}/);
  });

  test('진료의 변경이력(signer audit) 블록도 print:hidden — 출력 미노출', () => {
    const src = PANEL();
    expect(src).toMatch(/w-full max-w-md text-right print:hidden"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 변경이력 별도 동선(기본 접힘) — 인라인 혼재 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 변경이력 별도 열람', () => {
  test('이전/현재 분리: current=uniqMemos[0], previous=slice(1)', () => {
    const src = PANEL();
    expect(src).toContain('const current = uniqMemos[0];');
    expect(src).toContain('const previous = uniqMemos.slice(1);');
  });

  test('별도 토글 기본 접힘(false) + 펼침 시에만 이전 목록 노출', () => {
    const src = PANEL();
    expect(src).toContain('const [treatMemoHistoryOpen, setTreatMemoHistoryOpen] = useState(false);');
    expect(src).toContain('data-testid="treat-memo-history-toggle"');
    expect(src).toContain('이전 이력 보기');
    expect(src).toMatch(/\{treatMemoHistoryOpen && \([\s\S]{0,260}treat-memo-history-list[\s\S]{0,120}previous\.map\(renderMemo\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 이력 데이터 보존(MEMO-HISTORY 비파괴)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 이력 보존', () => {
  test('치료메모 조회 경로 보존 + delete 부재(데이터 손실 0)', () => {
    const src = PANEL();
    expect(src).toContain("from('customer_treatment_memos')");
    expect(src).not.toMatch(/customer_treatment_memos[\s\S]{0,80}\.delete\(\)/);
    // 이전 메모도 토글로 동일 renderMemo 열람(누락 없음).
    expect(src).toMatch(/previous\.map\(renderMemo\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 저장·차트 동선 회귀 0
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 회귀 가드', () => {
  test('최신순 DESC 조회 + 진료의 NOT NULL(의료법) 경로 무변경', () => {
    const src = PANEL();
    expect(src).toMatch(/from\('customer_treatment_memos'\)[\s\S]{0,200}order\('created_at', \{ ascending: false \}\)/);
    expect(src).toContain('formSigningDoctorId');
    expect(src).toContain('data-testid="treat-memo-empty"');
  });

  test('치료사차트/치료메모 2단 구조 무변경(DEDUP territory 미진입)', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="chart-tx-treatmemo-row"');
    expect(src).toContain('data-testid="medical-chart-treatment"');
  });
});

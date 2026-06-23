/**
 * E2E spec — T-20260623-foot-DOCOUTPUT-COLORBOX-SIMPLIFY
 *
 * 1·2번 차트 서류 발행/재발급 UI를 "서류별 대형 컬러박스 카드(2열 그리드)" →
 * 결제미니창(PaymentMiniWindow Zone3) 스타일의 "체크박스 + 서류명 1줄 행 리스트"로 변경.
 *
 * 핵심: 1번차트 서류발행 영역과 2번차트-진료내역-서류재출력 모달 둘 다
 *   DocumentPrintPanel → TemplateSection 을 거쳐 렌더 → 단일 컴포넌트(TemplateSection) 변경으로 2곳 동시 일관화.
 *
 * 변경 = 표현(레이아웃)만. 서류 종류·순서·발행 로직·"상세 발행" 진입·게이트(소견서·진단서) 동작은 보존.
 *
 * AC-1 : TemplateSection 이 컬러박스 카드 그리드(grid-cols-2 + meta.color)가 아니라
 *        세로 행 리스트(flex flex-col)로 렌더한다.
 * AC-2 : 무게이트 서류 = 체크박스(CheckSquare/Square) + 행 클릭 토글(onToggle) + "상세 발행 →" 진입 보존.
 * AC-3 : 게이트 서류(소견서·진단서) = 잠금/작성완료 분기·발행본 출력(gate.onPrint) 보존.
 * AC-4 : 발행 이력 건수 배지(N건)·좌표 미설정 경고 인라인 보존.
 * AC-5 : 회귀0 — 앱 정상 로드 + 2번차트 재발급 모달이 동일 DocumentPrintPanel 재사용.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오(1번/2번 차트)는 하단 체크리스트(갤탭 실기기 현장 confirm 후 done).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const dpp = () => read('src/components/DocumentPrintPanel.tsx');
const chartPage = () => read('src/pages/CustomerChartPage.tsx');

// TemplateSection 본문만 좁혀서 검증(다른 영수증 재발급 grid-cols-2 와 혼동 방지)
function templateSection(): string {
  const src = dpp();
  const start = src.indexOf('function TemplateSection(');
  expect(start).toBeGreaterThan(-1);
  // 다음 최상위 함수 정의(IssueDialog 등) 직전까지
  const after = src.indexOf('\n// ─── 단건 발행 다이얼로그 ───', start);
  return after > start ? src.slice(start, after) : src.slice(start);
}

test.describe('T-20260623-foot-DOCOUTPUT-COLORBOX-SIMPLIFY — 서류출력 컬러박스 → 심플 행 리스트', () => {

  // 앱 정상 로드 (회귀 가드)
  test('AC-5: 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1: 컬러박스 카드 그리드 제거 → 세로 행 리스트
  test('AC-1: TemplateSection — 카드 그리드 제거, 행 리스트(flex flex-col)로 렌더', () => {
    const ts = templateSection();
    // 변경 후: 세로 행 리스트 컨테이너 + 신규 testid
    expect(ts).toContain('flex flex-col gap-1');
    expect(ts).toContain('data-testid="docprint-doc-list"');
    // 제거: 2열 카드 그리드 + 서류별 배경색(meta.color) + 설명/line-clamp 박스
    expect(ts).not.toContain('grid grid-cols-2');
    expect(ts).not.toContain('meta?.color');
    expect(ts).not.toContain('meta?.description');
    // 행 1줄 컴팩트(min-h-[44px] 태블릿 터치 타깃)
    expect(ts).toContain('min-h-[44px]');
  });

  // AC-2: 무게이트 서류 = 체크박스 + 토글 + 상세 발행 진입 보존
  test('AC-2: 무게이트 — 체크박스/onToggle/상세 발행 진입 보존', () => {
    const ts = templateSection();
    expect(ts).toContain('CheckSquare');
    expect(ts).toContain('Square');
    expect(ts).toContain('onToggle(tpl.form_key)');
    expect(ts).toContain('상세 발행 →');
    expect(ts).toContain('onCardClick(tpl)');
    // 행 클릭 토글 진입점 유지
    expect(ts).toContain('const gate = medDocGate?.(tpl.form_key) ?? null');
  });

  // AC-3: 게이트 서류(소견서·진단서) 동작 보존
  test('AC-3: 게이트 — 잠금/작성완료 분기·발행본 출력 보존', () => {
    const ts = templateSection();
    expect(ts).toContain('원장 작성 필요');
    expect(ts).toContain('원장 작성 완료 · 출력');
    expect(ts).toContain('gate.onPrint()');
    expect(ts).toContain('docprint-meddoc-print-');
    expect(ts).toContain('docprint-meddoc-locked-');
    // data-authored 디버그 속성(현장 검증) 보존
    expect(ts).toContain("data-authored={isGated ? (gate.authored ? 'true' : 'false') : undefined}");
  });

  // AC-4: 건수 배지·좌표 경고 인라인 보존
  test('AC-4: 건수 배지/좌표 미설정 경고 보존', () => {
    const ts = templateSection();
    expect(ts).toContain('submissionCount');
    expect(ts).toContain('건');
    expect(ts).toContain('좌표 미설정');
  });

  // AC-5(구조): 2번차트 재발급 모달 = 동일 DocumentPrintPanel 재사용(컴포넌트 단일화 일관성)
  test('AC-5: 2번차트 서류 재발급 모달 = 동일 DocumentPrintPanel 재사용', () => {
    const cp = chartPage();
    expect(cp).toContain('서류 재발급');
    // 재발급 모달이 별도 카드 UI가 아니라 DocumentPrintPanel 을 그대로 렌더 → 본 변경이 자동 반영
    const reissueIdx = cp.indexOf('서류 재발급 —');
    expect(reissueIdx).toBeGreaterThan(-1);
    const after = cp.slice(reissueIdx, reissueIdx + 600);
    expect(after).toContain('<DocumentPrintPanel');
  });
});

/**
 * ─── 갤탭 실기기 현장 confirm 체크리스트 (done 전제) ───
 * [ ] 시나리오1: 1번차트 진입 → 서류발행 영역이 체크박스+서류명 1줄 행 리스트(컬러박스 카드 아님)로 렌더
 * [ ] 시나리오1: "진료비 계산서·영수증" 행 체크 → 하단 일괄 출력 버튼 활성/동작
 * [ ] 시나리오1: "소견서"(원장 작성 필요) 행은 🔒 + 비활성(미작성) / 작성완료 시 🖨️ 출력
 * [ ] 시나리오1: "상세 발행 →" 클릭 → 기존 IssueDialog 진입 동일
 * [ ] 시나리오2: 2번차트 → 진료내역 → "서류재출력" → 재발급 모달 내부도 행 리스트로 렌더
 * [ ] 시나리오2: 모달 내 서류 1건 체크 → 출력 정상
 * [ ] 시나리오3: 행 리스트 전환 후 서류 종류·순서·발행 로직 기존과 동일
 */

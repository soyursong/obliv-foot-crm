/**
 * E2E spec — T-20260620-foot-CHART2-CONSULT-TAB-LAYOUT-3SECTION
 * 2번차트(고객차트) [상담내역] 탭 3섹션 박스 레이아웃 재구성 (김주연 총괄 명시 재정의)
 *
 * 목표 레이아웃 (세로 순서):
 *   1줄: 환불/비급여 동의서(좌) · 발건강 질문지(우) — 나란히 한 줄 (grid 2col)
 *   2줄: 소견서 & 진단서 요청 (placeholder, 기능=별도티켓 OPINION-SELECT-BOX-LINK)
 *   3줄: 결제영수증 (ReceiptUploadSection — 기존 wiring 유지)
 *
 * AC-1: 1줄 — 환불/비급여 동의서(좌)·발건강 질문지(우) 박스 나란히 (grid sm:grid-cols-2). 각 박스 '내용보기' 유지.
 * AC-2: 펜차트 '작성' 진입 버튼 제거 재확인 — 두 박스 어디에도 "펜차트에서 작성" 없음. '내용보기'(읽기전용)만.
 * AC-3: 발건강 질문지 '내용보기' = 현행 HEALTHQ-VIEWER(in-modal) 재사용 (openSubmissionViewer(3)).
 * AC-4: 3섹션 세로 순서 — 1줄(forms) → 2줄(opinion) → 3줄(receipt).
 * AC-5: 영역 무침범·회귀0 — 기존 뷰어(환불/발건강/결제영수증) 정상 동작.
 *
 * 검증 방식: 인증 우회 불가(현장 계정 PHI) → 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   기존 [내용보기] 활성/비활성 판정 로직 회귀 가드. 실브라우저 클릭 시나리오는 하단 체크리스트.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const chartPath = path.join(__dirname, '../../src/pages/CustomerChartPage.tsx');
const readChart = () => fs.readFileSync(chartPath, 'utf8');

// 상담내역 탭 본문만 슬라이스 (consultations 블록 ~ 다음 탭 경계 progress)
function consultBlock(src: string): string {
  const start = src.indexOf("chartTab === 'consultations'");
  const end = src.indexOf("chartTab === 'progress'", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

test.describe('T-20260620-foot-CHART2-CONSULT-TAB-LAYOUT-3SECTION — 상담내역 3섹션 레이아웃', () => {

  // 앱 정상 로드 (회귀 가드)
  test('AC-5: 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1: 1줄 — 환불/비급여 동의서(좌)·발건강 질문지(우) 나란히 grid 배치
  test('AC-1: 1줄 환불·발건강 박스 나란히 (grid 2col)', () => {
    const block = consultBlock(readChart());
    // 두 박스를 감싸는 grid 컨테이너
    expect(block).toContain('data-testid="consult-section-forms"');
    expect(block).toContain('sm:grid-cols-2');
    // 좌: 환불, 우: 발건강 박스 식별
    expect(block).toContain('data-testid="consult-box-refund"');
    expect(block).toContain('data-testid="consult-box-healthq"');
    // 좌(환불)가 우(발건강)보다 먼저 (DOM 순서 = 좌→우)
    const refundIdx = block.indexOf('data-testid="consult-box-refund"');
    const healthqIdx = block.indexOf('data-testid="consult-box-healthq"');
    expect(refundIdx).toBeLessThan(healthqIdx);
    // 각 박스 '내용보기' 버튼 유지
    expect(block).toContain('data-testid="refund-view-btn"');
    expect(block).toContain('data-testid="healthq-view-btn"');
  });

  // AC-2: 펜차트 '작성' 진입 버튼 제거 재확인 (핵심 회귀 락)
  test('AC-2: "펜차트에서 작성" 진입 버튼 상담내역 탭에서 제거됨', () => {
    const block = consultBlock(readChart());
    // 상담내역 탭 본문에 작성 진입 버튼 텍스트 없음
    expect(block).not.toContain('펜차트에서 작성');
    // 작성 진입 핸들러(펜차트 탭 이동)도 상담내역 박스에서 호출 안 함
    expect(block).not.toContain("handleClinicalTab('pen_chart')");
    // '내용보기'(읽기전용)는 두 박스 모두 유지
    expect((block.match(/내용보기/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // AC-3: 발건강 '내용보기' = 현행 in-modal 뷰어(openSubmissionViewer(3)) 재사용
  test('AC-3: 발건강 내용보기 = 현행 HEALTHQ-VIEWER 재사용', () => {
    const block = consultBlock(readChart());
    // 발건강 박스 내 내용보기 핸들러가 group 3 뷰어 호출
    expect(block).toContain('openSubmissionViewer(3, customer.id)');
    expect(block).toContain('setViewDocGroup(3)');
    // 환불 박스는 group 2 뷰어 유지
    expect(block).toContain('openSubmissionViewer(2, customer.id)');
    expect(block).toContain('setViewDocGroup(2)');
  });

  // AC-4: 3섹션 세로 순서 — forms → opinion → receipt
  test('AC-4: 3섹션 세로 순서 (1줄 forms → 2줄 opinion → 3줄 receipt)', () => {
    const block = consultBlock(readChart());
    const formsIdx   = block.indexOf('data-testid="consult-section-forms"');
    const opinionIdx = block.indexOf('data-testid="consult-section-opinion"');
    const receiptIdx = block.indexOf('data-testid="consult-section-receipt"');
    expect(formsIdx).toBeGreaterThan(-1);
    expect(opinionIdx).toBeGreaterThan(-1);
    expect(receiptIdx).toBeGreaterThan(-1);
    // 순서: forms < opinion < receipt
    expect(formsIdx).toBeLessThan(opinionIdx);
    expect(opinionIdx).toBeLessThan(receiptIdx);
    // 2줄: 소견서 & 진단서 요청 placeholder
    expect(block).toContain('소견서');
    expect(block).toContain('진단서 요청');
    // 3줄: 결제영수증 wiring 유지
    expect(block).toContain('ReceiptUploadSection');
  });

  // AC-5: 회귀 — 기존 환불/발건강 [내용보기] 활성/비활성 판정 로직 보존
  test('AC-5: [내용보기] 활성/비활성 판정 로직 회귀 없음', () => {
    const block = consultBlock(readChart());
    // 환불: refund_consent / refund / non_covered 기반 disabled 판정 유지
    expect(block).toContain("template_key === 'refund_consent'");
    expect(block).toContain("form_type === 'refund'");
    expect(block).toContain("form_type === 'non_covered'");
    // 발건강: 펜차트(form_submissions) OR 자가작성(health_q_results) 판정 유지
    expect(block).toContain("template_key?.startsWith('health_questionnaire_')");
    expect(block).toContain('healthQResults.length === 0');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 3섹션 레이아웃 렌더 (정상 동선) — AC-1/AC-4
 *   1. 로그인 → 고객 차트(2번차트) 상세 진입
 *   2. "상담내역" 탭 클릭
 *   3. 1줄에 [환불/비급여 동의서](좌) · [발건강 질문지](우) 박스가 나란히 한 줄로 보이는지 확인
 *   4. 2줄에 [소견서 & 진단서 요청] 박스, 3줄에 [결제영수증] 박스가 순서대로 보이는지 확인
 *   Expected: 1줄 좌우 2박스 → 2줄 소견서&진단서 → 3줄 결제영수증. 넓은 화면에서 1줄 한 줄 유지.
 *
 * [시나리오2] 내용보기 유지 / 작성 진입 제거 — AC-2/AC-3
 *   1. 환불/비급여 동의서 박스 → "내용보기" 클릭 → 기작성 내용 읽기전용 표시(group2 뷰어)
 *   2. 발건강 질문지 박스 → "내용보기" 클릭 → 현행 뷰어(구조화 텍스트, group3) 표시
 *   3. 두 박스 어디에도 "펜차트에서 작성" 진입 버튼이 없음 확인
 *   Expected: 내용보기만 노출. 작성 진입 버튼 0개.
 *
 * [시나리오3] 엣지 — 데이터 없는 환자 — AC-1/AC-5
 *   1. 환불/발건강 작성분이 없는 환자에서 상담내역 탭 진입
 *   2. 두 박스가 깨지지 않고 '○'(미작성) 상태 + 내용보기 버튼 disabled 로 안전 표시
 *   Expected: 레이아웃 정상, 내용보기 비활성(opacity-40), 토스트/에러 없음.
 *
 * 비고: FOOTQ-VIEWER(blocked) '이미지화 별도창'은 본 티켓 범위 밖 — 현행 in-modal 뷰어를
 *   '내용보기'로 채택. 총괄이 배포 후 이미지화 재요구 시 FOOTQ-VIEWER 재open.
 */

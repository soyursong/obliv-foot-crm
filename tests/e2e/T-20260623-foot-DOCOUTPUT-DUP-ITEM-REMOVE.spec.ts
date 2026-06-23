/**
 * E2E spec — T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE
 *
 * 현장결정 A+merge (김주연 총괄, 2026-06-23 12:19):
 *   DOCOUTPUT-COLORBOX-SIMPLIFY(서류출력 카드→행리스트 전환) 이후 행리스트 하단에 잔존하던
 *   별도 "진료비 영수증 재발급" 컬러카드 블록을 완전 제거 + 그 3개 고유기능을
 *   상단 "서류 출력" 목록의 '진료비 계산서·영수증'(bill_receipt) 행 → "영수증 관리" 펼침 패널로 통합(기능손실 0).
 *
 * 두 화면(1번차트 서류발행 / 2번차트 진료내역 서류재출력 모달)은 동일 DocumentPrintPanel 공유 → 동시 적용.
 *
 * AC-1 : 하단 별도 "진료비 영수증 재발급" 컬러카드 블록(bg-amber-50 colorbox, grid)이 제거됨.
 * AC-2 : 3개 고유기능이 receiptManagePanel 로 보존 — ①결제기록 재발급(handleReceiptReissue)
 *        ②등록영수증 보기·출력·삭제(printInvoice/deleteInvoice) ③금액수기+PDF 수기등록(setInvoiceOpen→InvoiceDialog).
 * AC-3 : receiptManagePanel 이 '진료비 계산서·영수증'(bill_receipt) 행의 "영수증 관리" 펼침 토글로 연결됨.
 * AC-4 : 빈카드 이슈 해소 — 컬러카드가 사라져 결제0건 환자에서 빈 컬러박스가 노출되지 않음.
 * AC-5 : DOCOUTPUT-COLORBOX-SIMPLIFY 배포분 회귀0 — TemplateSection 행 리스트/상세 발행/게이트 보존.
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

// receiptManagePanel(영수증 관리 펼침 패널) 본문만 좁혀서 검증
function receiptPanel(): string {
  const src = dpp();
  const start = src.indexOf('const receiptManagePanel = (');
  expect(start).toBeGreaterThan(-1);
  const after = src.indexOf('\n  return (', start);
  return after > start ? src.slice(start, after) : src.slice(start);
}

// TemplateSection 본문만 좁혀서 검증
function templateSection(): string {
  const src = dpp();
  const start = src.indexOf('function TemplateSection(');
  expect(start).toBeGreaterThan(-1);
  const after = src.indexOf('\n// ─── 단건 발행 다이얼로그 ───', start);
  return after > start ? src.slice(start, after) : src.slice(start);
}

test.describe('T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE — 잔존 "진료비 영수증 재발급" 중복 카드 제거 + 기능 통합', () => {

  // 앱 정상 로드 (회귀 가드)
  test('AC-5(load): 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1: 하단 별도 컬러카드 블록 제거
  test('AC-1: 별도 "진료비 영수증 재발급" 컬러카드 블록(bg-amber-50 colorbox) 제거', () => {
    const src = dpp();
    // 제거된 컬러카드 고유 마커: amber 컬러박스 배경 + 구 "등록 →" 버튼 텍스트
    expect(src).not.toContain('bg-amber-50 border-amber-200');
    expect(src).not.toContain('/> 등록 →');
    // 제거 사실을 명시한 정정 주석 존재(추적성)
    expect(src).toContain('T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE');
  });

  // AC-2: 3개 고유기능 보존 (receiptManagePanel)
  test('AC-2: 3개 고유기능 receiptManagePanel 로 보존 (기능손실 0)', () => {
    const src = dpp();
    expect(src).toContain('const receiptManagePanel = (');
    // ① 결제기록 기반 재발급
    expect(src).toContain('onClick={handleReceiptReissue}');
    expect(src).toContain('data-testid="docprint-receipt-reissue-btn"');
    // ② 등록 영수증 보기·출력·삭제
    expect(src).toContain('onClick={() => printInvoice(doc)}');
    expect(src).toContain('onClick={() => deleteInvoice(doc.id)}');
    expect(src).toContain('data-testid="docprint-receipt-print-btn"');
    expect(src).toContain('data-testid="docprint-receipt-delete-btn"');
    // ③ 금액 수기 + PDF 업로드 수기 등록 (InvoiceDialog)
    expect(src).toContain('onClick={() => setInvoiceOpen(true)}');
    expect(src).toContain('data-testid="docprint-receipt-manual-register-btn"');
    // 태블릿 도달성: 등록영수증 출력/삭제 액션이 hover 전용(hidden group-hover)이 아니어야 함 (패널 범위 한정)
    expect(receiptPanel()).not.toContain('hidden group-hover:flex');
  });

  // AC-3: '진료비 계산서·영수증'(bill_receipt) 행 → "영수증 관리" 펼침 토글로 연결
  test('AC-3: bill_receipt 행 "영수증 관리" 펼침 토글로 패널 연결', () => {
    const src = dpp();
    // 부모 → TemplateSection 으로 bill_receipt 행에만 패널 주입
    expect(src).toContain("renderRowExtra={(formKey) => (formKey === 'bill_receipt' ? receiptManagePanel : null)}");
    // TemplateSection 내부 펼침 토글/패널 렌더
    const ts = templateSection();
    expect(ts).toContain('renderRowExtra?.(tpl.form_key)');
    expect(ts).toContain('const [expandedKey, setExpandedKey] = useState<string | null>(null)');
    expect(ts).toContain('docprint-receipt-manage-toggle-');
    expect(ts).toContain('영수증 관리');
    expect(ts).toContain('docprint-row-extra-');
    // 게이트 행에는 패널을 붙이지 않음(소견서·진단서 보호)
    expect(ts).toContain('const rowExtra = !isGated ? (renderRowExtra?.(tpl.form_key) ?? null) : null');
  });

  // AC-4: 빈카드 이슈 해소 — 결제0건 안내는 펼침 패널 내부에서만(별도 빈 컬러박스 노출 X)
  test('AC-4: 빈카드 이슈 해소 — 결제0건 안내가 펼침 패널 내부로 한정', () => {
    const src = dpp();
    // "결제 내역이 없습니다" 안내는 receiptManagePanel(펼침) 내부에만 존재
    const panelStart = src.indexOf('const receiptManagePanel = (');
    const panelEnd = src.indexOf('\n  return (', panelStart);
    const panel = src.slice(panelStart, panelEnd);
    expect(panel).toContain('이 방문의 결제 내역이 없습니다.');
    // 항상 노출되던 별도 컬러카드가 사라졌으므로 결제0건에서 빈 박스가 기본 렌더되지 않음
    expect(src).not.toContain('bg-amber-50 border-amber-200');
  });

  // AC-5: COLORBOX-SIMPLIFY 행 리스트 회귀 없음
  test('AC-5: 서류출력 행 리스트/상세 발행/게이트 보존 (COLORBOX-SIMPLIFY 회귀0)', () => {
    const ts = templateSection();
    expect(ts).toContain('data-testid="docprint-doc-list"');
    expect(ts).toContain('flex flex-col gap-1');
    expect(ts).toContain('onToggle(tpl.form_key)');
    expect(ts).toContain('상세 발행 →');
    expect(ts).toContain('onCardClick(tpl)');
    // 게이트(소견서·진단서) 보존
    expect(ts).toContain('원장 작성 필요');
    expect(ts).toContain('gate.onPrint()');
  });
});

/**
 * ─── 갤탭 실기기 현장 confirm 체크리스트 (done 전제) ───
 * 시나리오1: 1번차트 — 카드 제거 + 기능 통합
 * [ ] 1번차트 진입 → 서류발행 영역 "서류 출력" 행 리스트 정상(회귀0)
 * [ ] 리스트 하단 "진료비 영수증 재발급" 컬러카드 섹션이 더 이상 표시되지 않음
 * [ ] "진료비 계산서·영수증" 행 우측 "영수증 관리 ▾" 클릭 → 펼침 패널 노출
 * [ ] 펼침 패널에서 (a)결제기록 재발급 (b)등록영수증 보기·출력·삭제 (c)금액수기+PDF 등록 3기능 모두 진입 가능
 * 시나리오2: 2번차트 서류재출력 모달 — 동일
 * [ ] 2번차트 → 진료내역 → "서류재출력" → "서류 재발급" 모달 오픈, 행 리스트 정상
 * [ ] 모달 하단 "진료비 영수증 재발급" 카드 섹션 미표시
 * [ ] 모달 "진료비 계산서·영수증" 행 "영수증 관리"에서 재발급·영수증관리·수기등록 진입 가능
 * 시나리오3: 빈카드 + 회귀
 * [ ] 결제기록 0건 환자에서 빈 컬러박스가 노출되지 않음(펼치기 전 깔끔)
 * [ ] 서류 종류·순서·"상세 발행" 진입·잠금 동작·영수증 발급 경로가 기존과 동일
 */

/**
 * T-20260722-foot-BILLRECEIPT-MASTER-FIXES
 *
 * 진료비 계산서·영수증(신양식 bill_receipt_new) + 세부내역서(bill_detail) 통합 수정 묶음 불변식.
 * (현장 총괄 긴급 지시서 §1~§5. base=origin/main d461ab1e. db_change=false — 렌더/집계 표시층 한정.)
 *
 *   §1 🔴 선수금/패키지 차감 → ⑨ '이미 납부한 금액' 칸 신설 + ⑩ 토큰 분리({{due_amount}}=⑧−⑨).
 *        ⑨만 채우고 ⑩을 patient_amount 로 두면 "⑧-⑨" 라벨과 산술모순=허위영수증 재점화(codex 배포차단급).
 *   §2 🟠 refund(payment_type='refund') 순액 차감 — 환불 양수·active 이중합산 정정.
 *   §3 🟡 야간(공휴일)·환자구분 칸 [라벨][값] 2셀 분리(종전 한 셀 <br> crammed) + colspan 정합.
 *   §4 🟡 하단 안내문 공식 전문(별지 제6호서식) verbatim 교체 + 주(註) 행.
 *   §5 🟢 세부내역서 주민등록번호 제거(7→6칸). 타 서류(계산서·영수증·진단서·소견서) 주민번호 유지.
 *   §6 dedup — 패키지 전액차감(method='membership') 결제행은 ⑨에 반영 → ⑪ 이중계상 제외.
 *
 * 라이브 앱 회귀 아님 — 템플릿 렌더/바인딩 + 순수 산식 불변식(로그인 불요, 결정론적).
 * 공통 금지선: 금액 산식(⑧환자부담·공단 canon)·절사·항목표·급여분해 무접촉 — 납부박스 집계·칸분리·안내문·RRN 제거만.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { applyBillReceiptPaidBoxTokens } from '../../src/lib/footBilling';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const DPP_SRC = fs.readFileSync(path.join(ROOT, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const PMW_SRC = fs.readFileSync(path.join(ROOT, 'src/components/PaymentMiniWindow.tsx'), 'utf8');

function extractTemplate(name: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${name}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${name} 상수 존재`).not.toBeNull();
  return m![1];
}
const NEW_TPL = extractTemplate('BILL_RECEIPT_NEW_HTML');
const DETAIL_TPL = extractTemplate('BILL_DETAIL_HTML');
// HTML 주석(<!-- ... -->) 제거본 — 렌더 마크업만 검사(주석 내 history 문구 오탐 방지).
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');
const DETAIL_TPL_NC = stripComments(DETAIL_TPL);

test.describe('BILLRECEIPT-MASTER-FIXES — 선수금⑨·refund순액·칸분리·안내문·RRN제거', () => {
  // ══════════════ §1 시나리오 1: 선수금 완납건 영수증 (⑨ 신설 + ⑩ 토큰 분리) ══════════════

  test('§1-template: ⑨ 이미 납부한 금액 = {{already_paid}} 바인딩(빈 셀 아님)', () => {
    expect(NEW_TPL).toMatch(/⑨ 이미 납부한 금액<\/td><td class="rn-num">\{\{already_paid\}\}<\/td>/);
  });

  test('§1-template: ⑩ 납부할 금액 = {{due_amount}} 전용 토큰(★patient_amount 하드코딩 폐기 — 산술모순 방지)', () => {
    // ⑩ 셀은 due_amount 여야 하고 patient_amount 하드코딩이면 안 된다(codex 배포차단급).
    expect(NEW_TPL).toMatch(/⑩ 납부할 금액<br>\(⑧-⑨\)<\/td><td class="rn-num" style="font-weight:bold;">\{\{due_amount\}\}<\/td>/);
    expect(NEW_TPL).not.toMatch(/⑩ 납부할 금액<br>\(⑧-⑨\)<\/td><td class="rn-num" style="font-weight:bold;">\{\{patient_amount\}\}<\/td>/);
  });

  test('§1-golden: F-4990 선수금 300,000 완납 → ⑨=300,000, ⑩=8,800, 미납=0', () => {
    const v: Record<string, string> = {};
    // ⑧ 환자부담총액 308,800(상담실 선수금 300,000 + 데스크 진찰료 8,800). 데스크 카드 8,800 active.
    // ⑨ alreadyPaid = 300,000(패키지 세션 환자부담분).
    applyBillReceiptPaidBoxTokens(
      v,
      [{ method: 'card', amount: 8800, cash_receipt_issued: false, payment_type: 'payment' }],
      308800,
      300000,
    );
    expect(v.already_paid).toBe('300,000'); // ⑨
    expect(v.due_amount).toBe('8,800');     // ⑩ = ⑧ − ⑨
    expect(v.card_amount).toBe('8,800');    // ⑪ 카드
    expect(v.paid_total).toBe('8,800');
    expect(v.unpaid_amount).toBe('0');      // ★미납 0 (기존 300,000 오표기 소멸)
  });

  test('§1-regression: 직접결제만(선수금 없음) → ⑨ 공란, ⑩=⑧, 값 불변', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(
      v,
      [{ method: 'card', amount: 50000, cash_receipt_issued: false, payment_type: 'payment' }],
      50000,
      0, // alreadyPaid 없음
    );
    expect(v.already_paid).toBe('');    // ⑨ 공란(종전 빈 셀 유지)
    expect(v.due_amount).toBe('50,000'); // ⑩ = ⑧
    expect(v.unpaid_amount).toBe('0');
  });

  test('§1-guard: ⑨(alreadyPaid) > ⑧(patientAmount) 이어도 ⑩ 음수 방지(그레인 가드)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(v, [], 100000, 130000);
    expect(v.due_amount).toBe('0');    // max(0, ⑧−⑨)
    expect(v.unpaid_amount).toBe('0');
  });

  // ══════════════ §1 시나리오 2: 3경로 패리티 (path-sweeper) ══════════════

  test('§1-path-sweeper: 3 호출부 모두 alreadyPaid(4번째 인자) 전달', () => {
    // 단건(DPP useMemo) — alreadyPaidAmount 상태 전달.
    expect(DPP_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(base, paymentItems, patientFloored, alreadyPaidAmount\)/);
    // 일괄(DPP handleBatchPrint) — batchAlreadyPaid 전달.
    expect(DPP_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(v, paymentItems, patientFloored, batchAlreadyPaid\)/);
    // 결제창(PMW) — alreadyPaid 전달.
    expect(PMW_SRC).toMatch(/applyBillReceiptPaidBoxTokens\(\s*autoValues,[\s\S]*?patientFloored,\s*alreadyPaid,\s*\)/);
  });

  test('§1-path-sweeper: 3 경로 모두 loadAlreadyPaidAmount(SSOT 소스) 로드', () => {
    // package_payments 원장 금지 — check_in_services 정합 소스만.
    expect(DPP_SRC).toMatch(/loadAlreadyPaidAmount\(checkIn\.id, customerInsuranceGrade\)/); // 일괄
    expect(DPP_SRC).toMatch(/loadAlreadyPaidAmount\(checkIn\.id, grade\)/);                  // 단건(effect)
    expect(PMW_SRC).toMatch(/loadAlreadyPaidAmount\(checkIn\.id, customerInsuranceGrade\)/);  // 결제창
  });

  test('§1-parity: 동일 입력 → 3경로 헬퍼 산출 동일(같은 SSOT 헬퍼)', () => {
    const args: [Record<string, string>, Parameters<typeof applyBillReceiptPaidBoxTokens>[1], number, number] =
      [{}, [{ method: 'card', amount: 8800, cash_receipt_issued: false, payment_type: 'payment' }], 308800, 300000];
    const a: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(a, args[1], 308800, 300000);
    const b: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(b, args[1], 308800, 300000);
    const c: Record<string, string> = {}; applyBillReceiptPaidBoxTokens(c, args[1], 308800, 300000);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    void args;
  });

  // ══════════════ §2 시나리오 3: 환불(refund) 순액 ══════════════

  test('§2-refund: payment_type=refund 는 결제로 가산 안 됨(순액 = Σ결제 − Σ환불)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(
      v,
      [
        { method: 'card', amount: 100000, cash_receipt_issued: false, payment_type: 'payment' },
        { method: 'card', amount: 30000, cash_receipt_issued: false, payment_type: 'refund' }, // 환불 30,000
      ],
      100000,
      0,
    );
    expect(v.card_amount).toBe('70,000'); // 100,000 − 30,000
    expect(v.paid_total).toBe('70,000');  // 이중합산 아님
    expect(v.unpaid_amount).toBe('30,000'); // ⑩(100,000) − 실납부(70,000)
  });

  test('§2-refund-noaffect: 종전 payment_type 무전달(기존 테스트) 시 전부 결제로 합산(회귀0)', () => {
    const v: Record<string, string> = {};
    applyBillReceiptPaidBoxTokens(v, [{ method: 'card', amount: 8800, cash_receipt_issued: false }], 308800);
    expect(v.card_amount).toBe('8,800');
    expect(v.unpaid_amount).toBe('300,000'); // alreadyPaid 기본 0 → 종전 골든과 동일
  });

  // ══════════════ §6 dedup: membership 결제행 ⑪ 제외 ══════════════

  test('§6-dedup: method=membership(패키지 전액차감) 결제행은 ⑪ 버킷에서 제외(⑨ 이중계상 방지)', () => {
    const v: Record<string, string> = {};
    // 패키지 전액차감 300,000(membership 결제행 존재) + 데스크 카드 8,800.
    applyBillReceiptPaidBoxTokens(
      v,
      [
        { method: 'membership', amount: 300000, cash_receipt_issued: false, payment_type: 'payment' },
        { method: 'card', amount: 8800, cash_receipt_issued: false, payment_type: 'payment' },
      ],
      308800,
      300000, // ⑨ = 패키지 차감분
    );
    expect(v.cash_amount).toBe('');       // membership 이 cash 버킷에 안 잡힘
    expect(v.card_amount).toBe('8,800');
    expect(v.paid_total).toBe('8,800');   // membership 제외 → ⑪ = 데스크 카드만
    expect(v.already_paid).toBe('300,000'); // ⑨ 에만 표기
    expect(v.unpaid_amount).toBe('0');
  });

  // ══════════════ §3 시나리오 4-a: 상단 칸 분리 ══════════════

  test('§3-nightcell: 야간(공휴일) [라벨][값] 2셀 분리(한 셀 <br> crammed 폐기)', () => {
    expect(NEW_TPL).toMatch(/<td class="rn-lbl" style="font-size:6\.4pt;">야간\(공휴일\)<\/td><td style="font-size:6\.4pt;">\[\{\{night_mark\}\}\]야간 \[\{\{holiday_mark\}\}\]공휴일<\/td>/);
    expect(NEW_TPL).not.toMatch(/야간\(공휴일\)<br>\[\{\{night_mark\}\}\]/);
  });

  test('§3-patientcell: 환자구분 [라벨][값] 2셀 분리', () => {
    expect(NEW_TPL).toMatch(/<td class="rn-lbl" style="font-size:6\.4pt;">환자구분<\/td><td style="font-size:6\.4pt;">건강보험<\/td>/);
    expect(NEW_TPL).not.toMatch(/환자구분<br>건강보험/);
  });

  test('§3-colspan: 8칸 colgroup + 영수증번호 행 colspan=7 정합', () => {
    // colgroup 8 col
    const cg = NEW_TPL.match(/<colgroup>((<col[^>]*>)+)<\/colgroup>/);
    expect(cg).not.toBeNull();
    expect((cg![1].match(/<col/g) ?? []).length).toBe(8);
    // 영수증번호 값 셀 colspan=7 (라벨 1칸 + 값 7칸 = 8)
    expect(NEW_TPL).toMatch(/영수증번호<\/td><td colspan="7"/);
  });

  // ══════════════ §4 시나리오 4-b: 하단 안내문 verbatim + 주(註) ══════════════

  test('§4-verbatim: 좌측 공식 전문(법정 문구·기호 「」※ㆍ verbatim)', () => {
    expect(NEW_TPL).toContain('「국민건강보험법」제41조의4에 따른 요양급여 여부');
    expect(NEW_TPL).toContain('외래 본인부담률: 요양기관 종별에 따라 30% ~ 60%(의료급여는 수급권자 종별 및 의료급여기관 유형 등에 따라 0원 ~ 2500원, 0% ~ 15%) 등');
    expect(NEW_TPL).toContain('CTㆍMRIㆍPET: 외래 본인부담률(의료급여는 입원 본인부담률과 동일)');
    expect(NEW_TPL).toContain('「국민건강보험법 시행규칙」 별표 6 또는 「의료급여법 시행규칙」 별표 1의2');
    expect(NEW_TPL).toContain('연간 500만원');
    expect(NEW_TPL).toContain('※ 전액본인부담 및 「국민건강보험법」제41조의4에 따른 요양급여의 본인부담금 등은 본인부담상한액 산정시 제외합니다');
  });

  test('§4-verbatim: 우측 공식 전문(심평원 ☏1644-2000·www.hira.or.kr·현금영수증 지출증빙)', () => {
    expect(NEW_TPL).toContain('「국민건강보험법」 제48조 또는 「의료급여법」 제11조의3');
    expect(NEW_TPL).toContain('건강보험심사평가원(☏1644-2000, 홈페이지: www.hira.or.kr)');
    expect(NEW_TPL).toContain('지출증빙용으로 발급된 "현금영수증(지출증빙)"은 공제신청에 사용할 수 없습니다');
    expect(NEW_TPL).toContain('현금영수증 문의 126 인터넷 홈페이지: http://현금영수증.kr');
  });

  test('§4-note: 주(註) 전체폭 행 추가(선택항목·야간공휴일 가산)', () => {
    expect(NEW_TPL).toMatch(/<td colspan="2"[^>]*>주\(註\): 진료항목 중 선택항목은 요양기관의 특성에 따라 추가 또는 생략할 수 있으며, 야간\(공휴일\)진료 시 진료비가 가산될 수 있습니다\.<\/td>/);
  });

  // ══════════════ §5 시나리오 5: 세부내역서 주민번호 제거 ══════════════

  test('§5-detail-rrn-removed: 세부내역서 환자 헤더 주민등록번호 th+td 제거', () => {
    // 렌더 마크업만 검사(주석 내 history/§5 설명 문구의 '주민등록번호' 오탐 방지 — DETAIL_TPL_NC).
    expect(DETAIL_TPL_NC).not.toContain('주민등록번호');
    // 세부내역서(bill_detail) 템플릿에는 patient_rrn 바인딩이 더 이상 없음.
    expect(DETAIL_TPL_NC).not.toContain('{{patient_rrn}}');
  });

  test('§5-detail-6cols: 환자 헤더 6칸(환자등록번호·환자성명·진료기간·병실·환자구분·비고)', () => {
    // 첫 thead 의 th 6개(주석 제거본 기준).
    const thead = DETAIL_TPL_NC.match(/<thead>\s*<tr>([\s\S]*?)<\/tr>\s*<\/thead>/);
    expect(thead).not.toBeNull();
    expect((thead![1].match(/<th/g) ?? []).length).toBe(6);
    expect(thead![1]).toContain('환자등록번호');
    expect(thead![1]).toContain('환자성명');
    expect(thead![1]).toContain('진료기간');
    expect(thead![1]).not.toContain('주민등록번호');
  });

  test('§5-others-keep-rrn: 타 서류(계산서·진단서·소견서 등)의 {{patient_rrn}} 유지', () => {
    // 세부내역서만 제거 — 파일 전체에는 여전히 다수 patient_rrn 존재.
    const count = (HTML_SRC.match(/\{\{patient_rrn\}\}/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  // ══════════════ 공통 금지선 ══════════════

  test('금지선: ⑧ 환자부담총액(patient_amount)·합계 aggregate 토큰 무접촉', () => {
    // ⑧ 셀은 여전히 patient_amount, ⑥/⑦ 도 유지(canon 무변경).
    expect(NEW_TPL).toMatch(/⑧ 환자부담 총액<br>\(①-⑤\)\+③\+④<\/td><td class="rn-num" style="font-weight:bold;">\{\{patient_amount\}\}<\/td>/);
    expect(NEW_TPL).toContain('① {{copayment}}');
    expect(NEW_TPL).toContain('② {{insurance_covered}}');
  });
});

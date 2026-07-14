/**
 * T-20260714-foot-FEEDOC-FORM-REDESIGN-BODYSTYLE — 진료비 계산서·영수증 도수센터 기준 개편 (시안 DRAFT)
 * 권위: 김주연 총괄 (MSG-20260714-102038-tjva / MSG-20260714-102405-q40a)
 *
 * 이 스펙은 "라이브 무접촉 + 시안-컨펌 게이트" 하드 제약을 코드레벨에서 고정한다.
 *   G1 (라이브 무접촉): 라이브 템플릿 모듈(htmlFormTemplates.ts)이 draft 모듈을 import 하지 않는다.
 *                        → draft 추가만으로 라이브 번들/출력경로 side-effect 0 (트리 셰이킹).
 *   G2 (라이브 미등록): draft HTML 이 라이브 레지스트리(getHtmlTemplate 'bill_receipt')로 승격되지 않았다.
 *                        → 컨펌 수신 후 별도 후속 티켓에서만 wiring.
 *   G3 (시안 정합): draft 템플릿이 별지 제6호서식 골격을 갖추고, 샘플 데이터로 전 placeholder가
 *                    치환되어 잔존 {{...}} 이 0건.
 *
 * ⚠ 실제 렌더 시안(PDF/PNG)은 scripts/render_feedoc_draft_preview.mjs 로 생성 →
 *    _artifacts/feedoc_preview/ (현장 컨펌용).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILL_RECEIPT_DRAFT_HTML } from '../../src/lib/draftFormTemplates';
import { getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_TEMPLATE_SRC = resolve(HERE, '../../src/lib/htmlFormTemplates.ts');

// 렌더 스크립트와 동일 취지의 샘플 (풋센터 발톱 시술 예시)
const SAMPLE: Record<string, string> = {
  record_no: '25-0731', patient_name: '홍길동', visit_date: '2026-07-14',
  department: '정형외과', receipt_no: 'F-20260714-0001',
  copayment: '4,500', insurance_covered: '10,500', proc_copay: '', proc_ins: '',
  full_copay: '0', noncovered_fee: '', non_covered: '150,000', overcap: '0',
  total_amount: '165,000', patient_amount: '154,500', paid_amount: '0',
  unpaid_amount: '154,500', card_amount: '154,500', cashreceipt_amount: '0',
  cash_amount: '0', paid_total: '154,500', remaining_amount: '0',
  clinic_biz_reg_no: '123-45-67890', clinic_company_name: '오블리브의원 종로점',
  clinic_phone: '02-000-0000', clinic_address: '서울특별시 종로구 (예시)',
  doctor_name: '문지은', stamp_img_html: '(인)', issue_date: '2026년 7월 14일',
};

test('G1 라이브 무접촉 — htmlFormTemplates.ts 가 draft 모듈을 import 하지 않음', () => {
  const liveSrc = readFileSync(LIVE_TEMPLATE_SRC, 'utf8');
  expect(liveSrc).not.toContain('draftFormTemplates');
  expect(liveSrc).not.toContain('BILL_RECEIPT_DRAFT_HTML');
});

test('G2 라이브 미등록 — draft HTML 이 bill_receipt 라이브 템플릿으로 승격되지 않음', () => {
  const live = getHtmlTemplate('bill_receipt');
  expect(live).toBeTruthy();
  expect(live).not.toBe(BILL_RECEIPT_DRAFT_HTML);
});

test('G3 시안 정합 — 별지 제6호서식 골격 + 샘플 치환 후 잔존 placeholder 0건', () => {
  // 별지 제6호서식 핵심 골격
  expect(BILL_RECEIPT_DRAFT_HTML).toContain('별지 제6호서식');
  expect(BILL_RECEIPT_DRAFT_HTML).toContain('진료비 계산서ㆍ영수증');
  expect(BILL_RECEIPT_DRAFT_HTML).toContain('금액산정내용');

  // 모든 placeholder 가 SAMPLE 에 매핑되는지 (미매핑 0)
  const keys = new Set(
    [...BILL_RECEIPT_DRAFT_HTML.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]),
  );
  const unmapped = [...keys].filter((k) => !(k in SAMPLE));
  expect(unmapped, `SAMPLE 미매핑 placeholder: ${unmapped.join(', ')}`).toEqual([]);

  // 치환 후 잔존 {{...}} 0건
  const filled = BILL_RECEIPT_DRAFT_HTML.replace(
    /\{\{\s*([\w]+)\s*\}\}/g,
    (_m, k: string) => SAMPLE[k] ?? '',
  );
  const leftover = [...filled.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[0]);
  expect(leftover).toEqual([]);
});

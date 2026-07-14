/**
 * T-20260714-foot-FEEDOC-FORM-REDESIGN-BODYSTYLE — 시안 렌더러 (라이브 무접촉)
 *
 * 도수센터 기준(별지 제6호서식) 진료비 계산서·영수증 DRAFT 를 샘플 데이터로 채워
 * PNG + PDF 시안을 mockups/ 아래 산출한다. 총괄 컨펌용 예시(AC3).
 *
 * ⛔️ 라이브 서류 출력 경로/템플릿/렌더 함수 무접촉. 이 스크립트는 src/lib/draftFormTemplates.ts
 *    (라이브 미등록 파일)만 읽어 setContent 로 렌더 → 실행 서버 불요, side-effect 0.
 *
 * 사용: node scripts/T-20260714-foot-FEEDOC-FORM-REDESIGN_render_sample.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'mockups', 'T-20260714-foot-FEEDOC-FORM-REDESIGN');
fs.mkdirSync(OUT, { recursive: true });

// draft 템플릿 문자열 추출 (라이브 레지스트리 미경유)
const src = fs.readFileSync(path.join(ROOT, 'src/lib/draftFormTemplates.ts'), 'utf8');
const m = src.match(/BILL_RECEIPT_DRAFT_HTML\s*=\s*`([\s\S]*?)`;/);
if (!m) { console.error('draft 템플릿 추출 실패'); process.exit(1); }
let html = m[1];

// 시안용 샘플 데이터 (실제 환자 데이터 아님 — 레이아웃 확인용 표본)
const SAMPLE = {
  record_no: '2026-000123',
  patient_name: '홍길동',
  visit_date: '2026-07-14',
  department: '진료과',          // 라이브 승격 시 clinic/진료과 바인딩
  receipt_no: 'OBF-20260714-0001',
  copayment: '3,600',
  insurance_covered: '8,400',
  proc_copay: '',
  proc_ins: '',
  noncovered_fee: '',
  full_copay: '0',
  non_covered: '150,000',
  overcap: '0',
  total_amount: '162,000',
  patient_amount: '153,600',
  paid_amount: '0',
  unpaid_amount: '153,600',
  card_amount: '153,600',
  cashreceipt_amount: '0',
  cash_amount: '0',
  paid_total: '153,600',
  remaining_amount: '0',
  clinic_biz_reg_no: '000-00-00000',
  clinic_company_name: '오블리브오리진',
  clinic_phone: '02-000-0000',
  clinic_address: '서울특별시 종로구 (오블리브 풋센터 종로)',
  doctor_name: '문지은',
  stamp_img_html: '(인)',
  issue_date: '2026년 7월 14일',
};
for (const [k, v] of Object.entries(SAMPLE)) {
  html = html.replaceAll(`{{${k}}}`, v);
}
// 미치환 placeholder 는 공란 처리
html = html.replace(/\{\{[a-z_]+\}\}/g, '');

const full = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
fs.writeFileSync(path.join(OUT, 'bill_receipt_draft_preview.html'), full);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 1400 } });
const p = await ctx.newPage();
await p.setContent(full, { waitUntil: 'networkidle' });
await p.waitForTimeout(300);

const el = await p.$('.r6-wrap');
await el.screenshot({ path: path.join(OUT, 'bill_receipt_draft_preview.png') });
await p.pdf({ path: path.join(OUT, 'bill_receipt_draft_preview.pdf'), format: 'A4', printBackground: true });

await b.close();
console.log('시안 산출 완료 →', OUT);
console.log(' - bill_receipt_draft_preview.png');
console.log(' - bill_receipt_draft_preview.pdf');
console.log(' - bill_receipt_draft_preview.html');

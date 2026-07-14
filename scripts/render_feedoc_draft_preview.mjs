/**
 * render_feedoc_draft_preview.mjs
 * T-20260714-foot-FEEDOC-FORM-REDESIGN-BODYSTYLE — 시안(preview) 렌더러
 *
 * 목적: BILL_RECEIPT_DRAFT_HTML(draftFormTemplates.ts) 을 샘플 데이터로 채워
 *       A4 PDF + PNG 시안을 생성한다. 현장 컨펌 요청용.
 *
 * ⛔️ 라이브 무접촉: 이 스크립트는 draft 템플릿만 읽고, htmlFormTemplates.ts /
 *    autoBindContext / 라이브 출력 경로를 일절 건드리지 않는다. 빌드 산출물에도
 *    포함되지 않는(트리 셰이킹 대상 외) 독립 노드 스크립트다.
 *
 * 사용: node scripts/render_feedoc_draft_preview.mjs
 * 산출: _artifacts/feedoc_preview/feedoc_receipt_draft.pdf / .png
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, '_artifacts/feedoc_preview');

// ── 1. draft 템플릿 추출 (텍스트 파싱, {{...}} placeholder만 있고 ${} 보간 없음) ──
const src = readFileSync(resolve(ROOT, 'src/lib/draftFormTemplates.ts'), 'utf8');
const marker = 'export const BILL_RECEIPT_DRAFT_HTML = `';
const start = src.indexOf(marker);
if (start < 0) throw new Error('BILL_RECEIPT_DRAFT_HTML 마커를 찾지 못함');
const from = start + marker.length;
const end = src.indexOf('`;', from);
if (end < 0) throw new Error('draft 템플릿 종료 백틱을 찾지 못함');
const template = src.slice(from, end);

// ── 2. 샘플 데이터 (풋센터 발톱 시술 예시 — 급여 진찰료 + 비급여 시술 혼합) ──
// ⚠️ 전부 예시값. 실제 라이브 바인딩(autoBindContext)과는 무관.
const SAMPLE = {
  record_no: '25-0731',
  patient_name: '홍길동',
  visit_date: '2026-07-14',
  department: '정형외과',
  receipt_no: 'F-20260714-0001',
  // 급여(진찰료)
  copayment: '4,500',          // ① 일부 본인부담 - 본인부담금
  insurance_covered: '10,500', // ② 공단부담금
  proc_copay: '',
  proc_ins: '',
  full_copay: '0',             // ③ 전액 본인부담
  noncovered_fee: '',
  non_covered: '150,000',      // ④ 비급여 (예: 내향성 발톱교정 시술)
  overcap: '0',                // ⑤ 상한액 초과금
  // 금액산정내용
  total_amount: '165,000',     // ⑥ = ①+②+③+④
  patient_amount: '154,500',   // ⑧ = (①-⑤)+③+④
  paid_amount: '0',            // ⑨ 이미 납부한 금액
  unpaid_amount: '154,500',    // ⑩ = ⑧-⑨
  card_amount: '154,500',
  cashreceipt_amount: '0',
  cash_amount: '0',
  paid_total: '154,500',       // ⑪ 합계
  remaining_amount: '0',
  // 요양기관
  clinic_biz_reg_no: '123-45-67890',
  clinic_company_name: '오블리브의원 종로점',
  clinic_phone: '02-000-0000',
  clinic_address: '서울특별시 종로구 종로 00, 0층 (예시 주소)',
  doctor_name: '문지은',
  stamp_img_html: '<span style="display:inline-block;border:1px dashed #bbb;color:#bbb;font-size:6pt;padding:6px 8px;border-radius:50%;">(인)</span>',
  issue_date: '2026년 7월 14일',
};

// ── 3. placeholder 치환 + 미채움 감지 ──
const seen = new Set();
const filled = template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key) => {
  seen.add(key);
  return key in SAMPLE ? SAMPLE[key] : `<span style="background:#ffe08a">〖${key}〗</span>`;
});
const leftover = [...filled.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]);
const unmapped = [...seen].filter((k) => !(k in SAMPLE));
console.log(`[render] placeholders in template: ${seen.size}`);
if (unmapped.length) console.log(`[render] ⚠️ SAMPLE 미매핑 placeholder: ${unmapped.join(', ')}`);
if (leftover.length) {
  console.error(`[render] ❌ 치환 후 잔존 {{...}}: ${leftover.join(', ')}`);
  process.exit(1);
}

// ── 4. 렌더 (A4 PDF + PNG) ──
mkdirSync(OUT_DIR, { recursive: true });
const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>${filled}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(doc, { waitUntil: 'networkidle' });

const pdfPath = resolve(OUT_DIR, 'feedoc_receipt_draft.pdf');
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });

const pngPath = resolve(OUT_DIR, 'feedoc_receipt_draft.png');
await page.setViewportSize({ width: 900, height: 1400 });
await page.screenshot({ path: pngPath, fullPage: true });

await browser.close();
console.log(`[render] ✅ PDF: ${pdfPath}`);
console.log(`[render] ✅ PNG: ${pngPath}`);

/**
 * T-20260722 diagnose 렌더 — bill_receipt_new 를 batch 경로 토큰셋 / IssueDialog 경로 토큰셋으로
 * 각각 바인딩해 ①검사료 ②납부금액 divergence 를 시각 산출(라이브 무접촉, READ-ONLY 템플릿 추출).
 *
 * 데이터: 실 서비스카탈로그 기반 표본 — 진찰료(급여) + KOH균검사(급여 검사) + 레이저(비급여 풋케어) + KOH도말(비급여 검사).
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'evidence', 'T-20260722-BILLRECEIPT-EXAM-PAIDAMT');
fs.mkdirSync(OUT, { recursive: true });

const src = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const m = src.match(/BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
if (!m) { console.error('템플릿 추출 실패'); process.exit(1); }
const tpl = m[1];

const fmt = (n) => n > 0 ? n.toLocaleString('ko-KR') : '';
const bind = (html, v) => html.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');

// 표본 청구(실 카탈로그): 진찰료 급여(본인1500/공단3500), KOH균검사 급여(본인600/공단1400),
//   가열성레이저 비급여 150000, KOH도말검사 비급여 30000.
// 급여 aggregate: copayment=2100, insurance_covered=4900. non_covered=180000.
// grandTotal = 2100+4900+180000 = 187000. patient = copay(2100)+noncov(180000)=182100 → floor 182100.
const copayment = 2100, insurance_covered = 4900, non_covered = 180000;
const grand = copayment + insurance_covered + non_covered; // 187000
const patientRaw = copayment + non_covered; // 182100
const patientFloor = Math.floor(patientRaw / 10) * 10; // 182100

// category 분해(정상 footFb 경로): 비급여 = 레이저(처치및수술료) 150000 + KOH도말(검사료) 30000
//   ★ 급여 KOH균검사(cov=true)는 breakdown 에서 skip → 검사료 행 급여칸 공란(진찰료 흡수).
const proc_noncov = 150000, exam_noncov = 30000, etc_noncov = 0;

// ── batch(일괄출력) 경로 토큰: 2c/2d 미적용 → patient_amount raw, prepaid 공란 ──
const batchTokens = {
  patient_name: '홍길동', visit_date: '2026-07-22', record_no: 'F-4302',
  copayment: fmt(copayment), insurance_covered: fmt(insurance_covered), non_covered: fmt(non_covered),
  total_amount: fmt(grand), proc_noncov: fmt(proc_noncov), exam_noncov: fmt(exam_noncov), etc_noncov: fmt(etc_noncov),
  patient_amount: fmt(patientRaw),   // ← 절사 미적용(2c 없음)
  prepaid_amount: '',                // ← ② 공란 (2d 미적용) = 납부금액 미표기
  unpaid_amount: '',
};

// ── IssueDialog(단건) 경로 토큰: 2c/2d 적용 ──
const issueTokens = {
  ...batchTokens,
  patient_amount: fmt(patientFloor),          // 2c 절사
  prepaid_amount: fmt(patientFloor),          // 2d 기본바인딩 = 납부할금액
  unpaid_amount: fmt(Math.max(0, patientFloor - patientFloor)),
};

const browser = await chromium.launch();
const pg = await browser.newPage();
for (const [name, tok] of [['batch_ilgwal', batchTokens], ['issuedialog_single', issueTokens]]) {
  const html = bind(tpl, tok);
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`[render] ${name} → prepaid_amount='${tok.prepaid_amount}' exam_noncov='${tok.exam_noncov}' patient='${tok.patient_amount}'`);
}
await browser.close();
console.log(`\n① 검사료: 급여 KOH균검사(cov=true)는 breakdown skip → 검사료 행 급여칸 공란, exam_noncov=30000(비급여 KOH도말만).`);
console.log(`② 납부금액: batch 경로 prepaid_amount 공란(⑪ 합계칸 비어), IssueDialog 경로만 채워짐 = 경로 비대칭.`);
console.log(`[out] ${OUT}`);

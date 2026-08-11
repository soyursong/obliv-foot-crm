// dev-foot 실렌더 evidence — T-20260811-foot-OPINIONDOC-DIAGDATE-ISSUEDATE-MISBIND (P1, scalp2 canonical 미러)
//   RC: 소견서(diag_opinion)·진단서(diagnosis) '진단일' 셀이 {{issue_date}}(=today)로 오바인딩 →
//       항상 '오늘'로 오출력 → 보험사 제출건 반려. 신규 전용 토큰 {{diagnosis_date}} 배선.
//   실제 코드경로(getHtmlTemplate+bindHtmlTemplate = LOGIC-LOCK L-006)로 두 양식을 렌더 →
//   진단일=과거 방문일 / 발행일=오늘 서로 다르게 렌더됨을 브라우저 스크린샷 + assert 로 실증(AC-1/2/5).
//   run: npx tsx scripts/T-20260811-foot-OPINIONDOC-DIAGDATE-ISSUEDATE-MISBIND_render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const HOME = process.env.HOME;
const SHOT = `${HOME}/claude-sync/memory/_handoff/qa_screenshots/T-20260811-foot-OPINIONDOC-DIAGDATE-ISSUEDATE-MISBIND`;
fs.mkdirSync(SHOT, { recursive: true });

const DIAG_DATE = '2026-08-01';        // 과거 앵커 방문(진단)일
const ISSUE_DATE = '2026-08-11';       // 오늘(발행일)

// autoBindContext 산출 토큰 + 본 티켓 신규 diagnosis_date 를 실제 값으로 주입
const SAMPLE = {
  record_no: 'FT-2026-00042', chart_number: 'FT-2026-00042',
  patient_name: '홍길동', patient_gender: '☑ 남  ☐ 여', patient_age: '42',
  patient_rrn: '840101-1******', patient_phone: '010-1234-5678', patient_address: '서울 종로구',
  diagnosis_ko: '양측 조갑진균증(L60.0)으로 인한 내향성 발톱 및 통증 소견. 처치 및 경과관찰이 의학적으로 필요함.',
  treatment_opinion: '내향성 발톱 교정 및 조갑진균증 처치 권고.',
  diag_code_1: 'L60.0', diag_name_1: '내향성 발톱',
  onset_date: '2026-07-01',
  diagnosis_date: DIAG_DATE,   // ★ 신규 전용 토큰 = 과거 방문일
  issue_date: ISSUE_DATE,      // 발행일 = 오늘(별개 축)
  visit_date: DIAG_DATE,
  clinic_name: '오블리브 풋센터 종로', clinic_address: '서울 종로구 ○○로 00', clinic_phone: '02-123-4567',
  doctor_name: '문지은', doctor_license_no: '145617', doctor_specialist_no: '145617',
  attending_doctor_name: '문지은',
  doctor_seal_html: '<span style="display:inline-block;border:1px solid #000;border-radius:50%;width:44px;height:44px;line-height:44px;text-align:center;font-size:8pt;">직인</span>',
};

function extractCell(html, label) {
  const re = new RegExp(`${label}[\\s\\S]*?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`);
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

const R = {
  ticket: 'T-20260811-foot-OPINIONDOC-DIAGDATE-ISSUEDATE-MISBIND',
  ts: new Date().toISOString(),
  render_path: 'getHtmlTemplate + bindHtmlTemplate (L-006 실코드경로) → chromium setContent 렌더',
  diag_date: DIAG_DATE, issue_date: ISSUE_DATE,
  forms: {}, pass: [], fail: [],
};
const check = (cond, name) => { (cond ? R.pass : R.fail).push(name); return !!cond; };

const browser = await chromium.launch();
for (const formKey of ['diag_opinion', 'diagnosis']) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { check(false, `${formKey} 템플릿 존재`); continue; }
  const html = bindHtmlTemplate(raw, SAMPLE);
  const diagCell = extractCell(html, '진 단 일');
  const issueCell = extractCell(html, '발 행 일');
  R.forms[formKey] = { diag_cell: diagCell, issue_cell: issueCell };

  check(diagCell === DIAG_DATE, `${formKey} AC: 진단일 셀 = 방문일(${DIAG_DATE}) [렌더="${diagCell}"]`);
  check(issueCell.includes(ISSUE_DATE), `${formKey} AC-5: 발행일 셀 = 오늘 유지 [렌더="${issueCell}"]`);
  check(diagCell !== issueCell, `${formKey} AC-1/2: 진단일 ≠ 발행일 (서로 다르게 렌더)`);

  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">` +
      `<style>@page{size:A4 portrait;margin:0}body{margin:0;padding:10mm}</style></head>` +
      `<body>${html}</body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.screenshot({ path: `${SHOT}/${formKey}_diagdate_vs_issuedate.png`, fullPage: true });
  await page.close();
}
await browser.close();

R.verdict = R.fail.length === 0 ? 'RENDER PASS' : 'RENDER FAIL';
console.log(JSON.stringify(R, null, 2));
fs.writeFileSync(`${SHOT}/render_result.json`, JSON.stringify(R, null, 2));
process.exit(R.fail.length === 0 ? 0 : 1);

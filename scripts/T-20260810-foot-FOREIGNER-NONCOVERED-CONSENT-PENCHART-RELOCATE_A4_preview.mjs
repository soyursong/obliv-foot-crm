/**
 * T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE — A4 preview 렌더러
 *   (김주연 총괄 "일단 올려봐" 미리보기 제출용, MSG-20260810-163808-n7zv)
 *
 * 외국인 비급여 진료 동의서가 펜차트 양식 탭으로 재배치된 뒤의 A4 손서명 서식을
 *   라이브 템플릿 레지스트리(FOREIGNER_NONCOVERED_CONSENT_HTML) 그대로 렌더 → A4 PNG/PDF 산출.
 *   PenChartTab 이 draw 진입 시 이 HTML 을 html2canvas 로 래스터화(bindHtmlTemplate: 날짜=오늘·성명=환자)
 *   하는 것과 동일 문안. side-effect 0(setContent only, 서버 불요).
 *
 * 사용: node scripts/T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE_A4_preview.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'evidence');
fs.mkdirSync(OUT, { recursive: true });

const STEM = 'T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE_A4_preview';

// 라이브 템플릿 소스에서 직접 추출 (레지스트리 = htmlFormTemplates.ts)
const src = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const m = src.match(/const FOREIGNER_NONCOVERED_CONSENT_HTML = `([\s\S]*?)`;/);
if (!m) { console.error('FOREIGNER_NONCOVERED_CONSENT_HTML 추출 실패'); process.exit(1); }
let html = m[1];

// COMMON_STYLE 추출 (템플릿 상단이 ${COMMON_STYLE} 참조)
const cs = src.match(/const COMMON_STYLE = `([\s\S]*?)`;/);
const commonStyle = cs ? cs[1] : '';
html = html.replace('${COMMON_STYLE}', commonStyle);

// 자동채움 바인딩 (날짜=오늘·성명=환자·기관) — PenChartTab bindHtmlTemplate 과 동일 키
const BIND = {
  issue_date: new Date().toLocaleDateString('ko-KR'),
  patient_name: '홍길동',
  clinic_name: '종로 오블리브 풋케어',
};
for (const [k, v] of Object.entries(BIND)) html = html.replaceAll(`{{${k}}}`, v);
html = html.replace(/\{\{[a-z_]+\}\}/g, '');

// A4 = 794 x 1123 px @96dpi
const full = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0} body{margin:0;background:#fff}</style></head><body>${html}</body></html>`;
fs.writeFileSync(path.join(OUT, `${STEM}.html`), full);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.setContent(full, { waitUntil: 'networkidle' });
await p.waitForTimeout(300);

const wrap = await p.$('.form-wrap');
const box = await wrap.boundingBox();
console.log(`form-wrap 렌더 높이 = ${Math.round(box.height)}px (A4 1페이지=1123px, 초과 시 멀티페이지 인쇄)`);

await p.screenshot({ path: path.join(OUT, `${STEM}.png`), fullPage: true });
await p.pdf({ path: path.join(OUT, `${STEM}.pdf`), format: 'A4', printBackground: true });

await b.close();
console.log('A4 preview 산출 완료 → evidence/');
console.log(` - ${STEM}.png`);
console.log(` - ${STEM}.pdf`);

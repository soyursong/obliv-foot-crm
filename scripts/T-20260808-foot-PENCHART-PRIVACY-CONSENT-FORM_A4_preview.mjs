/**
 * T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM — A4 재-preview 렌더러 (AC-5 재-confirm 게이트용)
 *
 * FIX(2026-08-09): AC-6 고유식별정보(개보법 §24) 블록 추가 + AC-7 레이아웃 간격 확대 반영본을
 *   라이브 템플릿 레지스트리(getHtmlTemplate/bindHtmlTemplate) 그대로 렌더 → A4 PNG 산출.
 *   김주연 총괄 재-confirm 제출용 evidence. side-effect 0(setContent only, 서버 불요).
 *
 * 사용: node scripts/T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'evidence');
fs.mkdirSync(OUT, { recursive: true });

// 라이브 템플릿 소스에서 직접 추출 (레지스트리 = htmlFormTemplates.ts)
const src = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const m = src.match(/const PRIVACY_CONSENT_FORM_HTML = `([\s\S]*?)`;/);
if (!m) { console.error('PRIVACY_CONSENT_FORM_HTML 추출 실패'); process.exit(1); }
let html = m[1];

// COMMON_STYLE 추출 (템플릿 상단이 ${COMMON_STYLE} 참조)
const cs = src.match(/const COMMON_STYLE = `([\s\S]*?)`;/);
const commonStyle = cs ? cs[1] : '';
html = html.replace('${COMMON_STYLE}', commonStyle);

// 자동채움 바인딩 (성명·발행일·기관)
const BIND = {
  issue_date: '2026-08-09',
  patient_name: '홍길동',
  clinic_name: '종로 오블리브 풋케어',
};
for (const [k, v] of Object.entries(BIND)) html = html.replaceAll(`{{${k}}}`, v);
html = html.replace(/\{\{[a-z_]+\}\}/g, '');

// A4 = 794 x 1123 px @96dpi
const full = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0} body{margin:0;background:#fff}</style></head><body>${html}</body></html>`;
fs.writeFileSync(path.join(OUT, 'T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.html'), full);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.setContent(full, { waitUntil: 'networkidle' });
await p.waitForTimeout(300);

const wrap = await p.$('.form-wrap');
const box = await wrap.boundingBox();
console.log(`form-wrap 렌더 높이 = ${Math.round(box.height)}px (A4 1페이지=1123px, 초과 시 멀티페이지 인쇄)`);

await p.screenshot({
  path: path.join(OUT, 'T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.png'),
  fullPage: true,
});
await p.pdf({ path: path.join(OUT, 'T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.pdf'), format: 'A4', printBackground: true });

await b.close();
console.log('A4 재-preview 산출 완료 → evidence/');
console.log(' - T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.png');
console.log(' - T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM_A4_preview.pdf');

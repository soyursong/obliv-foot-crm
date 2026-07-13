/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN2 asset-swap] — 라이브 렌더 실측 하니스.
 * 실 storage seal(seal_image_url→signed URL)을 실 빌링서식 2종(bill_detail '대표자' /
 * bill_receipt '진료의사')에 autoBindContext와 동일한 doctor_seal_html로 주입 → 스크린샷.
 * 진료의(한동훈/김윤기/김상은)별 해당 도장만 찍히는지(오매핑 0) 육안 검증 근거 생성.
 * 실행: node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seal_render.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DOCTORS = ['한동훈', '김윤기', '김상은'];

// autoBindContext.ts doctor_seal_html 와 동일
const sealHtml = (url) => `<img src="${url}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`;

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', patient_name: '홍길동',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678', birth_date: '1990-01-01',
  rrn_front: '900101', rrn_back: '1234567', visit_date: '2026-07-14',
  issue_date: '2026년 07월 14일', year: '2026', month: '07',
  clinic_name: '오블리브의원 종로점', clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  total_amount: '120,000', patient_pay: '120,000',
  items_html: '<tr><td>2026-07-14</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
};

fs.mkdirSync(path.join(REPO, 'evidence/seal-swap'), { recursive: true });
const browser = await chromium.launch();
let fail = 0;
for (const name of DOCTORS) {
  const { data: row } = await sb.from('clinic_doctors').select('id,name,seal_image_url,license_no').eq('clinic_id', CLINIC).eq('name', name).maybeSingle();
  if (!row?.seal_image_url) { console.log(`  ❌ ${name}: seal_image_url 없음`); fail++; continue; }
  const { data: signed } = await sb.storage.from('documents').createSignedUrl(row.seal_image_url, 3600);
  const values = { ...SAMPLE, doctor_name: name, doctor_license_no: row.license_no || '제00000호', doctor_seal_html: sealHtml(signed.signedUrl) };
  for (const [formKey, orient] of [['bill_detail', 'landscape'], ['bill_receipt', 'portrait']]) {
    const raw = getHtmlTemplate(formKey);
    const html = bindHtmlTemplate(raw, values);
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    const w = orient === 'landscape' ? 297 : 210, h = orient === 'landscape' ? 210 : 297;
    await page.setViewportSize({ width: Math.round(w * 96 / 25.4), height: Math.round(h * 96 / 25.4) });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    await page.waitForLoadState('networkidle');
    const out = path.join(REPO, `evidence/seal-swap/${formKey}-${name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    // seal img가 실제 로드됐는지(naturalWidth>0) + src에 해당 doctor storage path 포함 확인
    const info = await page.evaluate(() => { const im = document.querySelector('img[src*="seals"]'); return im ? { loaded: im.naturalWidth > 0, src: im.src } : null; });
    const okPath = info && info.src.includes(row.id);
    console.log(`  ${okPath && info.loaded ? '✅' : '❌'} ${formKey}/${name}: loaded=${info?.loaded} src-has-doctorId(${row.id.slice(0,8)})=${okPath}`);
    if (!(okPath && info?.loaded)) fail++;
    await page.close();
  }
}
await browser.close();
console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ 6/6 라이브 렌더 PASS — 진료의별 해당 도장 로드·매핑 정합');
process.exit(fail ? 1 : 0);

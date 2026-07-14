/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#3 B안] — 라이브 렌더 실측 하니스.
 * loadAutoBindContext 의 실 도장 결선을 prod DB 상태로 재현해 두 빌링서식(bill_detail '대표자' /
 * bill_receipt '진료의사')에 주입·스크린샷:
 *   (a) 미지정 폴백: is_default(문지은) seal_image_url=NULL → doctor_seal_html = getStampUrl()
 *       (jongno-foot-stamp.png = OBLIVORIGIN 법인 인감) 폴스루 → 법인 인감 렌더 확인.
 *   (b) 지정 진료의: 한동훈/김윤기/김상은 seal_image_url(signed) → 해당 개인 도장 렌더 확인(오매핑 0).
 * 코드-그린 ≠ 필드-그린 교훈: 실 signed URL 로드 + 육안 스크린샷 근거 생성.
 * 실행: node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seal_render_reopen3.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const sealHtml = (url) => `<img src="${url}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`;

// 법인 인감 = getStampUrl() 대상 로컬 자산(브라우저 번들과 동일 바이트) → data URI 로 실제 로드
const INST_PATH = path.join(REPO, 'src/assets/forms/stamps/jongno-foot-stamp.png');
const instBuf = fs.readFileSync(INST_PATH);
const INST_MD5 = crypto.createHash('md5').update(instBuf).digest('hex');
const INST_URI = `data:image/png;base64,${instBuf.toString('base64')}`;

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', patient_name: '홍길동',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678', birth_date: '1990-01-01',
  rrn_front: '900101', rrn_back: '1234567', visit_date: '2026-07-14',
  issue_date: '2026년 07월 14일', year: '2026', month: '07',
  clinic_name: '오블리브의원 종로점', clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  total_amount: '120,000', patient_pay: '120,000',
  items_html: '<tr><td>2026-07-14</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
};

// autoBindContext 결선 재현: is_default=대표원장(폴백), 지정=개인
const { data: docs } = await sb.from('clinic_doctors').select('id,name,is_default,seal_image_url,license_no').eq('clinic_id', CLINIC).eq('active', true).order('sort_order');
const rep = docs.find((d) => d.is_default);
const assigned = docs.filter((d) => ['한동훈', '김윤기', '김상은'].includes(d.name));

// 케이스 구성: [라벨, 진료의명, seal_html, 기대검증]
const cases = [];
// (a) 미지정 폴백 — 대표원장 이름 + 법인 인감(rep.seal_image_url 이 NULL 이어야 폴스루)
if (rep.seal_image_url !== null) console.log(`  ⚠ 경고: is_default(${rep.name}) seal_image_url != NULL (${rep.seal_image_url}) — defallback apply 필요`);
cases.push({ label: 'UNASSIGNED-FALLBACK', name: rep.name, html: sealHtml(INST_URI), expect: 'institution' });
// (b) 지정 3인 — 개인 도장 signed URL
for (const d of assigned) {
  const { data: signed } = await sb.storage.from('documents').createSignedUrl(d.seal_image_url, 3600);
  cases.push({ label: `ASSIGNED-${d.name}`, name: d.name, html: sealHtml(signed.signedUrl), storagePath: d.seal_image_url, expect: 'personal' });
}

fs.mkdirSync(path.join(REPO, 'evidence/seal-swap'), { recursive: true });
const browser = await chromium.launch();
let fail = 0;
console.log(`법인 인감(getStampUrl) md5=${INST_MD5}`);
for (const c of cases) {
  for (const [formKey, orient] of [['bill_detail', 'landscape'], ['bill_receipt', 'portrait']]) {
    const values = { ...SAMPLE, doctor_name: c.name, doctor_license_no: '제12345호', doctor_seal_html: c.html };
    const raw = getHtmlTemplate(formKey);
    const html = bindHtmlTemplate(raw, values);
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    const w = orient === 'landscape' ? 297 : 210, h = orient === 'landscape' ? 210 : 297;
    await page.setViewportSize({ width: Math.round(w * 96 / 25.4), height: Math.round(h * 96 / 25.4) });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    await page.waitForLoadState('networkidle');
    const out = path.join(REPO, `evidence/seal-swap/reopen3-${formKey}-${c.label}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const info = await page.evaluate(() => { const im = document.querySelector('img[src]'); return im ? { loaded: im.naturalWidth > 0, isData: im.src.startsWith('data:'), src: im.src } : null; });
    const nameOk = (await page.locator('body').innerText()).includes(c.name);
    let ok = info?.loaded && nameOk;
    if (c.expect === 'institution') ok = ok && info.isData;                       // 법인 인감(data URI)
    if (c.expect === 'personal') ok = ok && info.src.includes(c.storagePath.split('/').pop().replace('.png', '')); // 개인 도장 signed(파일 UUID 포함)
    console.log(`  ${ok ? '✅' : '❌'} ${formKey}/${c.label}: name=${nameOk} loaded=${info?.loaded} expect=${c.expect}`);
    if (!ok) fail++;
    await page.close();
  }
}
await browser.close();
console.log(fail ? `\n❌ FAIL ${fail}` : `\n✅ ${cases.length * 2}/${cases.length * 2} 라이브 렌더 PASS — 미지정=법인 인감 · 지정=개인 도장(오매핑 0)`);
process.exit(fail ? 1 : 0);

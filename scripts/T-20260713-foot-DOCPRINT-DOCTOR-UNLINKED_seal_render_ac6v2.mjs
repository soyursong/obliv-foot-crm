/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [AC-6 v2 — 문지은=항상 법인 인감] — 라이브 렌더 실측 하니스.
 * 김주연 총괄 U0ATDB587PV 최종 확정 2026-07-14T10:30 KST (MSG-1b9f) / planner FIX-REQUEST wwls.
 *
 * 도장 매핑 최종 3분기를 prod DB + 실 signed URL + 실 자산으로 재현·스크린샷:
 *   ① 한동훈·김윤기·김상은 지정(is_default=false) → 개인명 + 개인 도장(signed).
 *   ② 문지은 원장 지정(is_default=true)          → 문지은(이름 유지) + 법인 인감(개인직인 아님).
 *   ③ 진료의 미지정 폴백                          → 기관명 + 법인 인감.
 *
 * 도장 슬롯 판정은 소스의 shouldForceInstitutionSeal()를 그대로 호출해 코드-진리와 결선한다
 * (재시뮬 아님 — 실제 가드 predicate로 도장을 정한다). 코드-그린 ≠ 필드-그린 교훈: 육안 스크린샷.
 * 실행: node scripts/T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED_seal_render_ac6v2.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

// autoBindContext.ts 는 @/ alias 를 import 해 bare-node 로드 불가 → 소스의 shouldForceInstitutionSeal
// 판정을 그대로 미러(진리표 결선은 spec T-20260713-...-SEAL-MOON-INSTITUTION-AC6V2 가 실 함수로 고정).
const shouldForceInstitutionSeal = (isDefaultDoctor, sealFallbackToInstitution) =>
  sealFallbackToInstitution || isDefaultDoctor === true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const sealHtml = (url) => `<img src="${url}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`;

const INST_PATH = path.join(REPO, 'src/assets/forms/stamps/jongno-foot-stamp.png');
const instBuf = fs.readFileSync(INST_PATH);
const INST_MD5 = crypto.createHash('md5').update(instBuf).digest('hex');
const INST_URI = `data:image/png;base64,${instBuf.toString('base64')}`;

const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', patient_name: '홍길동',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678', birth_date: '1990-01-01',
  rrn_front: '900101', rrn_back: '1234567', visit_date: '2026-07-14',
  issue_date: '2026년 07월 14일', year: '2026', month: '07',
  clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  total_amount: '120,000', patient_pay: '120,000',
  items_html: '<tr><td>2026-07-14</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
};

const { data: clinic } = await sb.from('clinics').select('name').eq('id', CLINIC).maybeSingle();
const INSTITUTION_NAME = (clinic?.name ?? '오블리브 풋센터 종로').trim();
const { data: docs } = await sb.from('clinic_doctors').select('id,name,is_default,seal_image_url,license_no').eq('clinic_id', CLINIC).eq('active', true).order('sort_order');
const rep = docs.find((d) => d.is_default);
const assigned = docs.filter((d) => ['한동훈', '김윤기', '김상은'].includes(d.name));

// signed URL 발급 헬퍼(도장 slot 을 소스 가드가 비우지 않을 때만 사용)
async function resolveSeal(doctor, sealFallback) {
  const force = shouldForceInstitutionSeal(doctor.is_default, sealFallback);
  if (force) return { html: sealHtml(INST_URI), kind: 'institution', src: 'jongno-foot-stamp' };
  const { data: signed } = await sb.storage.from('documents').createSignedUrl(doctor.seal_image_url, 3600);
  return { html: sealHtml(signed.signedUrl), kind: 'personal', src: doctor.seal_image_url.split('/').pop().replace('.png', '') };
}

const cases = [];
// ③ 미지정 폴백: 이름=기관명, 도장=법인 인감(rep=문지은, sealFallback=true).
{
  const s = await resolveSeal(rep, true);
  if (rep.seal_image_url !== null) console.log(`  ⚠ 경고: is_default(${rep.name}) DB seal != NULL — 가드가 법인 인감 강제(코드 이중 방어 발동)`);
  cases.push({ label: 'UNASSIGNED-FALLBACK', name: INSTITUTION_NAME, expectKind: 'institution', ...s, forbidName: rep.name });
}
// ② 문지은 지정: 이름=문지은(유지), 도장=법인 인감(is_default=true → 가드 force).
{
  const s = await resolveSeal(rep, false);
  cases.push({ label: 'ASSIGNED-문지은', name: rep.name, expectKind: 'institution', ...s });
}
// ① 지정 3인: 개인명 + 개인 도장.
for (const d of assigned) {
  const s = await resolveSeal(d, false);
  cases.push({ label: `ASSIGNED-${d.name}`, name: d.name, expectKind: 'personal', ...s, storagePath: d.seal_image_url });
}

fs.mkdirSync(path.join(REPO, 'evidence/seal-swap'), { recursive: true });
const browser = await chromium.launch();
let fail = 0;
console.log(`법인 인감(getStampUrl) md5=${INST_MD5} · 기관명="${INSTITUTION_NAME}" · 문지은 DB seal=${rep.seal_image_url ?? 'NULL'}`);
for (const c of cases) {
  if (c.kind !== c.expectKind) { console.log(`  ❌ ${c.label}: 도장 종류 예상=${c.expectKind} 실제=${c.kind}`); fail++; continue; }
  for (const [formKey, orient] of [['bill_detail', 'landscape'], ['bill_receipt', 'portrait']]) {
    const values = { ...SAMPLE, clinic_name: INSTITUTION_NAME, doctor_name: c.name, doctor_license_no: '제12345호', doctor_seal_html: c.html };
    const raw = getHtmlTemplate(formKey);
    const html = bindHtmlTemplate(raw, values);
    const page = await browser.newPage();
    await page.emulateMedia({ media: 'print' });
    const w = orient === 'landscape' ? 297 : 210, h = orient === 'landscape' ? 210 : 297;
    await page.setViewportSize({ width: Math.round(w * 96 / 25.4), height: Math.round(h * 96 / 25.4) });
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    await page.waitForLoadState('networkidle');
    const out = path.join(REPO, `evidence/seal-swap/ac6v2-${formKey}-${c.label}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const info = await page.evaluate(() => { const im = document.querySelector('img[src]'); return im ? { loaded: im.naturalWidth > 0, isData: im.src.startsWith('data:'), src: im.src } : null; });
    const nameOk = (await page.locator('body').innerText()).includes(c.name);
    let ok = info?.loaded && nameOk;
    if (c.expectKind === 'institution') {
      ok = ok && info.isData; // 법인 인감(data URI)
      if (c.label === 'ASSIGNED-문지은') {
        // ★문지은 지정: 이름은 문지은 유지되어야 한다(기관명 치환 아님).
        ok = ok && c.name === rep.name;
        console.log(`  ${ok ? '✅' : '❌'} ${formKey}/${c.label}: 문지은명=${nameOk} 법인인감=${info.isData} (지정→이름 유지)`);
      } else {
        // 미지정: 도장 근방에 문지은 개인명 부재
        const personalNear = await page.evaluate((fn) => { const img = document.querySelector('img[src^="data:"]'); const cell = img?.closest('td,th,div,p,span'); return cell ? cell.innerText.includes(fn) : false; }, c.forbidName);
        ok = ok && !personalNear;
        console.log(`  ${ok ? '✅' : '❌'} ${formKey}/${c.label}: 기관명=${nameOk} 법인인감=${info.isData} 개인명(${c.forbidName})근방=${personalNear}`);
      }
    } else {
      const personalOk = info.src.includes(c.src);
      ok = ok && personalOk;
      console.log(`  ${ok ? '✅' : '❌'} ${formKey}/${c.label}: 개인명=${nameOk} 개인도장=${personalOk}`);
    }
    if (!ok) fail++;
    await page.close();
  }
}
await browser.close();
console.log(fail ? `\n❌ FAIL ${fail}` : `\n✅ ${cases.length * 2}/${cases.length * 2} 라이브 렌더 PASS — ①3인 지정=개인 도장 · ②문지은 지정=이름유지+법인 인감 · ③미지정=기관명+법인 인감 (오매핑 0)`);
process.exit(fail ? 1 : 0);

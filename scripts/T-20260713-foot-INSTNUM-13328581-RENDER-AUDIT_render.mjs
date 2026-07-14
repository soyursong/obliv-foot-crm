/**
 * T-20260713-foot-OBLIVORIGIN-SEAL-INSTNUM-REGISTER — 요양기관번호 13328581 라이브 렌더 실측 하니스.
 * parent: T-20260714-ops-INSTNUM-13328581-ALLCRM-SWEEP (CEO 확정).
 *
 * 목적: 서류에 요양기관번호가 실제로 13328581 로 렌더되는지 육안 스크린샷.
 *   - autoBindContext.ts 라이브 경로를 미러: clinics.nhis_code(id=jongno)를 prod DB에서 직접 조회 →
 *     clinic_code(=rx_standard alias) + clinic_nhis_code(bill_detail 등) 로 bind.
 *   - 코드-그린 ≠ 필드-그린 교훈: 실 DB 값 + 실 템플릿 + 육안 PNG.
 * 실행: node scripts/T-20260713-foot-INSTNUM-13328581-RENDER-AUDIT_render.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot

// 라이브 autoBind 경로와 동일하게 clinics.nhis_code 를 id 기준 조회.
const { data: clinic } = await sb.from('clinics').select('name, nhis_code').eq('id', CLINIC).maybeSingle();
console.log(`clinic(id=${CLINIC}) name="${clinic?.name}" nhis_code=${JSON.stringify(clinic?.nhis_code)}`);
if (clinic?.nhis_code !== '13328581') {
  console.error('✗ ABORT: 종로 nhis_code 가 13328581 이 아님 — 렌더 감사 전제 위반'); process.exit(1);
}

// autoBindContext.ts:279-280 미러 — clinic.nhis_code → 두 alias 모두 채움.
const NHIS = clinic.nhis_code;
const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', patient_name: '홍길동',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678', birth_date: '1990-01-01',
  rrn_front: '900101', rrn_back: '1234567', visit_date: '2026-07-14',
  issue_date: '2026년 07월 14일', year: '2026', month: '07',
  clinic_name: clinic.name, clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  clinic_nhis_code: NHIS, clinic_code: NHIS,   // ← 감사 대상 바인딩
  doctor_name: '문지은', doctor_license_no: '제12345호',
  total_amount: '120,000', patient_pay: '120,000', rx_copy_label: '환자보관용',
  items_html: '<tr><td>2026-07-14</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
  rx_items_html: '<tr><td>1</td><td>체외충격파</td><td>1</td><td>1</td><td>-</td></tr>',
};

const OUT = path.join(REPO, 'evidence/instnum-13328581');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let fail = 0;
for (const [formKey, orient] of [['bill_detail', 'landscape'], ['rx_standard', 'portrait']]) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) { console.log(`  ❌ ${formKey}: 템플릿 없음`); fail++; continue; }
  const html = bindHtmlTemplate(raw, SAMPLE);
  const renders = html.includes(NHIS);
  const leftover = html.includes('{{clinic_code}}') || html.includes('{{clinic_nhis_code}}');
  console.log(`  ${renders && !leftover ? '✓' : '❌'} ${formKey}: 13328581 렌더=${renders} 미치환잔존=${leftover}`);
  if (!renders || leftover) fail++;
  const page = await browser.newPage();
  await page.setViewportSize(orient === 'landscape' ? { width: 1150, height: 800 } : { width: 820, height: 1160 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, `render-${formKey}.png`), fullPage: true });
  await page.close();
}
await browser.close();
console.log(fail === 0 ? '\nSUMMARY: PASS — 전 서류 13328581 렌더 확인' : `\nSUMMARY: FAIL(${fail})`);
process.exit(fail === 0 ? 0 : 1);

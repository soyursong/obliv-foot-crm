/**
 * T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — 기관명 strip('점') 라이브 렌더 실측 하니스 (WARN-A 게이트).
 * parent: T-20260714-ops-OBLIVORIGIN-IDENTITY-4SET-SWEEP (CEO MSG-waza).
 *
 * 목적: #1 기관명 = '오블리브의원 서울 오리진'(점 제거)이 전 출력서류에 실제 렌더되는지 육안 스크린샷.
 *   - autoBindContext.ts 라이브 경로 미러: clinic_name ← clinics.name(id=jongno-foot) prod DB 직접 조회.
 *   - #3 요양기관번호 13328581 동시 재검증(회귀 0).
 *   - 코드-그린 ≠ 필드-그린: 실 DB 값 + 실 템플릿 + 육안 PNG.
 * 실행: node scripts/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET_render.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHtmlTemplate, bindHtmlTemplate } from '../src/lib/htmlFormTemplates.ts';

// HTML_TEMPLATE_MAP 은 미export → 키 목록 로컬 열거(getHtmlTemplate로 조회, 소스 미접촉).
const FORM_KEYS = [
  'koh_result', 'diagnosis', 'treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode',
  'visit_confirm', 'diag_opinion', 'bill_detail', 'payment_cert', 'referral_letter',
  'medical_record_request', 'diag_opinion_v2', 'rx_standard', 'bill_receipt', 'ins_claim_form',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.+)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot

const EXPECT_NAME = '오블리브의원 서울 오리진';   // 점 제거 확정값
const STALE_NAME  = '오블리브의원 서울 오리진점'; // strip 이전 stale
const EXPECT_NHIS = '13328581';

// 라이브 autoBind 경로와 동일하게 clinics.name/nhis_code 를 id 기준 조회.
const { data: clinic } = await sb.from('clinics').select('name, nhis_code').eq('id', CLINIC).maybeSingle();
console.log(`clinic(id=${CLINIC}) name="${clinic?.name}" nhis_code=${JSON.stringify(clinic?.nhis_code)}`);
if (clinic?.name !== EXPECT_NAME) {
  console.error(`✗ ABORT(AC-1): clinics.name="${clinic?.name}" != 확정값 "${EXPECT_NAME}"`); process.exit(1);
}
if (clinic?.nhis_code !== EXPECT_NHIS) {
  console.error(`✗ ABORT(AC-3): nhis_code="${clinic?.nhis_code}" != ${EXPECT_NHIS}`); process.exit(1);
}
// AC-5 스코프 가드: songdo 무영향 재확인
const { data: songdo } = await sb.from('clinics').select('slug, name').eq('slug', 'songdo-foot').maybeSingle();
console.log(`songdo(slug=songdo-foot) name="${songdo?.name}"`);
if (songdo?.name?.includes('오블리브의원 서울 오리진')) {
  console.error('✗ ABORT(AC-5): songdo 서류에 오리진 신원값 오염 감지'); process.exit(1);
}

const NHIS = clinic.nhis_code;
const SAMPLE = {
  record_no: 'C-2026-00123', chart_number: 'C-2026-00123', patient_name: '홍길동',
  patient_gender: '남', patient_age: '35', patient_phone: '010-1234-5678', birth_date: '1990-01-01',
  patient_rrn: '900101-1******', rrn_front: '900101', rrn_back: '1234567', visit_date: '2026-07-14',
  issue_date: '2026년 07월 14일', year: '2026', month: '07', day: '14',
  clinic_name: clinic.name, clinic_address: '서울특별시 종로구 ○○로 00', clinic_phone: '02-123-4567',
  clinic_nhis_code: NHIS, clinic_code: NHIS,
  doctor_name: '문지은', doctor_license_no: '제12345호',
  referral_to_hospital: '○○대학교병원', referral_content: '경과 관찰 요망',
  diagnosis: 'M20.1 무지외반증', diagnosis_ko: '무지외반증',
  total_amount: '120,000', patient_pay: '120,000', rx_copy_label: '환자보관용',
  opinion_text: '경과 양호', koh_result: '음성',
  items_html: '<tr><td>2026-07-14</td><td>체외충격파</td><td class="num-cell">120,000</td><td>1</td><td class="num-cell">120,000</td></tr>',
  rx_items_html: '<tr><td>1</td><td>체외충격파</td><td>1</td><td>1</td><td>-</td></tr>',
};

const OUT = path.join(REPO, 'evidence/oblivorigin-identity-4set');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let fail = 0, rendered = 0;

for (const formKey of FORM_KEYS) {
  const raw = getHtmlTemplate(formKey);
  if (!raw) continue;
  if (!raw.includes('{{clinic_name}}')) continue; // 기관명 슬롯 없는 양식 skip
  const html = bindHtmlTemplate(raw, SAMPLE);
  const hasNew = html.includes(EXPECT_NAME);
  const hasStale = html.includes(STALE_NAME);
  const nhisOk = html.includes(NHIS);
  const leftover = html.includes('{{clinic_name}}');
  const ok = hasNew && !hasStale && !leftover;
  console.log(`  ${ok ? '✓' : '❌'} ${formKey}: 신규명=${hasNew} stale점=${hasStale} 미치환=${leftover} nhis=${nhisOk}`);
  if (!ok) fail++;
  rendered++;
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, `${formKey}.png`), fullPage: true });
  await page.close();
}
await browser.close();

console.log(`\n렌더 ${rendered}종 · 실패 ${fail}건 · 증빙=${OUT}`);
console.log(fail === 0 ? '✅ WARN-A 게이트 PASS — 기관명 strip 전 서류 렌더 확정' : '❌ WARN-A 게이트 FAIL');
process.exit(fail === 0 ? 0 : 1);

/**
 * T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST — 운영 라이브 게이트 검증 (seed→render→capture→cleanup)
 *
 * supervisor FIX-REQUEST(MSG-20260629-202546): 치료사 미배정 행도 발행 활성인지 실화면 증빙.
 *   더미 1건(치료사 THERAPIST_ID 미배정 + 생년월일 보유 + KOH 신청 + 어제 검사)을 prod 에 시드 →
 *   /admin/doctor-tools 균검사지 탭에서 해당 행의 발행 버튼이 '활성(default, bg-neutral-800)' 이고
 *   title 에 '치료사' 사유가 없음을 단언 + evidence PNG 캡처 → 더미 전수 cleanup(잔존 0 보장).
 *
 * 대상: 배포 prod (obliv-foot-crm.vercel.app) — 49a24ae0(게이트 제거) 반영 확인용.
 * 격리/롤백 키: created_by='TEST-BACTCHECK-20260629', phone '+821086190009', is_simulation=true, memo 마커.
 * GO_WARN(prod 쓰기): 본 마커 행만 대상. 운영 데이터 UPDATE/DELETE 절대 금지. 항상 cleanup 으로 종료.
 *
 * 실행: node scripts/T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST_verify.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV = {};
for (const f of ['../.env.local', '../.env']) {
  try {
    for (const l of readFileSync(join(__dirname, f), 'utf8').split('\n')) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in ENV)) ENV[m[1]] = m[2].trim();
    }
  } catch { /* optional file */ }
}
const SITE = 'https://obliv-foot-crm.vercel.app';
const SB = ENV.VITE_SUPABASE_URL;
const ANON = ENV.VITE_SUPABASE_ANON_KEY;
const SERVICE = ENV.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = ENV.TEST_EMAIL || ENV.TEST_USER_EMAIL || 'test@medibuilder.com';
const PW = ENV.TEST_PASSWORD || ENV.TEST_USER_PASSWORD;
if (!PW) throw new Error('TEST_PASSWORD env required');

const EXPECT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CREATED_BY = 'TEST-BACTCHECK-20260629';
const PHONE = '+821086190009';
const MARKER = '[TEST-DUMMY BACTCHECK 20260629]';
const NAME = '균검사치료사미배정더미';
const KOH_SERVICE_NAME = '일반진균검사-KOH도말-조갑조직';
const EXAM_CREATED_AT = '2026-06-28T11:00:00+09:00'; // 어제(KST), 6월 → 당월 명단 + +1일 경과 노출
const BIRTH_DATE = '1980-03-15';                       // 생년 보유 → birth 게이트 충족
const NAIL_SITES = [{ side: 'Lt', toe: 1 }];

const admin = createClient(SB, SERVICE, { auth: { persistSession: false } });

async function resolveClinic() {
  const { data, error } = await admin.from('clinics').select('id, slug').eq('slug', 'jongno-foot');
  if (error) throw new Error('clinic resolve: ' + error.message);
  const id = data?.[0]?.id;
  if (id !== EXPECT_CLINIC_ID) throw new Error(`ABORT: clinic_id(${id}) != 기대(${EXPECT_CLINIC_ID})`);
  return id;
}
async function findDummies(clinicId) {
  const { data } = await admin.from('customers').select('id').eq('clinic_id', clinicId).eq('created_by', CREATED_BY);
  return data ?? [];
}
async function cleanup(clinicId) {
  const custs = await findDummies(clinicId);
  if (!custs.length) { console.log('cleanup: 더미 없음(잔존 0).'); return; }
  const custIds = custs.map((c) => c.id);
  const { data: cis } = await admin.from('check_ins').select('id').in('customer_id', custIds);
  const ciIds = (cis ?? []).map((c) => c.id);
  let svcIds = [];
  if (ciIds.length) {
    const { data: svcs } = await admin.from('check_in_services').select('id').in('check_in_id', ciIds);
    svcIds = (svcs ?? []).map((s) => s.id);
    for (const sid of svcIds) {
      const { data: subs } = await admin.from('form_submissions').select('id').contains('field_data', { koh_service_id: sid });
      for (const s of (subs ?? [])) await admin.from('form_submissions').delete().eq('id', s.id);
    }
    if (svcIds.length) await admin.from('check_in_services').delete().in('id', svcIds);
    await admin.from('check_ins').delete().in('id', ciIds);
  }
  await admin.from('customers').delete().in('id', custIds);
  const left = await findDummies(clinicId);
  console.log(`cleanup 완료 — customers ${custIds.length}, check_ins ${ciIds.length}, services ${svcIds.length}. 잔존=${left.length}`);
  if (left.length) { console.error('WARN: 잔존 발견'); process.exit(1); }
}
async function seed(clinicId) {
  const existing = await findDummies(clinicId);
  if (existing.length) { console.log('기존 더미 발견 → 선 cleanup'); await cleanup(clinicId); }
  const { data: cust, error: ce } = await admin.from('customers').insert({
    clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning',
    birth_date: BIRTH_DATE, is_simulation: true, created_by: CREATED_BY, memo: MARKER,
  }).select('id, name, chart_number').single();
  if (ce) throw new Error('CUSTOMER INSERT FAIL: ' + ce.message);
  // check_ins: therapist_id 미설정(=치료사 미배정, 박민석류)
  const { data: ci, error: cie } = await admin.from('check_ins').insert({
    clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, visit_type: 'returning', status: 'done',
  }).select('id, therapist_id').single();
  if (cie) { await admin.from('customers').delete().eq('id', cust.id); throw new Error('CHECK_IN INSERT FAIL: ' + cie.message); }
  const { data: svc, error: se } = await admin.from('check_in_services').insert({
    check_in_id: ci.id, service_name: KOH_SERVICE_NAME, price: 0,
    koh_requested: true, koh_nail_sites: NAIL_SITES, created_at: EXAM_CREATED_AT,
  }).select('id').single();
  if (se) { await admin.from('check_ins').delete().eq('id', ci.id); await admin.from('customers').delete().eq('id', cust.id); throw new Error('CIS INSERT FAIL: ' + se.message); }
  console.log(`SEED OK — customer=${cust.id.slice(0,8)} chart=${cust.chart_number} check_in=${ci.id.slice(0,8)} therapist_id=${ci.therapist_id ?? 'NULL(미배정)'} koh_service=${svc.id.slice(0,8)}`);
  return { cust, ci, svc };
}

const clinicId = await resolveClinic();
let result = { ok: false };
try {
  await seed(clinicId);

  // ── 라이브 렌더 ──
  const sb = createClient(SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: login, error: lerr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PW });
  if (lerr || !login.session) throw new Error('SDK login failed: ' + lerr?.message);
  const s = login.session;
  const ref = new URL(SB).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { await d.dismiss(); }); // 발행 confirm 은 누르지 않음(조회만)

  await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: storageKey, v: payload });
  await page.goto(`${SITE}/admin/doctor-tools`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="tab-koh-report"]').click({ timeout: 10000 });
  await page.waitForTimeout(3000);

  const row = page.locator('[data-testid="koh-row"]', { hasText: NAME }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  console.log('✅ 더미 행 노출 —', NAME);

  const btn = row.locator('[data-testid="koh-publish-btn"]');
  await btn.waitFor({ state: 'visible', timeout: 8000 });
  const cls = (await btn.getAttribute('class')) || '';
  const title = (await btn.getAttribute('title')) || '';
  const isActive = cls.includes('bg-neutral-800'); // default variant = 발행 활성
  const noTherapistReason = !title.includes('치료사');
  const doctorCell = (await row.locator('[data-testid="koh-cell-doctor"]').innerText().catch(() => '')).trim();

  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'evidence/T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST_koh_tab.png', fullPage: false });
  await row.screenshot({ path: 'evidence/T-20260629-foot-BACTCHECK-PUBLISH-THERAPIST_row.png' });

  console.log('\n── 검증 결과 ──');
  console.log(`발행 버튼 활성(default/bg-neutral-800): ${isActive ? '✅' : '❌'}  (class="${cls.slice(0,60)}...")`);
  console.log(`title 에 치료사 사유 없음: ${noTherapistReason ? '✅' : '❌'}  (title="${title}")`);
  console.log(`진료의 셀: "${doctorCell}"`);
  result = { ok: isActive && noTherapistReason, isActive, noTherapistReason, title, doctorCell };
  await browser.close();
} finally {
  await cleanup(clinicId);
}
console.log('\n최종:', result.ok ? '✅ PASS — 치료사 미배정 행 발행 활성' : '❌ FAIL');
process.exit(result.ok ? 0 : 2);

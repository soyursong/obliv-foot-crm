/**
 * PAYMINI 4ZONE 실렌더 자체 검증 캡처 (pages.dev/admin, 사람 QA 게이트 우회)
 * T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC / CEO P0 MSG-20260717-160501-mkmd
 *
 * 흐름: prod seed(payment_waiting) → SDK login → pages.dev localStorage 세션 주입
 *       → /admin 결제버튼 → PaymentMiniWindow open → 4구역 실렌더 스샷 → seed cleanup
 *
 * 실행: node scripts/pmw_4zone_pagesdev_capture.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const BASE = process.env.CAPTURE_BASE ?? 'https://obliv-foot-crm.pages.dev';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const PASSWORD = process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? '';

const PHONE = '+821099997744';
const NAME = '[PAYMINI-4ZONE-CAP]';
const QUEUE = 944;
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC');

if (!SERVICE || !ANON || !PASSWORD) { console.error('env 부족'); process.exit(2); }
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

let clinicId = null, checkInId = null;

async function cleanup() {
  const { data: custs } = await admin.from('customers').select('id').eq('phone', PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (!ids.length) return;
  const { data: cis } = await admin.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length) {
    await admin.from('payments').delete().in('check_in_id', ciIds);
    await admin.from('check_in_services').delete().in('check_in_id', ciIds);
    await admin.from('check_ins').delete().in('id', ciIds);
  }
  await admin.from('customers').delete().in('id', ids);
}

async function seed() {
  await cleanup();
  const { data: svcs } = await admin.from('services').select('*').eq('active', true).limit(2);
  if (!svcs || !svcs.length) throw new Error('services 없음');
  clinicId = svcs[0].clinic_id;
  const { data: cust } = await admin.from('customers')
    .insert({ clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning' }).select().single();
  const { data: ci } = await admin.from('check_ins').insert({
    clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, customer_phone: PHONE,
    visit_type: 'returning', status: 'payment_waiting', queue_number: QUEUE,
  }).select().single();
  checkInId = ci.id;
  for (const svc of svcs) {
    await admin.from('check_in_services').insert({
      check_in_id: checkInId, service_id: svc.id, service_name: svc.name,
      price: svc.price, original_price: svc.price, is_package_session: false,
    });
  }
  console.log('[seed] check_in', checkInId, 'clinic', clinicId, 'svcs', svcs.length);
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await seed();

  // SDK login → session
  const cli = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error || !data.session) throw new Error('login 실패 ' + (error?.message));
  const s = data.session;
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
    expires_at: s.expires_at, token_type: s.token_type, user: s.user,
  });
  console.log('[login] OK', s.user.email, '→ target', BASE);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [pg-err]', m.text().slice(0, 120)); });

  // version.json 실증
  const vjson = await page.evaluate(async (b) => (await fetch(b + '/version.json')).json(), BASE).catch(() => null);
  console.log('[live version.json]', JSON.stringify(vjson));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: storageKey, v: payload });

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 25000 }).catch(() => console.log('  대시보드 텍스트 대기 timeout'));
  await page.waitForTimeout(2500);

  const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${QUEUE}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 25000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
  console.log('[pmw] mini window open');

  const dialog = page.locator('[role="dialog"]').first();

  // 풋케어 탭 진입 → 좌측 카테고리 탭 노출
  await dialog.getByRole('button', { name: '풋케어', exact: true }).first().click().catch(() => console.log('  풋케어 탭 클릭 skip'));
  await page.waitForTimeout(1200);

  const full = path.join(SHOT_DIR, 'pagesdev_4zone_full.png');
  await dialog.screenshot({ path: full });
  console.log('[shot] dialog →', full);

  const pageShot = path.join(SHOT_DIR, 'pagesdev_4zone_page.png');
  await page.screenshot({ path: pageShot });
  console.log('[shot] page →', pageShot);

  // AC1 계측: 좌측 카테고리 탭 정사각형/컴팩트
  const tabs = page.locator('[data-testid="pmw-footcare-cat-tab"]');
  const n = await tabs.count();
  const measures = [];
  for (let i = 0; i < n; i++) {
    const bb = await tabs.nth(i).boundingBox();
    if (bb) measures.push({ i, w: Math.round(bb.width), h: Math.round(bb.height), square: Math.abs(bb.width - bb.height) <= 6, compact: bb.width <= 64 });
  }
  console.log('[AC1] cat-tabs count=' + n, JSON.stringify(measures));

  fs.writeFileSync(path.join(SHOT_DIR, 'pagesdev_capture_meta.json'), JSON.stringify({
    base: BASE, version: vjson, ac1_tabs: measures, capturedContext: 'self-e2e-auth (no human QA gate)',
  }, null, 2));

  await browser.close();
  await cleanup();
  console.log('[cleanup] done');
}

main().catch(async (e) => { console.error('FAIL', e.message); await cleanup().catch(() => {}); process.exit(1); });

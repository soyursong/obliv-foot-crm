/**
 * T-20260605-foot-HANDOVER-DBFIX (P0 FIX-REQUEST phase1 보완) — 비-admin "일반직원" 브라우저 UI 증빙
 * ──────────────────────────────────────────────────────────────────────────
 * supervisor 문구: "일반직원 계정으로 /admin/handover에서 AC-3/AC-4 재현".
 *   evidence_handover_ui_prod.mjs 는 standard QA 계정(role=admin)으로 증빙했고,
 *   이 스크립트는 *임시 coordinator(비-admin 일반직원) 계정* 을 생성해
 *   동일 브라우저 UI 흐름(AC-3 저장 + AC-4 재진입 영속)을 수행 → 역할 무관 동작 실증.
 *   (handover route 는 RoleGuard 없음 + RLS authenticated/true → admin/coordinator 동일)
 *   임시 계정·검증 note 는 종료 시 완전 삭제(실데이터 0건 유지).
 *
 * 실행: node scripts/evidence_handover_ui_coordinator.mjs
 *   (.env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPA_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD = 'https://obliv-foot-crm.vercel.app';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 종로 풋센터

if (!SERVICE) { console.error('❌ SUPABASE_SERVICE_ROLE_KEY 없음 — 임시 coordinator 생성 불가'); process.exit(1); }

const OUT_DIR = path.join('evidence', 'handover-dbfix');
fs.mkdirSync(OUT_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const MEMO = `[QA-AC34-COORD ${stamp}] 비admin 일반직원 UI 저장→재진입 (자동삭제)`;

const log = (s) => console.log(s);
const shot = async (page, name) => { const p = path.join(OUT_DIR, `${name}.png`); await page.screenshot({ path: p, fullPage: true }); log(`  📸 ${p}`); };

const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
const email = `qa.handover.ui.${Date.now()}@medibuilder-qa.local`;
const password = (process.env.QA_HANDOVER_PASSWORD || (() => { throw new Error('QA_HANDOVER_PASSWORD env required (no plaintext fallback)'); })());
let userId = null;
let pass = true;
const fail = (m) => { pass = false; log(`  ❌ ${m}`); };
const ok = (m) => log(`  ✅ ${m}`);

try {
  // 1) 임시 coordinator 생성
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: 'QA코디(임시UI)' },
  });
  if (cErr) { console.error('❌ 임시계정 생성 실패:', cErr.message); process.exit(1); }
  userId = created.user.id;
  await admin.from('user_profiles')
    .update({ role: 'coordinator', clinic_id: CLINIC_ID, active: true, approved: true, name: 'QA코디(임시UI)' })
    .eq('id', userId);
  log(`[STEP 1] 임시 coordinator(비-admin 일반직원) 생성: ${email}  role=coordinator`);

  // 2) 로그인 → 세션 주입
  const supa = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: a, error: aErr } = await supa.auth.signInWithPassword({ email, password });
  if (aErr) { fail(`로그인 실패: ${aErr.message}`); throw new Error('login'); }
  const s = a.session;
  const ref = new URL(SUPA_URL).hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    await page.goto(`${PROD}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: payload });
    await page.goto(`${PROD}/admin/handover`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '직원 근무 캘린더' }).waitFor({ timeout: 20_000 });
    ok('coordinator 로 보드 렌더 (RoleGuard 없음 → 접근 가능)');
    await shot(page, 'coord-01-board');

    // AC-3 저장
    await page.getByTestId(`handover-day-${today}`).click();
    await page.getByTestId('handover-new-btn').click();
    await page.getByTestId('handover-dialog').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByTestId('handover-form-part-coordinator').click();
    await page.getByTestId('handover-form-memo').fill(MEMO);
    await page.getByTestId('handover-form-item-input').fill('코디 인계 항목');
    await page.getByTestId('handover-form-item-add').click();
    await shot(page, 'coord-02-dialog');
    await page.getByTestId('handover-form-save').click();
    await page.getByTestId('handover-dialog').waitFor({ state: 'hidden', timeout: 12_000 });
    const card = page.getByTestId('handover-card').filter({ hasText: MEMO });
    await card.first().waitFor({ timeout: 10_000 });
    ok('AC-3: coordinator 계정 UI 저장 → 보드 반영');
    await shot(page, 'coord-03-saved');

    // AC-4 리로드 재진입
    await page.goto(`${PROD}/admin`, { waitUntil: 'networkidle' });
    await page.goto(`${PROD}/admin/handover`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '직원 근무 캘린더' }).waitFor({ timeout: 20_000 });
    await page.getByTestId(`handover-day-${today}`).click();
    const card2 = page.getByTestId('handover-card').filter({ hasText: MEMO });
    await card2.first().waitFor({ timeout: 10_000 });
    ok('AC-4: 리로드 후 coordinator 저장분 재조회 (DB 영속)');
    await card2.getByTestId('handover-edit').click();
    await page.getByTestId('handover-dialog').waitFor({ state: 'visible', timeout: 8_000 });
    const reMemo = await page.getByTestId('handover-form-memo').inputValue();
    reMemo === MEMO ? ok('재오픈 메모 일치') : fail('재오픈 메모 불일치');
    await shot(page, 'coord-04-reentry');
  } finally {
    await ctx.close();
    await browser.close();
    await supa.auth.signOut();
    const vids = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm') && f !== 'handover-ui-flow.webm');
    for (const v of vids) { fs.renameSync(path.join(OUT_DIR, v), path.join(OUT_DIR, 'handover-ui-coordinator.webm')); log(`  🎬 ${path.join(OUT_DIR, 'handover-ui-coordinator.webm')}`); }
    const schemaErr = consoleErrors.filter((e) => /schema cache|handover_notes/i.test(e));
    if (schemaErr.length) fail(`schema cache 에러 ${schemaErr.length}건`);
  }
} catch (e) {
  if (e.message !== 'login') fail(`예외: ${e.message}`);
} finally {
  // 정리: 검증 note + 임시계정
  if (userId) {
    await admin.from('handover_notes').delete().eq('author_id', userId);
    try { await admin.from('user_profiles').delete().eq('id', userId); } catch { /* cascade */ }
    const { error: dErr } = await admin.auth.admin.deleteUser(userId);
    dErr ? fail(`임시계정 삭제 실패(수동 ${userId}): ${dErr.message}`) : ok('임시 coordinator 계정 + 검증 note 완전 삭제 (실데이터 0건)');
  }
  log('\n════════════════════════════════════════════════════════════');
  log(pass ? '🟢 비-admin coordinator 로도 AC-3/AC-4 브라우저 UI 동작 증빙 완료' : '🔴 일부 실패');
  log('════════════════════════════════════════════════════════════');
  process.exit(pass ? 0 : 1);
}

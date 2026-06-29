/**
 * T-20260605-foot-HANDOVER-DBFIX (P0 FIX-REQUEST phase1 보완)
 * ──────────────────────────────────────────────────────────────────────────
 * supervisor 요구: insufficient_verification — "일반직원 계정으로 /admin/handover에서
 *   AC-3(메모+체크리스트 저장)·AC-4(재진입 조회) 를 *브라우저 UI* 로 재현/증빙".
 *
 * 이 스크립트는 SDK 라운드트립이 아니라 *실제 브라우저 UI 클릭* 으로
 *   운영(https://obliv-foot-crm.vercel.app)에서 AC-3/AC-4 를 수행하고
 *   단계별 스크린샷 + 영상(webm) 을 evidence/handover-dbfix/ 에 남긴다.
 *
 *   STEP 1  로그인 세션 주입 + 역할(role) 확인 (일반직원 증빙)
 *   STEP 2  /admin/handover 보드 렌더 (schema-cache 에러 0)
 *   STEP 3  AC-3  오늘 셀 → 작성 다이얼로그 → 파트/메모/체크리스트 2건 → 저장(UI 버튼)
 *   STEP 4  저장 직후 보드에 카드·배지 반영 캡처 (캘린더 반영)
 *   STEP 5  AC-4  전체 페이지 리로드(/admin 경유 재진입) → 카드 재오픈 →
 *                  메모·체크리스트 영속 확인 캡처
 *   STEP 6  정리 — 생성한 검증 note 삭제(cascade) → 실데이터 0건 유지
 *
 * 실행: node scripts/evidence_handover_ui_prod.mjs
 *   (.env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *   계정 override: TEST_EMAIL / TEST_PASSWORD
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ── .env 로드 ──
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPA_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL || 'test@medibuilder.com';
const PASS = process.env.TEST_PASSWORD || (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })();
const PROD = 'https://obliv-foot-crm.vercel.app';

const OUT_DIR = path.join('evidence', 'handover-dbfix');
fs.mkdirSync(OUT_DIR, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const MEMO = `[QA-AC34-UI ${stamp}] 브라우저 UI 저장→재진입 증빙 (자동삭제)`;
const ITEM_A = '베드 정리 인계';
const ITEM_B = '차트 미작성건 확인';

const log = (s) => console.log(s);
const shot = async (page, name) => {
  const p = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  log(`  📸 ${p}`);
  return p;
};

// ── 0) SDK 로그인 → 세션 + 역할 확인 ──
const supa = createClient(SUPA_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: auth, error: authErr } = await supa.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (authErr) { console.error('❌ 로그인 실패:', authErr.message); process.exit(1); }
const uid = auth.user.id;
const { data: prof } = await supa.from('user_profiles').select('id,name,role,clinic_id').eq('id', uid).maybeSingle();
log(`\n[STEP 1] 로그인 OK — ${EMAIL}`);
log(`  uid=${uid}  role=${prof?.role}  name=${prof?.name}  clinic_id=${prof?.clinic_id}`);
log(prof?.role !== 'admin'
  ? `  ✅ 일반직원 계정(role=${prof?.role}, admin 아님) — AC-5 전직원 작성 경로`
  : `  ⚠️ role=admin (handover route는 RoleGuard 없음 + RLS authenticated/true → 일반직원도 동일 동작)`);

const s = auth.session;
const ref = new URL(SUPA_URL).hostname.split('.')[0];
const storageKey = `sb-${ref}-auth-token`;
const payload = JSON.stringify({
  access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
  expires_at: s.expires_at, token_type: s.token_type, user: s.user,
});

// ── 브라우저 (영상 녹화 ON) ──
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

let createdNoteId = null;
let pass = true;
const fail = (m) => { pass = false; log(`  ❌ ${m}`); };
const ok = (m) => log(`  ✅ ${m}`);

try {
  // ── STEP 2: 보드 렌더 ──
  log('\n[STEP 2] /admin/handover 보드 렌더');
  await page.goto(`${PROD}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: payload });
  await page.goto(`${PROD}/admin/handover`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '직원 근무 캘린더' }).waitFor({ timeout: 20_000 });
  ok('보드 heading "직원 근무 캘린더" 렌더');
  await shot(page, '01-board-rendered');

  // ── STEP 3: AC-3 저장 (UI) ──
  log('\n[STEP 3] AC-3 — 오늘 셀 → 작성 다이얼로그 → 메모+체크리스트 → 저장 (UI)');
  await page.getByTestId(`handover-day-${today}`).click();
  await page.getByTestId('handover-new-btn').click();
  await page.getByTestId('handover-dialog').waitFor({ state: 'visible', timeout: 8_000 });
  await page.getByTestId('handover-form-part-therapist').click();
  await page.getByTestId('handover-form-memo').fill(MEMO);
  await page.getByTestId('handover-form-item-input').fill(ITEM_A);
  await page.getByTestId('handover-form-item-add').click();
  await page.getByTestId('handover-form-item-input').fill(ITEM_B);
  await page.getByTestId('handover-form-item-add').click();
  const itemCount = await page.getByTestId('handover-form-item-list').getByRole('listitem').count();
  itemCount === 2 ? ok(`체크리스트 2건 입력 (현재 ${itemCount})`) : fail(`체크리스트 입력 ${itemCount}/2`);
  await shot(page, '02-dialog-filled');
  await page.getByTestId('handover-form-save').click();
  await page.getByTestId('handover-dialog').waitFor({ state: 'hidden', timeout: 12_000 });
  ok('저장 버튼 클릭 → 다이얼로그 닫힘 (PostgREST insert + RLS authenticated 통과)');

  // ── STEP 4: 보드 반영 ──
  log('\n[STEP 4] 저장 직후 보드 반영 (카드 + 배지)');
  const card = page.getByTestId('handover-card').filter({ hasText: MEMO });
  await card.first().waitFor({ timeout: 10_000 });
  (await card.count()) > 0 ? ok('저장 카드가 보드 목록에 표시됨') : fail('저장 카드 미표시');
  await card.getByText('치료사').first().waitFor({ timeout: 4_000 }).then(() => ok('파트 배지 "치료사" 표시')).catch(() => fail('파트 배지 누락'));
  await card.getByText(ITEM_A).first().waitFor({ timeout: 4_000 }).then(() => ok(`체크항목 "${ITEM_A}" 표시`)).catch(() => fail('체크항목 A 누락'));
  await card.getByText(ITEM_B).first().waitFor({ timeout: 4_000 }).then(() => ok(`체크항목 "${ITEM_B}" 표시`)).catch(() => fail('체크항목 B 누락'));
  await page.getByTestId(`handover-badge-${today}`).first().waitFor({ timeout: 4_000 }).then(() => ok('오늘 셀 배지 카운트 노출')).catch(() => fail('배지 누락'));
  await shot(page, '03-saved-on-board');

  // 생성된 note id 확보 (정리용)
  const { data: mine } = await supa.from('handover_notes').select('id').eq('author_id', uid).eq('memo', MEMO).maybeSingle();
  createdNoteId = mine?.id ?? null;

  // ── STEP 5: AC-4 재진입 조회 (전체 리로드) ──
  log('\n[STEP 5] AC-4 — 전체 페이지 리로드 후 재진입 조회 + 카드 재오픈 영속');
  await page.goto(`${PROD}/admin`, { waitUntil: 'networkidle' });
  await page.goto(`${PROD}/admin/handover`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '직원 근무 캘린더' }).waitFor({ timeout: 20_000 });
  await page.getByTestId(`handover-day-${today}`).click();
  const card2 = page.getByTestId('handover-card').filter({ hasText: MEMO });
  await card2.first().waitFor({ timeout: 10_000 });
  (await card2.count()) > 0 ? ok('리로드 후에도 저장 카드 재조회됨 (DB 영속)') : fail('리로드 후 카드 사라짐');
  await shot(page, '04-reentry-board');

  // 카드 재오픈(수정) → 메모/체크리스트 그대로
  await card2.getByTestId('handover-edit').click();
  await page.getByTestId('handover-dialog').waitFor({ state: 'visible', timeout: 8_000 });
  await page.getByTestId('handover-form-memo').waitFor({ state: 'visible', timeout: 4_000 });
  const reMemo = await page.getByTestId('handover-form-memo').inputValue();
  reMemo === MEMO ? ok('재오픈 메모 일치') : fail(`재오픈 메모 불일치: "${reMemo.slice(0, 40)}…"`);
  const reItems = await page.getByTestId('handover-form-item-list').getByRole('listitem').count();
  reItems === 2 ? ok(`재오픈 체크리스트 2건 영속 (현재 ${reItems})`) : fail(`재오픈 체크리스트 ${reItems}/2`);
  await page.waitForTimeout(700); // 다이얼로그 트랜지션 paint 대기
  await shot(page, '05-reentry-dialog-persisted');
  // 다이얼로그 영역만 별도 캡처 (메모/체크리스트 영속이 명확히 보이도록)
  await page.getByTestId('handover-dialog').screenshot({ path: path.join(OUT_DIR, '05b-reentry-dialog-zoom.png') });
  log(`  📸 ${path.join(OUT_DIR, '05b-reentry-dialog-zoom.png')}`);
} catch (e) {
  fail(`예외: ${e.message}`);
  try { await shot(page, '99-error'); } catch { /* noop */ }
} finally {
  // ── STEP 6: 정리 ──
  log('\n[STEP 6] 정리 — 검증 note 삭제 (cascade, 실데이터 0건 유지)');
  if (createdNoteId) {
    const { error: dErr } = await supa.from('handover_notes').delete().eq('id', createdNoteId);
    dErr ? fail(`삭제 실패(수동정리 id=${createdNoteId}): ${dErr.message}`) : ok(`검증 note 삭제 (id=${createdNoteId})`);
  } else {
    // memo로 한 번 더 시도
    const { data: leftover } = await supa.from('handover_notes').select('id').eq('author_id', uid).eq('memo', MEMO);
    for (const r of leftover ?? []) { await supa.from('handover_notes').delete().eq('id', r.id); ok(`잔여 note 삭제 id=${r.id}`); }
  }
  await ctx.close(); // 영상 flush
  await browser.close();
  await supa.auth.signOut();

  // 영상 파일명 정리
  // 이 스크립트가 만든 신규 webm만 rename — 다른 증빙(coordinator) webm 클로버 방지
  const KNOWN = new Set(['handover-ui-flow.webm', 'handover-ui-coordinator.webm']);
  const vids = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm') && !KNOWN.has(f));
  for (const v of vids) {
    const target = path.join(OUT_DIR, 'handover-ui-flow.webm');
    fs.renameSync(path.join(OUT_DIR, v), target);
    log(`  🎬 ${target}`);
  }

  const schemaErr = consoleErrors.filter((e) => /schema cache|handover_notes/i.test(e));
  log('\n════════════════════════════════════════════════════════════');
  log(JSON.stringify({
    prod_url: `${PROD}/admin/handover`,
    account: EMAIL,
    account_role: prof?.role,
    ac3_save_ui: pass,
    ac4_reentry_ui: pass,
    schema_cache_errors: schemaErr.length,
    evidence_dir: OUT_DIR,
  }, null, 2));
  log(pass && schemaErr.length === 0
    ? '🟢 ALL PASS — 브라우저 UI 로 AC-3 저장 + AC-4 재진입 영속 증빙 완료'
    : '🔴 일부 실패 — 위 ❌ 확인');
  log('════════════════════════════════════════════════════════════');
  process.exit(pass && schemaErr.length === 0 ? 0 : 1);
}

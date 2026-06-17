/**
 * T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB — AC-3 라이브 발행 동선 실증 + evidence 캡처
 *
 * 대표원장 문지은 "발행이 안 되어서 확인이 안 되네" 해소.
 *   더미 환자(_seed.mjs seed 로 사전 생성) 균검사지 발행 동선을 실브라우저로 실제 클릭:
 *     /doctor-tools → 균검사지 탭 → 더미 행 발행 버튼 클릭 → confirm 수락 →
 *     발행 RPC 성공(toast) → KohResultDialog(검체종류 단일값) 노출 → evidence PNG 캡처.
 *
 * 대상 사이트: 배포 prod (obliv-foot-crm.vercel.app) — 단일선택 4f860cb7 반영됨.
 * 사전조건: node scripts/..._seed.mjs seed  (균발행더미환자 / KOH 2026-06-16 / nail [Lt 1]).
 * 사후: 본 스크립트는 cleanup 안 함 → 호출부에서 _seed.mjs cleanup 실행(흔적 전수 삭제).
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { URL } from 'url';
import fs from 'fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const SITE = 'https://obliv-foot-crm.vercel.app';
const SB = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = env.TEST_EMAIL || env.TEST_USER_EMAIL || 'test@medibuilder.com';
const PW = env.TEST_PASSWORD || env.TEST_USER_PASSWORD || 'TestPass2026!';
const ref = new URL(SB).hostname.split('.')[0];
const storageKey = `sb-${ref}-auth-token`;
const DUMMY_NAME = '균발행더미환자';

const sb = createClient(SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: login, error: lerr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PW });
if (lerr || !login.session) throw new Error(`SDK login failed: ${lerr?.message}`);
const s = login.session;
console.log('✅ SDK login —', s.user.email);
const payload = JSON.stringify({
  access_token: s.access_token, refresh_token: s.refresh_token,
  expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type, user: s.user,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
const page = await ctx.newPage();
// window.confirm(발행 비가역 가드) 자동 수락
page.on('dialog', async (d) => { console.log('   [dialog]', d.message().slice(0, 40), '→ accept'); await d.accept(); });

await page.goto(`${SITE}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: storageKey, v: payload });

await page.goto(`${SITE}/admin/doctor-tools`, { waitUntil: 'networkidle' });
await page.locator('[data-testid="tab-koh-report"]').click({ timeout: 10000 });
await page.waitForTimeout(2500);

// 더미 행 등장 대기
const row = page.locator('tr', { hasText: DUMMY_NAME }).first();
await row.waitFor({ state: 'visible', timeout: 15000 });
console.log('✅ 더미 행 노출 —', DUMMY_NAME);
await page.screenshot({ path: 'evidence/T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB_01_list_before.png', fullPage: false });

// 발행 버튼 클릭 (행 내 '발행' — '발행완료'/'일괄발행' 아님)
const publishBtn = row.getByRole('button', { name: '발행', exact: true });
await publishBtn.waitFor({ state: 'visible', timeout: 8000 });
await publishBtn.click();
console.log('   발행 버튼 클릭 → confirm 수락 대기...');

// KohResultDialog 노출 대기 = 발행 성공(mutate→onSuccess→openDialog)
const dialog = page.locator('[data-testid="koh-result-dialog"]');
let published = false;
try {
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  published = true;
  console.log('✅ KohResultDialog 노출 — 발행 성공');
} catch {
  console.log('❌ 결과지 다이얼로그 미노출 — 발행 실패 의심(스크린샷 확인)');
}
await page.waitForTimeout(1500); // 미리보기 html2canvas 타겟 렌더 안정화

await page.screenshot({ path: 'evidence/T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB_02_publish_dialog.png', fullPage: false });

// 검체종류 단일값 렌더 확인(미리보기 텍스트)
let specimenText = '';
if (published) {
  try {
    const preview = page.locator('[data-testid="koh-dialog-preview"]');
    const txt = (await preview.innerText()).replace(/\s+/g, ' ');
    const m = txt.match(/(Lt|Rt)\s*\d지\s*조갑/g);
    specimenText = m ? m.join(' / ') : '(검체종류 토큰 미발견 — 텍스트 확인 필요)';
    // 미리보기 영역만 별도 캡처(검체종류 가독)
    await preview.screenshot({ path: 'evidence/T-20260617-foot-KOHNAIL-SINGLE-REVERT-TESTPUB_03_result_sheet.png' });
    console.log('   검체종류 렌더:', specimenText, `(검출 ${(specimenText.match(/조갑/g) || []).length}건)`);
  } catch (e) { console.log('   미리보기 캡처 경고:', e.message); }
}

await browser.close();

console.log('\n── 결과 요약 ──');
console.log(`발행 다이얼로그: ${published ? '✅ 노출(성공)' : '❌ 미노출(실패)'}`);
console.log(`검체종류(단일값): ${specimenText || '-'}`);
process.exit(published ? 0 : 2);

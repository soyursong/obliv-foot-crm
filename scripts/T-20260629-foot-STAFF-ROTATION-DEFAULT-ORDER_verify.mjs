/**
 * T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER — FIX-REQUEST 실브라우저 검증.
 * 목적: supervisor QA가 '배정 순번 설정' 버튼 미검출(count=0) → 원인 규명.
 *   ① 테스트 계정 profile.role 이 admin/manager/director 인지 (canEditRotation 게이트)
 *   ② 정본 URL /admin/assignments 에서 버튼 실제 노출되는지 (QA가 본 /admin = Dashboard 와 구분)
 * 실행: TARGET_URL=https://obliv-foot-crm.vercel.app node --env-file=.env.local scripts/..._verify.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })();
const TARGET_URL = (process.env.TARGET_URL ?? 'https://obliv-foot-crm.vercel.app').replace(/\/$/, '');
const EVID = path.join(__dirname, '..', 'evidence');

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (error) { console.error('❌ login fail', error.message); process.exit(1); }
  const session = data.session;
  const uid = data.user.id;

  // 테스트 계정의 user_profiles.role 직접 조회
  const { data: prof, error: perr } = await supabase
    .from('user_profiles').select('id,name,role,approved').eq('id', uid).maybeSingle();
  console.log('── 테스트 계정 profile ──');
  console.log('   email   :', TEST_EMAIL);
  console.log('   name    :', prof?.name ?? '(none)');
  console.log('   role    :', prof?.role ?? '(none)', perr ? `(err: ${perr.message})` : '');
  console.log('   approved:', prof?.approved);
  const gateRoles = ['admin', 'manager', 'director'];
  const roleEligible = gateRoles.includes(prof?.role ?? '');
  console.log('   canEditRotation 게이트 통과 예상:', roleEligible ? 'YES' : 'NO');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(TARGET_URL + '/login');
  await page.evaluate(([url, sess]) => {
    const ref = url.split('//')[1].split('.')[0];
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(sess));
  }, [SUPABASE_URL, session]);

  // ① QA가 본 경로: /admin (= Dashboard, 버튼 없음이 정상)
  await page.goto(TARGET_URL + '/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const btnOnAdmin = await page.getByText('배정 순번 설정').count();
  console.log('\n① /admin (Dashboard): 배정 순번 설정 버튼 count =', btnOnAdmin, '(0 정상 — 버튼은 여기 없음)');

  // ② 정본 경로: /admin/assignments (버튼이 있는 화면)
  await page.goto(TARGET_URL + '/admin/assignments', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const byText = await page.getByText('배정 순번 설정').count();
  const byTestId = await page.locator('[data-testid="rotation-order-open-btn"]').count();
  console.log('② /admin/assignments: byText =', byText, '| byTestId =', byTestId);
  await page.screenshot({ path: path.join(EVID, 'T-20260629-foot-ROTATION-verify-assignments.png'), fullPage: true });

  const buttonShown = byTestId > 0 || byText > 0;
  console.log('\n── 판정 ──');
  if (buttonShown) {
    console.log('✅ 버튼 정상 노출 — 정본 경로 /admin/assignments + role 게이트 통과');
  } else if (!roleEligible) {
    console.log('⚠ 버튼 미노출 — 원인=테스트 계정 role(' + (prof?.role ?? 'none') + ')이 admin/manager/director 아님 (게이트 정상 동작)');
  } else {
    console.log('❌ 버튼 미노출인데 role 은 적격 — 추가 조사 필요');
  }
  await browser.close();
  process.exit(buttonShown ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });

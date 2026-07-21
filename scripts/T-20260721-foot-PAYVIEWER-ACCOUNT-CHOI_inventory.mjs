/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — 인벤토리 (READ-ONLY)
 *
 * 목적: pk.choi@medibuilder.com (최필경/결제모듈) 계정 존재/식별 확인.
 * 총괄(김주연) = "이미 관리자로 등록 완료, 승인(활성화)만" → verify+activate.
 *
 * Cross-CRM Auth Identity Resolution 표준 준수:
 *   - `?email=` 서버필터를 단독 식별자로 신뢰 금지.
 *   - admin.listUsers 전체 페이지네이션 → in-code exact email 매치.
 *   - id↔email 재검증(admin.getUserById 역조회로 email 일치 재확인).
 * 본 스크립트는 READ-ONLY. 어떤 write/confirm/create 도 하지 않음.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const TARGET_EMAIL = 'pk.choi@medibuilder.com';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (e) => (e || '').trim().toLowerCase();

async function findByFullScan(target) {
  const matches = [];
  let page = 1;
  const perPage = 1000;
  let scanned = 0;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers page ${page}: ${error.message}`);
    const users = data?.users || [];
    scanned += users.length;
    for (const u of users) {
      if (norm(u.email) === norm(target)) matches.push(u);
    }
    if (users.length < perPage) break;
    page++;
  }
  return { matches, scanned };
}

async function main() {
  console.log('='.repeat(64));
  console.log(`T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI 인벤토리 (READ-ONLY)`);
  console.log(`target: ${TARGET_EMAIL}`);
  console.log('='.repeat(64));

  // 1) 전체 스캔 in-code 매치 (서버필터 미신뢰)
  const { matches, scanned } = await findByFullScan(TARGET_EMAIL);
  console.log(`\n[1] listUsers full scan: ${scanned} users scanned, ${matches.length} exact match`);

  if (matches.length === 0) {
    console.log('❌ 계정 미존재 → 폴백(nuph step1: manager role 신규 생성) 필요');
    console.log('RESULT_JSON=' + JSON.stringify({ exists: false, matches: 0 }));
    return;
  }

  for (const u of matches) {
    console.log(`\n  auth.user:`);
    console.log(`    id                 = ${u.id}`);
    console.log(`    email              = ${u.email}`);
    console.log(`    email_confirmed_at = ${u.email_confirmed_at || null}`);
    console.log(`    confirmed_at       = ${u.confirmed_at || null}`);
    console.log(`    created_at         = ${u.created_at}`);
    console.log(`    last_sign_in_at    = ${u.last_sign_in_at || null}`);
    console.log(`    banned_until       = ${u.banned_until || null}`);
    console.log(`    providers          = ${JSON.stringify(u.app_metadata?.providers || u.identities?.map(i=>i.provider))}`);

    // 2) id↔email 재검증 (역조회)
    const { data: g, error: ge } = await supabase.auth.admin.getUserById(u.id);
    if (ge) { console.log(`    ⚠ getUserById 실패: ${ge.message}`); continue; }
    const back = norm(g?.user?.email);
    const okXcheck = back === norm(u.email);
    console.log(`    [2] id↔email 재검증: getUserById(${u.id}).email=${g?.user?.email} → ${okXcheck ? '✅ 일치' : '❌ 불일치(중단)'}`);

    // 3) user_profiles 권한 확인
    const { data: prof, error: pe } = await supabase
      .from('user_profiles')
      .select('id,email,name,role,approved,active,clinic_id')
      .eq('id', u.id)
      .maybeSingle();
    if (pe) { console.log(`    ⚠ user_profiles 조회 실패: ${pe.message}`); }
    console.log(`    [3] user_profiles = ${JSON.stringify(prof)}`);
  }

  const u = matches[0];
  console.log('\nRESULT_JSON=' + JSON.stringify({
    exists: true,
    matches: matches.length,
    id: u.id,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at || null,
    last_sign_in_at: u.last_sign_in_at || null,
  }));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

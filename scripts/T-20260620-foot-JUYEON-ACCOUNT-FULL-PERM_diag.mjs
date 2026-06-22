/**
 * T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — RC 진단
 * juyeon 은 이미 user_profiles.role='admin'. 그런데 진료 대시보드 검수 불가 보고.
 * → role 외 원인 규명: (1) row 타임스탬프 (2) user_profiles SELECT RLS 가 본인 세션에서 자기 row 읽기 허용?
 *   loadProfile()은 로그인 사용자 토큰(RLS 적용)으로 .select('*').eq('id', uid) 수행.
 *   서비스롤은 RLS 우회라 row 보이지만, juyeon 브라우저 세션은 RLS 적용 → self-read 불가 시 profile=null → 메뉴 전체 숨김.
 * READ-ONLY.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const AUTH_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
const ANON_KEY = (readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .match(/VITE_SUPABASE_ANON_KEY=(\S+)/) || [])[1];

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== JUYEON RC 진단 ===\n');

  // 1. row 타임스탬프 + 전체 컬럼
  console.log('[1] user_profiles 전체 컬럼 + 타임스탬프 (service role)');
  const { data: row, error: re } = await svc
    .from('user_profiles').select('*').eq('id', AUTH_ID).maybeSingle();
  if (re) console.error('  err:', re.message);
  console.log('  ', JSON.stringify(row, null, 2));

  // 2. has_ops_authority 컬럼 실존 여부 (information_schema)
  console.log('\n[2] user_profiles 컬럼 목록 (has_ops_authority 실존 확인)');
  const { data: cols, error: ce } = await svc.rpc('exec_sql_readonly', {
    q: `select column_name from information_schema.columns where table_schema='public' and table_name='user_profiles' order by ordinal_position`
  }).then(r => r, () => ({ data: null, error: { message: 'rpc exec_sql_readonly 미존재' } }));
  if (ce) {
    console.log('  (rpc 없음 — select 시도로 대체)');
    const probe = await svc.from('user_profiles').select('has_ops_authority').limit(1);
    console.log('  has_ops_authority select:', probe.error ? `ERROR: ${probe.error.message}` : 'OK (컬럼 존재)');
  } else {
    console.log('  ', JSON.stringify(cols));
  }

  // 3. user_profiles SELECT RLS 정책 조회
  console.log('\n[3] user_profiles RLS SELECT 정책');
  const polProbe = await svc.rpc('exec_sql_readonly', {
    q: `select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
        from pg_policy where polrelid='public.user_profiles'::regclass`
  }).then(r => r, () => ({ data: null, error: { message: 'rpc 미존재' } }));
  if (polProbe.error) console.log('  (정책 직접조회 불가:', polProbe.error.message, ')');
  else console.log('  ', JSON.stringify(polProbe.data, null, 2));

  // 4. juyeon 세션 시뮬레이션: 본인 토큰으로 자기 profile self-read 가능?
  console.log('\n[4] juyeon 세션 RLS 시뮬 (magiclink 토큰 → authenticated 클라이언트로 self-read)');
  try {
    const { data: link, error: le } = await svc.auth.admin.generateLink({
      type: 'magiclink', email: 'juyeon@medibuilder.com',
    });
    if (le) { console.log('  generateLink err:', le.message); }
    const props = link?.properties;
    if (props?.hashed_token) {
      const anon = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data: vera, error: ve } = await anon.auth.verifyOtp({
        type: 'magiclink', token_hash: props.hashed_token,
      });
      if (ve) { console.log('  verifyOtp err:', ve.message); }
      else {
        const tok = vera?.session?.access_token;
        const userClient = createClient(SUPABASE_URL, ANON_KEY, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${tok}` } },
        });
        const { data: selfRow, error: selfErr } = await userClient
          .from('user_profiles').select('*').eq('id', AUTH_ID).maybeSingle();
        console.log('  self-read 결과:', selfErr ? `ERROR: ${selfErr.message}` : (selfRow ? `OK role=${selfRow.role}` : 'NULL (RLS 차단 의심)'));
      }
    }
  } catch (e) { console.log('  세션 시뮬 예외:', e.message); }
}

main().catch(e => { console.error(e); process.exit(1); });

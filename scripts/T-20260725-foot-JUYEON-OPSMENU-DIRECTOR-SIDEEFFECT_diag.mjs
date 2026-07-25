/**
 * T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT — READ-ONLY 진단
 * 가설(planner): JUYEON-DOCWRITE-1WK-TEMPACCESS pg_cron 이 7/25 00:00 KST 에
 *   김주연 총괄 role 을 admin→director 로 전환 → 단일-role 이라 admin-gated ops 메뉴
 *   (통계/매출집계/계정관리) 상실.
 * ★ mutation 절대 금지 — SELECT only. DB write/role 변경 없음.
 * 산출: (1) role 실측 + id↔email 재검증 (2) has_ops_authority prod 존재여부
 *       (3) cron 발동 이력(role 전환 시각).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const pick = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const SUPABASE_URL = pick('VITE_SUPABASE_URL') || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = pick('VITE_SUPABASE_ANON_KEY');
if (!SERVICE_ROLE_KEY) throw new Error('service role key absent in .env.local');

const EXPECT_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
const EXPECT_EMAIL = 'juyeon@medibuilder.com';

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function rawSql(q) {
  // 여러 후보 read-only RPC 시도(환경별 명칭 상이). 실패 시 null.
  for (const fn of ['exec_sql_readonly', 'exec_sql', 'sql']) {
    let r;
    try { r = await svc.rpc(fn, { q }); } catch (e) { r = { error: { message: e.message } }; }
    if (!r.error) return { via: fn, data: r.data };
  }
  return null;
}

async function main() {
  console.log('=== T-20260725 JUYEON OPSMENU DIRECTOR SIDE-EFFECT — READ-ONLY 진단 ===');
  console.log('실행:', new Date().toISOString(), '| URL:', SUPABASE_URL, '\n');

  // ── [1] role 실측 + id↔email 이중 재검증 (Cross-CRM Auth Identity 표준) ──
  console.log('[1] 김주연 총괄 계정 role 실측 (id↔email 이중조회 재검증)');
  // 1a. id 기준 조회 (권위 식별자)
  const byId = await svc.from('user_profiles').select('*').eq('id', EXPECT_ID).maybeSingle();
  console.log('  1a. id=' + EXPECT_ID + ' 기준:');
  if (byId.error) console.log('      ERROR:', byId.error.message);
  else console.log('      role=%s approved=%s clinic=%s updated_at=%s',
    byId.data?.role, byId.data?.approved, byId.data?.clinic_slug ?? byId.data?.clinic_id, byId.data?.updated_at);

  // 1b. GoTrue admin — id 로 auth 유저 조회 → email 대조 (server ?email= 단독 신뢰 금지)
  const authById = await svc.auth.admin.getUserById(EXPECT_ID).catch((e) => ({ error: e }));
  const authEmail = authById?.data?.user?.email;
  console.log('  1b. auth.getUserById → email=%s', authEmail);
  console.log('      id↔email 재검증:', authEmail === EXPECT_EMAIL
    ? 'MATCH ✓ (id ' + EXPECT_ID + ' == ' + EXPECT_EMAIL + ')'
    : 'MISMATCH ✗ expected=' + EXPECT_EMAIL + ' got=' + authEmail);

  // 1c. email 기준 profiles 역조회 → 동일 id 로 수렴하는지
  let byEmail;
  try { byEmail = await svc.from('user_profiles').select('id, role').eq('email', EXPECT_EMAIL).maybeSingle(); }
  catch (e) { byEmail = { error: { message: e.message } }; }
  if (byEmail.error) console.log('  1c. email 역조회: (skip)', byEmail.error.message);
  else console.log('  1c. email=%s 역조회 → id=%s role=%s | id 수렴:', EXPECT_EMAIL,
    byEmail.data?.id, byEmail.data?.role, byEmail.data?.id === EXPECT_ID ? '✓' : '✗');

  // ── [2] has_ops_authority 컬럼 prod 실존 여부 ──
  console.log('\n[2] has_ops_authority 컬럼 prod 실존 여부');
  const probe = await svc.from('user_profiles').select('has_ops_authority').limit(1);
  console.log('  select has_ops_authority:',
    probe.error ? `컬럼 부재 → ERROR: ${probe.error.message}` : 'OK — 컬럼 존재 (샘플:' + JSON.stringify(probe.data) + ')');
  const cols = await rawSql(
    `select column_name from information_schema.columns where table_schema='public' and table_name='user_profiles' and column_name in ('has_ops_authority','exempt_from_restrictions','role','email') order by column_name`);
  if (cols) console.log('  information_schema 확인(' + cols.via + '):', JSON.stringify(cols.data));
  else console.log('  (information_schema RPC 미가용 — 위 select probe 가 권위 근거)');

  // ── [3] cron lifecycle 잡 + 발동 이력 (role 전환 시각) ──
  console.log('\n[3] foot-juyeon-tempgrant-lifecycle cron 잡/발동 이력');
  const job = await rawSql(`select jobid, jobname, schedule, active from cron.job where jobname='foot-juyeon-tempgrant-lifecycle'`);
  console.log('  cron.job:', job ? JSON.stringify(job.data) : '(RPC 미가용)');
  const runs = await rawSql(
    `select status, return_message, start_time, end_time
       from cron.job_run_details
      where jobid in (select jobid from cron.job where jobname='foot-juyeon-tempgrant-lifecycle')
      order by start_time desc limit 12`);
  console.log('  최근 run 이력:', runs ? JSON.stringify(runs.data, null, 2) : '(cron.job_run_details RPC 미가용)');

  // 3b. role 전환 시각 = user_profiles.updated_at (grant tick 이 updated_at=now() 세팅)
  console.log('  role 전환 근거 updated_at (byId):', byId.data?.updated_at,
    '\n  (grant_at 경계 = 2026-07-24 15:00:00+00 = 2026-07-25 00:00 KST)');

  console.log('\n=== 진단 종료 (mutation 0건, SELECT only) ===');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

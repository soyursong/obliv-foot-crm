/**
 * T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER — 복구 (auth mutation)
 *
 * 진단 결론(diag): es.ki@medibuilder.com 계정 존재·id↔email clean, 그러나
 *   email_confirmed_at=NULL(미확인) + identities=[] → confirm-email 요구 GoTrue 가 로그인 거부
 *   → 현장엔 "비밀번호가 틀렸습니다"로 표출. banned/desync 아님.
 *
 * 복구(§조치 "email 미확인 → email_confirmed_at 강제 확인" + "비번 초기화 미반영 → admin 비번 직접설정"):
 *   1) id↔email 재검증(getUserById, INV-4) — 파괴적 mutation 직전 재확인.
 *   2) updateUserById(id, { email_confirm:true, password:<temp> }) — 강제 email 확인 + 임시 비번.
 *   3) after 재조회: email_confirmed_at set + identities 확인.
 *   4) 서버측 로그인 증명: anon signInWithPassword(temp) 성공 → 즉시 signOut (자격증명 실동작 증명).
 *
 * 표준 / 안전:
 *   - Cross-CRM Auth Identity Resolution: listUsers 전량 페이지네이션 exact 매칭 + 유일성 assert(diag에서 1건 확정),
 *     destructive 직전 getUserById id↔email 재검증(불일치=abort).
 *   - 임시비번은 랜덤 생성, 콘솔 전용 출력. git 커밋물(script/evidence/snapshot)에 미기재.
 *     현장 전달은 responder MQ 보안 relay(PHI 안전경로). 완료 후 첫 로그인 시 변경 안내.
 *   - db_change=false(GoTrue auth mutation=스키마/데이터계약 무관), code_change=false(app 무수정, ops artifact).
 *   - PHI: 실명/비번 원문 evidence 미기재.
 *
 * 실행:
 *   DRY(기본):  node scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_recover.mjs
 *   APPLY:      APPLY=true node scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_recover.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

function loadEnvLocal() {
  const out = {};
  if (!existsSync('.env.local')) return out;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const envl = loadEnvLocal();
const URL = process.env.VITE_SUPABASE_URL || envl.VITE_SUPABASE_URL || 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envl.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || envl.VITE_SUPABASE_ANON_KEY;
if (!KEY) { console.error('ABORT: SUPABASE_SERVICE_ROLE_KEY 필요'); process.exit(2); }

const TARGET_EMAIL = 'es.ki@medibuilder.com';
const APPLY = process.env.APPLY === 'true';
const norm = (e) => (e || '').trim().toLowerCase();
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

// 정책 준수 임시 비번: 대소문자+숫자+기호 포함, 콘솔 전용
function genTempPw() {
  const b = randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  return `Foot!${b}7`;
}

async function resolveExact() {
  const exact = [];
  let page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers err: ' + error.message);
    const users = data.users || [];
    for (const u of users) if (norm(u.email) === norm(TARGET_EMAIL)) exact.push(u);
    if (users.length < 1000) break;
    page += 1; if (page > 50) break;
  }
  return exact;
}

async function main() {
  const captured_at = new Date().toISOString();
  console.log(`=== ESKI 복구 (APPLY=${APPLY}) === ${captured_at}  target=${TARGET_EMAIL}`);

  const exact = await resolveExact();
  if (exact.length !== 1) { console.error(`ABORT: exact 매칭 ${exact.length}건(≠1) → 파괴 write 금지, planner FOLLOWUP`); process.exit(3); }
  const u = exact[0];
  console.log(`[1] resolved id=${u.id}  email=${u.email}`);
  console.log(`    before: email_confirmed_at=${u.email_confirmed_at ?? null} banned_until=${u.banned_until ?? null} identities=${(u.identities||[]).length}`);

  // before-snapshot (토큰/비번 미포함)
  mkdirSync('rollback', { recursive: true });
  const snap = { ticket: 'T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER', captured_at, id: u.id, email: u.email,
    before: { email_confirmed_at: u.email_confirmed_at ?? null, confirmed_at: u.confirmed_at ?? null,
      banned_until: u.banned_until ?? null, deleted_at: u.deleted_at ?? null,
      identities_cnt: (u.identities||[]).length, last_sign_in_at: u.last_sign_in_at ?? null, updated_at: u.updated_at },
    note: 'rollback=email_confirm 은 비파괴적 상태전환. 필요시 재확인. temp pw 는 미기재(콘솔전용).' };
  writeFileSync('rollback/T-20260731-foot-LOGIN-FAIL-ESKI_before.json', JSON.stringify(snap, null, 2));
  console.log('[1] before-snapshot → rollback/T-20260731-foot-LOGIN-FAIL-ESKI_before.json');

  if (!APPLY) { console.log('\n[DRY] APPLY=true 로 재실행 시: email_confirm=true + 임시비번 설정 + 로그인 증명.'); return; }

  // 2) INV-4: destructive 직전 id↔email 재검증
  const { data: gz, error: ge0 } = await svc.auth.admin.getUserById(u.id);
  if (ge0) { console.error('getUserById err:', ge0.message); process.exit(1); }
  if (gz.user.id !== u.id || norm(gz.user.email) !== norm(TARGET_EMAIL)) {
    console.error(`ABORT INV-4: id↔email 불일치 (resolved=${u.id}/${TARGET_EMAIL} vs ${gz.user.id}/${gz.user.email})`); process.exit(4);
  }
  console.log('[2] INV-4 id↔email 재검증 통과 (destructive 직전)');

  // 3) 강제 email 확인 + 임시 비번
  const tempPw = genTempPw();
  const { data: up, error: ue } = await svc.auth.admin.updateUserById(u.id, { email_confirm: true, password: tempPw });
  if (ue) { console.error('updateUserById err:', ue.message); process.exit(1); }
  console.log('[3] updateUserById: email_confirm=true + 임시비번 설정 ✅');

  // after 재조회
  const { data: af } = await svc.auth.admin.getUserById(u.id);
  console.log(`    after: email_confirmed_at=${af.user.email_confirmed_at ?? null} identities=${(af.user.identities||[]).length} providers=${JSON.stringify((af.user.identities||[]).map(i=>i.provider))}`);

  // 4) 서버측 로그인 증명 (anon signInWithPassword) → 즉시 signOut
  let loginProof = 'skipped(no anon key)';
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: si, error: se } = await anon.auth.signInWithPassword({ email: TARGET_EMAIL, password: tempPw });
    if (se) { loginProof = 'FAIL: ' + se.message; console.error('[4] 로그인 증명 실패:', se.message); }
    else { loginProof = `OK (server-side signInWithPassword, uid=${si.user.id})`; console.log('[4] 서버측 로그인 증명 ✅', loginProof); await anon.auth.signOut(); }
  }

  const evidence = { ticket: 'T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER', applied_at: new Date().toISOString(),
    id: u.id, email: u.email, id_email_reverify: 'PASS(INV-4)',
    before_email_confirmed_at: u.email_confirmed_at ?? null,
    after_email_confirmed_at: af.user.email_confirmed_at ?? null,
    after_identities: (af.user.identities||[]).map(i=>i.provider),
    login_proof: loginProof, cause: 'email_confirmed_at=NULL(미확인 계정) → confirm-email GoTrue 로그인 거부(=비번 오류로 표출)',
    fix: 'admin email_confirm=true + 임시비번 재설정. temp pw 는 responder 보안 relay(콘솔전용, git 미기재).',
    db_change: false, phi_note: '실명/비번 원문 미기재' };
  writeFileSync('scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_recover-evidence.json', JSON.stringify(evidence, null, 2));
  console.log('\n[evidence] → scripts/T-20260731-foot-LOGIN-FAIL-ESKI-ACCT-RECOVER_recover-evidence.json');
  console.log('\n========== RELAY (콘솔 전용 · git 미기재) ==========');
  console.log('TEMP_PW:', tempPw);
  console.log('안내: es.ki@medibuilder.com 로 로그인 후 즉시 비밀번호 변경. 링크: https://obliv-foot-crm.pages.dev/login');
  console.log('===================================================');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });

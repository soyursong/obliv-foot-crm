/**
 * T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — 풋센터 CRM 조회용 계정 발급 (최필경님)
 *
 * 승인 근거(authority): 총괄 김주연(U0ATDB587PV = foot 데이터오너 = 매출/PHI 인가 authority)
 *   원 채널 명시 승인 "해당 계정 승인해줘 - pk.choi@medibuilder.com" (ts 1784599948.998289).
 *   DECISION-REQUEST(669s) → conflict 해소, B안(기존 role manager 임시부여) 확정.
 *
 * 대상: 최필경 (오블리브 서울오리진 결제모듈 담당) / pk.choi@medibuilder.com
 * role: manager  ← 총괄 승인 framing 그대로(일마감>레드페이 탭 조회 가능한 기존 최소권한 role).
 *   ⚠ manager 는 read-only 아님(edit 포함 + 매출/통계/계정 화면 노출) = 최소권한 위배.
 *     **임시부여** 성격 — ROLE-MATRIX-3TIER-RBAC 완료 시 정식 read-only(A안)로 승격·회수 대상.
 *   ⚠ PHI(환자정보) prod — 로그인 시 기존 마스킹 정책 범위 내에서 환자정보 노출면 발생(authority 수용).
 *
 * 생성 범위(KGMIN/create_staff_accounts SOP 재사용):
 *   1) Supabase Auth user 생성 (email_confirm=true)  ← 즉시 로그인 가능(self-signup 미확인 블로커 회피)
 *      handle_new_user 트리거가 user_profiles 선삽입(role=raw_meta.role 화이트리스트=manager, approved=false 서버강제)
 *   2) user_profiles UPDATE → name=최필경 / role=manager / approved=true / active=true / clinic_id
 *   3) staff INSERT → clinic_id / name / role=manager / user_id 연결 (이력추적 활성)
 *
 * 안전:
 *   - ★Identity 재검증(createUser 반환 id ↔ 요청 email) 선행 (GOTRUE-EMAIL-FILTER-BAN).
 *   - idempotent: auth.users 이메일 이미 존재 → 생성 스킵·기존 id 재사용(중복 계정 방지).
 *   - before/after 스냅샷(rollback/, 평문비번 미포함) 적재 + rollback SQL 기록(계정 회수/비활성).
 *   - 임시비번 env(TEMP_PW) 주입 — 평문 git 미커밋. 콘솔 출력만 → responder relay 1회(최필경 DM 권장).
 *   - DDL/신규 컬럼/enum/테이블 0. 계정 데이터만(db_change=false).
 *
 * 실행:
 *   DRY:   SUPABASE_SERVICE_ROLE_KEY=.. VITE_SUPABASE_ANON_KEY=.. node scripts/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_create.mjs
 *   APPLY: (위 + ) APPLY=true TEMP_PW='<강한랜덤16+>' node scripts/..._create.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.ANON_KEY || '';
const APPLY = process.env.APPLY === 'true';
const TEMP_PW = process.env.TEMP_PW || '';

const TICKET = 'T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI';
const EMAIL = 'pk.choi@medibuilder.com';
const NAME = '최필경';
const ROLE = 'manager';          // 총괄 승인 framing (임시부여)
const CLINIC_SLUG = 'jongno-foot';

const svc = createClient(URL, KEY, { auth: { persistSession: false } });
const log = (m) => console.log(m);

async function findUserByEmail(email) {
  // listUsers 전수 스캔(server ?email= 필터 단독 신뢰 금지 — GOTRUE-EMAIL-FILTER-BAN)
  const target = email.trim().toLowerCase();
  let page = 1; const perPage = 1000;
  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers 실패: ${error.message}`);
    if (!data?.users?.length) return null;
    const hit = data.users.find((u) => (u.email || '').trim().toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function main() {
  log(`=== ${TICKET} — 최필경 조회계정 발급 (APPLY=${APPLY}) ===  ${new Date().toISOString()}`);

  // 0) clinic_id (서버 파생)
  const { data: clinic, error: ce } = await svc.from('clinics').select('id, name, slug').eq('slug', CLINIC_SLUG).single();
  if (ce || !clinic) { console.error(`clinics[slug=${CLINIC_SLUG}] 조회 실패: ${ce?.message}`); process.exit(1); }
  const CLINIC_ID = clinic.id;
  log(`[0] clinic 확인: ${clinic.name} (${CLINIC_ID})`);

  // 1) idempotent 가드 — 이미 존재?
  const existing = await findUserByEmail(EMAIL);
  if (existing) log(`[1] auth.users 이미 존재(${existing.id}) → 생성 스킵, profiles/staff 정합 보정 대상`);
  else log(`[1] auth.users 미존재 → 신규 createUser 예정`);

  // ── RECONCILE 판정: 이미 confirmed(본인 로그인 이력 있음)이면 비번 보존, 권한만 보정 ──
  const alreadyUsable = Boolean(existing && existing.email_confirmed_at);
  const preservePw = alreadyUsable && process.env.FORCE_PW_RESET !== 'true';

  if (!APPLY) {
    log('\n[DRY] APPLY=true 로 재실행 시 실제 반영.');
    if (preservePw) {
      log(`  판정: RECONCILE — 계정 이미 존재·email confirmed(본인 로그인 이력) → 비번 보존(파괴 금지).`);
      log(`  예정: user_profiles UPDATE(role staff→${ROLE}, approved=true) → staff INSERT. 비번 미변경.`);
    } else {
      log(`  예정: ${existing ? 'updateUserById(임시비번 재설정)' : 'createUser(email_confirm)'} → user_profiles UPDATE(role=${ROLE}) → staff INSERT`);
      log(`  ⚠ TEMP_PW(12자+) 필요. (FORCE_PW_RESET=true 로 기존계정 비번 강제 재설정 가능)`);
    }
    return;
  }

  // 2) Auth user
  let userId;
  if (preservePw) {
    userId = existing.id;
    log(`[2] RECONCILE: 기존 계정 비번 보존(본인 소유·로그인 이력) — Auth write 없음.`);
  } else if (existing) {
    if (!TEMP_PW || TEMP_PW.length < 12) { console.error('ABORT: TEMP_PW(12자+) 필요.'); process.exit(2); }
    userId = existing.id;
    const { error: ue } = await svc.auth.admin.updateUserById(userId, { password: TEMP_PW, email_confirm: true });
    if (ue) { console.error('updateUserById 실패:', ue.message); process.exit(1); }
    log(`[2] 기존 계정 임시비번 재설정 + email_confirm ✅`);
  } else {
    if (!TEMP_PW || TEMP_PW.length < 12) { console.error('ABORT: TEMP_PW(12자+) 필요.'); process.exit(2); }
    const { data: authData, error: authErr } = await svc.auth.admin.createUser({
      email: EMAIL, password: TEMP_PW, email_confirm: true,
      user_metadata: { name: NAME, role: ROLE },
    });
    if (authErr) { console.error('Auth 생성 실패:', authErr.message); process.exit(1); }
    userId = authData.user.id;
    log(`[2] Auth user 생성 ✅  id=${userId}`);
  }

  // 0*) ★Identity 재검증 (write 직전 id↔email) — GOTRUE-EMAIL-FILTER-BAN
  const { data: byId, error: ge } = await svc.auth.admin.getUserById(userId);
  if (ge) { console.error('getUserById 실패:', ge.message); process.exit(1); }
  if ((byId.user.email || '').trim().toLowerCase() !== EMAIL) {
    console.error(`ABORT: uid↔email 불일치 (${byId.user.email} ≠ ${EMAIL})`); process.exit(2);
  }
  log(`[0*] Identity 재검증 OK: ${userId} = ${byId.user.email}`);

  // before-snapshot (평문비번 미포함)
  const { data: prof0 } = await svc.from('user_profiles').select('name, role, approved, active, clinic_id').eq('id', userId).maybeSingle();
  const { data: st0 } = await svc.from('staff').select('id, name, role, active, clinic_id').eq('user_id', userId).maybeSingle();
  mkdirSync('rollback', { recursive: true });
  const snapPath = `rollback/${TICKET}_before.json`;
  writeFileSync(snapPath, JSON.stringify({
    ticket: TICKET, captured_at: new Date().toISOString(), id: userId, email: byId.user.email,
    email_confirmed_at: byId.user.email_confirmed_at, created_at: byId.user.created_at,
    user_profiles: prof0, staff: st0,
    note: 'password hash NOT captured (irreversible). role=manager 임시부여 — 회수 시 rollback SQL 참조.',
  }, null, 2));
  log(`[snapshot] → ${snapPath}`);

  // rollback SQL (계정 회수/비활성 — RBAC 정식역할 승격 시 또는 임시부여 만료 시)
  const rbPath = `rollback/${TICKET}_rollback.sql`;
  writeFileSync(rbPath,
    `-- Rollback: ${TICKET} — 최필경 조회계정 임시부여 회수\n` +
    `-- (비번 해시 irreversible. 계정 비활성/권한 강등으로 회수.)\n` +
    `-- 완전 비활성:\n` +
    `--   UPDATE public.user_profiles SET active=false, approved=false WHERE id='${userId}';\n` +
    `--   UPDATE public.staff SET active=false WHERE user_id='${userId}';\n` +
    `-- RBAC A안(read-only) 승격 시: role 을 정식 조회역할로 교체(3TIER-RBAC 완료 후).\n`);
  log(`[rollback] → ${rbPath}`);

  // 3) user_profiles UPDATE (트리거 선삽입 행 보정 — approved=true 서버강제 해제)
  const { error: pe } = await svc.from('user_profiles')
    .update({ email: EMAIL, name: NAME, role: ROLE, approved: true, active: true, clinic_id: CLINIC_ID })
    .eq('id', userId);
  if (pe) { console.error('user_profiles UPDATE 실패:', pe.message); process.exit(1); }
  log(`[3] user_profiles 정합 ✅ (role=${ROLE}, approved=true, active=true)`);

  // 4) staff INSERT (idempotent)
  const { data: stEx } = await svc.from('staff').select('id').eq('user_id', userId).maybeSingle();
  if (stEx) {
    const { error: se } = await svc.from('staff').update({ name: NAME, role: ROLE, active: true, clinic_id: CLINIC_ID }).eq('user_id', userId);
    if (se) { console.error('staff UPDATE 실패:', se.message); process.exit(1); }
    log(`[4] staff row 이미 존재 → 정합 보정 ✅`);
  } else {
    const { error: si } = await svc.from('staff').insert({ user_id: userId, name: NAME, role: ROLE, active: true, clinic_id: CLINIC_ID });
    if (si) { console.error('staff INSERT 실패:', si.message); process.exit(1); }
    log(`[4] staff INSERT ✅`);
  }

  // 5) 실로그인 검증 (password grant) — 비번 보존 케이스는 비번 미지 → 검증 스킵(본인 로그인 이력이 근거)
  if (preservePw) {
    log(`[5] 비번 보존(RECONCILE) → password-grant 검증 스킵. 근거: last_sign_in_at=${existing.last_sign_in_at || 'N/A'} (본인 로그인 실증).`);
  } else if (!ANON) { console.warn('[5] ANON key 없음 → 로그인 검증 스킵'); }
  else {
    const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: TEMP_PW }) });
    const j = await r.json();
    log(`[5] 실로그인 검증: ${r.status} ${j.access_token ? '✅ access_token 발급' : `❌ ${JSON.stringify(j)}`}`);
    if (!j.access_token) process.exit(1);
  }

  // 6) 권한 게이트 재확인
  const { data: prof } = await svc.from('user_profiles').select('name, role, approved, active, clinic_id').eq('id', userId).maybeSingle();
  log(`[6] user_profiles gate: ${JSON.stringify(prof)} ${prof?.approved && prof?.active ? '→ 워크스페이스 진입 OK' : '→ ⚠게이트 미충족'}`);

  log('\n[DONE] 권한 보정 완료.');
  log(`  로그인 URL: https://obliv-foot-crm.pages.dev`);
  log(`  email: ${EMAIL} | role: ${ROLE} (임시부여·회수가능)`);
  if (preservePw) {
    log('  ↳ RECONCILE: 계정 이미 존재·본인 로그인 이력 → 비번 미변경. relay 시 "기존 본인 비밀번호로 로그인" 안내.');
    log('    (신규 임시비번 발급/전달 불요 — 새 비번 relay 하면 오히려 혼선.)');
  } else {
    log('  ↳ responder relay 1회: URL + email + 임시PW → 최필경(U05L6HE7QF6) DM 권장(공개스레드 노출 최소화).');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });

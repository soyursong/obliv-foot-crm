/**
 * T-20260713 FACEOFANGEL — 복구 (auth-ops, 임시 비밀번호 재설정)
 * SOP: T-20260526-body-STAFF-PW-RECOVERY (동일 조직 oblivseoul, recovery email = localhost 리디렉트 broken → temp pw 직접설정).
 *
 * 대상: faceofangel9999@oblivseoul.kr (b36e74a3-be1f-4b61-aeb4-9150affe2c05) — 김지윤, coordinator/consultant.
 * RC: 계정 구조 정상(identity·email_confirmed·approved·not banned/deleted) → GoTrue invalid_credentials = 자격증명 불일치.
 *
 * 안전:
 *   - 실행 전 before-snapshot(rollback/ 디렉토리) 적재 (평문 비번 미포함 — 상태 시각만).
 *   - 임시 비번은 콘솔에만 출력, git 커밋물(ticket/report)엔 미기재. 현장 전달은 responder MQ 경유.
 *   - 롤백 = 본인 최초 로그인 후 즉시 변경(직원공간>내 프로필) / 또는 재-재설정. 이전 해시는 복구 불가(irreversible by design), 계정영향 없음.
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... APPLY=true TEMP_PW='...' node scripts/..._recover.mjs   (기본 DRY)
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('need SERVICE_ROLE'); })());
const ID = 'b36e74a3-be1f-4b61-aeb4-9150affe2c05';
const EMAIL = 'faceofangel9999@oblivseoul.kr';
const APPLY = process.env.APPLY === 'true';
const TEMP_PW = process.env.TEMP_PW || '';
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`=== FACEOFANGEL 복구 (APPLY=${APPLY}) ===`, new Date().toISOString());

  // 0) before-snapshot
  const { data: before } = await svc.auth.admin.getUserById(ID);
  const b = before.user;
  const snap = { ticket: 'T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL', captured_at: new Date().toISOString(),
    id: b.id, email: b.email, email_confirmed_at: b.email_confirmed_at, banned_until: b.banned_until ?? null,
    deleted_at: b.deleted_at ?? null, updated_at: b.updated_at, last_sign_in_at: b.last_sign_in_at,
    identities_cnt: (b.identities || []).length, note: 'password hash NOT captured (irreversible). rollback=user self-change.' };
  mkdirSync('rollback', { recursive: true });
  const snapPath = `rollback/T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL_before.json`;
  writeFileSync(snapPath, JSON.stringify(snap, null, 2));
  console.log('[0] before-snapshot →', snapPath, JSON.stringify(snap));

  if (!APPLY) { console.log('\n[DRY] APPLY=true + TEMP_PW=... 로 재실행 시 임시비번 설정.'); return; }
  if (!TEMP_PW || TEMP_PW.length < 8) { console.error('ABORT: TEMP_PW(8자+) 필요.'); process.exit(2); }

  // 1) 임시 비번 설정 (admin.updateUserById) — WRITE (auth.users 1행)
  const { data: upd, error: ue } = await svc.auth.admin.updateUserById(ID, { password: TEMP_PW });
  if (ue) { console.error('UPDATE err:', ue.message); process.exit(1); }
  console.log('[1] 임시비번 설정 ✅ updated_at:', upd.user.updated_at);

  // 2) 로그인 검증 (password grant)
  const anon = process.env.ANON_KEY;
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: TEMP_PW }) });
  const j = await r.json();
  console.log('[2] 로그인 검증:', r.status, j.access_token ? '✅ access_token 발급' : `❌ ${JSON.stringify(j)}`);

  // 3) 권한화면 게이트 재확인 (approved=true 여야 /admin 진입)
  const { data: prof } = await svc.from('user_profiles').select('approved, role, active').eq('id', ID).maybeSingle();
  console.log('[3] user_profiles gate:', JSON.stringify(prof), prof?.approved ? '→ /admin 진입 OK' : '→ ⚠승인대기 화면');

  console.log('\n[DONE] 임시비번=콘솔 상단(현장 전달은 responder 경유, git 미기재). 최초 로그인 후 즉시 변경 안내.');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });

/**
 * T-20260727-foot-CHOI-PK-LOGIN-BLOCKED — 복구 (auth-ops, recovery 링크 재발급)
 *
 * 대상: 최필경 총괄 (pk.choi@medibuilder.com, slack U05L6HE7QF6)
 * RC: 서버측 계정 정상(7/27 진단 재확인) = 자격증명 레벨 비번 불일치.
 *     recovery 링크 생성됐으나 현장 전달 미완료(gap) + 기링크 만료 가능성 → 재발급 필수.
 *
 * 방식: admin.generateLink(type=recovery) — 평문 비번 미사용(FACEOFANGEL temp-pw SOP과 다름).
 *       재설정 링크 방식만. redirect_to = https://obliv-foot-crm.pages.dev/login (정본 CF Pages).
 *
 * 안전 / 표준:
 *   - Cross-CRM Auth Identity Resolution 표준: `?email=` 서버필터 단독 신뢰 금지.
 *     → listUsers 전량 페이지네이션 후 client-side exact(lowercase) email 매칭 + 유일성 assert.
 *     → 링크 발급 직후 반환 user.id↔email 재검증(mutating op 직전/직후 id↔email 재확인).
 *   - action_link 는 recovery 토큰 포함(민감) → 콘솔에만 출력. git 커밋물(script/ticket/snapshot)엔 미기재.
 *     현장 전달은 responder MQ 경유(재설정 링크 방식). 평문 비번 채널 노출 금지.
 *   - before-snapshot(rollback/): 계정 상태 시각만(토큰·비번 미포함).
 *   - db_change=false(auth 토큰 regen은 스키마·데이터 변경 아님) / code_change=false(app코드 무수정, ops artifact).
 *
 * 실행:
 *   DRY(기본):  node scripts/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_recover.mjs
 *   APPLY:      APPLY=true node scripts/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_recover.mjs
 *   (키는 .env.local 자동 로드, 또는 env override)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// --- .env.local 로더 (secret bash echo 회피) ---
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

const TARGET_EMAIL = 'pk.choi@medibuilder.com';
const REDIRECT_TO = 'https://obliv-foot-crm.pages.dev/login';
const APPLY = process.env.APPLY === 'true';
const svc = createClient(URL, KEY, { auth: { persistSession: false } });

const norm = (e) => (e || '').trim().toLowerCase();

async function resolveIdentity() {
  // Cross-CRM Auth Identity: ?email= 서버필터 단독 신뢰 금지 → 전량 스캔 후 client-side exact 매칭.
  const matches = [];
  let page = 1;
  for (;;) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers err: ' + error.message);
    const users = data.users || [];
    for (const u of users) if (norm(u.email) === norm(TARGET_EMAIL)) matches.push(u);
    if (users.length < 1000) break;
    page += 1;
    if (page > 50) break; // safety cap
  }
  return matches;
}

async function main() {
  console.log(`=== CHOI 최필경 recovery 링크 재발급 (APPLY=${APPLY}) ===`, new Date().toISOString());
  console.log(`target=${TARGET_EMAIL}  redirect_to=${REDIRECT_TO}`);

  // 1) identity resolution + 유일성 assert
  const matches = await resolveIdentity();
  console.log(`[1] exact-email 매칭 계정 수: ${matches.length}`);
  if (matches.length === 0) { console.error('ABORT: 해당 email 계정 없음 → planner FOLLOWUP 필요(id↔email 불일치/미존재).'); process.exit(3); }
  if (matches.length > 1) {
    console.error('ABORT: 동일 email 다중 계정 → 파괴/발급 전 disambiguation 필요(Auth Identity 표준).');
    console.error(matches.map(u => u.id).join(', '));
    process.exit(3);
  }
  const user = matches[0];
  console.log(`    resolved id=${user.id}  email=${user.email}`);
  console.log(`    email_confirmed_at=${user.email_confirmed_at}  banned_until=${user.banned_until ?? null}  deleted_at=${user.deleted_at ?? null}`);
  console.log(`    last_sign_in_at=${user.last_sign_in_at}  identities=${(user.identities || []).length}`);

  // 2) before-snapshot (상태 시각만, 토큰·비번 미포함)
  const snap = { ticket: 'T-20260727-foot-CHOI-PK-LOGIN-BLOCKED', captured_at: new Date().toISOString(),
    id: user.id, email: user.email, email_confirmed_at: user.email_confirmed_at,
    banned_until: user.banned_until ?? null, deleted_at: user.deleted_at ?? null,
    updated_at: user.updated_at, last_sign_in_at: user.last_sign_in_at,
    identities_cnt: (user.identities || []).length,
    note: 'recovery token/link NOT captured (sensitive). rollback=link expiry(default) / re-issue.' };
  mkdirSync('rollback', { recursive: true });
  const snapPath = 'rollback/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_before.json';
  writeFileSync(snapPath, JSON.stringify(snap, null, 2));
  console.log('[2] before-snapshot →', snapPath);

  if (!APPLY) { console.log('\n[DRY] APPLY=true 로 재실행 시 recovery 링크 발급. 링크는 콘솔에만 출력됨.'); return; }

  // 3) recovery 링크 발급 (mutating: auth.users.recovery_token regen)
  const { data: gen, error: ge } = await svc.auth.admin.generateLink({
    type: 'recovery', email: TARGET_EMAIL, options: { redirectTo: REDIRECT_TO } });
  if (ge) { console.error('generateLink err:', ge.message); process.exit(1); }

  // 4) 발급 직후 id↔email 재검증 (Auth Identity 표준)
  const gu = gen.user || {};
  if (gu.id !== user.id || norm(gu.email) !== norm(TARGET_EMAIL)) {
    console.error(`ABORT: 발급후 id↔email 불일치 (resolved=${user.id}/${TARGET_EMAIL} vs returned=${gu.id}/${gu.email})`);
    process.exit(4);
  }
  const link = gen.properties?.action_link;
  console.log('[3] recovery 링크 발급 ✅  발급후 id↔email 재검증 통과');
  console.log('[4] redirect_to 확인:', REDIRECT_TO);
  console.log('\n========== RELAY (콘솔 전용 · git 미기재) ==========');
  console.log('ACTION_LINK:', link);
  console.log('EXPIRES: GoTrue 기본 만료(대략 1h~24h, 프로젝트 설정) → 즉시 사용 안내');
  console.log('===================================================');
  console.log('\n[DONE] 위 ACTION_LINK 를 responder MQ TICKET-UPDATE 로 전달(재설정 링크 방식). git 커밋물 미기재.');
  console.log('       generateLink 는 이메일 자동발송 안 함 → 현장 전달은 responder 스레드 relay(step3 링크-only 방식).');
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });

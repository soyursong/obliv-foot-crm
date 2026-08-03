/**
 * admin-register-staff — T-20260803-foot-STAFF-PROVISION-ATOMIC-EF-INV6-PORT (P2, lane: dev-foot)
 *
 * 직원 계정 등록 원자화 Edge Function (server-side, service_role).
 * body pilot 이식: obliv-body-crm admin-register-staff (commit 15d18d00, 배포 2026-07-15 02:11 KST).
 * governing SSOT: cross_crm_auth_identity_standard.md (INV-1~6 · body=canonical pilot, foot=횡전개).
 *
 * ── 배경(RC — 풋 구조적 재발원) ──────────────────────────────────────────────
 *   기존 FE(Accounts.tsx#inviteStaff) = 비원자적 3단 클라이언트 흐름:
 *     (1) signupClient.auth.signUp                → auth.users 선커밋(email_confirmed_at=NULL)
 *     (2) admin_register_user RPC                 → user_profiles/staff 매핑
 *     (3) admin_approve_and_confirm_user RPC      → approved=true + email_confirmed_at 강제
 *   (2)/(3) 중 하나라도 실패 시 (1) 무롤백 → 미확인·기본role(staff)·approved=false 고아 auth.users 잔존.
 *   이 고아가 이후 동일 email 재등록을 "User already registered" 로 전면차단(이정인/이은희/진이서 실증).
 *   auth.users(GoTrue) ↔ admin_register_user(Postgres RPC) 는 하나의 txn 에 묶을 수 없음 →
 *   두 호출을 모두 소유하고 실패 시 보상하는 server-side 오케스트레이터가 유일한 all-or-nothing 경로
 *   (cross_crm_auth_identity_standard §INV-6 이 경고한 정확한 위험을 제거).
 *
 * ── ★ 풋 이식 편차 (body pilot 대비) ────────────────────────────────────────
 *   1. admin_register_user 실패신호: 풋 RPC(mig …_part_lead)는 **RAISE EXCEPTION** 으로 전량 신호
 *      (body 는 검증실패를 jsonb error 로 정상반환). ⇒ 풋은 rpcErr(transport/exception)로 잡힘.
 *      방어적으로 jsonb.error 도 병행 검사(장래 RPC 시맨틱 변화 대비, 무해).
 *   2. admin_register_user 시그니처: 풋은 link_existing_staff 인자 **없음**
 *      (target_user_id, email, name, role, approved, staff_id).
 *   3. role 매핑: 풋 role = admin/manager/director/part_lead/consultant/coordinator/therapist/
 *      technician/tm/staff. 임상직(staff 테이블 매핑)= consultant/coordinator/therapist/technician.
 *      (body 의 'space' sentinel 없음. body 엔 part_lead/technician 없음.)
 *   4. 호출자 게이트: 풋 is_admin_or_manager() = admin/manager/director → CALLER_ALLOWED_ROLES 3종.
 *   5. email 자동확인: createUser({email_confirm:true})가 신규계정을 이미 확인처리.
 *      단, **고아 재사용(self-heal)** 계정은 signUp 산이라 email_confirmed_at=NULL 일 수 있음 →
 *      register 성공 후 기존 idempotent admin_approve_and_confirm_user 로 email 확인을 보증한다
 *      (풋 STAFF-REGISTER-EMAILCONFIRM 하드닝을 원자 EF 안으로 흡수). 이 confirm 실패는 롤백사유 아님
 *      (계정은 등록됨 — 롤백하면 고아문제 재현). ok:true + email_confirm_warning 로 fail-loud.
 *   6. INV-5 감사: 풋은 record_auth_action / stamp_auth_action_outcome SECURITY DEFINER RPC 보유
 *      → 호출자 JWT 스코프로 호출해 감사 트레일 보존(body 는 테이블 부재로 console.log-only 였음).
 *
 * ── 원자 흐름 ────────────────────────────────────────────────────────────────
 *   입력: { email, password, name, role, staff_id? } + 호출자 세션 JWT
 *   0. JWT 검증 → actorUserId(auth.uid). 호출자 role ∈ (admin,manager,director) + clinic_id. (INV-5)
 *   1. resolveUserByEmail(email) [INV-1~3: 전량조회+정확매칭+모호성 fail-closed]
 *        · 매칭 有 + user_profiles 매핑됨 → 409 ALREADY_REGISTERED
 *        · 매칭 有 + user_profiles 無(기존 고아) → 그 id 재사용(self-heal), createUser 건너뜀
 *        · 매칭 無 → step 2
 *   2. auth.admin.createUser({ email_confirm:true }) → newUserId (이메일 인증 루프 소멸)
 *   3. record_auth_action(invite_overwrite) → admin_register_user RPC(호출자 JWT 스코프, auth.uid/clinic 보존)
 *   4. 성공(rpcErr 無 AND jsonb.error 無) → admin_approve_and_confirm_user(email 확인 보증) → { ok:true, data }
 *      실패 → (step2 신규계정일 때만) assertUserIdentity[INV-4] → deleteUser 보상삭제 → 감사(INV-5)
 *             → { ok:false, error }.  ※재사용 고아는 삭제 안 함(기존 자산, 매핑만 재시도)
 *
 * ── 게이트 ──────────────────────────────────────────────────────────────────
 *   ADDITIVE — admin_register_user/admin_approve_and_confirm_user 시그니처·auth 스키마·DB shape
 *   무접촉(신규 EF + FE 1콜 전환). db_change=false.
 *   service_role 미노출 — EF 전용(SUPABASE_SERVICE_ROLE_KEY). FE 는 인증세션 JWT 로 invoke 만.
 *   RPC 호출은 anon-key + 호출자 Bearer JWT 스코프 클라이언트 사용(service_role 로 호출 시 auth.uid=NULL
 *   → caller has no clinic_id 오류). service_role 은 GoTrue admin(list/create/get/delete) 전용.
 *
 * ── 반환봉투 ────────────────────────────────────────────────────────────────
 *   { ok: boolean, error: { code, message } | null, data?: {...} }
 *   business/rollback 결과는 HTTP 200 + ok:false(FE 가 봉투 message 노출 가능).
 *   auth 실패 401/403, 잘못된 요청 400, 예기치 못한 오류 500 — 모두 동일 봉투 형태.
 */

// body pilot(15d18d00) 표준: npm: specifier. GoTrue admin surface(list/create/get/delete)를 쓰는
// 첫 풋 EF — esm.sh 는 admin API 전이트리(node-fetch/ws/bufferutil/utf-8-validate/node-gyp-build)를
// vfs 번들 단계에서 끌어와 실패 가능. body 가 CLI 2.109.0 에서 npm 핀으로 admin surface 배포 검증함.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// 풋 role SSOT — user_profiles CHECK / admin_register_user 검증목록과 1:1(20260513…_part_lead).
const ALLOWED_ROLES = new Set([
  'admin', 'manager', 'director', 'part_lead',
  'consultant', 'coordinator', 'therapist', 'technician', 'tm', 'staff',
]);
// 호출자 게이트 = 풋 is_admin_or_manager()(admin/manager/director). RPC 가드와 일치.
const CALLER_ALLOWED_ROLES = new Set(['admin', 'manager', 'director']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}
function ok(data: Record<string, unknown>): Response {
  return json({ ok: true, error: null, data }, 200);
}
function fail(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}

// ── canonical: resolveUserByEmail (INV-1,2,3 — 전량조회+정확매칭+fail-closed) ──
class AuthResolveError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = 'AuthResolveError'; this.code = code; }
}
// deno-lint-ignore no-explicit-any
async function resolveUserByEmail(admin: any, rawEmail: string): Promise<{ user: any | null }> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  if (!email) throw new AuthResolveError('EMPTY_EMAIL');
  // deno-lint-ignore no-explicit-any
  const matches: any[] = [];
  const perPage = 1000;
  const MAX_PAGES = 100;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new AuthResolveError('LIST_FAILED');
    const users = data?.users ?? [];
    for (const u of users) {
      if ((u.email ?? '').trim().toLowerCase() === email) matches.push(u);
    }
    if (users.length < perPage) break;
    if (page === MAX_PAGES) throw new AuthResolveError('PAGE_BOUND_EXCEEDED');
  }
  if (matches.length === 0) return { user: null };                       // INV-3 not-found
  if (matches.length > 1) throw new AuthResolveError('AMBIGUOUS_EMAIL');  // INV fail-closed
  return { user: matches[0] };
}

// ── canonical: assertUserIdentity (INV-4) — destructive(deleteUser) 직전 id↔email 재검증 ──
// deno-lint-ignore no-explicit-any
async function assertUserIdentity(admin: any, userId: string, expectedEmail: string): Promise<void> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new AuthResolveError('REVERIFY_FETCH_FAILED');
  const got = (data.user.email ?? '').trim().toLowerCase();
  const want = (expectedEmail ?? '').trim().toLowerCase();
  if (got !== want) throw new AuthResolveError('IDENTITY_MISMATCH');
}

// ── INV-5 감사 (풋: record_auth_action/stamp RPC 를 호출자 JWT 스코프로 back — auth.uid() 서버확정) ──
// best-effort: 감사 실패가 provisioning 을 막지 않는다(감사부재 > 계정생성차단). warn-log 만.
// deno-lint-ignore no-explicit-any
async function recordAuthActionEF(caller: any, targetUserId: string, email: string): Promise<number | null> {
  try {
    const { data, error } = await caller.rpc('record_auth_action', {
      p_target_user_id: targetUserId,
      p_target_email: email,
      p_action: 'invite_overwrite',
      p_request_meta: { via: 'admin-register-staff-ef' },
    });
    if (error) { console.warn('[INV-5] audit insert failed (best-effort)', error.message); return null; }
    return typeof data === 'number' ? data : (data ?? null);
  } catch (e) {
    console.warn('[INV-5] audit insert threw (best-effort)', String(e));
    return null;
  }
}
// deno-lint-ignore no-explicit-any
async function stampAuthOutcomeEF(caller: any, auditId: number | null, outcome: 'succeeded' | 'failed'): Promise<void> {
  if (!auditId) return;
  try {
    const { error } = await caller.rpc('stamp_auth_action_outcome', { p_audit_id: auditId, p_outcome: outcome });
    if (error) console.warn('[INV-5] outcome stamp failed (best-effort)', error.message);
  } catch (e) {
    console.warn('[INV-5] outcome stamp threw (best-effort)', String(e));
  }
}

function auditLog(action: string, meta: Record<string, unknown>): void {
  try { console.log(`[admin-register-staff][audit] ${JSON.stringify({ action, ...meta })}`); } catch { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return fail('CONFIG', 'EF env not configured', 500);
  }

  // service_role admin — GoTrue admin(list/create/get/delete) 전용
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 0. 호출자 JWT 검증 + admin/manager/director 게이트 (INV-5) ─────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fail('UNAUTHORIZED', '세션 인증이 필요합니다', 401);

  const { data: actorData, error: actorErr } = await admin.auth.getUser(jwt);
  if (actorErr || !actorData?.user) return fail('UNAUTHORIZED', '유효하지 않은 세션', 401);
  const actorUserId = actorData.user.id;

  const { data: actorProfile } = await admin
    .from('user_profiles')
    .select('role, clinic_id')
    .eq('id', actorUserId)
    .maybeSingle();
  const actorRole = (actorProfile as { role?: string } | null)?.role ?? null;
  const actorClinic = (actorProfile as { clinic_id?: string } | null)?.clinic_id ?? null;
  if (!actorRole || !CALLER_ALLOWED_ROLES.has(actorRole)) {
    return fail('FORBIDDEN', '관리자(admin/manager/director)만 계정을 등록할 수 있습니다', 403);
  }
  if (!actorClinic) return fail('FORBIDDEN', '호출자 clinic 정보 없음', 403);

  // ── 입력 파싱/검증 ────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return fail('INVALID_PARAM', 'JSON 파싱 실패', 400);
  }
  const email = String(payload['email'] ?? '').trim().toLowerCase();
  const password = String(payload['password'] ?? '');
  const name = String(payload['name'] ?? '').trim();
  const role = String(payload['role'] ?? '').trim();
  const staffId = payload['staff_id'] ? String(payload['staff_id']) : null;

  if (!email) return fail('INVALID_PARAM', '이메일을 입력하세요', 400);
  if (!password || password.length < 8) return fail('INVALID_PARAM', '비밀번호는 8자 이상', 400);
  if (!name) return fail('INVALID_PARAM', '이름을 입력하세요', 400);
  if (!ALLOWED_ROLES.has(role)) return fail('INVALID_PARAM', `허용되지 않은 역할: ${role}`, 400);

  // 호출자 JWT 스코프 클라이언트(auth.uid 보존) — RPC/감사 전용
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  try {
    // ── 1. resolveUserByEmail (INV-1~3) ─────────────────────────────────────
    // deno-lint-ignore no-explicit-any
    let existing: any = null;
    try {
      const r = await resolveUserByEmail(admin, email);
      existing = r.user;
    } catch (e) {
      const code = e instanceof AuthResolveError ? e.code : 'RESOLVE_FAILED';
      auditLog('resolve_failed', { email, code, actorUserId });
      return fail(code, `이메일 조회 실패(${code})`, 500);
    }

    let targetUserId: string;
    let createdNew = false;

    if (existing) {
      // 매핑 여부 확인 → 매핑 有 = 이미 등록(409), 無 = 고아 self-heal(id 재사용)
      const { data: prof, error: profErr } = await admin
        .from('user_profiles')
        .select('id')
        .eq('id', existing.id)
        .maybeSingle();
      if (profErr) {
        auditLog('profile_lookup_failed', { email, actorUserId, msg: profErr.message });
        return fail('PROFILE_LOOKUP_FAILED', `프로필 조회 실패: ${profErr.message}`, 500);
      }
      if (prof) {
        return fail('ALREADY_REGISTERED', `이미 등록된 계정입니다: ${email}`, 200);
      }
      // 고아 → id 재사용(self-heal). createUser 건너뜀.
      targetUserId = existing.id;
      auditLog('orphan_reuse', { email, targetUserId, actorUserId });
    } else {
      // ── 2. createUser (email_confirm:true — 관리자 발급, 이메일 인증 루프 불요) ──
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (createErr || !created?.user) {
        auditLog('create_failed', { email, actorUserId, msg: createErr?.message });
        return fail('CREATE_FAILED', `계정 생성 실패: ${createErr?.message ?? 'unknown'}`, 200);
      }
      targetUserId = created.user.id;
      createdNew = true;
      auditLog('create_user', { email, targetUserId, actorUserId });
    }

    // ── 3. INV-5 감사(attempted) → admin_register_user RPC(호출자 JWT 스코프, auth.uid 보존) ──
    const auditId = await recordAuthActionEF(callerClient, targetUserId, email);
    const { data: rpcData, error: rpcErr } = await callerClient.rpc('admin_register_user', {
      target_user_id: targetUserId,
      email,
      name,
      role,
      approved: true,
      staff_id: staffId,
    });

    // 풋 RPC 는 실패를 RAISE(→rpcErr)로 신호. 방어적으로 jsonb.error 도 병행 검사(무해).
    const jsonbError =
      rpcData && typeof rpcData === 'object' && (rpcData as Record<string, unknown>)['error']
        ? (rpcData as Record<string, unknown>)
        : null;

    if (rpcErr || jsonbError) {
      await stampAuthOutcomeEF(callerClient, auditId, 'failed');
      const failCode = rpcErr ? 'RPC_ERROR' : String(jsonbError!['error']);
      const failMsg =
        rpcErr?.message ??
        (jsonbError!['message'] as string | undefined) ??
        '프로필/staff 매핑 실패';

      // ── 4(실패). 보상삭제: step2 에서 새로 만든 계정일 때만. INV-4 재검증 선행. ──
      if (createdNew) {
        try {
          await assertUserIdentity(admin, targetUserId, email);   // INV-4 (불일치 시 throw → 삭제 skip)
          const { error: delErr } = await admin.auth.admin.deleteUser(targetUserId);
          if (delErr) {
            auditLog('compensating_delete_failed', {
              email, targetUserId, actorUserId, reason: failCode, delMsg: delErr.message,
            });
          } else {
            auditLog('delete_user', {
              email, targetUserId, actorUserId, reason: failCode, outcome: 'rolled_back',
            });
          }
        } catch (e) {
          const code = e instanceof AuthResolveError ? e.code : 'REVERIFY_FAILED';
          auditLog('compensating_delete_aborted', { email, targetUserId, actorUserId, code });
        }
      } else {
        // 재사용 고아는 삭제 안 함(기존 자산). 매핑만 실패로 리턴.
        auditLog('orphan_remap_failed', { email, targetUserId, actorUserId, reason: failCode });
      }
      return fail(failCode, `등록 실패: ${failMsg}`, 200);
    }

    await stampAuthOutcomeEF(callerClient, auditId, 'succeeded');

    // ── 4(성공). email 자동확인 보증(idempotent) — 신규계정은 이미 확인됨, 고아 재사용만 실제 확인. ──
    //   confirm 실패는 롤백사유 아님(계정은 등록됨). ok:true + email_confirm_warning 로 fail-loud.
    let emailConfirmed = true;      // createUser(email_confirm:true) 신규계정 = 즉시 true
    let emailConfirmWarning: string | null = null;
    {
      const { data: confirmData, error: confirmErr } = await callerClient.rpc(
        'admin_approve_and_confirm_user', { target_user_id: targetUserId },
      );
      if (confirmErr) {
        emailConfirmed = false;
        emailConfirmWarning =
          `계정은 등록됐지만 이메일 자동확인에 실패했습니다(${confirmErr.message}). ` +
          `계정 관리 목록에서 해당 직원의 '승인' 버튼을 눌러 로그인 활성화를 완료하세요.`;
        auditLog('email_confirm_failed', { email, targetUserId, actorUserId, msg: confirmErr.message });
      } else {
        const cd = (confirmData ?? {}) as Record<string, unknown>;
        const confirmedNow = !!cd['email_confirmed_now'];
        const alreadyConfirmed = !!cd['already_confirmed'];
        emailConfirmed = confirmedNow || alreadyConfirmed;
        if (!emailConfirmed) {
          emailConfirmWarning =
            `${email} 등록됐지만 이메일 확인 상태가 확실치 않습니다. 로그인 안 되면 '승인' 버튼을 눌러 다시 시도하세요.`;
          auditLog('email_confirm_uncertain', { email, targetUserId, actorUserId });
        }
      }
    }

    const d = (rpcData ?? {}) as Record<string, unknown>;
    auditLog('register_ok', {
      email, targetUserId, actorUserId, reused_orphan: !createdNew, email_confirmed: emailConfirmed,
    });
    return ok({
      user_id: targetUserId,
      staff_id: d['staff_id'] ?? null,
      role,
      reused_orphan: !createdNew,
      email_confirmed: emailConfirmed,
      email_confirm_warning: emailConfirmWarning,
    });
  } catch (err) {
    console.error('[admin-register-staff] unexpected error:', err);
    return fail('INTERNAL', String(err).slice(0, 500), 500);
  }
});

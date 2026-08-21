// T-20260820-foot-STAFF-MANUAL-REGISTER-ATOMIC-EF-CONVERGE (P2, lane: dev-foot)
//   forward-prevention: 신규 직원 등록이 항상 계정(user_id) 연결까지 원자적으로 완결되도록,
//   모든 수동 등록 write-path 를 원자 EF(admin-register-staff) 하나로 수렴한다.
//
// ── 배경(RC) ────────────────────────────────────────────────────────────────
//   부모 T-20260820-foot-STAFF-LINKAGE-CORRUPTION-RECURRENCE-GUARD(FORENSIC) RC:
//   수동 '신규 직원 등록'(Staff.tsx CreateStaffDialog)이 supabase.from('staff').insert(...)로
//   user_id 없이 staff 행을 태생시켜(user_id born NULL) linkage 조건
//   (user_id=profile.id AND active=true AND deleted_at IS NULL) 미충족 → 발행요청 등 기능 disabled
//   (최현희 실장 사고의 상시 원인). user_id 세팅 유일 경로 = 원자 EF admin-register-staff.
//
// ── 이 모듈 = 수렴 SSOT ──────────────────────────────────────────────────────
//   Accounts.tsx(inviteStaff) + Staff.tsx(CreateStaffDialog) 두 등록 진입점이 동일한 helper 를
//   써서 EF 를 호출 → EF 미경유 우회 INSERT 경로 소멸. db_change=false(기존 EF/RPC 재사용).
//
//   ⚠ 임상직(consultant/coordinator/therapist/technician)만 admin_register_user RPC 가 staff 행을
//     생성/링크한다(user_id 세팅). director 등 비임상직은 user_profiles 계정만 생성(staff 행 없음).
//     → 어느 경우든 'user_id 없는 staff 행'은 태생적으로 생기지 않는다(AC: 태생 NULL 0건).

import { supabase } from '@/lib/supabase';
import { EDGE_FUNCTIONS } from '@/lib/externalServices';

/** 임시 비번 자동 생성 (영문대소+숫자+특수, 10자). Accounts/Staff 등록 폼 공용. */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digit = '23456789';
  const sym = '!@#$%';
  const all = upper + lower + digit + sym;
  let pw = '';
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += digit[Math.floor(Math.random() * digit.length)];
  pw += sym[Math.floor(Math.random() * sym.length)];
  for (let i = 0; i < 6; i++) pw += all[Math.floor(Math.random() * all.length)];
  // shuffle
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

// T-20260810-foot-STAFF-DUPEMAIL-ERRMSG-UX: 중복 이메일(=이미 등록된 계정) 실패 식별.
//   1순위 = EF 가 명시 반환하는 code 'ALREADY_REGISTERED'(resolveUserByEmail+프로필매핑 판별 재사용,
//   cross_crm_auth_identity_standard 준수 — FE 는 ?email= 필터를 독자 신뢰하지 않고 EF 판정을 그대로 사용).
//   2순위(폴백) = EF 사전판별이 놓친 뒤 GoTrue createUser / RPC 유니크위반이 사후 거부한 경우, 그
//   authoritative 에러 메시지 시그니처로 "이미 등록된 계정"임을 식별해 generic '생성 오류' 대신 명시 표기.
//   메시지 표기 분류일 뿐 — 파괴/식별 판단이나 신규 생성 로직에는 관여하지 않음.
export function isAlreadyRegistered(code: string | undefined, msg: string | undefined): boolean {
  if (code === 'ALREADY_REGISTERED') return true;
  const m = (msg ?? '').toLowerCase();
  if (!m) return false;
  return (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('already exists') ||
    m.includes('email address has already') ||
    m.includes('user already') ||
    m.includes('duplicate key') ||          // Postgres 23505 (user_profiles/email unique)
    m.includes('이미 등록')
  );
}

export type RegisterStaffResult = {
  ok: boolean;
  /** 실패 시 EF 봉투 error.code (또는 NO_SESSION/transport). ok:true 면 undefined. */
  code?: string;
  /** 실패 시 사용자 노출용 메시지. */
  message?: string;
  /** ok:true 시 EF data 봉투( user_id/staff_id/role/reused_orphan/email_confirmed/email_confirm_warning ). */
  data?: Record<string, unknown>;
};

/**
 * 원자 직원 등록 — admin-register-staff EF 1콜(계정 생성/프로필매핑/staff user_id 링크/email 확인을
 * all-or-nothing 으로 소유, 중간 실패 시 신규 auth.users 보상삭제·기존 고아 self-heal).
 *
 * FE 는 반환봉투 {ok,error} 하나만 검사한다(구 identities[] 빈배열 중복감지 / 고아 잔존 우회 로직 없음 —
 * 재발원 뿌리뽑기). transport error OR ok!==true 는 모두 실패로 취급(silent-success 차단).
 */
export async function registerStaffAtomic(params: {
  email: string;
  password: string;
  name: string;
  role: string;
  staffId?: string | null;
}): Promise<RegisterStaffResult> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session?.session?.access_token;
  if (!accessToken) {
    return { ok: false, code: 'NO_SESSION', message: '세션 인증이 만료됐어요. 다시 로그인 후 시도하세요.' };
  }

  type RegisterEnvelope = {
    ok?: boolean;
    error?: { code?: string; message?: string } | null;
    data?: Record<string, unknown>;
  };
  let envelope: RegisterEnvelope | null = null;
  let transportError: string | null = null;
  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.ADMIN_REGISTER_STAFF, {
      body: {
        email: params.email,
        password: params.password,
        name: params.name,
        role: params.role,
        staff_id: params.staffId || null,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) transportError = error.message ?? 'invoke 실패';
    envelope = (data ?? null) as RegisterEnvelope | null;
  } catch (e) {
    transportError = e instanceof Error ? e.message : String(e);
  }

  // silent-success 차단: transport error OR ok!==true 둘 다 실패.
  if (transportError || !envelope || envelope.ok !== true) {
    return {
      ok: false,
      code: envelope?.error?.code,
      message: envelope?.error?.message ?? transportError ?? '알 수 없는 오류',
    };
  }
  return { ok: true, data: envelope.data ?? {} };
}

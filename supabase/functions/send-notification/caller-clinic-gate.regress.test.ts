// send-notification/caller-clinic-gate.regress.test.ts — caller-clinic 격리 게이트 불변식 회귀 가드
//
// T-20260723-foot-SENDSMS-CALLER-CLINIC-GATE (부모 xcrm SENDSMS-CALLER-CLINIC-FORKINHERIT-SWEEP Phase-2)
//   [배경] derm H-1 anti-pattern PRESENT + clinics=2 LIVE. verifyRoleJwt 가 user_profiles.role 만
//     대조하고 caller 소속 clinic 을 대조하지 않아, 인증된 스태프가 임의 body.clinic_id 지정 시
//     그 clinic 의 Vault 자격/발신번호로 cross-tenant 실 발송 가능(test_sms L387 / manual_send L499).
//   [조치] provider·vault 접근 이전에 caller(auth.uid()) 소속 clinic ↔ body.clinic_id 대조 게이트.
//
//   ▸ index.ts 의 callerBelongsToClinic 순수 결정부를 충실히 미러링한다(top-level supabase client
//     때문에 index.ts 직접 import 불가). 소속 판정은 3소스 OR:
//       ① user_profiles.clinic_id == body.clinic_id (단일지점 배정)
//       ② user_profiles.clinic_id IS NULL + role∈(admin,manager,director) = 다지점 HQ 권한 → 전 지점 허용
//          (foot 정본 테넌트 격리 mc_clinic_isolated_v2 / is_admin_or_manager() 동형)
//       ③ staff.user_id == userId AND staff.clinic_id == body.clinic_id (staff 배정 fallback)
//     이 매트릭스가 깨지면(예: 단일지점 스태프의 타 clinic 발송이 통과, 또는 HQ 발송이 막힘)
//     테스트가 실패해 AC-1(cross-tenant 차단) / AC-2(정당발송 무회귀) 회귀를 표면화한다.
//
//   실행: deno test --node-modules-dir=none supabase/functions/send-notification/caller-clinic-gate.regress.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MULTI_CLINIC_HQ_ROLES = ["admin", "manager", "director"];

interface ProfileRow { clinic_id: string | null; role: string | null }
interface StaffRow { user_id: string; clinic_id: string }

// ── index.ts callerBelongsToClinic 결정부 미러 (DB fetch 제거, 순수 함수) ──
function callerBelongsToClinicDecision(
  userId: string,
  clinicId: string,
  profile: ProfileRow | null,
  staffRows: StaffRow[],
): boolean {
  if (profile) {
    if (profile.clinic_id && profile.clinic_id === clinicId) return true;
    if (!profile.clinic_id && MULTI_CLINIC_HQ_ROLES.includes(profile.role ?? "")) return true;
  }
  return staffRows.some((s) => s.user_id === userId && s.clinic_id === clinicId);
}

const CLINIC_A = "74967aea-a60b-4da3-a0e7-9c997a930bc8"; // jongno-foot (서울 오리진점)
const CLINIC_B = "b0000000-0000-0000-0000-0000000000b0"; // songdo-foot (송도)
const USER = "2b613328-5c4e-43d3-8b8c-649806bc1095";

// ── AC-1: cross-tenant 차단 ──────────────────────────────────────────────
Deno.test("AC-1: 단일지점(A) 배정 스태프가 타 clinic(B) 지정 → 차단", () => {
  const profile: ProfileRow = { clinic_id: CLINIC_A, role: "therapist" };
  assertEquals(
    callerBelongsToClinicDecision(USER, CLINIC_B, profile, []),
    false,
    "A 소속 스태프의 B 명의 발송은 반드시 차단(→ 호출부 403)",
  );
});

Deno.test("AC-1: staff 배정도 자기 clinic(A)뿐일 때 타 clinic(B) 지정 → 차단", () => {
  const profile: ProfileRow = { clinic_id: CLINIC_A, role: "coordinator" };
  const staff: StaffRow[] = [{ user_id: USER, clinic_id: CLINIC_A }];
  assertEquals(callerBelongsToClinicDecision(USER, CLINIC_B, profile, staff), false);
});

Deno.test("AC-1: clinic_id NULL 이지만 비-HQ role(therapist)이면 → 차단 (NULL 남용 방지)", () => {
  // foot 정본: clinic_id NULL 다지점 특권은 admin/manager/director 한정.
  // 그 외 role 의 NULL 은 데이터 결함(chartsave-regress 보정 대상)이므로 통과시키지 않는다.
  const profile: ProfileRow = { clinic_id: null, role: "therapist" };
  assertEquals(callerBelongsToClinicDecision(USER, CLINIC_A, profile, []), false);
});

// ── AC-2: 정당 발송 무회귀 ───────────────────────────────────────────────
Deno.test("AC-2: 자기 소속 clinic(A) 지정 → 통과 (회귀 0)", () => {
  const profile: ProfileRow = { clinic_id: CLINIC_A, role: "staff" };
  assert(callerBelongsToClinicDecision(USER, CLINIC_A, profile, []));
});

Deno.test("AC-2: 다지점 HQ(admin, clinic_id NULL) → 전 지점 허용", () => {
  const profile: ProfileRow = { clinic_id: null, role: "admin" };
  assert(callerBelongsToClinicDecision(USER, CLINIC_A, profile, []));
  assert(callerBelongsToClinicDecision(USER, CLINIC_B, profile, []));
});

Deno.test("AC-2: 다지점 HQ(manager/director, clinic_id NULL) → 전 지점 허용", () => {
  for (const role of ["manager", "director"]) {
    const profile: ProfileRow = { clinic_id: null, role };
    assert(callerBelongsToClinicDecision(USER, CLINIC_B, profile, []), `${role} HQ 발송 허용`);
  }
});

Deno.test("AC-2: user_profiles 미존재라도 staff 배정(user_id+clinic_id) 일치 → 통과", () => {
  const staff: StaffRow[] = [{ user_id: USER, clinic_id: CLINIC_A }];
  assert(callerBelongsToClinicDecision(USER, CLINIC_A, null, staff));
});

// ── 식별 기준: user_id(JWT sub), email 아님 ──────────────────────────────
Deno.test("식별: 다른 user 의 staff 배정은 매칭되지 않음 (user_id 기준, cross_crm_auth_identity_standard)", () => {
  const staff: StaffRow[] = [{ user_id: "other-user-id", clinic_id: CLINIC_A }];
  assertEquals(callerBelongsToClinicDecision(USER, CLINIC_A, null, staff), false);
});

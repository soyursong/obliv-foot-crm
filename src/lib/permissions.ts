// T-20260525-foot-MESSAGING-V1: 풋센터 권한 매트릭스
// 메시지 설정: T-20260611-foot-MSGSETTINGS-STAFF-ACCESS 로 전직원(8역할, tm 제외) 개방

import type { StaffRole } from './types';

// T-20260725-foot-PERMISSION-PARITY-PLAYBOOK STEP4 (INV-4 닫힌 role 타입):
//   개방부(| string)를 제거해 유니온을 '닫는다'. 이제 unknown role 문자열은 컴파일에서 잡힌다
//   (신규 role 은 이 유니온에 명시 추가해야 하며 = INV-4 강제 → PERM_MATRIX·RLS 패리티 STEP1 게이트 동반).
//   ★enum 실측(user_profiles.role + staff 로스터): 8역할 + tm(풋 자체/도파민 TM콜센터) + technician(staff
//     로스터 enum) + doctor(향후 봉직의 forward-ref, canViewPhraseManagement §AC-1 참조). 이 12개로 확정.
//   ★DB→FE 경계(user.role: string)에서 UserRole 로 좁힐 땐 명시 캐스트(as UserRole)로 유입점을 드러낸다.
//     unknown role 은 predicate 가 기본값 false 로 안전 처리(권한 미부여 = fail-closed).
export type UserRole =
  | 'admin'
  | 'manager'
  | 'director'      // 원장
  | 'consultant'
  | 'coordinator'
  | 'therapist'
  | 'part_lead'
  | 'staff'
  | 'tm'            // T-20260610-foot-STAFF-ROLE-TM-ADD: 풋 자체 TM(4메뉴 최소권한) / 도파민 TM콜센터
  | 'technician'    // T-20260630-foot-STAFFCRUD-CODY-PERM: staff 로스터 enum(director/…/technician)
  | 'doctor';       // T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE: 향후 봉직의/일반의사 forward-ref

export type PermKey =
  | 'dashboard'
  | 'reservations'
  | 'customers'
  | 'closing'
  | 'stats'
  | 'register'
  | 'messaging'      // T-20260525-foot-MESSAGING-V1: 통합 설정 > 메시지 → T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: 전직원(8역할) 개방, tm 제외
  | 'manual_sms_send'   // T-20260606-foot-CTXMENU-SMS-SEND: 대시보드 우클릭 [문자] 수동 1:1 발송 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원 확대
  | 'customer_export';  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 고객 리스트 내보내기(CSV). PII(전화·생년월일) 포함. → T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND ④: 직원 3역할 ADDITIVE 확대 + export audit sub-gate.

// T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원(8역할) 집합 SSOT.
// FE PERM_MATRIX.manual_sms_send 와 EF send-notification allowedRoles(manual_send) 가
// 동일 집합이어야 함(AC-5 role 패리티). EF는 Deno 환경이라 import 불가 → 동일 배열을 명시 복제.
export const ALL_STAFF_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff',
];

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-STAFF-PERM-UNLOCK-6MENU — 직원 3역할 6개 메뉴 권한 일괄 해제 role-set SSOT (1지점).
//   현장(김주연 총괄, U0ATDB587PV) STAFF-SIDEBAR-RESTRICTION-AUDIT 후속 확정:
//     상담실장(consultant)·코디네이터(coordinator)·치료사(therapist) 3역할에게
//     ① 패키지 ② 일마감 ③ 메시지 ④ 직원·공간 ⑤ 서비스항목 ⑥ 고객관리(정보/민감/RRN조회) 막힌 기능 해제.
//   원칙 = RX-PERMMENU-PARITY(commit aa687a8): "권한 풀린 메뉴는 역할분기 없이 동일 노출/동작."
//   ★lock-out-safe: escape(admin/manager/director) 항상 포함 = 확대만(축소 0). floor(part_lead/staff/tm)은
//     본 일괄해제 대상 아님(의도된 경계) — 단, 기존에 이미 가진 권한은 절대 회수하지 않음(아래 canEditCustomer 참조).
//   ★FE union = RLS union 의무: ①②⑤⑥ write 는 prod RLS 가 admin/mgr/dir + (일부) consult/coord 한정이라
//     therapist/3역할이 DB 에서 거부됨(특히 therapist). 동반 마이그(20260620120000_..._rls_additive)가
//     동일 3역할 ADDITIVE 정책을 추가해 effective RLS write set = 이 6역할과 1:1 정합(DA CONSULT + supervisor DDL-diff).
//   ★본 set 으로 풀지 않는 것(DEFERRED — 보안 경계, 별 DA 결정 필요):
//     ③ 연결설정(Solapi 자격증명, clinics write=is_admin_or_manager·column-scope 불가) → adminOnly 유지.
//     ④ 직원 계정관리(user_profiles insert/delete=admin only = 권한상승) + 공간정보 편집(clinics write) → 현행 유지.
//     (메뉴 노출·조회·QR 다운로드 read-only 는 본 해제에 포함.)
export const STAFF_UNLOCK_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist',
];

/** 6개 메뉴 일괄 해제 대상 역할인지(escape 포함 6역할). null/undefined 안전 기본값 false. */
export function isStaffUnlockRole(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return STAFF_UNLOCK_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260630-foot-STAFFCRUD-CODY-PERM — 근무자(staff 로스터) 추가/수정/삭제 권한 role-set (1지점).
//   현장(김주연 총괄, U0ATDB587PV, #project-doai-crm-풋확장 2026-06-30): 직원·공간 > 직원 탭의
//   근무자 '추가/삭제'를 coordinator 에게도 ADDITIVE 허용. (6MENU line172 [DEFERRED] §④의 실티켓.)
//   ★RC(dev-foot 2026-06-30): 본 surface = staff 로스터 테이블(StaffPage>StaffTab) — 로그인 계정(user_profiles)이
//     아님. staff.role enum = director/consultant/coordinator/therapist/technician (admin/manager 부재).
//     ∴ staff 로스터 생성 ≠ 계정 생성 = 권한상승 경로 아님. user_profiles(계정관리)는 본건 미포함(admin-only 불변).
//   ★기존 게이트 = isAdmin(admin/manager/director). coordinator 만 ADDITIVE 추가(consultant/therapist 미포함 = 요청 한정).
//   ★권한상승 가드(guard1): coordinator 는 'director'(원장) 로스터 행을 생성/수정/비활성 불가
//     (assignableStaffRolesFor + 동반 RLS WITH CHECK role<>'director' 이중). admin/manager/director 는 전 역할 가능(무회귀).
//   ★FE union = RLS union 의무: staff write-RLS = staff_admin_all(is_admin_or_manager = admin/manager/director)이라
//     coordinator 는 DB 에서 거부됨 → 동반 ADDITIVE 마이그(20260630220000_staff_coordinator_crud_rls_additive)로
//     effective write-set 정합(coordinator INSERT/UPDATE, role<>'director', clinic-scoped). DA CONSULT GO + supervisor
//     DDL-diff 후 FE↔DB ★동반 landing★ (FE 단독 merge = lock-out-in-disguise 금지).
export const STAFF_CRUD_ROLES: UserRole[] = ['admin', 'manager', 'director', 'coordinator'];

/** 근무자(staff 로스터) 추가/수정/삭제(비활성) 권한 보유 여부. null/undefined 안전 기본값 false. */
export function canManageStaff(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return STAFF_CRUD_ROLES.includes(role);
}

// T-20260808-foot-SPACEASSIGN-SLOT-CREATE-EDIT-DASHSYNC — 공간(슬롯/room) 생성·구성수정 write 게이트 SSOT.
//   AC5 확정: write=admin/manager/director(=rooms_admin_all is_admin_or_manager RLS 와 UI 이중방어).
//   Staff.tsx RoomTab '슬롯 구성 관리' 카드의 인라인 role=== 판정을 SSOT predicate 로 흡수(STEP6 ratchet).
export const ROOM_MANAGE_ROLES: UserRole[] = ['admin', 'manager', 'director'];

/** 공간(슬롯/room) 생성·구성수정 권한 보유 여부. null/undefined 안전 기본값 false. */
export function canManageRooms(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return ROOM_MANAGE_ROLES.includes(role);
}

/**
 * 근무자 추가/수정 시 actor 가 배정 가능한 staff.role 옵션(권한상승 가드).
 *   - admin/manager/director: 전 staff 역할(원장 포함) — 무회귀.
 *   - coordinator: 'director'(원장) 제외 — 코디가 원장 로스터를 만들/바꿀 수 없음(guard1).
 *   - 그 외: 빈 배열(쓰기 권한 없음 — UI 게이트로 도달 불가하나 방어적).
 */
export function assignableStaffRolesFor(
  actorRole: UserRole | null | undefined,
  allRoles: readonly StaffRole[],
): StaffRole[] {
  if (!actorRole || !canManageStaff(actorRole)) return [];
  if (actorRole === 'coordinator') return allRoles.filter((r) => r !== 'director');
  return [...allRoles];
}

// T-20260610-foot-STAFF-ROLE-TM-ADD AC6 (박민지 팀장 C안): TM → dashboard/reservations/customers/stats 만 허용.
//   ⚠️ ALL_STAFF_ROLES 에는 tm 을 넣지 않는다 — ALL_STAFF_ROLES 는 manual_sms_send 의 EF(send-notification)
//   allowedRoles 와 role 패리티를 이루는 SSOT 이고, tm 은 SMS 발송 권한(AC6 미포함, 임의 권한 부여 금지)이
//   없어야 한다. 따라서 tm 은 아래 4개 키에만 명시적으로 추가한다(설정/일마감/메시지/매출 등 미명시 메뉴 차단 = 최소권한).
const PERM_MATRIX: Record<PermKey, UserRole[]> = {
  dashboard:    [...ALL_STAFF_ROLES, 'tm'],
  reservations: ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'tm'],
  customers:    [...ALL_STAFF_ROLES, 'tm'],
  // T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN(policy_correction_jnz7 — 김주연 총괄 직접 정정): 일마감=직원 업무(daily closing workflow, /closing Closing.tsx → daily_closings/closing_manual). 전직원(8역할, tm 제외) OPEN.
  //   ★이전 값(coordinator/therapist 회수)은 '일마감'을 '매출집계'로 오분류 → 정정. 매출집계(실장별·치료사별 성과)는 별도 /sales(payments 직접쿼리, PERM 없음·route admin/manager EXCL) — 이 키와 무관.★
  //   ⚠️ AdminLayout nav + App.tsx route 와 3-gate 동일 집합 SSOT(한쪽만 바꾸면 NAV-BOUNCE). ★tm 제외★(STAFF-ROLE-TM-ADD 최소권한) → ALL_STAFF_ROLES 재사용으로 구조 보장.
  closing:      [...ALL_STAFF_ROLES],
  // T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY (Q2 안전 기본값 발효, CEO STAMP Lane A MSG-20260710-142249-rp15):
  //   통계 메뉴 = 파트장(part_lead)에게도 숨김(최소노출 안전 기본값). part_lead 제거 = 축소(lock-out 아님, 정책 확정).
  //   ★gap-fix RC: requireOpsAuthority 가드는 director 만 차단(ProtectedRoute L49) → part_lead 는 roles 포함 시 그대로 통과했음.
  //     ∴ roles 배열에서 part_lead 를 실제로 빼야 차단됨(가드로는 안 막힘). tm 은 별 AC6(STAFF-ROLE-TM-ADD 4메뉴) 유지·본건 무관.
  //   ⚠️ App.tsx stats route + AdminLayout stats nav 와 3-gate 동일 집합 SSOT(한쪽만 바꾸면 NAV-BOUNCE).
  stats:        ['admin', 'manager', 'director', 'tm'],
  // T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR B2①: +director(대표원장 접수/등록 운영 parity). admin 비제거(ADDITIVE).
  // T-20260630-foot-REGISTER-MENU-CODY-UNLOCK (COORD-PERM-UNLOCK ⑤): 접수/신규등록 동선 권한 3역할 ADDITIVE 확대.
  //   role_scope EXPANDED→CONFIRMED(2026-06-30 김주연 총괄 ts:1782820093): coordinator 단독 → +consultant +therapist.
  //   ★lock-out-safe: admin/manager/director 무회귀(확대만). ADDITIVE.
  //   ⚠️ RC(dev-foot 2026-06-30): 이 PermKey 는 현재 UI 미소비(canAccess('register') 호출부 0). /register 라우트는
  //     pre-login 셀프 회원가입(Login → /register)이라 in-app 사이드바 메뉴 아님. 실 신규등록 surface(Customers
  //     '신규 고객' 버튼·Reservations new-mode)는 이미 3역할 노출(PERM_MATRIX.customers/reservations 포함). SSOT 정합·future-proof 목적.
  //   ★FE union = RLS union 의무(NOTIF-TMPL drift 차단): customers/reservations/check_ins INSERT write-RLS 가
  //     therapist(전부)·consultant(reservations INSERT) 미포함 → 동반 RLS ADDITIVE 마이그(20260630210000_..., DA CONSULT-HOLD)
  //     로 effective write-set 정합 필요. da_gate=pending(DA GO + supervisor DDL-diff 후 dev-foot 직접 실행).
  register:     ['admin', 'manager', 'director', 'coordinator', 'consultant', 'therapist'],
  // T-20260525-foot-MESSAGING-V1 + ROLE-PERM-CUSTOM 3차(coordinator/therapist) → T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: part_lead/staff 추가 = 전직원(8역할).
  //   ★tm 제외★: 박민지 팀장 C안(AC6, STAFF-ROLE-TM-ADD) tm=4메뉴 최소권한 고정 → messaging 미포함. ALL_STAFF_ROLES(tm 미포함) 재사용으로 구조적 보장.
  //   ⚠️ App.tsx settings RoleGuard 와 동일 집합 SSOT — 한쪽만 바꾸지 말 것.
  messaging:    [...ALL_STAFF_ROLES],
  // T-20260606-foot-CTXMENU-SMS-SEND §6 admin/manager 한정 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 김주연 총괄 re-scope("전직원 권한 풀어줘") 전직원 확대(supersede).
  // tm 제외: AC6(STAFF-ROLE-TM-ADD) 미포함 + EF send-notification allowedRoles 패리티 유지.
  manual_sms_send: [...ALL_STAFF_ROLES],
  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 고객 리스트 내보내기(CSV).
  //   내보내기 컬럼에 전화·생년월일 등 PII 포함 → 최소권한 원칙으로 admin/manager 한정(노출·실행 동시 게이팅).
  //   ★rrn(주민번호)은 어떤 권한이든 export 컬럼에서 영구 제외(customerCsv.ts 헤더에 부재).★
  // T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR B2①(DA PII 민감도): +director. CSV는 FE에서 이미 로드된 데이터로 생성(별도 RLS 없음) → RLS/감사로그 영향 0. rrn 영구 제외 불변. admin 비제거.
  // T-20260630-foot-PERM-UNLOCK-EXPORT-AUTOSEND ④ (DA CONSULT-REPLY DA-20260701, GO 조건부):
  //   직원 3역할(coordinator·consultant·therapist) ADDITIVE 확대. role_scope CONFIRMED(2026-06-30 김주연 총괄 ts:1782820093).
  //   ★전화번호·생년월일 bulk = RRN-class PHI 아님(birth_date=일반PII) → 6MENU RRN 대표게이트 bar 전이 안 됨(DA 판정).
  //   ★PII-egress sub-gate: 권한확대 ≠ audit 면제 — export 실행 시 fn_log_customer_export(DEFINER RPC)로
  //     who/when/row수/구조필터 감사기록(customer_export_audit, 마이그 20260701030000). actor/role/clinic 서버파생(위조불가).
  //   ★rrn 영구 제외·admin/manager/director 무회귀(확대만). ADDITIVE.
  customer_export: ['admin', 'manager', 'director', 'coordinator', 'consultant', 'therapist'],
};

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-SUPERADMIN-EXEMPT — 상시예외 영속화(exempt_from_restrictions)
//   DA CONSULT-REPLY MSG-20260620-162917-aw39 (GO, ADDITIVE 컬럼 user_profiles.exempt_from_restrictions).
//   reporter(김주연 총괄, id ee67fc6b-…-70d12): role 변경·신규 제한 토글에도 생존하는 상시예외 요구.
//   ★진짜 durability = 중앙 게이트(canAccess)가 flag 를 honor 하는 것 — flag 존재만으론 부족(Q1).
//     ∴ 모든 '제한 토글'은 canAccess(=PERM_MATRIX SSOT, §12-5 ①) 경유 의무. 우회 토글은 flag 도 무력.
// ─────────────────────────────────────────────────────────────────────────────

/** 권한 판정용 subject(또는 role 문자열) 공용 타입 — canAccess 하위호환 오버로드. */
export type AccessSubject = UserRole | OpsAuthSubject | null | undefined;

/**
 * 상시예외(exempt_from_restrictions) 보유 여부.
 *   true = 메뉴/권한 '제한 토글'(§12 EXCL-3 회수 및 향후 신규 제한)의 적용 제외.
 *   ★grant 아님: 신규 메뉴 부여 없음 — 역할이 이미 가진 접근의 '제거 방지'만.
 *   ★불변(면제 아님): PHI audit·RRN 가드·승인 게이트·clinic 스코프·의사/진료 publish 는 우회 X
 *     (이들은 canAccess 비경유 별 게이트 — isDoctorRole/canPublish/canViewRrn 등 → AC-6 자동 안전).
 */
export function isExemptFromRestrictions(subject: OpsAuthSubject | null | undefined): boolean {
  return !!subject && subject.exempt_from_restrictions === true;
}

/**
 * 운영 메뉴(PermKey) 접근 판정 — '제한 토글' 평가의 단일 SSOT.
 *   하위호환: role 문자열 또는 subject(UserProfile/OpsAuthSubject) 모두 허용.
 *     · role 문자열을 넘기면 exempt 미고려(과거 호출부 호환) — exempt honor 하려면 subject 를 넘길 것.
 *   exempt 단락: exempt_from_restrictions=true → 제한 토글 우회(역할이 잃을 메뉴 보존).
 *     ★운영 메뉴 surface(PermKey) 한정 — 의사/진료 publish 는 canAccess 비경유라 영향 0(grant 경로 절대 미적용).
 */
export function canAccess(subjectOrRole: AccessSubject, key: PermKey): boolean {
  const s: OpsAuthSubject | null | undefined =
    typeof subjectOrRole === 'string' ? { role: subjectOrRole } : subjectOrRole;
  if (!s) return false;
  // 상시예외: 제한 토글 평가 단락(운영 메뉴 한정). grant 아님 — 의사/진료 publish 미경유.
  if (isExemptFromRestrictions(s)) return true;
  const role = s.role;
  if (!role) return false;
  return PERM_MATRIX[key].includes(role);
}

// T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B / DA CONSULT-REPLY MSG-20260618-185650-arwz):
//   주민번호(RRN) "값 조회" 권한. rrn_decrypt RPC 게이트1 미러.
// ★T-20260620-foot-STAFF-PERM-UNLOCK-6MENU ⑥ — A2(역할 한정 복원) 적용★
//   결정 이력:
//     · CORRECTION ndoc(MSG-20260620-113604) = "RRN NOTOUCH(admin/manager/director 유지)".
//     · ★CORRECTION o4u4(MSG-20260620-114645) = ndoc supersede★ — 대표(김승현) "다열어줘"
//       (MSG-20260620-114217-cac9, DM ts 1781923282.667609) → phi_sub_gate_status=approved.
//     · DA-20260618-foot-STAFF-CHART2-RRN-NOSAVE CONSULT-REPLY: A1(전직원) 불허 / A2(역할한정)=대표게이트+업무근거 조건부 허용.
//     · DA CONSULT-REPLY GO_WITH_CONDITIONS(MSG-20260620-131852-hbbh): phi_access_log canonical + audit INSERT 예외격리.
//   A2 = 기존(admin/manager/director) + consultant/coordinator/therapist (= STAFF_UNLOCK_ROLES). part_lead/staff/tm 미포함(A1 전직원복원 아님).
//   ★FE union = rrn_decrypt 게이트1 union 의무: 동반 PHI 마이그(20260620120100_rrn_decrypt_a2_role_restore)가
//     rrn_decrypt 게이트1을 동일 3역할로 확대 + phi_access_log 조회이력 append(AC-4 audit 무회귀 — 현 prod audit 전무라 net-new).
//   목적: 권한 직원이 복호화 값을 조회. 권한 없는 직원은 '조회 권한 없음' 표기(복호 null = '미입력' 오해 방지). 저장(rrn_encrypt)은 별도 권한.
export const RRN_VIEW_ROLES: UserRole[] = [...STAFF_UNLOCK_ROLES];

export function canViewRrn(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return RRN_VIEW_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260714-foot-TM-CUSTOMER-EDIT-ENABLE — 고객정보 수정(edit)/삭제(delete) 권한 role-set SSOT (1지점).
//   기존엔 Customers.tsx 인라인 상수(isStaffUnlockRole ∪ {staff,part_lead})였으나, 파일 컨벤션(ROLE-SET+predicate)
//   정합 + 단위테스트 가능성 위해 SSOT 추출. 인라인 로직과 1:1 동치 유지(무회귀).
//   ★TM ADDITIVE(2026-07-14): 풋 자체 TM(tm)에 '수정' 부여. AC-0 게이트 PASS(분기 a):
//     PROD role='tm' 3계정 전부 clinic=jongno-foot·@medibuilder.com·provider=email·source_system=null →
//     전원 풋 자체 TM 확정(도파민 TM콜센터 소속 0). silent 전체 grant 아님.
//   ★FE union = RLS union 의무 = 이미 충족(무DDL): customers UPDATE 'customers_staff_update'(is_floor_staff())의
//     is_floor_staff() 가 PROD 에서 이미 tm 포함(admin/manager/director/staff/part_lead/tm) → tm write 旣허용.
//     ∴ RLS ADDITIVE 불요·enum/스키마 무변경·DA CONSULT/DDL-diff 불요.
//   ★삭제(delete)는 tm 미포함: admin/director 만(=customers_admin_all is_admin_or_manager RLS 와 정합, tm DB 거부).
export const CUSTOMER_EDIT_ROLES: UserRole[] = [...STAFF_UNLOCK_ROLES, 'staff', 'part_lead', 'tm'];
export const CUSTOMER_DELETE_ROLES: UserRole[] = ['admin', 'director'];

/** 고객정보 '수정(edit)' 권한 보유 여부. null/undefined 안전 기본값 false. */
export function canEditCustomer(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return CUSTOMER_EDIT_ROLES.includes(role);
}

/** 고객 '삭제(delete)' 권한 보유 여부(admin/director 한정, tm 제외). null/undefined 안전 기본값 false. */
export function canDeleteCustomer(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return CUSTOMER_DELETE_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED — 직원영역 편집(상용구·수가세트) role-set SSOT (1지점).
//   현장(김주연 총괄, U0ATDB587PV) "직원들이 메인으로 쓰는 곳" → 전직원(8역할, tm 제외) inclusive.
//   AREA-SEPARATION 모델 표(직원영역 customer/pen_chart = '직원 편집 가능')를 실현.
//   ★기존 admin/manager 게이트(RX-PERMMENU-PARITY)가 director·일반 직원(consultant/coordinator/
//     therapist/part_lead/staff)을 collateral 배제 → 본 set 으로 확대(축소 아님, lock-out 0).
//   ★대상 surface 별 영속화 차이(RC, T-20260620-foot-PHRASE-STAFF-PERM-BLOCKED AC-0):
//      · 수가세트(fee_set_templates) RLS=auth_all(true/true) → 이 set 만으로 FE+DB 즉시 동작(Phase 1, 본 배포).
//      · 상용구(phrase_templates) RLS write=IN('admin','manager') → 이 set 으로 FE 만 풀면 staff write 가
//        RLS 에서 거부(lock-out-in-disguise) → Phase 2(phrase_templates RLS 확대, DA CONSULT) 동반 필요.
//        ∴ PhrasesTab(상용구 펜/고객차트) 게이트는 RLS 확대 landing 전까지 admin||manager 유지(별 티켓 FOLLOWUP).
//   tm 제외: STAFF-ROLE-TM-ADD 최소권한(4메뉴) — tm 은 서비스/상용구관리 surface 미접근. ALL_STAFF_ROLES 재사용.
export const STAFF_AREA_EDIT_ROLES: UserRole[] = [...ALL_STAFF_ROLES];

export function canEditStaffArea(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return STAFF_AREA_EDIT_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-STAFFPHRASE-EDIT-UNLOCK AC-2/AC-3 — 상용구(펜차트/고객차트) 직원 편집 role-set.
//   현장(김주연 총괄, U0ATDB587PV): "상용구(펜차트)·상용구(고객차트) 직원이 메인으로 쓰는데 편집 막힘" → 직원 개방.
//   ★수가세트(canEditStaffArea = ALL_STAFF_ROLES incl director)와 분리된 별 set인 이유:
//     phrase_templates 는 director(의사) 편집권을 본 티켓에서 변경 금지(현행=admin||manager 만 가능, director 불가).
//     PHRASE-AREA-SEPARATION-AUDIT AC-4(human_pending, '상용구관리탭 의사 제외 범위') 미결 → director 포함은
//     그 사람결정 선점이므로 금지. 따라서 director 제외(= ALL_STAFF_ROLES − director).
//   ★FE set = {admin, manager, consultant, coordinator, therapist, part_lead, staff} (7역할).
//     RLS 측은 2-policy ADDITIVE 로 동일 effective set 표현:
//       · 기존 admin_write_phrase_templates  = {admin, manager} (모든 phrase_type, 무변경)
//       · 신규 staff_write_staffarea_phrases = {consultant, coordinator, therapist, part_lead, staff}
//                                              (pen_chart/customer_chart 만, phrase_type 가드)
//     → FE union = RLS union (= 7역할). medical_chart write = {admin, manager} 불변(의사영역 보호).
//   ★role 실측(2026-06-20, user_profiles active): consultant4·coordinator7·therapist10·staff2 사용중,
//     part_lead0(enum 유효·future-proof). enum 밖 직원 role 0 → lock-out 없음. tm/technician 제외(현장 미해당).
//   tm 제외: STAFF-ROLE-TM-ADD 최소권한(4메뉴). technician: 실데이터 0·DA set 미포함 → 제외.
export const PHRASE_STAFFAREA_EDIT_ROLES: UserRole[] = ALL_STAFF_ROLES.filter(
  (r) => r !== 'director',
);

/** 상용구관리(펜차트/고객차트) 편집 가능 여부. medical_chart(의사영역)에는 쓰지 말 것(admin-only 유지). */
export function canEditStaffAreaPhrase(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return PHRASE_STAFFAREA_EDIT_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE — 균검사지(KOH) 발급 권한 대상(WHO) = 전직군(8역할)
//   reporter(문지은 대표원장, U0ALGAAAJAV, 풋센터 C0ATE5P6JTH) 직접 지시: "발급하기 권한 다 풀어줘 모든 직군 가능"
//   (ts=1781932348.900389 "아니, 발급하기 권한 싹 풀어줘" — 직전 봇 라벨분기 제안 명시 거부).
//   ★supersedes GRANT-3ROLE(4역할) — /admin/doctor-tools 라우트 가드 roles 목록과 동일하게 전8역할로 확장.
//     additive 추가 4역할 = admin / manager / technician / part_lead (기존 director/consultant/coordinator/therapist 위).
//   ★라벨분기 제거 — KohReportTab 의 역할별 라벨(의사='발급하기'/직원='발급요청')은 superseded.
//     이제 director 포함 전8역할 모두 단일 '발급하기'(일괄 '일괄발급하기'). '발급요청' 라벨 폐기.
//   ★발급 실행(publish_koh_result RPC) 서버측 게이트 = is_approved_user() — director 강제 없음(전 승인직원 실행 가능).
//     본 FE 게이트(노출/활성)만 전8역할로 확장하면 RPC 와 정합(NO-DDL, RC 확인 완료).
export const KOH_ISSUE_ROLES: UserRole[] = ['admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'technician', 'part_lead'];

export function canIssueKoh(role: UserRole): boolean {
  return KOH_ISSUE_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260619-foot-ROLE-MATRIX-3TIER-RBAC — 운영최고권한(has_ops_authority) 2축 분리
//   DA branch B(n17u pre-GO): 임상 role(director=대표원장·봉직의) ⟂ 운영권한(계정·통계·매출 + 진료관리 수정).
//   single-role + boolean flag 로 표현(enum 무변경, full RBAC 테이블 REJECT).
// ─────────────────────────────────────────────────────────────────────────────

/** 권한 판정용 최소 프로필 구조 (UserProfile 또는 그 부분집합). */
export interface OpsAuthSubject {
  role?: UserRole | null;
  has_ops_authority?: boolean | null;
  // T-20260620-foot-SUPERADMIN-EXEMPT: 상시예외 flag(제한 토글 적용 제외). has_ops_authority(positive)와 직교 축(negative-protection).
  exempt_from_restrictions?: boolean | null;
}

/**
 * 운영최고권한 보유 여부 (계정관리·통계·매출 + 진료관리 수정 게이트의 단일 판정).
 *   - has_ops_authority === true            → 보유 (대표원장·총괄 등 명시 flag)
 *   - role === 'admin'                       → 보유 (시스템 슈퍼유저 escape — ★lock-out 가드 AC-4★)
 *   - role === 'manager'                     → 보유 (지점장·총괄실장 = 운영 role-implied)
 *   - role === 'director' (flag 無)          → ✗ (봉직의 = 진료만, 운영최고권한 無) — flag 의 핵심 disambiguation
 *   - 그 외                                   → ✗
 *
 * ★lock-out-safe: DB 컬럼/역배정 적용 전(현재 전원 admin)엔 admin escape 로 전원 통과 = inert.
 *   역배정(admin→non-admin) apply 시점에 게이트가 비로소 실효된다.
 */
export function hasOpsAuthority(subject: OpsAuthSubject | null | undefined): boolean {
  if (!subject) return false;
  if (subject.has_ops_authority === true) return true;
  return subject.role === 'admin' || subject.role === 'manager';
}

/**
 * 진료관리(ClinicManagement) 수정(write) 권한.
 *   확정 모델: VIEW=전직원(STAFF-OPEN 유지) / EDIT=대표원장(has_ops_authority=true) 단독.
 *   predicate = admin || has_ops_authority — ★admin escape 로 lock-out 가드(AC-4) 충족★.
 *     · 현재(전원 admin) → 전원 edit 유지 = 무회귀·무 lock-out.
 *     · 역배정 후 → flag 보유자(대표원장) + system admin 만 edit. 봉직의(director,flag無)·일반직원 → read-only.
 *   ★supersedes T-20260619-foot-CLINICMGMT-WRITE-RESTRICT-MEDVIEW 의 ['director','admin'] 집합.
 *     director(봉직의)를 자동 포함하던 모델 → has_ops_authority 로 대표원장만 분리(s3hn 확정).
 *     prod director=0 이라 이 전환은 무회귀(현 영향 0).
 *   ※ 진료관리 EDIT 모델이 admin/has_ops_authority 단독이므로 manager(role-implied ops)는 진료관리 수정 대상 아님 →
 *     hasOpsAuthority 를 직접 쓰지 않고 전용 술어로 분리(manager 진료관리 수정 부여 방지).
 */
export const CLINIC_MGMT_WRITE_ROLES: UserRole[] = ['director', 'admin']; // legacy 참조 호환(직접 사용 비권장)

export function canEditClinicMgmt(subject: OpsAuthSubject | UserRole | null | undefined): boolean {
  // 하위호환: 과거 호출부가 role 문자열을 넘길 수 있음(점진 전환). 문자열이면 role 로 래핑.
  const s: OpsAuthSubject | null | undefined =
    typeof subject === 'string' ? { role: subject } : subject;
  if (!s) return false;
  if (s.has_ops_authority === true) return true;
  if (s.role === 'admin') return true;
  // ── T-20260620-foot-MUNJIEUN-CLINICMGMT-LOCKOUT (P0 STOPGAP, 옵션 B / DB-0 / reversible) ──
  // 배포순서 race 로 대표원장(문지은, admin→director swap) 진료관리 EDIT 전면 lock-out.
  //   원인: has_ops_authority 컬럼 미적재(20260619220000_..._additive.sql.DDL_DIFF_HOLD) +
  //         swap 으로 admin escape 상실 → false||false = EDIT 차단.
  //   stopgap: director escape 임시 추가. prod director = 문지은 1명뿐(봉직의 미고용, nafn Q1)이라
  //            functionally = has_ops_authority flag 적재와 동일·무부작용·reversible.
  //   ★마이그(20260619220000_..._additive.sql) landing + 문지은 has_ops_authority=true set 후
  //     이 director escape 1줄을 제거해 converged model(EDIT=has_ops_authority 단독)로 복귀할 것.★
  if (s.role === 'director') return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260620-foot-PHRASE-MGMT-DOCTOR-HIDE — 서비스관리>상용구 관리 노출 게이트
//   확정 스펙(김주연 총괄, slack ts 1781924207.232909, 옵션2/A안):
//     "봉직의/일반의사만 비노출, 대표원장(문지은 원장님)은 그대로 이용 가능."
//   ★봉직의/일반의사 = 의사 role(director) 중 '운영최고권한이 없는' 계정.
//     대표원장 = 의사 role + 운영최고권한(has_ops_authority) → 노출 유지.
//   ★UserRole enum 에 '봉직의'/'doctor' 별도 값 없음 — 의사 role = 'director' 단일.
//     봉직의 vs 대표원장 구분축 = has_ops_authority flag (T-20260619-foot-ROLE-MATRIX-3TIER-RBAC).
//   ★single-user 하드코딩(uid==문지은) 금지 — role/flag 기반이라 향후 봉직의 채용 시 자동 적용(AC-4).
// ─────────────────────────────────────────────────────────────────────────────

/** 의사(임상) role 집합 — 상용구 관리 노출 게이트 평가 대상. 그 외 직군은 평가 없이 노출(AC-5). */
export const PHRASE_GATE_DOCTOR_ROLES: UserRole[] = ['director', 'doctor'];

/**
 * 서비스관리>상용구 관리(서브탭 + ?tab=phrases 딥링크) 노출 가능 여부.
 *   - 비의사 직군(admin/manager/consultant/coordinator/therapist/part_lead/staff/technician/tm) → 노출(AC-5, 무회귀).
 *   - 운영최고권한(대표원장, has_ops_authority=true 또는 admin/manager role-implied) → 노출(AC-2).
 *   - 봉직의/일반의사(의사 role 중 운영최고권한 없는 계정) → 비노출(AC-1).
 *   - 향후 봉직의 채용 시 role/flag 기반으로 자동 비노출(AC-4) — single-user 하드코딩 아님.
 *
 * ★lock-out 가드(AC 가드레일, 오전 c619eee8 incident 재현 금지):
 *   has_ops_authority 컬럼 미적재(DDL_DIFF_HOLD) 동안 대표원장(문지은, role='director')도
 *   hasOpsAuthority=false 로 평가됨. canEditClinicMgmt 와 동일 사유로 director escape stopgap 적용 →
 *   prod director=문지은 1명뿐(봉직의 미고용)이라 director escape = 무회귀·무부작용. 봉직의가 없으니
 *   '당장 비노출되는 의사'는 0(= 티켓 field_summary "지금 막히는 분 없음"과 정합).
 */
export function canViewPhraseManagement(
  subject: OpsAuthSubject | UserRole | null | undefined,
): boolean {
  const s: OpsAuthSubject | null | undefined =
    typeof subject === 'string' ? { role: subject } : subject;
  if (!s) return false;
  const role = s.role;
  if (!role) return false;
  // AC-5: 비의사 직군 전원 노출(무회귀). 의사 role(director)만 게이트 평가.
  if (!PHRASE_GATE_DOCTOR_ROLES.includes(role)) return true;
  // AC-2: 운영최고권한(대표원장) → 노출 유지.
  if (hasOpsAuthority(s)) return true;
  // ── STOPGAP (canEditClinicMgmt 동일 사유, T-20260620-foot-MUNJIEUN-CLINICMGMT-LOCKOUT) ──
  //   has_ops_authority 컬럼 미적재 → 대표원장(문지은, role='director')도 hasOpsAuthority=false.
  //   prod director=문지은 1명뿐(봉직의 미고용) → director escape 로 대표원장 lock-out 방지(가드레일).
  //   ★마이그(20260619220000_..._has_ops_authority_additive.sql) landing + 문지은 has_ops_authority=true
  //     set 후 이 1줄 제거 → 봉직의(director,flag無) 자동 비노출(AC-4) 실효. (canEditClinicMgmt 와 동시 수렴)★
  if (role === 'director') return true;
  // AC-1: 그 외 의사 role(향후 'doctor' 등) 중 운영최고권한 없는 계정 → 비노출.
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP — 진료대시보드>서류작성 탭의
//   '경과분석지(원장 최종발행 서류) 발행 대상' 리스트업 read/write 게이트 분리(A안, 김주연 총괄 확정 2026-08-14).
//
//   ★A안 근거(dev-foot RCA MSG-20260814-204034-wzox): 기존 canSeeProgressDocs 가
//     hasOpsAuthority(admin/manager) + director 만 통과 → coordinator(코디) 미통과로 섹션 전체 '증발'.
//     현장 재신고 = 코디/총괄이 '명단(read)'은 봐야 하고 '발행(write)'은 원장이 함(read/write 분리).
//   ★read/write 2게이트로 split:
//     · canSeeProgressDocs(READ)  = 치료테이블 §③ 경과분석 탭과 '동일 read 범위'로 완화
//         → PROGRESS_DOCS_VIEW_ROLES(=treatment-table RoleGuard 집합) 멤버십.
//         net-new PHI 노출 0 — 동일 코호트를 코디/상담/치료사는 이미 치료테이블에서 봄(date-독립·동일 필터).
//     · canIssueProgressDocs(WRITE) = 발행 액션(개별 발행하기·일괄처리)은 원장(+admin/manager)만.
//   ★db_change=false — FE 노출/활성 게이트만. backing-table SELECT RLS = role-agnostic(clinic-scoped)라
//     read 완화에 RLS 변경 불요(치료테이블에서 이미 동일 쿼리 통과).
// ─────────────────────────────────────────────────────────────────────────────
// READ 범위 = 치료테이블 경과분석 탭 접근 집합(App.tsx /admin/treatment-table RoleGuard 와 동일 SSOT).
export const PROGRESS_DOCS_VIEW_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist',
];
// WRITE(발행) = 원장 + 운영최고권한(admin/manager). 코디/상담/치료사 제외.
export const PROGRESS_DOCS_ISSUE_ROLES: UserRole[] = ['admin', 'manager', 'director'];

/** 경과분석지 발행 대상 '명단 조회(read)' 노출 여부 — 치료테이블 경과분석 탭과 동일 범위. null-safe(false). */
export function canSeeProgressDocs(
  subject: OpsAuthSubject | UserRole | null | undefined,
): boolean {
  const s: OpsAuthSubject | null | undefined =
    typeof subject === 'string' ? { role: subject } : subject;
  const role = s?.role;
  if (!role) return false;
  return PROGRESS_DOCS_VIEW_ROLES.includes(role);
}

/** 경과분석지 '발행(write)' 액션(개별/일괄) 노출·동작 여부 — 원장 + admin/manager 만. null-safe(false). */
export function canIssueProgressDocs(
  subject: OpsAuthSubject | UserRole | null | undefined,
): boolean {
  const s: OpsAuthSubject | null | undefined =
    typeof subject === 'string' ? { role: subject } : subject;
  const role = s?.role;
  if (!role) return false;
  return PROGRESS_DOCS_ISSUE_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK — 일마감 확정(closed) 후 '해제 없이 수정' 권한.
//   현장 확정(김다인, MSG-8f6s): 수정 권한 = payment(수납) 권한 보유자 + admin/manager 역할. 전 직원 X.
//   ★payment(수납) 권한 = 일마감/수납 접근(closing) — admin/manager/director 전원 보유(PERM_MATRIX.closing).
//   ★admin/manager 역할 게이트 + director(대표원장) escape: has_ops_authority 컬럼 미적재(DDL_DIFF_HOLD)라
//     canEditClinicMgmt/canViewPhraseManagement 와 동일 role 기반 stopgap 적용(prod director=대표원장 1명).
//   ★BE(closing_confirmed_edit RPC) 게이트 = user_profiles.role IN (admin,manager,director) 와 1:1 정합(FE=BE).
export const CONFIRMED_CLOSING_EDIT_ROLES: UserRole[] = ['admin', 'manager', 'director'];

/**
 * 일마감 확정 후 '해제 없이 수정' 가능 여부(payment 권한 + admin/manager/director).
 *   subject(프로필) 또는 role 문자열 허용. null/unknown 안전 기본값 false(fail-closed).
 *   ★서버(RPC)에서 재검증되므로 FE 게이트는 노출/활성 제어용(이중 방어).
 */
export function canEditConfirmedClosing(
  subject: OpsAuthSubject | UserRole | null | undefined,
): boolean {
  const s: OpsAuthSubject | null | undefined =
    typeof subject === 'string' ? { role: subject } : subject;
  if (!s) return false;
  if (s.has_ops_authority === true) return true;
  const role = s.role;
  if (!role) return false;
  return CONFIRMED_CLOSING_EDIT_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260726-foot-TREATTABLE-TESTITEM-ACTIONS-3BTN — 검사 접수 항목 행 액션(보류/신청취소/재검사) 권한.
//   확정 스펙(2026-07-26 김주연 총괄, Q2): '권한 A 사용자만' 버튼 노출·동작. 권한 A = 최상위/관리자 tier.
//   foot CRM 에 'A' role 매핑 부재 → 관리 tier(admin/manager/director=원장)로 매핑(field-soak 확인, 재-block 아님).
//   Staff.tsx isAdmin(admin/manager/director) 동일 tier. 하위 권한 계정엔 미노출(fail-closed).
export const EXAM_ITEM_ACTION_ROLES: UserRole[] = ['admin', 'manager', 'director'];

/** 검사 접수 항목 행 액션(보류/신청취소/재검사) 권한 보유 여부. null/undefined 안전 기본값 false. */
export function canActOnExamItem(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return EXAM_ITEM_ACTION_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260726-foot-LABTAB-EXAM-REQ-MANUAL-ADD-BY-SEARCH — '검사 신청 수기 추가' 진입점 노출 role (SSOT).
//   현장(김주연 총괄, U0ATDB587PV): 검사 신청이 '자꾸 풀리는' 버그 보완루트 = 성함/차트번호 검색 수기 등록.
//   '스태프(관리자) 이상' = 관리 스태프(admin/manager/director/coordinator) + staff. 치료사·컨설턴트 등
//     비관리 role 은 미노출(2번차트 토글 경로는 그대로 사용 가능). 필드 요청 시 responder 경유 조정.
//   ★값은 ExamTargetsSection(균검사 탭, T-20260726-foot-EXAM-MANUAL-ADD-SEARCH)의 인라인 MANUAL_EXAM_ADD_ROLES 와
//     1:1 동일 — 균검사/피검사 두 탭의 수기추가 role 게이트 정합(gate #4). 均検사 탭은 이미 LIVE(commit 2a33968b)라
//     인라인 상수를 그대로 두고, 신규 피검사 탭(BloodDailyListSection)은 본 SSOT 헬퍼를 사용(라이브 코드 무접점).
//     향후 정리(consolidate) 시 ExamTargetsSection 도 본 헬퍼로 수렴 예정.
export const MANUAL_EXAM_ADD_ROLES: UserRole[] = ['admin', 'manager', 'director', 'coordinator', 'staff'];

/** 검사 신청 수기 추가(성함/차트번호 검색 등록) 진입점 노출 권한. null/undefined 안전 기본값 false. */
export function canManualAddExam(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return MANUAL_EXAM_ADD_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260728-foot-CHART2-DOCREQ-HISTORY-COORDPERM — 서류(소견서/진단서) '신청(요청)'·'취소' 권한 SSOT (1지점).
//   범위 확정(김주연 총괄 U0ATDB587PV, 2026-07-28): coordinator = **신청(요청)만**. 출력(발급)·취소·발행·서명은 미부여
//     (원장/상위권한 유지, MUNJIEUN-ROLE-DIRECTOR / PUBLISH-BTN-REVERIFY-GATE 방향 정합).
//   DA CONSULT-REPLY(MSG-20260728-162717-9fka / 정정 MSG-20260728-163619-8dqz): **ADDITIVE, FE-only, 무DDL**.
//     · form_submissions_insert RLS = active clinic member 전원 허용(role-agnostic, 20260522000010) → 신규 CREATE POLICY 불요.
//     · coordinator는 cross_crm §2-3 enum 정본 + effective write-set {admin,manager,director,coordinator}에 旣편입
//       = '과소provisioning 해소'(director-lock 아님). staff_permissions 테이블·is_admin류 boolean·permission flag = 전부 REJECT.
//   ★REDEFINITION_RISK 정합: ROLE-MATRIX-3TIER-RBAC(in_progress) single-role 모델 위 ADDITIVE 셀 — 신규 병렬 권한체계 아님.
//   ★신청(request) 노출은 role 축소 금지(FE union = RLS union = 전 active member). unknown role 만 fail-closed(INV-4).
//     → OPINION_REQUEST_ROLES = 전 UserRole. coordinator 명시 포함, tm/technician/doctor 도 RLS 패리티로 포함(lock-out 0).
export const OPINION_REQUEST_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff', 'tm', 'technician', 'doctor',
];

/** 서류(소견서/진단서) 발행 '요청(신청)' 권한 — 전 직군(RLS 패리티, coordinator 포함). null/unknown 안전 기본값 false. */
export function canRequestOpinionDoc(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return OPINION_REQUEST_ROLES.includes(role);
}

// ★'취소(요청 철회)'는 coordinator 미부여(신청만) — AC②-2/시나리오3. = 신청 role-set − coordinator.
//   FE 표시 게이트(취소 X 버튼 노출 제어). 다른 역할(실장 consultant 등)의 기존 취소 동선은 무회귀(coordinator 만 제외).
export const OPINION_CANCEL_ROLES: UserRole[] = OPINION_REQUEST_ROLES.filter((r) => r !== 'coordinator');

/** 서류 요청 '취소(철회)' 버튼 노출 권한. coordinator 제외(신청만). null/unknown 안전 기본값 false. */
export function canCancelOpinionRequest(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return OPINION_CANCEL_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260811-foot-SALESAGG-THERAPIST-TAB — 일마감 신규 '총매출(치료)' 탭 노출 role (SSOT).
//   김주연 총괄 확정(reply ts=1786502240.795299): 신규 '총매출(치료)' 탭 = 관리자(admin)+치료사(therapist)만 노출.
//   /sales route(RoleGuard[admin,manager,director]) 는 무변경 — therapist 를 매출집계 전체에 admit 하지 않고
//     일마감(/admin/closing) 내부 이 신규 탭만 role 게이트로 좁힌다. manager/director 는 기존 /sales 경로로 열람.
//   ★인라인 role=== ratchet(STEP6) 정합 — 신규 인라인 판정 대신 SSOT predicate 로 착지.
export const THERAPIST_SALES_VIEW_ROLES: UserRole[] = ['admin', 'therapist'];

/** 일마감 '총매출(치료)' 탭 노출 권한(admin+therapist 한정). null/unknown 안전 기본값 false. */
export function canViewTherapistSales(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return THERAPIST_SALES_VIEW_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST — 고객상세 2번째 탭(펜차트/자동기록)
//   '패키지 시술 차감내역(회차)' soft-delete·복원 권한 role-set SSOT (1지점).
//   현장(김주연 총괄, U0ATDB587PV, 슬랙 C0ATE5P6JTH ts 1786700281.528599): 코디(coordinator)·
//     치료사(therapist)도 이 차감내역 삭제를 하도록 권한 확대 요청.
//   ★기존 게이트 = admin/manager/director (CustomerChartPage 인라인 하드코딩 + RPC 내부
//     is_admin_or_manager()). 여기에 coordinator/therapist 2역할만 ADDITIVE 추가(확대만·축소 0·회귀 0).
//   ★AC2 스코프 하드가드: 이 predicate 는 '패키지 시술 차감내역(package_sessions) soft-delete/복원'
//     surface 전용. 다른 삭제(고객/패키지 자체/서류 등) 게이트에는 절대 재사용하지 말 것(권한 누수 0).
//   ★consultant 미포함: 티켓은 coordinator·therapist 만 명시(정확 스코프). '수정' 버튼(isStaffUnlockRole,
//     consultant 포함)과 다른 별 set 인 이유 — 삭제는 요청 2역할만 확대.
//   ★FE union = RLS(RPC) union 의무: soft_delete_package_session / restore_package_session RPC 내부
//     게이트를 동일 5역할(admin/manager/director/coordinator/therapist)로 확대하는 동반 마이그
//     (20260814..._pkg_session_delete_coord_therapist) 와 1:1 정합. FE 단독 확대(RPC 미확대)는
//     lock-out-in-disguise(버튼은 보이나 RPC permission denied) → ★동반 landing★ 의무(supervisor DB-GATE).
//   ★복원(restore) 포함 근거: soft-delete 의 안전 역연산(AC3 "실수 삭제 원복 가능" 원장 doctrine,
//     SOFTDELETE-REACTIVATION-LOCK 표준). 삭제만 확대하고 복원을 admin-only 로 두면 코디/치료사가
//     자기 실수 삭제를 되돌릴 수 없어 안전망이 깨짐 → 같은 target 의 삭제/복원 쌍을 함께 확대(scope creep 아님).
export const PKG_SESSION_DELETE_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'coordinator', 'therapist',
];

/** 패키지 시술 차감내역(회차) soft-delete·복원 권한 보유 여부. null/undefined 안전 기본값 false(fail-closed). */
export function canDeletePackageSession(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return PKG_SESSION_DELETE_ROLES.includes(role);
}

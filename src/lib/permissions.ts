// T-20260525-foot-MESSAGING-V1: 풋센터 권한 매트릭스
// 메시지 설정: T-20260611-foot-MSGSETTINGS-STAFF-ACCESS 로 전직원(8역할, tm 제외) 개방

export type UserRole =
  | 'admin'
  | 'manager'
  | 'director'      // 원장
  | 'consultant'
  | 'coordinator'
  | 'therapist'
  | 'part_lead'
  | 'staff'
  | string;

export type PermKey =
  | 'dashboard'
  | 'reservations'
  | 'customers'
  | 'closing'
  | 'stats'
  | 'register'
  | 'messaging'      // T-20260525-foot-MESSAGING-V1: 통합 설정 > 메시지 → T-20260611-foot-MSGSETTINGS-STAFF-ACCESS: 전직원(8역할) 개방, tm 제외
  | 'manual_sms_send'   // T-20260606-foot-CTXMENU-SMS-SEND: 대시보드 우클릭 [문자] 수동 1:1 발송 → T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원 확대
  | 'customer_export';  // T-20260613-foot-CUSTLIST-MULTISELECT-EXPORT: 고객 리스트 내보내기(CSV). PII(전화·생년월일) 포함 → admin/manager 한정.

// T-20260608-foot-SMS-CTXMENU-ALLROLE: 전직원(8역할) 집합 SSOT.
// FE PERM_MATRIX.manual_sms_send 와 EF send-notification allowedRoles(manual_send) 가
// 동일 집합이어야 함(AC-5 role 패리티). EF는 Deno 환경이라 import 불가 → 동일 배열을 명시 복제.
export const ALL_STAFF_ROLES: UserRole[] = [
  'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff',
];

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
  stats:        ['admin', 'manager', 'director', 'part_lead', 'tm'],
  // T-20260619-foot-MUNJIEUN-ROLE-DIRECTOR B2①: +director(대표원장 접수/등록 운영 parity). admin 비제거(ADDITIVE).
  register:     ['admin', 'manager', 'director'],
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
  customer_export: ['admin', 'manager', 'director'],
};

export function canAccess(role: UserRole, key: PermKey): boolean {
  return PERM_MATRIX[key].includes(role);
}

// T-20260618-foot-STAFF-CHART2-RRN-NOSAVE (Option B / DA CONSULT-REPLY MSG-20260618-185650-arwz):
//   주민번호(RRN) "값 조회" 권한 = prod rrn_decrypt 게이트1(is_admin_or_manager) 미러 = admin/manager/director.
//   ★FE-only 안내문 게이트★ — rrn_decrypt RPC 권한(DB)은 변경하지 않음(PHI 무변경).
//   A1(전직원 복원)·A2(역할 한정 복원)는 대표 PHI 게이트 통과 전까지 HOLD(migration .PHI_GATE_HOLD).
//   목적: 권한 없는 직원이 복호화 null(빈 값)을 보고 "저장 안 됨"으로 오해하는 것 방지
//        — '미입력' 대신 '조회 권한 없음' 표기. 저장(rrn_encrypt)은 별도 권한이라 영향 없음.
export const RRN_VIEW_ROLES: UserRole[] = ['admin', 'manager', 'director'];

export function canViewRrn(role: UserRole): boolean {
  return RRN_VIEW_ROLES.includes(role);
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

// Supabase table row types for 풋센터 CRM

import type { InsuranceGrade, InsuranceGradeSource, HiraCategory } from './insurance';

export type VisitType = 'new' | 'returning' | 'experience';

/** 고객 상태 플래그 (카드 배경색 변경) — T-20260502-foot-STATUS-COLOR-FLAG */
export type StatusFlag =
  | 'white'     // 정상 (기본)
  | 'red'       // 취소/부도
  | 'orange'    // CP(데스크) — 컴플레인/성향이슈
  | 'yellow'    // HL — 금일 힐러 치료
  | 'green'     // 선체험 — 상담대기 중 체험 전환
  | 'blue'      // CP(치료실) — 치료 중 이슈
  | 'purple'    // 진료필요 — 원장님 진료콜
  | 'pink'      // 진료완료 — 원장님 진료+약처방 완료
  | 'brown'     // 후상담 — 진료완료 후 상담 (T-20260603-foot-STATUSFLAG-BROWN)
  | 'dark_gray';// 수납완료 — 수납 후 귀가

export type CheckInStatus =
  | 'registered'
  | 'receiving'         // 접수중 — 셀프접수 후 발건강질문지 작성 중(미저장). 저장 시 consult_waiting (T-20260602-foot-CHECKIN-RECEIVING-SLOT)
  | 'consult_waiting'
  | 'consultation'
  | 'exam_waiting'
  | 'examination'
  | 'treatment_waiting'
  | 'preconditioning'
  | 'laser_waiting'     // 레이저실 입실 전 대기 (4/30 표준 v2 신규)
  | 'healer_waiting'   // 힐러대기 — 힐러 시술 전 대기 (T-20260502-foot-HEALER-WAIT-SLOT)
  | 'laser'
  | 'payment_waiting'   // 시술 후 수납대기 (의미 변경: 상담 후 결제 → 레이저 후 수납)
  | 'done'
  | 'cancelled'
  | 'checklist';        // deprecated — DB 이관 완료 후 제거 예정, 호환성 유지

/** Room-type field keys on CheckIn (used for room assignment logic) */
export type RoomFieldKey = 'examination_room' | 'consultation_room' | 'treatment_room' | 'laser_room';

/** Structured notes stored in check_ins.notes JSONB */
export interface CheckInNotes {
  needs_exam?: boolean;
  text?: string;
  checklist?: Record<string, boolean>;
  /** 셀프체크인 시 초진/예약없이방문 고객에게 자동 설정 — 데스크에서 신분증 확인 후 false로 해제 */
  id_check_required?: boolean;
  /** T-20260529-foot-SELFCHECKIN-FLOW-REVAMP AC-8: 주민번호 매칭 미완료 — 데스크 입력 대기 중 */
  rrn_match_pending?: boolean;
  [key: string]: unknown;
}

/** Supabase Realtime row snapshot (check_ins) */
export interface CheckInRealtimeRow {
  id?: string;
  checked_in_at?: string;
  [key: string]: unknown;
}

/** Prescription row from prescriptions + prescription_items join */
export interface PrescriptionRow {
  id: string;
  prescribed_by_name: string | null;
  diagnosis: string | null;
  memo: string | null;
  prescribed_at: string;
  prescription_items?: PrescriptionItemRow[];
}

export interface PrescriptionItemRow {
  id: string;
  medication_name: string;
  dosage: string | null;
  duration_days: number | null;
  quantity: number | null;
}

export type StaffRole = 'director' | 'consultant' | 'coordinator' | 'therapist' | 'technician';
export type UserRole = 'admin' | 'manager' | 'director' | 'part_lead' | 'consultant' | 'coordinator' | 'therapist' | 'technician' | 'tm' | 'staff';

export interface Clinic {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  open_time: string;
  close_time: string;
  weekend_close_time: string;
  slot_interval: number;
  consultation_rooms: number;
  treatment_rooms: number;
  laser_rooms: number;
  exam_rooms: number;
  max_per_slot: number;
  overbooking_rate: number;
  created_at: string;
  // 건보 본인부담 산출 (T-20260504-foot-INSURANCE-COPAYMENT)
  hira_unit_value?: number | null;
  hira_unit_value_year?: number | null;
  // 레이저 시간 단위 설정 (T-20260502-foot-LASER-TIME-UNIT)
  laser_time_units?: number[] | null;
  // 서류 바인딩 (T-20260520-foot-PRINT-FORM-BIND)
  nhis_code?: string | null;    // 요양기관번호
  fax?: string | null;          // 팩스번호
}

export type LeadSource = 'TM' | '인바운드' | '워크인' | '지인소개' | '온라인' | '기타';

export interface Customer {
  id: string;
  clinic_id: string;
  name: string;
  phone: string;
  visit_type: 'new' | 'returning';
  memo: string | null;
  customer_memo: string | null;             // 고객 메모 (성향·특이사항·주차 등) — T-20260504-foot-MEMO-RESTRUCTURE
  customer_note?: string | null;            // 2번차트 1구역 고객메모 (직접수정·non-history) — T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD
  lead_source: LeadSource | string | null;  // 유입 경로
  tm_memo: string | null;                   // 상담 메모 (보험/상담내용/성향)
  referrer_id: string | null;               // 추천인 고객 ID (optional FK)
  referrer_name: string | null;             // 추천인 이름 텍스트 (fallback)
  birth_date: string | null;                // 생년월일 (YYMMDD 텍스트, 예: 900515)
  chart_number: string | null;              // 차트번호
  is_foreign: boolean;
  is_simulation: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 풀퍼널 표준화 (큐카드 정책 v1.0)
  unified_customer_id?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  campaign_ref?: string | null;
  hospital?: string | null;
  clinic?: string | null;
  medium?: string | null;
  product?: string | null;
  campaign_name?: string | null;
  adset_name?: string | null;
  adsubject_name?: string | null;
  gender?: 'M' | 'F' | null;
  inflow_channel?: string | null;
  inflow_source?: string | null;
  // 건보 본인부담 산출 (T-20260504-foot-INSURANCE-COPAYMENT)
  rrn_vault_id?: string | null;
  insurance_grade?: InsuranceGrade | null;
  insurance_grade_verified_at?: string | null;
  insurance_grade_source?: InsuranceGradeSource | null;
  insurance_grade_memo?: string | null;
  // 주소지 (T-20260507-foot-CHART2-INSURANCE-FIELDS)
  address?: string | null;
  // 고객정보 입력폼 전면 수정 (T-20260508-foot-CUST-FORM-REVAMP)
  customer_grade?: '일반' | '1단계' | '2단계' | '3단계' | null;
  customer_email?: string | null;       // 고객 이메일
  passport_number?: string | null;      // 여권번호 (외국인)
  // T-20260625-foot-PASSPORT-PORT: 여권/외국인 정보 (derm 이식, 마이그 20260625130000 적용 후 활성)
  passport_first_name?: string | null;  // 여권 영문 이름(Given names)
  passport_last_name?: string | null;   // 여권 영문 성(Surname)
  nationality_id?: number | null;       // 국적 FK → nationalities.id
  foreigner_registration_number?: string | null; // 외국인등록번호 (RRN 동급 PHI)
  foreign_doc_expiry?: string | null;   // 여권/체류 만료일 (DATE)
  language?: string | null;             // 환자 선호 언어 BCP-47 코드(ko/en/ja/zh-CN/zh-TW). T-20260625-foot-FOREIGN-LANG-SAVE
  postal_code?: string | null;          // 우편번호 (5자리)
  assigned_staff_role?: '데스크' | '상담실장' | null; // 담당자 구분 (레거시)
  assigned_staff_id?: string | null;    // 담당 직원 FK (C2-STAFF-DROPDOWN)
  privacy_consent?: boolean | null;     // 개인정보 수집·이용 동의
  privacy_consent_at?: string | null;   // 개인정보 동의 일시 (T-20260602-foot-CONSENT-TIMESTAMP-COLS)
  sms_opt_in?: boolean | null;          // 예약문자 수신 동의 (선택)
  sms_opt_in_at?: string | null;        // 예약문자 수신 동의 일시 (T-20260602-foot-CONSENT-TIMESTAMP-COLS)
  sms_reject?: boolean | null;          // 문자수신거부
  marketing_reject?: boolean | null;    // 광고성 문자 수신 미동의
  // C2 tickets
  hira_consent?: boolean | null;        // 건강보험 조회 동의 Y/N (C2-HIRA-CONSENT)
  hira_consent_at?: string | null;      // 건강보험 조회 동의 일시
  // T-20260615-foot-CONSENT-SENSITIVE: 민감정보(건강·진료정보) 별도 동의 (개보법 §23)
  consent_sensitive?: boolean | null;   // 민감정보 수집·이용 동의 (DB default FALSE — 폼 캡처 시 TRUE)
  consent_agreed_at?: string | null;    // 민감정보 동의셋 증빙 시각 (최초 기록 후 불변)
  consent_version?: string | null;      // 동의 항목셋 버전 (foot-2026-06 고정)
  visit_route?: VisitRoute | null; // 방문경로 대분류 (C2-VISIT-ROUTE) — W2-DB: 네이버·인콜 ADD
  referral_name?: string | null;          // 소개자 성함 (방문경로='지인소개' 시) — T-20260515-foot-REFERRAL-NAME
  visit_route_detail?: string | null;     // 방문경로 소분류(유입경로) — T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH. 자유 TEXT (SNS_인스타그램/검색_네이버/지인소개_{성함}/제휴기타 …)
  // C23-DETAIL-SIMPLIFY
  treatment_note?: string | null;       // 치료메모: 치료사끼리 공유하는 고객 특이사항 메모
  // T-20260510-foot-ADDRESS-DETAIL-FIX
  address_detail?: string | null;       // 상세주소 (동·호수·건물명 등)
  // T-20260516-foot-HEALER-RESV-BTN v2: 힐러 대기 플래그 (예약 없을 때 임시 보관, 예약 생성 시 1회 소모)
  pending_healer_flag?: boolean | null;
  // T-20260522-foot-DESIGNATED-THERAPIST: 지정 치료사 FK
  designated_therapist_id?: string | null;
  // T-20260617-foot-AUTOASSIGN: 담당 실장(지정 상담사) FK→staff(id). 자동배정 0순위 우선, NULL이면 월 균등 fallback.
  assigned_consultant_id?: string | null;
  // T-20260522-foot-ALT-BADGE: ALT(올트) 배지 시스템 (AC-2)
  alt_status?: boolean | null;      // ALT 활성 여부 (보험 반려 → 레이저 병행 대상)
  alt_detail?: string | null;       // ALT 상세 내용 (예: "5회차까지 진행, 보험 반려됨")
  alt_activated_at?: string | null; // ALT 활성화 일시
}

export interface Service {
  id: string;
  clinic_id: string;
  name: string;
  category: string;
  price: number;
  discount_price: number | null;
  duration_min: number;
  vat_type: 'none' | 'exclusive' | 'inclusive';
  service_type: 'single' | 'package_component' | 'addon';
  active: boolean;
  sort_order: number;
  // T-20260525-foot-FEE-ITEM-REORDER AC-6: 결제 미니창 수가 항목 clinic 단위 표시 순서
  display_order?: number;
  created_at: string;
  // 판매상품 코드 (T-20260507-foot-SERVICE-CATALOG-SEED)
  service_code?: string | null;
  // 항목분류 (T-20260510-foot-SVCMENU-REVAMP)
  category_label?: string | null;       // 기본/검사/상병/풋케어/수액/풋화장품
  // 건보 본인부담 산출 (T-20260504-foot-INSURANCE-COPAYMENT)
  is_insurance_covered?: boolean | null;
  hira_code?: string | null;
  hira_score?: number | null;
  hira_category?: HiraCategory | null;
  copayment_rate_override?: number | null;
}

// ── 건보 청구 관련 (T-20260520-foot-INS-UI AC-2) ──────────────────────────

export type InsuranceClaimStatus = 'draft' | 'submitted' | 'accepted' | 'rejected' | 'cancelled';

/** insurance_claims — 진료비 청구 요약 */
export interface InsuranceClaim {
  id: string;
  clinic_id: string;
  customer_id: string;
  check_in_id: string | null;
  visit_date: string;
  claim_status: InsuranceClaimStatus;
  total_base: number;
  total_copayment: number;
  total_covered: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  calculation_engine_version: string | null;
}

/** claim_items — 청구 항목 (서비스별) */
export interface ClaimItem {
  id: string;
  claim_id: string;
  service_id: string;
  hira_code: string | null;
  hira_score: number | null;
  quantity: number;
  base_amount: number;
  copayment_amount: number;
  covered_amount: number;
  created_at: string;
}

/** claim_diagnoses — 청구 상병코드 */
export interface ClaimDiagnosis {
  id: string;
  claim_id: string;
  kcd_code: string;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
}

/** service_charges — 결제별 수가 산출 이력 (T-20260504-foot-INSURANCE-COPAYMENT) */
export interface ServiceCharge {
  id: string;
  clinic_id: string;
  check_in_id: string;
  customer_id: string;
  service_id: string;
  is_insurance_covered: boolean;
  hira_score: number | null;
  hira_unit_value: number | null;
  base_amount: number;
  insurance_covered_amount: number;
  copayment_amount: number;
  exempt_amount: number;
  customer_grade_at_charge: InsuranceGrade;
  copayment_rate_at_charge: number | null;
  calculated_at: string;
  calculation_engine_version: string;
}

export interface Staff {
  id: string;
  clinic_id: string;
  name: string;
  /** T-20260522-foot-STAFF-NAME-UNIFY: 구성명(현장 표시명). null이면 name fallback */
  display_name?: string | null;
  role: StaffRole;
  active: boolean;
  created_at: string;
  updated_at?: string;
  user_id?: string | null;
  /**
   * T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER: 자동배정 기본순번(round-robin).
   * (clinic_id, role) 그룹 내 정렬 키. NULL=미지정(name 정렬로 후순위 + random tie-break).
   * 읽기경로=autoAssign.pickLeastLoaded 3순위 tie-break(월균등 primary 비파괴). admin이 UPDATE로 편집.
   */
  assign_sort_order?: number | null;
}

// ── 자동배정 (T-20260617-foot-AUTOASSIGN-BALANCE-TOSS) ─────────────────────────

/** 배정 축(역할): 상담사 | 치료사 */
export type AssignmentRole = 'consult' | 'therapy';

/** 배정 액션 종류: 자동배정 | 토스(push) | 당김(pull) | 수동 override */
export type AssignmentActionType = 'auto_assign' | 'toss' | 'pull_in' | 'manual';

/**
 * assignment_actions row — 자동배정·토스·당김·수동 배정의 append-only audit SSOT.
 * 월 균등 카운트·토스 N건·당김 N건은 전부 본 테이블 count(*) 파생(별도 카운터 없음).
 */
export interface AssignmentAction {
  id: string;
  clinic_id: string;
  check_in_id: string | null;
  action_type: AssignmentActionType;
  role: AssignmentRole;
  /** 분류 축 스냅샷: 상담=TM|인바운드|워크인|returning / 치료=main|podologue|trial */
  axis: string | null;
  from_staff_id: string | null;
  to_staff_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Room {
  id: string;
  clinic_id: string;
  name: string;
  room_type: 'treatment' | 'laser' | 'consultation' | 'examination' | 'heated_laser';
  active: boolean;
  sort_order: number;
  max_occupancy: number;
}

export interface CheckIn {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  reservation_id: string | null;
  queue_number: number | null;
  customer_name: string;
  customer_phone: string | null;
  visit_type: VisitType;
  status: CheckInStatus;
  consultant_id: string | null;
  therapist_id: string | null;
  technician_id: string | null;
  consultation_room: string | null;
  treatment_room: string | null;
  laser_room: string | null;
  package_id: string | null;
  notes: CheckInNotes | null;
  treatment_memo: { details?: string; [key: string]: unknown } | null;
  treatment_photos: string[] | null;
  doctor_note: string | null;
  examination_room: string | null;
  checked_in_at: string;
  called_at: string | null;
  completed_at: string | null;
  priority_flag: 'CP' | '#' | null;
  sort_order: number;
  skip_reason: string | null;
  created_at: string;
  /** 진료정보 — T-20260430-foot-TREATMENT-LABEL */
  consultation_done: boolean;
  treatment_kind: string | null;
  preconditioning_done: boolean;
  pododulle_done: boolean;
  laser_minutes: number | null;
  /** 의사 진료 워크플로우 — T-20260502-foot-DOCTOR-TREATMENT-FLOW */
  prescription_items: unknown | null;
  document_content: string | null;
  doctor_confirm_charting: boolean;
  doctor_confirm_prescription: boolean;
  doctor_confirm_document: boolean;
  doctor_confirmed_at: string | null;
  healer_laser_confirm: boolean;
  /** 빠른처방 상태 — T-20260512-foot-QUICK-RX-BUTTON */
  prescription_status: 'none' | 'pending' | 'confirmed';
  /** 상태 플래그 — T-20260502-foot-STATUS-COLOR-FLAG */
  status_flag: StatusFlag | null;
  /** 상태 플래그 변경 감사 이력 (JSONB append-only).
   *  T-20260610-foot-TREATMENT-COMPLETE-BTN: changed_by_name/changed_by_role 추가(additive) —
   *  진료완료(purple→pink) 처리자(의사/직원 + 이름) 의료 추적. 기존 엔트리는 두 필드 미존재(undefined). */
  status_flag_history: Array<{
    flag: StatusFlag | null;
    changed_at: string;
    changed_by: string | null;
    changed_by_name?: string | null;
    changed_by_role?: string | null;
  }> | null;
  /** 진료 기록 간소화 — T-20260504-foot-TREATMENT-SIMPLIFY */
  assigned_counselor_id: string | null;
  treatment_category: string | null;
  treatment_contents: string[] | null;
  /** 원장님 진료콜 명단 진료 전달사항 전용 메모 — T-20260601-foot-DOCTOR-CALL-LIST
   *  방문동선 메모(treatment_memo/notes)와 용도 분리 */
  doctor_call_memo: string | null;
  /** 진료호출 의사 ✋확인(손 들기) 시각 — T-20260609-foot-DOCCALL-DOCTOR-ACK.
   *  의사가 호출을 인지/확인했다는 표시 신호. NULL=미확인, 값 있으면 '의사 확인됨'.
   *  진료완료(completed_at) 상태머신과 별개 신호(귀속/완료 로직 무관). */
  doctor_ack_at: string | null;
  /** 진료 세션 단계 — T-20260612-foot doctor_status (architect CONSULT DA-20260612-foot-DOCTORCALL).
   *  enum doctor_session_status: 'in_treatment'(진료중) | 'done'(진료완료) | NULL(미시작/대기).
   *  status_flag(콜 큐 색)와 직교. T-20260614-foot-DOCCALL-PURPLE-STEPPER 진료단계 stepper(대기→원장확인→진료중→진료완료)에서
   *  진료중/진료완료 2단계 표상 (대기=NULL, 원장확인=doctor_ack_at). */
  doctor_status: 'in_treatment' | 'done' | null;
  /** doctor_status='in_treatment' 전환 시각 — T-20260612-foot. */
  doctor_started_at: string | null;
  /** doctor_status='done' 전환 시각 — T-20260612-foot. */
  doctor_ended_at: string | null;
  /** 진료콜 명단 수기 순서 override — T-20260615-foot-CALLLIST-ROOMSUMMARY-NUM-REORDER WS-C (DA CONSULT GO, ADDITIVE).
   *  NULL = 자동 진입순(callEntryTime). 값 있으면 수기 우선(asc). 진료중(examination/in_treatment)은 항상 상단 고정.
   *  공유 realtime 영속(localStorage 불가) — check_ins 당일 행 단위(다음날 새 행에서 자연 소멸). */
  call_list_manual_order: number | null;
  /** T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: customers(name) embed 조인 결과.
   *  카드 표기명을 customers 현재 이름 우선 렌더하기 위한 비영속 파생 필드.
   *  customer_id 미연결(unlink) 시 null → denormalized customer_name fallback.
   *  T-20260612-foot-CHARTNO-B2-P1: chart_number 추가(additive) — 환자명 노출 surface 차트번호 인접 표기.
   *  T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: designated_therapist_id 추가(additive, read-only) —
   *    통합시간표 [치료사별] 탭 그룹핑 키 + "지정" 배지 판정용. customers.designated_therapist_id SSOT 재사용. */
  customers?: { name: string | null; chart_number?: string | null; designated_therapist_id?: string | null } | null;
  /** T-20260616-foot-CALLLIST-ENTRYORDER-FALLBACK-RECEIPTLEAK — 진료콜 진입순 폴백 사다리 2순위(파생/비DB).
   *  status_transitions(별도 테이블) 중 명단 active 전환(to_status ∈ healer_waiting/purple/yellow)의 최신
   *  transitioned_at. Dashboard fetch가 read-path로 주입(DB 컬럼 아님 — DDL 없음). callEntryTime이
   *  status_flag_history(1순위) 부재 시 checked_in_at(최종단) 직전 2순위로 소비.
   *  ※ healer_waiting처럼 status 전환만 되고 flag history 미기록인 케이스의 진입(activation)시각 복구용.
   *    HL자동노랑(SSOT 우회 벌크 yellow)은 transition row 자체가 없어 미복구 → known-limitation(접수시각 잔존). */
  derivedCallEntryAt?: string | null;
}

export interface Package {
  id: string;
  clinic_id: string;
  customer_id: string;
  package_name: string;
  package_type: string;
  total_sessions: number;
  heated_sessions: number;
  unheated_sessions: number;
  iv_sessions: number;
  preconditioning_sessions: number;
  shot_upgrade: boolean;
  af_upgrade: boolean;
  upgrade_surcharge: number;
  total_amount: number;
  paid_amount: number;
  status: 'active' | 'completed' | 'cancelled' | 'refunded' | 'transferred';
  transferred_from: string | null;
  transferred_to: string | null;
  expires_at: string | null;
  contract_date: string;
  memo: string | null;
  // T-20260507-foot-PKG-TEMPLATE-REDESIGN: 항목별 수가 + 연동 필드
  podologe_sessions?: number;
  podologe_unit_price?: number;
  heated_unit_price?: number;
  unheated_unit_price?: number;
  iv_unit_price?: number;
  iv_company?: string | null;
  template_id?: string | null;
  // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
  trial_sessions?: number;
  trial_unit_price?: number;
  // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 6번째 항목
  reborn_sessions?: number;
  reborn_unit_price?: number;
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE: 진료비 금액(패키지 금액 total_amount 과 별도, 합산표기 금지).
  // 마이그(20260617120000) ADDITIVE NOT NULL DEFAULT 0. 마이그 미적용 환경 대비 옵셔널 표기.
  consultation_fee?: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackageRemaining {
  heated: number;
  unheated: number;
  iv: number;
  preconditioning: number;
  podologe?: number;  // packages.podologe_sessions 참조 (컬럼명 오타 유지)
  trial?: number;     // T-20260522-foot-PKG-TRIAL: 체험권 잔여 회차
  reborn?: number;    // T-20260608-foot-PKG-REBORN-ITEM: Re:Born 잔여 회차
  total_used: number;
  total_remaining: number;
}

/** T-20260507-foot-PKG-TEMPLATE-REDESIGN: 패키지 템플릿 (종류/구성 정의) */
export interface PackageTemplate {
  id: string;
  clinic_id: string;
  name: string;
  heated_sessions: number;
  heated_unit_price: number;
  heated_upgrade_available: boolean;
  unheated_sessions: number;
  unheated_unit_price: number;
  unheated_upgrade_available: boolean;
  podologe_sessions: number;
  podologe_unit_price: number;
  iv_company: string | null;
  iv_sessions: number;
  iv_unit_price: number;
  // T-20260522-foot-PKG-TRIAL: 체험권 5번째 항목
  trial_sessions: number;
  trial_unit_price: number;
  // T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT: Re:Born 6번째 항목
  reborn_sessions: number;
  reborn_unit_price: number;
  total_price: number;
  price_override: boolean;
  memo: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  clinic_id: string | null;
  active: boolean;
  approved: boolean;
  created_at: string;
  updated_at?: string;
  access_tier?: string | null;
  // T-20260619-foot-ROLE-MATRIX-3TIER-RBAC: 운영최고권한(계정·통계·매출 + 진료관리 수정) ADDITIVE flag.
  //   임상 role(director)과 직교 — 대표원장=true / 봉직의=false(진료만). DA branch B(n17u pre-GO).
  //   ⚠️ DB 컬럼은 마이그(20260619220000_..._has_ops_authority_additive.sql.DDL_DIFF_HOLD) 적용 전까지 부재 →
  //      profile.has_ops_authority 는 undefined. 그동안 모든 ops-authority predicate는 admin escape로만 통과(inert·lock-out-safe).
  has_ops_authority?: boolean | null;
  // T-20260620-foot-SUPERADMIN-EXEMPT (DA CONSULT-REPLY MSG-20260620-162917-aw39, DA-20260620-FOOT-SUPERADMIN-EXEMPT):
  //   상시예외 영속화 ADDITIVE flag. true = '제한 토글'(§12 EXCL-3 회수 + 향후 신규 제한)의 적용 제외.
  //   ★grant 아님 — 역할이 이미 가진 접근의 '제거 방지'만. 신규 메뉴/의사·진료 publish 부여 안 함(AC-6 자동 안전).
  //   has_ops_authority(positive ABILITY)와 직교 축(negative-protection) → 별 컬럼(통합 금지, least-privilege).
  //   ⚠️ DB 컬럼은 마이그(..._exempt_from_restrictions_additive.sql.DDL_DIFF_HOLD) 적용 전까지 부재 → undefined(=false 취급, inert).
  exempt_from_restrictions?: boolean | null;
}

/** T-20260623-foot-DOCCHART-PASTHX-TAB: 의사 진료차트 '과거력' 확정 이력 (append-only).
 *  발건강 질문지(read-only)에서 자동 prefill → 실장 더블체크·확정값만 저장. 최신 confirmed_at 1건 read. */
export interface PatientPastHistory {
  id: string;
  clinic_id: string;
  customer_id: string;
  lines: Record<string, '+' | '-'>;  // 라인별 (-/+) 상태 (pastHistory.PastHxLines)
  comment: string | null;            // 실장 자유 코멘트
  confirmed_by: string | null;
  confirmed_at: string;
}


/** T-20260515-foot-RESV-MEMO-APPEND: 예약메모 누적 이력 (append-only)
 *  T-20260520-foot-RESV-MEMO-WALKIN: reservation_id nullable + customer_id 추가
 *  T-20260521-foot-WALKIN-MEMO-GAP: check_in_id 3순위 fallback 추가
 *  T-20260522-foot-ALT-BADGE: is_pinned / pinned_at 고정 기능 */
export interface ReservationMemoHistory {
  id: string;
  reservation_id: string | null;     // T-20260520: nullable (워크인 지원)
  customer_id?: string | null;        // T-20260520: 예약 없는 고객 fallback
  check_in_id?: string | null;        // T-20260521: customer_id 없는 수기 워크인 fallback
  clinic_id: string;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  // T-20260522-foot-ALT-BADGE: 고객메모 고정 기능
  is_pinned: boolean;                 // 최상단 고정 여부 (default false)
  pinned_at: string | null;           // 고정 설정 일시
}

export interface Reservation {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  reservation_date: string;
  reservation_time: string;
  end_time: string | null;                  // 예약 종료시간 (HH:MM) — C2-RESV-DETAIL-PANEL
  visit_type: VisitType;
  service_id: string | null;
  memo: string | null;
  booking_memo: string | null;              // 예약메모 (예약 경로 확인용) — T-20260504-foot-MEMO-RESTRUCTURE
  /** T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB: 간략메모(초진 주증상 — 발톱무좀/내성발톱 선택 또는 직접입력).
   *  CRM-local 임상 메타. booking_memo(예약메모)와 별개 칸. cue_card·통계·리드 집계 영향 0. */
  brief_note?: string | null;
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';
  cancelled_at: string | null;             // 취소 일시 — T-20260515-foot-RESV-CANCEL
  cancel_reason: string | null;            // 취소 사유 — T-20260515-foot-RESV-CANCEL
  cancelled_by: string | null;             // 취소 처리 staff user_id — T-20260525-foot-RESV-CANCEL-CTX
  referral_source: string | null;
  /** T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약경로(방문경로 대분류). customers.visit_route enum 재사용 SSOT.
   *  W2-DB: 네이버·인콜 ADD(B안: legacy 인바운드 존치). */
  visit_route?: VisitRoute | null;
  /** T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 마스터 FK(reservation_registrars). */
  registrar_id?: string | null;
  /** T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 성함 스냅샷(고객박스 @표시·이력 안정). */
  registrar_name?: string | null;
  created_by: string | null;
  /** T-20260622-foot-RESVMGMT-ASSIGNEE-BOOKER-UI: 마지막 수정 계정(auth uid). 일자/시간 변경 등 UPDATE 시 overwrite.
   *  담당자 표시 = COALESCE(updated_by, created_by). created_by(생성자=TM 귀속)는 불변 유지.
   *  ⚠ 의미 축(DA CONSULT-REPLY MSG-20260622-215701-p402 조건3): updated_by 는 **audit/last-modifier 축**
   *  (= "예약을 마지막으로 생성/수정한 계정", 운영 audit)이며, 계약 §6-6[5]의 비즈니스 owner 배정 축
   *  (assigned_staff/p_owner_staff_id, 도파민 round-robin)과는 별개다. UI엔 '담당자'로 표기하되 의미는 audit. */
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  /** T-20260516-foot-HEALER-RESV-BTN: 힐러예약 플래그 — 치료사 수동 설정, 예약 당일 대시보드 HL(노랑) 자동 표시 후 false로 리셋 (1회성) */
  healer_flag?: boolean | null;
  /** T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): 힐러 의도(영속) — 예약 팝업 ON/OFF 토글. 체크인 후에도 유지되는 힐러 분류 SSOT. */
  is_healer_intent?: boolean | null;
  // ── 도파민 연동 (T-20260520-foot-DOPAMINE-SCHEMA) ─────────────────────
  /** 예약 유입 경로: null=일반/워크인, 'dopamine'=도파민 TM 경유, 'foot-walkin'=풋 자체 워크인 */
  source_system?: string | null;
  /** 도파민 cue_card.id (UUID) — 큐카드 master=도파민 모델 */
  external_id?: string | null;
  /** T-20260524-foot-THERAPIST-BISYNC: 재진 예약 지정 치료사 — customers.designated_therapist_id와 쌍방 동기화 */
  preferred_therapist_id?: string | null;
  /** T-PROGRESS-CHECKPOINT AC-3: 예약이 경과분석 체크포인트 회차에 해당하면 true */
  progress_check_required?: boolean | null;
  /** T-PROGRESS-CHECKPOINT AC-3: 경과분석 레이블 (예: "6회 중간 경과분석") */
  progress_check_label?: string | null;
  /** T-20260604-foot-DASH-CARD-NAME-DENORM-SYNC: customers(name) embed 조인 결과.
   *  카드 표기명을 customers 현재 이름 우선 렌더하기 위한 비영속 파생 필드.
   *  customer_id 미연결(unlink) 시 null → denormalized customer_name fallback.
   *  T-20260612-foot-CHARTNO-B2-P2: chart_number 인접 표시용 embed(읽기 전용, 비영속).
   *  T-20260614-foot-TIMETABLE-THERAPIST-DESIGNATED: designated_therapist_id 추가(additive, read-only) —
   *    통합시간표 명단 "지정" 배지 판정용. customers.designated_therapist_id SSOT 재사용. */
  customers?: { name: string | null; chart_number?: string | null; designated_therapist_id?: string | null } | null;
}

/**
 * T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS: 예약등록자 편집형 마스터.
 * 관리자 설정에서 CRUD(추가/수정/비활성/정렬). 예약상세 팝업 '예약등록자' 드롭다운 SSOT.
 * ⚠ staff 계정과 분리된 운영 명단 — STAFF-ROLE-TM-ADD(staff role)와 별개 모델.
 */
export interface ReservationRegistrar {
  id: string;
  clinic_id: string;
  group_name: '원내' | 'TM';
  name: string;
  sort_order: number;
  active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS / T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB(item8):
 * 방문경로(예약경로) 대분류 옵션 SSOT — 신규 등록 선택지 5종.
 * customers.visit_route / reservations.visit_route CHECK 제약(W2-DB: TM/워크인/인바운드/지인소개/네이버/인콜)과 정합.
 * ⚠ B안(비파괴): 신규 등록 드롭다운은 5종(TM/네이버/인콜/워크인/지인소개)만 노출.
 *    legacy '인바운드'는 CHECK·표시에는 허용하되 드롭다운 기본 노출에서 제외(visitRouteOptionsFor 로 동적 보존).
 * ⚠ 이름충돌 경고(DA CONSULT-REPLY igq8): foot.visit_route '네이버'(네이버예약/플레이스 수기 inbound)
 *    ≠ cue_cards.media_source='naver'(도파민 paid). silver/route_std 매핑: '네이버'→naver / '인콜'→inbound / legacy '인바운드'→inbound.
 */
export const VISIT_ROUTE_OPTIONS = ['TM', '네이버', '인콜', '워크인', '지인소개'] as const;
/** 신규 드롭다운 미노출 legacy 보존값(CHECK·표시는 허용). */
export const VISIT_ROUTE_LEGACY = ['인바운드'] as const;
export type VisitRoute = (typeof VISIT_ROUTE_OPTIONS)[number] | (typeof VISIT_ROUTE_LEGACY)[number];

/**
 * 드롭다운 옵션 계산: 신규 5종 + 현재값이 legacy('인바운드' 등 5종 밖)면 그 값을 보존 항목으로 추가.
 * → legacy '인바운드' 예약을 편집해도 드롭다운에서 현재값이 빈칸이 되지 않고 그대로 선택·표시(B안 보존).
 */
export function visitRouteOptionsFor(current?: string | null): string[] {
  const base = [...VISIT_ROUTE_OPTIONS] as string[];
  const cur = (current ?? '').trim();
  if (cur && !base.includes(cur)) return [...base, cur];
  return base;
}

/** 예약등록자 마스터 그룹 라벨 순서 (드롭다운 그룹 헤더용). */
export const REGISTRAR_GROUPS = ['원내', 'TM'] as const;

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
  | 'dark_gray';// 수납완료 — 수납 후 귀가

export type CheckInStatus =
  | 'registered'
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
export type UserRole = 'admin' | 'manager' | 'part_lead' | 'consultant' | 'coordinator' | 'therapist' | 'technician' | 'tm' | 'staff';

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
  postal_code?: string | null;          // 우편번호 (5자리)
  assigned_staff_role?: '데스크' | '상담실장' | null; // 담당자 구분 (레거시)
  assigned_staff_id?: string | null;    // 담당 직원 FK (C2-STAFF-DROPDOWN)
  privacy_consent?: boolean | null;     // 개인정보 수집·이용 동의
  sms_reject?: boolean | null;          // 문자수신거부
  marketing_reject?: boolean | null;    // 광고성 문자 수신 미동의
  // C2 tickets
  hira_consent?: boolean | null;        // 건강보험 조회 동의 Y/N (C2-HIRA-CONSENT)
  hira_consent_at?: string | null;      // 건강보험 조회 동의 일시
  visit_route?: 'TM' | '워크인' | '인바운드' | '지인소개' | null; // 방문경로 (C2-VISIT-ROUTE)
  // C23-DETAIL-SIMPLIFY
  treatment_note?: string | null;       // 치료메모: 치료사끼리 공유하는 고객 특이사항 메모
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
  created_at: string;
  // 판매상품 코드 (T-20260507-foot-SERVICE-CATALOG-SEED)
  service_code?: string | null;
  // 건보 본인부담 산출 (T-20260504-foot-INSURANCE-COPAYMENT)
  is_insurance_covered?: boolean | null;
  hira_code?: string | null;
  hira_score?: number | null;
  hira_category?: HiraCategory | null;
  copayment_rate_override?: number | null;
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
  role: StaffRole;
  active: boolean;
  created_at: string;
  updated_at?: string;
  user_id?: string | null;
}

export interface Room {
  id: string;
  clinic_id: string;
  name: string;
  room_type: 'treatment' | 'laser' | 'consultation' | 'examination';
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
  /** 상태 플래그 — T-20260502-foot-STATUS-COLOR-FLAG */
  status_flag: StatusFlag | null;
  status_flag_history: Array<{ flag: StatusFlag | null; changed_at: string; changed_by: string | null }> | null;
  /** 진료 기록 간소화 — T-20260504-foot-TREATMENT-SIMPLIFY */
  assigned_counselor_id: string | null;
  treatment_category: string | null;
  treatment_contents: string[] | null;
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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackageRemaining {
  heated: number;
  unheated: number;
  iv: number;
  preconditioning: number;
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
}

/** 날짜별 원내 공지 메모 — T-20260504-foot-CLINIC-MEMO */
export interface ClinicMemo {
  id: string;
  clinic_id: string;
  date: string; // 'yyyy-MM-dd'
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'noshow';
  referral_source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

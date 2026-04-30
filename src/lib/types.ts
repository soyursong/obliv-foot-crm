// Supabase table row types for 풋센터 CRM

export type VisitType = 'new' | 'returning' | 'experience';

export type CheckInStatus =
  | 'registered'
  | 'checklist'
  | 'exam_waiting'
  | 'examination'
  | 'consult_waiting'
  | 'consultation'
  | 'payment_waiting'
  | 'treatment_waiting'
  | 'preconditioning'
  | 'laser'
  | 'done'
  | 'cancelled';

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
}

export type LeadSource = 'TM' | '인바운드' | '워크인' | '지인소개' | '온라인' | '기타';

export interface Customer {
  id: string;
  clinic_id: string;
  name: string;
  phone: string;
  visit_type: 'new' | 'returning';
  memo: string | null;
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

export interface Reservation {
  id: string;
  clinic_id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  reservation_date: string;
  reservation_time: string;
  visit_type: VisitType;
  service_id: string | null;
  memo: string | null;
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'noshow';
  referral_source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

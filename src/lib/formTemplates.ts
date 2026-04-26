/**
 * 서류 양식 타입 정의 + fallback 템플릿 데이터
 *
 * form_templates DB 시드 적용 전에도 UI가 동작하도록 fallback 데이터를 제공한다.
 * DB에 데이터가 있으면 DB 우선, 없으면 fallback 사용.
 *
 * - Phase 1: form_templates 5행 seed (DDL 승인 대기)
 * - Phase 2: field_map 좌표 측정 (원장 리뷰 대기)
 * - Phase 3: DocumentPrintPanel UI (본 파일 + 컴포넌트)
 */

// ─── 타입 ───

export interface FieldMapEntry {
  /** 필드 키 (customer_name, diagnosis_ko 등) */
  key: string;
  /** 한국어 라벨 */
  label: string;
  /** 렌더링 타입 */
  type: 'text' | 'multiline' | 'date' | 'amount';
  /** 오버레이 X 좌표 (px, 원본 이미지 해상도 기준) */
  x: number;
  /** 오버레이 Y 좌표 */
  y: number;
  /** 너비 (multiline용) */
  w?: number;
  /** 높이 (multiline용) */
  h?: number;
  /** 폰트 크기 (px) */
  font?: number;
}

export interface FormTemplate {
  id: string;
  clinic_id: string;
  category: string;
  form_key: string;
  name_ko: string;
  template_path: string;
  template_format: 'jpg' | 'pdf';
  field_map: FieldMapEntry[];
  requires_signature: boolean;
  required_role: string;
  active: boolean;
  sort_order: number;
}

export interface FormSubmission {
  id: string;
  template_id: string;
  check_in_id: string;
  customer_id: string | null;
  issued_by: string;
  field_data: Record<string, string>;
  diagnosis_codes: string[] | null;
  signature_url: string | null;
  status: 'draft' | 'printed' | 'voided';
  printed_at: string | null;
  created_at: string;
}

// ─── 자동 바인딩 필드 키 ───

/** 시스템이 자동으로 채워주는 필드 키 목록 */
export const AUTO_BIND_KEYS = [
  'patient_name',
  'patient_phone',
  'patient_rrn',
  'visit_date',
  'doctor_name',
  'total_amount',
  'insurance_covered',
  'non_covered',
  'clinic_name',
  'clinic_address',
  'issue_date',
] as const;

export type AutoBindKey = (typeof AUTO_BIND_KEYS)[number];

// ─── 이미지 resolver ───

/**
 * form_key → Vite 에셋 이미지 경로 매핑.
 * Vite에서는 `new URL(...)` 패턴으로 정적 에셋을 참조한다.
 */
const IMAGE_MAP: Record<string, string> = {};

// Vite static asset URLs — 한국어 파일명 지원
function resolveAsset(filename: string): string {
  return new URL(`../assets/forms/foot-service/${filename}`, import.meta.url).href;
}

try {
  IMAGE_MAP.diag_opinion = resolveAsset('소견서.jpg');
  IMAGE_MAP.diagnosis = resolveAsset('진단서.jpg');
  IMAGE_MAP.bill_detail = resolveAsset('진료비내역서.pdf');
  IMAGE_MAP.treat_confirm = resolveAsset('진료확인서.jpg');
  IMAGE_MAP.visit_confirm = resolveAsset('통원확인서.jpg');
} catch {
  // asset 미존재 시 graceful degrade — 미리보기만 불가
}

export function getTemplateImageUrl(formKey: string): string | null {
  return IMAGE_MAP[formKey] ?? null;
}

// ─── Fallback 템플릿 데이터 ───

const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

/**
 * DB에 form_templates가 비어있을 때 사용하는 fallback.
 * field_map은 빈 배열 — Phase 2(원장 좌표 측정) 후 채워진다.
 */
export const FALLBACK_TEMPLATES: FormTemplate[] = [
  {
    id: 'fallback-diag-opinion',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'diag_opinion',
    name_ko: '소견서',
    template_path: '/assets/forms/foot-service/소견서.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager',
    active: true,
    sort_order: 10,
  },
  {
    id: 'fallback-diagnosis',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'diagnosis',
    name_ko: '진단서',
    template_path: '/assets/forms/foot-service/진단서.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager',
    active: true,
    sort_order: 20,
  },
  {
    id: 'fallback-bill-detail',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'bill_detail',
    name_ko: '진료비내역서',
    template_path: '/assets/forms/foot-service/진료비내역서.pdf',
    template_format: 'pdf',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 30,
  },
  {
    id: 'fallback-treat-confirm',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm',
    name_ko: '진료확인서',
    template_path: '/assets/forms/foot-service/진료확인서.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 40,
  },
  {
    id: 'fallback-visit-confirm',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'visit_confirm',
    name_ko: '통원확인서',
    template_path: '/assets/forms/foot-service/통원확인서.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 50,
  },
];

// ─── 양식 아이콘/색상 ───

export const FORM_META: Record<string, { icon: string; color: string; description: string }> = {
  diag_opinion: { icon: '📋', color: 'bg-blue-50 border-blue-200', description: '진료 소견 및 의견' },
  diagnosis: { icon: '🩺', color: 'bg-indigo-50 border-indigo-200', description: '질병 진단 내용' },
  bill_detail: { icon: '🧾', color: 'bg-amber-50 border-amber-200', description: '진료비 세부 내역 (PDF)' },
  treat_confirm: { icon: '✅', color: 'bg-teal-50 border-teal-200', description: '진료 사실 확인' },
  visit_confirm: { icon: '🏥', color: 'bg-emerald-50 border-emerald-200', description: '통원 사실 확인' },
};

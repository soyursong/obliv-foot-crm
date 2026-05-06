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
  clinic_id: string;
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
/**
 * T-20260506-foot-CHART-SIMPLE-REVAMP: 5/4 22:04 요청 반영
 * 별도 요청 서류 목록 전면 개정
 */
export const FALLBACK_TEMPLATES: FormTemplate[] = [
  // ── 기본 서류 ──
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
    sort_order: 5,
  },

  // ── 별도 요청 서류 (현장 22:04 요청 기준) ──
  {
    id: 'fallback-prescription',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'prescription',
    name_ko: '처방전',
    template_path: '/assets/forms/foot-service/처방전.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager',
    active: true,
    sort_order: 10,
  },
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
    sort_order: 20,
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
    sort_order: 30,
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
    sort_order: 40,
  },
  {
    id: 'fallback-med-record-short',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'med_record_short',
    name_ko: '진료기록사본(1-5매)',
    template_path: '/assets/forms/foot-service/진료기록사본_단.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 50,
  },
  {
    id: 'fallback-med-record-long',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'med_record_long',
    name_ko: '진료기록사본(6매 이상)',
    template_path: '/assets/forms/foot-service/진료기록사본_장.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 60,
  },
  {
    id: 'fallback-treat-confirm-code',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm_code',
    name_ko: '진료확인서(코드·진단명 포함)',
    template_path: '/assets/forms/foot-service/진료확인서_코드포함.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 70,
  },
  {
    id: 'fallback-treat-confirm-nocode',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm_nocode',
    name_ko: '진료확인서(코드·진단명 불포함)',
    template_path: '/assets/forms/foot-service/진료확인서_코드불포함.jpg',
    template_format: 'jpg',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 80,
  },
];

// ─── 원내 도장 ───

let _stampUrl: string | null | undefined = undefined; // undefined = 아직 확인 안 함

/**
 * 원내 도장 이미지 URL 반환.
 * Vite 빌드 시 파일이 없으면 null 반환 → 출력 시 도장 생략.
 */
export function getStampUrl(): string | null {
  if (_stampUrl !== undefined) return _stampUrl;
  try {
    // @vite-ignore — 도장 파일은 현장 수급 후 추가 예정 (없으면 graceful degrade)
    _stampUrl = new URL(/* @vite-ignore */ '../assets/forms/stamps/jongno-foot-stamp.png', import.meta.url).href;
  } catch {
    _stampUrl = null;
  }
  return _stampUrl;
}

// ─── 양식 분류 ───

/**
 * print_preset:
 *  - 'default'  — "기본 서류 출력" 프리셋에 자동 포함 (진료비내역서 등)
 *  - 'optional' — 별도 요청 시 개별 선택
 */
export type PrintPreset = 'default' | 'optional';

/** 기본 프리셋에 포함되는 form_key 목록 */
export const DEFAULT_PRESET_KEYS: ReadonlyArray<string> = ['bill_detail'];

// ─── 양식 아이콘/색상 ───

export const FORM_META: Record<
  string,
  { icon: string; color: string; description: string; print_preset: PrintPreset }
> = {
  // 기본 서류
  bill_detail: {
    icon: '🧾',
    color: 'bg-amber-50 border-amber-200',
    description: '진료비 세부 내역 (PDF)',
    print_preset: 'default',
  },
  // 별도 요청 서류 (T-20260506-foot-CHART-SIMPLE-REVAMP)
  prescription: {
    icon: '💊',
    color: 'bg-pink-50 border-pink-200',
    description: '처방전',
    print_preset: 'optional',
  },
  diag_opinion: {
    icon: '📋',
    color: 'bg-blue-50 border-blue-200',
    description: '진료 소견 및 의견',
    print_preset: 'optional',
  },
  diagnosis: {
    icon: '🩺',
    color: 'bg-indigo-50 border-indigo-200',
    description: '질병 진단 내용',
    print_preset: 'optional',
  },
  visit_confirm: {
    icon: '🏥',
    color: 'bg-emerald-50 border-emerald-200',
    description: '통원 사실 확인',
    print_preset: 'optional',
  },
  med_record_short: {
    icon: '📄',
    color: 'bg-gray-50 border-gray-200',
    description: '진료기록사본 1-5매',
    print_preset: 'optional',
  },
  med_record_long: {
    icon: '📄',
    color: 'bg-gray-50 border-gray-200',
    description: '진료기록사본 6매 이상',
    print_preset: 'optional',
  },
  treat_confirm_code: {
    icon: '✅',
    color: 'bg-teal-50 border-teal-200',
    description: '코드·진단명 포함',
    print_preset: 'optional',
  },
  treat_confirm_nocode: {
    icon: '☑️',
    color: 'bg-cyan-50 border-cyan-200',
    description: '코드·진단명 불포함',
    print_preset: 'optional',
  },
  // 하위 호환 — 기존 treat_confirm 유지
  treat_confirm: {
    icon: '✅',
    color: 'bg-teal-50 border-teal-200',
    description: '진료 사실 확인',
    print_preset: 'optional',
  },
};

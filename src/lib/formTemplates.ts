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

/** 복수 서명자 슬롯 (미성년자 동의서 등) */
export interface SignatureSlot {
  key: string;   // 'signer_patient' | 'signer_guardian'
  label: string; // '환자 서명' | '법정대리인 서명'
}

/** 미성년자 동의서 법정대리인 정보 */
export interface GuardianInfo {
  guardian_name?: string;
  guardian_rrn?: string;
  guardian_relation?: string;
  guardian_phone?: string;
}

export interface FormTemplate {
  id: string;
  clinic_id: string;
  category: string;
  form_key: string;
  name_ko: string;
  template_path: string;
  template_format: 'jpg' | 'png' | 'pdf';
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
  /** 마케팅 서류(모델계약서·체험단 초상권) 만료일. NULL이면 만료 없음. */
  expires_at?: string | null;
  /** 미성년자 동의서 법정대리인 정보 */
  guardian_info?: GuardianInfo | null;
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

function resolveDosuAsset(filename: string): string {
  return new URL(`../assets/forms/도수센터/${filename}`, import.meta.url).href;
}

try {
  // T-20260515-foot-FORM-TEMPLATE-REFRESH: 신규 이미지로 교체 (JPG→PNG)
  IMAGE_MAP.diag_opinion = resolveAsset('diag_opinion.png');
  IMAGE_MAP.diagnosis    = resolveAsset('diagnosis.png');
  IMAGE_MAP.bill_detail  = resolveAsset('bill_detail.png');
  IMAGE_MAP.treat_confirm = resolveAsset('treat_confirm.png');
  IMAGE_MAP.visit_confirm = resolveAsset('visit_confirm.png');
  // 신규 2종
  IMAGE_MAP.rx_standard  = resolveAsset('rx_standard.jpg');
  IMAGE_MAP.bill_receipt = resolveAsset('bill_receipt.jpg');
} catch {
  // asset 미존재 시 graceful degrade — 미리보기만 불가
}

// 도수센터 에셋 — 도수센터 오픈 전까지는 미리보기 비활성 가능
try {
  IMAGE_MAP.dosu_consent          = resolveDosuAsset('[도수센터]도수치료 동의서.png');
  IMAGE_MAP.general_consent       = resolveDosuAsset('[도수센터]동의서.png');
  IMAGE_MAP.minor_consent         = resolveDosuAsset('[도수센터]미성년자 시술 동의서.png');
  IMAGE_MAP.nonbenefit_explain    = resolveDosuAsset('[도수센터]비급여 설명확인서.png');
  IMAGE_MAP.growth_hormone_survey = resolveDosuAsset('[도수센터]성장호르몬 설문지.png');
  IMAGE_MAP.model_contract_1      = resolveDosuAsset('[도수센터]모델 계약서_1.png');
  IMAGE_MAP.model_contract_2      = resolveDosuAsset('[도수센터]모델계약서_2.png');
  IMAGE_MAP.experience_portrait   = resolveDosuAsset('[도수센터]체험단 초상권동의서.png');
  IMAGE_MAP.initial_chart         = resolveDosuAsset('[도수센터]초진차트.png');
  IMAGE_MAP.row_chart             = resolveDosuAsset('[도수센터]줄차트.png');
} catch {
  // 도수센터 에셋 미존재 시 graceful degrade
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
 *
 * T-20260515-foot-FORM-TEMPLATE-REFRESH: 7종 이미지 갱신 + 신규 2종 추가
 *   기존 5종(JPG/PDF) → 새 PNG 교체, rx_standard/bill_receipt 신규 등록
 */
export const FALLBACK_TEMPLATES: FormTemplate[] = [
  // ── 기본 서류 ──
  {
    id: 'fallback-bill-detail',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'bill_detail',
    name_ko: '진료비내역서',
    // T-20260515: PDF → PNG 교체 (1123×789 px, 가로형)
    template_path: '/assets/forms/foot-service/bill_detail.png',
    template_format: 'png',
    // 가로형 PNG — CSS position:absolute (픽셀, 좌상단 원점)
    // 초기 추정치 — 원장 시각 검증 후 확정
    field_map: [
      { key: 'patient_name', label: '환자성명',   type: 'text',   x: 200, y: 90,  font: 13 },
      { key: 'issue_date',   label: '발행일',     type: 'date',   x: 500, y: 475, font: 13 },
      { key: 'total_amount', label: '합계금액',   type: 'amount', x: 750, y: 428, font: 12 },
      { key: 'clinic_name',  label: '요양기관명', type: 'text',   x: 205, y: 500, font: 12 },
    ],
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
    // T-20260515: 새 PNG 교체 (645×884 px)
    template_path: '/assets/forms/foot-service/diag_opinion.png',
    template_format: 'png',
    // 645×884 px — 초기 추정치
    field_map: [
      { key: 'patient_name', label: '환자성명', type: 'text',      x: 130, y: 138, font: 14 },
      { key: 'patient_rrn',  label: '주민번호', type: 'text',      x: 272, y: 103, font: 12 },
      { key: 'diagnosis_ko', label: '상병명',   type: 'multiline', x: 200, y: 186, w: 400, h: 55, font: 13 },
      { key: 'issue_date',   label: '발행일',   type: 'date',      x: 130, y: 718, font: 13 },
      { key: 'clinic_name',  label: '의료기관', type: 'text',      x: 105, y: 742, font: 12 },
      { key: 'doctor_name',  label: '의사성명', type: 'text',      x: 480, y: 877, font: 13 },
    ],
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
    // T-20260515: 새 PNG 교체 (621×835 px)
    template_path: '/assets/forms/foot-service/diagnosis.png',
    template_format: 'png',
    // 621×835 px — 초기 추정치
    field_map: [
      { key: 'patient_name', label: '환자성명',    type: 'text',      x: 118, y: 136, font: 14 },
      { key: 'patient_rrn',  label: '주민등록번호', type: 'text',      x: 390, y: 136, font: 12 },
      { key: 'diagnosis_ko', label: '병명',        type: 'multiline', x: 195, y: 193, w: 380, h: 50, font: 13 },
      { key: 'issue_date',   label: '발행일',      type: 'date',      x: 170, y: 632, font: 13 },
      { key: 'clinic_name',  label: '의료기관',    type: 'text',      x: 100, y: 650, font: 12 },
      { key: 'doctor_name',  label: '의사성명',    type: 'text',      x: 470, y: 812, font: 13 },
    ],
    requires_signature: false,
    required_role: 'admin|manager',
    active: true,
    sort_order: 30,
  },
  {
    id: 'fallback-treat-confirm',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm',
    name_ko: '진료확인서',
    // T-20260515: 새 PNG 교체 (693×907 px, 빈 양식)
    template_path: '/assets/forms/foot-service/treat_confirm.png',
    template_format: 'png',
    // 693×907 px — 초기 추정치
    field_map: [
      { key: 'patient_name', label: '환자성명', type: 'text',      x: 130, y: 163, font: 16 },
      { key: 'patient_rrn',  label: '주민번호', type: 'text',      x: 130, y: 187, font: 14 },
      { key: 'diagnosis_ko', label: '병명',     type: 'multiline', x: 140, y: 218, w: 520, h: 50, font: 14 },
      { key: 'issue_date',   label: '발행일',   type: 'date',      x: 130, y: 790, font: 16 },
      { key: 'clinic_name',  label: '의료기관', type: 'text',      x: 130, y: 812, font: 14 },
      { key: 'doctor_name',  label: '의사성명', type: 'text',      x: 560, y: 900, font: 14 },
    ],
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
    // T-20260515: 새 PNG 교체 (639×800 px)
    template_path: '/assets/forms/foot-service/visit_confirm.png',
    template_format: 'png',
    // 639×800 px — 초기 추정치
    field_map: [
      { key: 'patient_name', label: '환자성명', type: 'text',      x: 128, y: 153, font: 14 },
      { key: 'patient_rrn',  label: '주민번호', type: 'text',      x: 120, y: 174, font: 12 },
      { key: 'diagnosis_ko', label: '병명',     type: 'multiline', x: 140, y: 205, w: 450, h: 50, font: 13 },
      { key: 'issue_date',   label: '발행일',   type: 'date',      x: 120, y: 692, font: 13 },
      { key: 'clinic_name',  label: '의료기관', type: 'text',      x: 120, y: 710, font: 12 },
      { key: 'doctor_name',  label: '의사성명', type: 'text',      x: 540, y: 793, font: 13 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 40,
  },
  // ── T-20260515: 신규 2종 ──
  {
    id: 'fallback-rx-standard',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'rx_standard',
    name_ko: '처방전(표준처방전)',
    template_path: '/assets/forms/foot-service/rx_standard.jpg',
    template_format: 'jpg',
    // 1206×1735 px — 초기 추정치 (원장 검증 후 확정)
    field_map: [
      { key: 'patient_name', label: '피보성명(환자성명)', type: 'text', x: 155, y: 345, font: 18 },
      { key: 'patient_rrn',  label: '주민번호',           type: 'text', x: 155, y: 388, font: 16 },
      { key: 'diagnosis_ko', label: '질병분류기호',       type: 'text', x: 30,  y: 455, font: 16 },
      { key: 'issue_date',   label: '교부일',             type: 'date', x: 155, y: 313, font: 16 },
      { key: 'clinic_name',  label: '의료기관명칭',       type: 'text', x: 705, y: 313, font: 16 },
      { key: 'doctor_name',  label: '처방의사성명',       type: 'text', x: 570, y: 455, font: 16 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|director',
    active: true,
    sort_order: 15,
  },
  {
    id: 'fallback-bill-receipt',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'bill_receipt',
    name_ko: '진료비 계산서·영수증',
    template_path: '/assets/forms/foot-service/bill_receipt.jpg',
    template_format: 'jpg',
    // 1206×1779 px — 초기 추정치 (원장 검증 후 확정)
    field_map: [
      { key: 'patient_name', label: '환자성명',   type: 'text',   x: 200, y: 65,   font: 16 },
      { key: 'total_amount', label: '총진료비',   type: 'amount', x: 950, y: 218,  font: 14 },
      { key: 'issue_date',   label: '발행일',     type: 'date',   x: 230, y: 1496, font: 14 },
      { key: 'clinic_name',  label: '요양기관명', type: 'text',   x: 400, y: 1461, font: 14 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 35,
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
    // jongno-foot-stamp.png은 5/9 추가 완료 (16KB, 488×488 RGBA) — @vite-ignore 제거
    _stampUrl = new URL('../assets/forms/stamps/jongno-foot-stamp.png', import.meta.url).href;
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
    // T-20260515: PDF → PNG 교체
    description: '진료비 세부산정내역 (별지 제1호)',
    print_preset: 'default',
  },
  // 별도 요청 서류 (T-20260506-foot-CHART-SIMPLE-REVAMP)
  prescription: {
    icon: '💊',
    color: 'bg-pink-50 border-pink-200',
    description: '처방전',
    print_preset: 'optional',
  },
  // T-20260515: 신규 2종
  rx_standard: {
    icon: '💊',
    color: 'bg-violet-50 border-violet-200',
    description: '처방전 (표준처방전, 약국보관용)',
    print_preset: 'optional',
  },
  bill_receipt: {
    icon: '🧾',
    color: 'bg-orange-50 border-orange-200',
    description: '진료비 계산서·영수증 (외래, 별지 제1호)',
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

// ─── 도수센터 서류 메타 ───

/**
 * 도수센터 서류 10종 메타데이터.
 * T-20260423-foot-DOSU-FORMS-SPEC Phase 0
 * 도수센터 오픈 후 렌더러 연동 시 FORM_META에 병합 예정.
 */
export const DOSU_FORM_META: Record<
  string,
  { icon: string; color: string; description: string; category: 'dosu-consent' | 'dosu-payment' | 'dosu-survey' | 'dosu-marketing' | 'dosu-chart' }
> = {
  // 치료 동의서
  dosu_consent: {
    icon: '📋',
    color: 'bg-teal-50 border-teal-200',
    description: '도수치료 동의 (서명 필요)',
    category: 'dosu-consent',
  },
  general_consent: {
    icon: '📋',
    color: 'bg-teal-50 border-teal-200',
    description: '일반 동의서 (서명 필요)',
    category: 'dosu-consent',
  },
  minor_consent: {
    icon: '👶',
    color: 'bg-orange-50 border-orange-300',
    description: '미성년자 — 환자+법정대리인 서명 2개 필요',
    category: 'dosu-consent',
  },
  // 결제
  nonbenefit_explain: {
    icon: '💰',
    color: 'bg-amber-50 border-amber-200',
    description: '비급여 설명확인서 (서명 필요)',
    category: 'dosu-payment',
  },
  // 문진
  growth_hormone_survey: {
    icon: '📊',
    color: 'bg-purple-50 border-purple-200',
    description: '성장호르몬 설문 (서명 불필요)',
    category: 'dosu-survey',
  },
  // 마케팅 (admin|manager 한정)
  model_contract_1: {
    icon: '📸',
    color: 'bg-pink-50 border-pink-200',
    description: '모델 계약서 1 (만료일 관리)',
    category: 'dosu-marketing',
  },
  model_contract_2: {
    icon: '📸',
    color: 'bg-pink-50 border-pink-200',
    description: '모델 계약서 2 (만료일 관리)',
    category: 'dosu-marketing',
  },
  experience_portrait: {
    icon: '🎬',
    color: 'bg-rose-50 border-rose-200',
    description: '체험단 초상권동의서 (만료일 관리)',
    category: 'dosu-marketing',
  },
  // 진료기록 (draft 편집 가능)
  initial_chart: {
    icon: '🗂️',
    color: 'bg-blue-50 border-blue-200',
    description: '초진차트 (세션 중 편집, 마감 시 잠금)',
    category: 'dosu-chart',
  },
  row_chart: {
    icon: '📈',
    color: 'bg-indigo-50 border-indigo-200',
    description: '줄차트 (세션 중 편집, 마감 시 잠금)',
    category: 'dosu-chart',
  },
};

/**
 * 미성년자 서명 슬롯을 포함하는 form_key 목록.
 * field_map에 signer_guardian 키가 있으면 guardian_info 입력 필수.
 */
export const MINOR_CONSENT_FORM_KEYS: ReadonlyArray<string> = ['minor_consent'];

/**
 * 마케팅 서류 form_key 목록 — expires_at 관리 대상.
 */
export const MARKETING_FORM_KEYS: ReadonlyArray<string> = [
  'model_contract_1',
  'model_contract_2',
  'experience_portrait',
];

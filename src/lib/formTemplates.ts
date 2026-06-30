// LOGIC-LOCK: L-006 — 서류출력 경로 통일. FALLBACK_TEMPLATES·AUTO_BIND_KEYS 단일 소스. 변경 시 현장 승인 필수

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
  /** T-20260514-foot-FORM-CLARITY-REWORK: 'html' 추가 — HTML/CSS 기반 디지털 양식 */
  template_format: 'jpg' | 'png' | 'pdf' | 'html';
  field_map: FieldMapEntry[];
  requires_signature: boolean;
  required_role: string;
  active: boolean;
  sort_order: number;
}

/**
 * T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT
 * 펜차트([보험차트])는 시술을 직접 수행하는 임상 role(therapist/staff)이 인쇄해야 하나,
 * DB form_templates.required_role('admin|manager|coordinator|director')에 미포함 →
 * DocumentPrintPanel 인쇄목록에서 해당 계정 로그인 시 누락(비활성 표시).
 * DB(required_role) 변경 없이 코드 측 표시 조건만 보강한다. pen_chart 한정이므로
 * 진료비영수증·보험청구 등 financial/insurance 양식 노출에는 영향 없음(회귀 차단).
 */
export const PENCHART_EXTRA_PRINT_ROLES = ['therapist', 'staff'] as const;

/**
 * T-20260608-foot-DOCPANEL-ALLROLE-PRINT
 * 정책 확정(김주연 총괄): 아래 5종 서류는 역할 제한 없이 모든 계정에서 인쇄 가능.
 * 현장 P1 — coordinator(데스크/코디) 계정으로 1번/2번 차트 진입 시 required_role
 * (admin|manager 등)에 미포함되어 서류 발행 패널에서 누락되던 문제 해소.
 * PENCHART 패턴(T-20260602) 동일 — DB form_templates.required_role 변경 없이
 * 코드측 canAccess 판정만 보강(db_changed=false). form_key 한정이므로 그 외
 * 양식(med_record 등)의 required_role 정책에는 영향 없음(회귀 차단).
 *   소견서 diag_opinion · 처방전 rx_standard · 진단서 diagnosis ·
 *   진료비납입증명서 payment_cert · 진료의뢰서 referral_letter
 *
 * ⚠️ AC-0 진단(2026-06-08, _diag_docpanel_allrole): 운영 DB form_templates 의
 * 활성 "처방전"은 form_key='rx_standard'(name_ko='처방전(표준처방전)') 이다.
 * fallback 키 'prescription' 은 DB 미존재 → 직전 보강(bef9a98)이 처방전만 누락,
 * coordinator 에게 계속 비활성 노출됨. 운영 실키 'rx_standard' 추가로 해소.
 * fallback 'prescription' 은 DB 빈 환경 방어용으로 유지(무해).
 * (소견서 보험청구용 diag_opinion_v2 는 명세 5종 범위 외 → 미포함, 회귀 차단.)
 */
export const ALL_ROLE_PRINT_FORM_KEYS = [
  'diag_opinion',
  'prescription',  // fallback 데이터 호환(DB 빈 환경)
  'rx_standard',   // 운영 DB 실제 처방전 form_key (AC-0 진단 근거)
  'diagnosis',
  'payment_cert',
  'referral_letter',
] as const;

/**
 * 인쇄목록 양식 접근 권한 판정 (DocumentPrintPanel canAccess 단일 소스).
 * 1) ALL_ROLE_PRINT_FORM_KEYS 5종은 role 무관 전체 허용(위 주석 참조).
 * 2) required_role 에 명시된 role 은 그대로 허용.
 * 3) pen_chart 양식에 한해 therapist/staff 추가 허용.
 */
export function canAccessFormTemplate(tpl: FormTemplate, userRole: string): boolean {
  if ((ALL_ROLE_PRINT_FORM_KEYS as readonly string[]).includes(tpl.form_key)) {
    return true;
  }
  const allowed = tpl.required_role?.split('|') ?? [];
  if (allowed.includes(userRole)) return true;
  if (tpl.form_key === 'pen_chart' && (PENCHART_EXTRA_PRINT_ROLES as readonly string[]).includes(userRole)) {
    return true;
  }
  return false;
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
// LOGIC-LOCK L-006: AUTO_BIND_KEYS — 전 경로 공통 자동 바인딩 키. 목록 변경 시 56종 E2E regression 통과 필수
export const AUTO_BIND_KEYS = [
  'patient_name',
  'patient_phone',
  'patient_rrn',
  'patient_address',
  'visit_date',
  'doctor_name',
  'total_amount',
  'insurance_covered',
  'non_covered',
  'clinic_name',
  'clinic_address',
  'issue_date',
  // T-20260516-foot-CLINIC-DOC-INFO: 원장·병원 상세 정보
  'doctor_license_no',
  'doctor_specialist_no',
  'doctor_seal_image',
  'clinic_business_no',
  'clinic_phone',
  'clinic_established_date',
  'business_reg_no',   // 하위 호환 alias
  // T-20260520-foot-PRINT-FORM-BIND: 확장 바인딩
  'patient_gender',
  'patient_birthdate',
  'patient_age',
  'record_no',
  'diag_code_1',
  'diag_name_1',
  'diag_code_2',
  'diag_name_2',
  'clinic_nhis_code',
  'clinic_fax',
  // T-20260522-foot-INS-DOC-PRINT: 보험서류 전용 바인딩
  'insurance_grade_label',
  'copay_rate',
  'special_treatment_code',
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
// LOGIC-LOCK L-006: FALLBACK_TEMPLATES — form_templates DB 미적용 시 단일 fallback 소스. 중복 정의 금지
export const FALLBACK_TEMPLATES: FormTemplate[] = [
  // ── 기본 서류 ──
  {
    id: 'fallback-bill-detail',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'bill_detail',
    name_ko: '진료비내역서',
    // T-20260514-foot-FORM-CLARITY-REWORK: PNG → HTML/CSS 디지털 양식
    template_path: '',
    template_format: 'html',
    // HTML 템플릿 변수 바인딩 (좌표 불필요 — x/y 미사용)
    field_map: [
      { key: 'patient_name',  label: '환자성명',   type: 'text',   x: 0, y: 0 },
      { key: 'record_no',     label: '등록번호',   type: 'text',   x: 0, y: 0 },
      { key: 'visit_date',    label: '진료일',     type: 'date',   x: 0, y: 0 },
      { key: 'issue_date',    label: '발행일',     type: 'date',   x: 0, y: 0 },
      { key: 'total_amount',  label: '합계금액',   type: 'amount', x: 0, y: 0 },
      { key: 'clinic_name',   label: '요양기관명', type: 'text',   x: 0, y: 0 },
      { key: 'doctor_name',   label: '대표자',     type: 'text',   x: 0, y: 0 },
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
    // T-20260514-foot-FORM-CLARITY-REWORK: PNG → HTML/CSS
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name', label: '환자성명', type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',  label: '주민번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_phone',label: '전화번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소', type: 'text',       x: 0, y: 0 },
      { key: 'diagnosis_ko', label: '소견',    type: 'multiline',  x: 0, y: 0 },
      { key: 'issue_date',   label: '발행일',  type: 'date',       x: 0, y: 0 },
      { key: 'clinic_name',  label: '의료기관',type: 'text',       x: 0, y: 0 },
      { key: 'clinic_address',label: '주소',   type: 'text',       x: 0, y: 0 },
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH: 전종 field_map 연결 — clinic_phone
      { key: 'clinic_phone', label: '전화 및 팩스', type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',  label: '의사성명',type: 'text',       x: 0, y: 0 },
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
    // T-20260514-foot-FORM-CLARITY-REWORK: PNG → HTML/CSS
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명',    type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민등록번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소',        type: 'text',      x: 0, y: 0 },
      { key: 'patient_phone',   label: '전화번호',    type: 'text',      x: 0, y: 0 },
      { key: 'diagnosis_ko',    label: '소견',        type: 'multiline', x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',      type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관',    type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',  label: '주소',        type: 'text',      x: 0, y: 0 },
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH: 전종 field_map 연결 — clinic_phone
      { key: 'clinic_phone',    label: '전화 및 팩스',type: 'text',      x: 0, y: 0 },
      { key: 'doctor_name',     label: '의사성명',    type: 'text',      x: 0, y: 0 },
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
    // T-20260514-foot-FORM-CLARITY-REWORK: PNG → HTML/CSS
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명', type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'visit_date',      label: '진료일',  type: 'date',      x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',  type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관',type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',  label: '주소',    type: 'text',      x: 0, y: 0 },
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH: 전종 field_map 연결 — clinic_phone
      { key: 'clinic_phone',    label: '전화 및 팩스', type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',     label: '의사성명',type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: 레거시 단일 진료확인서 비활성(forward-only,
    //   DB active=false 와 동일 상태). code/nocode 2폼으로 분리됨. DOCLIST_ORDER_10 화이트리스트에서도
    //   제거되어 패널 미노출(3중표시 방지). 기존 발행문서(form_submissions 10건) 참조·재출력은
    //   HTML_TEMPLATE_MAP.treat_confirm 보존으로 무손상.
    active: false,
    sort_order: 40,
  },
  {
    id: 'fallback-visit-confirm',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'visit_confirm',
    name_ko: '통원확인서',
    // T-20260514-foot-FORM-CLARITY-REWORK: PNG → HTML/CSS
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명', type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'visit_date',      label: '진료일',  type: 'date',      x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',  type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관',type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',  label: '주소',    type: 'text',      x: 0, y: 0 },
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH: 전종 field_map 연결 — clinic_phone
      { key: 'clinic_phone',    label: '전화 및 팩스', type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',     label: '의사성명',type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 42,
  },
  // ── T-20260515: 신규 2종 ──
  {
    id: 'fallback-rx-standard',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'rx_standard',
    name_ko: '처방전(표준처방전)',
    // T-20260515-foot-FORM-ONELINE-RX: HTML/CSS 전환 (template_path 불필요)
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name', label: '피보성명(환자성명)', type: 'text', x: 0, y: 0 },
      { key: 'patient_rrn',  label: '주민번호',           type: 'text', x: 0, y: 0 },
      { key: 'diagnosis_ko', label: '질병분류기호',       type: 'text', x: 0, y: 0 },
      { key: 'issue_date',   label: '교부일',             type: 'date', x: 0, y: 0 },
      { key: 'clinic_name',  label: '의료기관명칭',       type: 'text', x: 0, y: 0 },
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH: 전종 field_map 연결 — clinic_phone + clinic_fax
      { key: 'clinic_phone', label: '전화번호',           type: 'text', x: 0, y: 0 },
      { key: 'clinic_fax',   label: '팩스번호',           type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',  label: '처방의사성명',       type: 'text', x: 0, y: 0 },
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
    // T-20260517-foot-FORM-SCREENSHOT-FIX: HTML/CSS 전환 (스크린샷 PNG 제거)
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명',   type: 'text',   x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민번호',   type: 'text',   x: 0, y: 0 },
      { key: 'visit_date',      label: '진료일',     type: 'date',   x: 0, y: 0 },
      { key: 'clinic_name',     label: '요양기관명', type: 'text',   x: 0, y: 0 },
      { key: 'clinic_address',  label: '요양기관주소',type: 'text',  x: 0, y: 0 },
      { key: 'insurance_covered',label: '공단부담금', type: 'amount', x: 0, y: 0 },
      { key: 'non_covered',     label: '비급여',     type: 'amount', x: 0, y: 0 },
      { key: 'total_amount',    label: '총진료비',   type: 'amount', x: 0, y: 0 },
      { key: 'doctor_name',     label: '진료의사',   type: 'text',   x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',     type: 'date',   x: 0, y: 0 },
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
  // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: 진료확인서 2 발급폼 분리(html).
  //   code = 코드·진단명 포함(상병 테이블 렌더, diag 자동주입) / nocode = 불포함(상병 미렌더).
  //   field_map(수기입력 필드)은 두 폼 동일 — 상병(diag_*)은 service_charges 읽기 자동바인딩이라
  //   수기 필드가 아님. 두 폼의 차이는 HTML 템플릿(상병 테이블 유무)뿐(htmlFormTemplates.ts).
  {
    id: 'fallback-treat-confirm-code',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm_code',
    name_ko: '진료확인서(코드·진단명 포함)',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명', type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'visit_date',      label: '진료일',  type: 'date',      x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',  type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관',type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',  label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'clinic_phone',    label: '전화 및 팩스', type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',     label: '의사성명',type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 40,
  },
  {
    id: 'fallback-treat-confirm-nocode',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'treat_confirm_nocode',
    name_ko: '진료확인서(코드·진단명 불포함)',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명', type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address', label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'visit_date',      label: '진료일',  type: 'date',      x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',  type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관',type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',  label: '주소',    type: 'text',      x: 0, y: 0 },
      { key: 'clinic_phone',    label: '전화 및 팩스', type: 'text', x: 0, y: 0 },
      { key: 'doctor_name',     label: '의사성명',type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 41,
  },

  // ── T-20260514-foot-DOC-4FORM-IMPL: 신규 4종 ──

  {
    id: 'fallback-payment-cert',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'payment_cert',
    name_ko: '진료비 납입증명서(소득공제용)',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',    label: '환자성명',       type: 'text',   x: 0, y: 0 },
      { key: 'patient_rrn',     label: '주민등록번호',   type: 'text',   x: 0, y: 0 },
      { key: 'patient_address', label: '주소',           type: 'text',   x: 0, y: 0 },
      { key: 'record_no',       label: '등록번호',       type: 'text',   x: 0, y: 0 },
      { key: 'recipient',       label: '수신자',         type: 'text',   x: 0, y: 0 },
      { key: 'year',            label: '납입연도',       type: 'text',   x: 0, y: 0 },
      { key: 'annual_total',    label: '연간합계액',     type: 'amount', x: 0, y: 0 },
      { key: 'issue_date',      label: '발행일',         type: 'date',   x: 0, y: 0 },
      { key: 'clinic_name',     label: '의료기관명',     type: 'text',   x: 0, y: 0 },
      { key: 'clinic_address',  label: '사업자소재지',   type: 'text',   x: 0, y: 0 },
      { key: 'business_reg_no', label: '사업자등록번호', type: 'text',   x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager',
    active: true,
    sort_order: 85,
  },
  {
    id: 'fallback-referral-letter',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'referral_letter',
    name_ko: '진료의뢰서',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',        label: '환자성명',     type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',         label: '주민등록번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_phone',       label: '연락처',       type: 'text',      x: 0, y: 0 },
      { key: 'patient_gender',      label: '성별',         type: 'text',      x: 0, y: 0 },
      { key: 'patient_age',         label: '나이',         type: 'text',      x: 0, y: 0 },
      { key: 'patient_email',       label: 'E-mail',       type: 'text',      x: 0, y: 0 },
      { key: 'referral_year',       label: '의뢰연도',     type: 'text',      x: 0, y: 0 },
      { key: 'referral_month',      label: '의뢰월',       type: 'text',      x: 0, y: 0 },
      { key: 'referral_day',        label: '의뢰일',       type: 'text',      x: 0, y: 0 },
      { key: 'dept_name',           label: '진료과',       type: 'text',      x: 0, y: 0 },
      { key: 'referring_doctor',    label: '의뢰의사',     type: 'text',      x: 0, y: 0 },
      { key: 'diagnosis',           label: '진단명',       type: 'multiline', x: 0, y: 0 },
      { key: 'medical_history',     label: '병력및소견',   type: 'multiline', x: 0, y: 0 },
      { key: 'referral_content',    label: '의뢰내용',     type: 'multiline', x: 0, y: 0 },
      { key: 'referral_to_hospital',label: '의뢰병원',     type: 'text',      x: 0, y: 0 },
      { key: 'clinic_name',         label: '병원명',       type: 'text',      x: 0, y: 0 },
      { key: 'clinic_phone',        label: '전화/FAX',     type: 'text',      x: 0, y: 0 },
      { key: 'doctor_name',         label: '의사성명',     type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|director',
    active: true,
    sort_order: 90,
  },
  {
    id: 'fallback-medical-record-request',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'medical_record_request',
    name_ko: '의무기록사본발급신청서',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',      label: '환자성명',     type: 'text', x: 0, y: 0 },
      { key: 'patient_rrn',       label: '주민등록번호', type: 'text', x: 0, y: 0 },
      { key: 'patient_address',   label: '주소',         type: 'text', x: 0, y: 0 },
      { key: 'record_no',         label: '병록번호',     type: 'text', x: 0, y: 0 },
      { key: 'request_purpose',   label: '신청목적',     type: 'text', x: 0, y: 0 },
      { key: 'record_section',    label: '복사부문',     type: 'text', x: 0, y: 0 },
      { key: 'requester_relation',label: '신청인관계',   type: 'text', x: 0, y: 0 },
      { key: 'requester_name',    label: '신청인성명',   type: 'text', x: 0, y: 0 },
      { key: 'issue_date',        label: '신청일',       type: 'date', x: 0, y: 0 },
      { key: 'doctor_name',       label: '주치의',       type: 'text', x: 0, y: 0 },
      { key: 'clinic_name',       label: '의료기관명',   type: 'text', x: 0, y: 0 },
    ],
    requires_signature: true,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 95,
  },
  {
    // AC-6: diag_opinion_v2 별도 등록 (기존 diag_opinion 교체 X)
    // 사유: 보험청구용 소견서 — 기존과 목적·레이아웃 상이, 현장 교체 시 혼란 우려
    id: 'fallback-diag-opinion-v2',
    clinic_id: FOOT_CLINIC_ID,
    category: 'foot-service',
    form_key: 'diag_opinion_v2',
    name_ko: '소견서(보험청구용)',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',       label: '환자성명',     type: 'text',      x: 0, y: 0 },
      { key: 'patient_rrn',        label: '주민등록번호', type: 'text',      x: 0, y: 0 },
      { key: 'patient_address',    label: '주소',         type: 'text',      x: 0, y: 0 },
      // T-20260526-INS-FIELD-BIND-SPEC FIX: disease_name → diag_code_1/diag_code_2
      // DIAG_OPINION_V2_HTML 병명 셀이 {{diag_code_1}}<br>{{diag_code_2}} 로 변경됨에 따라 field_map 동기화
      { key: 'diag_code_1',        label: '상병코드(주)', type: 'text',      x: 0, y: 0 },
      { key: 'diag_code_2',        label: '상병코드(부)', type: 'text',      x: 0, y: 0 },
      { key: 'inpatient_start',    label: '입원시작일',   type: 'date',      x: 0, y: 0 },
      { key: 'inpatient_end',      label: '입원종료일',   type: 'date',      x: 0, y: 0 },
      { key: 'outpatient_start',   label: '외래시작일',   type: 'date',      x: 0, y: 0 },
      { key: 'outpatient_end',     label: '외래종료일',   type: 'date',      x: 0, y: 0 },
      { key: 'assistive_device',   label: '보조기명',     type: 'text',      x: 0, y: 0 },
      { key: 'classification_code',label: '분류번호',     type: 'text',      x: 0, y: 0 },
      { key: 'device_start',       label: '사용기간시작', type: 'date',      x: 0, y: 0 },
      { key: 'device_end',         label: '사용기간종료', type: 'date',      x: 0, y: 0 },
      { key: 'onset_date',         label: '발병일',       type: 'date',      x: 0, y: 0 },
      { key: 'submit_to',          label: '제출처',       type: 'text',      x: 0, y: 0 },
      { key: 'opinion_text',       label: '소견',         type: 'multiline', x: 0, y: 0 },
      { key: 'remarks',            label: '참고사항',     type: 'multiline', x: 0, y: 0 },
      { key: 'issue_date',         label: '발행일',       type: 'date',      x: 0, y: 0 },
      { key: 'clinic_name',        label: '의료기관명',   type: 'text',      x: 0, y: 0 },
      { key: 'clinic_address',     label: '병원주소',     type: 'text',      x: 0, y: 0 },
      { key: 'clinic_phone',       label: '전화번호',     type: 'text',      x: 0, y: 0 },
      { key: 'doctor_name',        label: '담당의사',     type: 'text',      x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|director',
    active: true,
    sort_order: 100,
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
  // T-20260514-foot-DOC-4FORM-IMPL: 신규 4종
  payment_cert: {
    icon: '💴',
    color: 'bg-yellow-50 border-yellow-300',
    description: '소득공제용 — 월별 외래/입원 납입현황 (소득세법 §52)',
    print_preset: 'optional',
  },
  referral_letter: {
    icon: '✉️',
    color: 'bg-sky-50 border-sky-200',
    description: '타원 진료의뢰 — 진단명·병력·의뢰내용',
    print_preset: 'optional',
  },
  medical_record_request: {
    icon: '📂',
    color: 'bg-neutral-50 border-neutral-300',
    description: '의무기록 열람·복사 신청서 (의료법 §21)',
    print_preset: 'optional',
  },
  diag_opinion_v2: {
    icon: '🩺',
    color: 'bg-purple-50 border-purple-200',
    description: '소견서(보험청구용) — 보조기·간병기간·분류번호 포함',
    print_preset: 'optional',
  },
  // T-20260522-foot-INS-DOC-PRINT: 보험서류 카테고리
  ins_claim_form: {
    icon: '🏥',
    color: 'bg-blue-50 border-blue-200',
    description: '실손/단체/자동차보험 청구 공통서식 — 건보 등급·부담률·산정특례 자동 바인딩',
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

// ─── 보험서류 (T-20260522-foot-INS-DOC-PRINT) ───

/**
 * 보험청구용 서류 종류 (현장 확인 기준 v1.0)
 *
 * 확정 리스트 (2026-05-22):
 *   1. 보험청구서 (ins_claim_form)     — 실손/단체/자동차보험 공통 청구서
 *
 * 현장 후보 목록 (기존 foot-service 서류 중 보험청구 겸용):
 *   - bill_detail            진료비내역서       (foot-service, 기본 서류)
 *   - bill_receipt           진료비 계산서·영수증 (foot-service)
 *   - diag_opinion_v2        소견서(보험청구용)  (foot-service)
 *   - diagnosis              진단서             (foot-service)
 *   - treat_confirm_code     진료확인서(코드포함) (foot-service)
 *   - payment_cert           진료비납입증명서     (foot-service)
 *
 * ⚠️ 위 기존 서류는 별도요청 서류에 이미 존재 → 중복 등록 불필요.
 *    신규 `insurance` 카테고리는 보험청구 전용 양식만 포함.
 */

/**
 * 보험서류 fallback 템플릿 (DB 미세팅 시 사용)
 *
 * T-20260525-foot-INS-FIELD-BIND: field_map 완전성 보장
 *   AC-1: diag_code_1/diag_name_1/diag_code_2/diag_name_2 — DOC-CODE-INSERT 동일 메커니즘
 *   AC-2: patient_rrn(주민등록번호) + patient_address(주소) 명시 포함
 *
 * DB 동기화는 20260525060000_ins_claim_form_field_bind_fix.sql 참조.
 */
export const INSURANCE_FALLBACK_TEMPLATES: FormTemplate[] = [
  {
    id: 'fallback-ins-claim-form',
    clinic_id: FOOT_CLINIC_ID,
    category: 'insurance',
    form_key: 'ins_claim_form',
    name_ko: '보험청구서',
    template_path: '',
    template_format: 'html',
    field_map: [
      { key: 'patient_name',            label: '환자성명',       type: 'text',   x: 0, y: 0 },
      { key: 'patient_rrn',             label: '주민등록번호',   type: 'text',   x: 0, y: 0 },
      { key: 'patient_phone',           label: '연락처',         type: 'text',   x: 0, y: 0 },
      { key: 'patient_address',         label: '주소',           type: 'text',   x: 0, y: 0 },
      { key: 'insurance_grade_label',   label: '건보 등급',      type: 'text',   x: 0, y: 0 },
      { key: 'copay_rate',              label: '본인부담률',     type: 'text',   x: 0, y: 0 },
      { key: 'special_treatment_code',  label: '산정특례코드',   type: 'text',   x: 0, y: 0 },
      { key: 'diag_code_1',             label: '주상병코드',     type: 'text',   x: 0, y: 0 },
      { key: 'diag_name_1',             label: '주상병명',       type: 'text',   x: 0, y: 0 },
      { key: 'diag_code_2',             label: '부상병코드',     type: 'text',   x: 0, y: 0 },
      { key: 'diag_name_2',             label: '부상병명',       type: 'text',   x: 0, y: 0 },
      { key: 'visit_date',              label: '진료일',         type: 'date',   x: 0, y: 0 },
      { key: 'total_amount',            label: '진료비합계',     type: 'amount', x: 0, y: 0 },
      { key: 'insurance_covered',       label: '공단부담금',     type: 'amount', x: 0, y: 0 },
      { key: 'copayment',               label: '본인부담금',     type: 'amount', x: 0, y: 0 },
      { key: 'non_covered',             label: '비급여',         type: 'amount', x: 0, y: 0 },
      { key: 'issue_date',              label: '발행일',         type: 'date',   x: 0, y: 0 },
      { key: 'clinic_name',             label: '의료기관명',     type: 'text',   x: 0, y: 0 },
      { key: 'clinic_phone',            label: '전화번호',       type: 'text',   x: 0, y: 0 },
      { key: 'doctor_name',             label: '담당의사',       type: 'text',   x: 0, y: 0 },
    ],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active: true,
    sort_order: 10,
  },
];

/** insurance 카테고리 form_key 목록 */
export const INSURANCE_FORM_KEYS: ReadonlyArray<string> = ['ins_claim_form'];

// ─── 결제미니창 서류발행 탭 비노출 양식 (T-20260616-foot-DOCPANEL-PENCHART-INSCLAIM-HIDE) ───

/**
 * 결제미니창(PaymentMiniWindow) > 서류발행 탭(DocumentPrintPanel) 목록에서만 숨기는 form_key.
 *
 * 펜차트 계열 4종 + 보험청구서는 임상 작성용 / 보험청구 전용 양식이라, 수납 미니창에서
 * 환자 발행 서류를 고르는 목록에 섞여 현장 혼동을 유발 → 이 탭 목록 노출만 제거한다.
 *
 * ⚠️ 양식 자체 삭제 아님(db_change 없음). 본 목록은 DocumentPrintPanel 분류 단계의 '표시 필터'.
 *    - 펜차트 4종(pen_chart / health_questionnaire_general / health_questionnaire_senior /
 *      refund_consent)은 차트탭(PenChartTab)의 펜차트 draw 작성·발행 경로에서 그대로 사용.
 *    - 보험청구서(ins_claim_form, category='insurance')는 별도 보험 경로에서 그대로 사용.
 *    → 다른 surface·발행 로직·발행 이력 라벨 무영향. AC-3(원경로 보존) 자동 충족.
 *
 * ※ diag_opinion_v2(소견서-보험청구용)는 명세상 제거 대상 아님 → 미포함(AC-4: 보험청구서만 제거).
 */
export const DOC_PANEL_HIDDEN_FORM_KEYS: ReadonlyArray<string> = [
  'pen_chart',
  'health_questionnaire_general',
  'health_questionnaire_senior',
  'refund_consent',
  'ins_claim_form',
];

// ─── 서류 출력 목록 확정 10종 SSOT (T-20260620-foot-DOCLIST-ORDER-10) ───

/**
 * 결제미니창(PaymentMiniWindow) + 1/2번 차트 서류출력(DocumentPrintPanel) 두 화면이 공유하는
 * 서류 출력 목록의 **확정 진열 순서 + 표시 집합(SSOT)**.
 *
 * 김주연 총괄 확정(v2, 2026-06-20): 두 화면 서류 출력 목록은 아래 10종**만**, 이 순서대로 표시.
 * - 배열 인덱스 = 위→아래 진열 순서.
 * - 이 배열에 없는 기존 서류 타입(payment_cert/diag_opinion_v2/opinion_doc 등)은 **목록 비표시**.
 *   → 제거 = FE 목록 필터일 뿐, DB row·서류 생성/발행 RPC·published 트리거 미접촉(db_change=false).
 *   → 이미 발행된 서류 데이터·발행 이력은 보존(목록에서만 안 보임).
 *
 * 운영 DB form_templates 실측(2026-06-20) 기준 form_key 매핑 확정:
 *   1.진료비영수증=bill_receipt  2.진료비세부내역서=bill_detail  3.KOH균검사결과지=koh_result
 *   4.소견서=diag_opinion  5.진단서=diagnosis  6.진료확인서=treat_confirm
 *   7.진료의뢰서=referral_letter  8.통원확인서=visit_confirm  9.진료기록사본=medical_record_request
 *   10.처방전=rx_standard
 */
export const DOCLIST_ORDER_10: ReadonlyArray<string> = [
  'bill_receipt',           // 1. 진료비영수증
  'bill_detail',            // 2. 진료비세부내역서
  'koh_result',             // 3. KOH균검사결과지
  'diag_opinion',           // 4. 소견서
  'diagnosis',              // 5. 진단서
  // 6. 진료확인서 — T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: 단일 'treat_confirm' →
  //    2 발급폼 분리. code(코드·진단명 포함, 10,000) / nocode(불포함, 3,000) 두 버튼 노출.
  //    레거시 'treat_confirm' 은 화이트리스트에서 제거(+ DB active=false) → 3중표시 방지.
  //    동일 서류종류(진료확인서)의 표시변이 → doc-serial prefix 둘 다 VC 공유(docSerial.ts).
  'treat_confirm_code',     // 6a. 진료확인서(코드·진단명 포함)
  'treat_confirm_nocode',   // 6b. 진료확인서(코드·진단명 불포함)
  'referral_letter',        // 7. 진료의뢰서
  'visit_confirm',          // 8. 통원확인서
  'medical_record_request', // 9. 진료기록사본
  'rx_standard',            // 10. 처방전
];

/**
 * T-20260621-foot-DOCLABEL-RENAME-11: 서류 출력 목록 **표시 라벨(name_ko) override**.
 * 김주연 총괄 확정 — 두 화면(결제미니창·서류출력)의 목록 라벨 2건만 표시명을 교체한다.
 *   bill_detail: 진료비내역서   → 진료비세부내역서
 *   koh_result:  검사결과 보고서 → KOH균검사결과지
 * 표시 라벨만 바꾼다. form_key(식별자)·필터/정렬·발행/바인딩·template_type·published 트리거 전부 불변.
 * - DB form_templates.name_ko 원본은 미접촉(FE 표시 override). 인쇄 출력물 본문 제목(법정 별지 제1호
 *   "진료비 세부산정내역", KOH 인쇄 헤더 `<h1>검사결과 보고서</h1>` = doctor 영역 공유 surface)은 본 티켓
 *   범위 밖이라 미접촉 — 여기서는 두 화면 목록 라벨에 한정된다.
 * - override 적용 지점을 공유 함수 orderDocList 한 곳으로 고정 → 두 화면 자동 동일, 의료 게이트 surface 무영향
 *   (orderDocList는 PaymentMiniWindow·DocumentPrintPanel 두 화면에서만 호출).
 */
export const DOCLIST_LABEL_OVERRIDE: Readonly<Record<string, string>> = {
  bill_detail: '진료비세부내역서',
  koh_result: 'KOH균검사결과지',
};

/**
 * 서류 템플릿 배열을 DOCLIST_ORDER_10 기준으로 **필터(10종만) + 정렬(확정 순서) + 표시 라벨 override** 한다.
 * 두 화면(PaymentMiniWindow·DocumentPrintPanel)이 동일 결과를 얻도록 단일 함수로 공유.
 * - 10종 외 form_key는 제외(표시 집합 축소).
 * - 발행/바인딩 로직은 호출부에서 원본 templates를 그대로 사용하므로 무영향(표시 진열만 변경).
 * - name_ko 필드가 있는 항목에 한해 DOCLIST_LABEL_OVERRIDE 로 표시명만 치환(form_key 불변).
 */
export function orderDocList<T extends { form_key: string }>(tpls: T[]): T[] {
  return tpls
    .filter((t) => DOCLIST_ORDER_10.includes(t.form_key))
    .sort(
      (a, b) =>
        DOCLIST_ORDER_10.indexOf(a.form_key) - DOCLIST_ORDER_10.indexOf(b.form_key),
    )
    .map((t) => {
      const override = DOCLIST_LABEL_OVERRIDE[t.form_key];
      return override && 'name_ko' in t ? ({ ...t, name_ko: override } as T) : t;
    });
}

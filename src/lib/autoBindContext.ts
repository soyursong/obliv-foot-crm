/**
 * 서류 자동 바인딩 컨텍스트 — DocumentPrintPanel + PaymentMiniWindow 공유 유틸
 *
 * T-20260521-foot-DOC-PRINT-UNIFY PUSH:
 *   경로 4 (PaymentMiniWindow Zone 3)가 경로 1 (DocumentPrintPanel)과
 *   완전 동일한 바인딩(양식·레이아웃)을 사용하도록 공통 추출.
 *   경로 4 = 현장 사용 빈도 1순위 메인 출력 경로 (김주연 총괄 확인).
 *
 * 이전에는 DocumentPrintPanel.tsx 내 private 함수로만 존재.
 * PaymentMiniWindow의 loadMiniAutoBindValues(7필드 미니 버전)를 이 함수로 교체함.
 */

import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { formatAmount } from '@/lib/format';
import { formatPhone } from '@/lib/format';
import { fetchDutyDoctors } from '@/hooks/useDutyRoster';
import type { CheckIn } from '@/lib/types';
import {
  INSURANCE_GRADE_LABELS,
  getBaseCopayRate,
  type InsuranceGrade,
} from '@/lib/insurance';

// ─── 타입 ───────────────────────────────────────────────────────────────────

export interface ClinicDoctorInfo {
  name: string;
  license_no: string | null;
  specialist_no: string | null;
  seal_image_url: string | null;
}

/** T-20260520-foot-PRINT-FORM-BIND: 고객 확장 필드 포함 */
export interface CustomerBindInfo {
  name: string;
  phone: string;
  rrn?: string | null;           // 복호화된 주민번호 (rrn_decrypt RPC)
  address?: string | null;
  address_detail?: string | null;
  birth_date?: string | null;    // YYMMDD 텍스트 (예: 900515)
  chart_number?: string | null;  // 차트번호
  gender?: 'M' | 'F' | null;
}

/** T-20260522-foot-INS-DOC-PRINT: 보험서류 바인딩용 건보 정보 */
export interface InsuranceBindInfo {
  /** 건보 등급 라벨 (예: "일반 (30%)") */
  gradeLabel: string;
  /** 본인부담률 텍스트 (예: "30%") */
  copayRateText: string;
  /** 산정특례코드 — 해당 없으면 빈 문자열 */
  specialTreatmentCode: string;
}

export interface AutoBindContext {
  customer?: CustomerBindInfo | null;
  checkIn: CheckIn;
  payments?: { total: number; insurance_covered: number; copayment?: number; non_covered: number };
  /** T-20260520-foot-PRINT-FORM-BIND: nhis_code, fax 추가 */
  clinic?: {
    name: string;
    address: string;
    phone?: string | null;
    fax?: string | null;
    nhis_code?: string | null;
    business_no?: string | null;
    established_date?: string | null;
  } | null;
  doctor?: string | null;
  /** T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 매칭된 원장 상세 정보 */
  clinicDoctor?: ClinicDoctorInfo | null;
  /** T-20260520-foot-PRINT-FORM-BIND: medical_charts에서 읽은 진단 정보 */
  /** T-20260526-foot-DOC-DIAG-TRUNC: code3/4 확장 — 최대 4건 */
  diagCodes?: {
    code1?: string;
    name1?: string;
    code2?: string;
    name2?: string;
    code3?: string;
    name3?: string;
    code4?: string;
    name4?: string;
  } | null;
  /** T-20260522-foot-INS-DOC-PRINT: 건보 등급·부담률·산정특례 */
  insuranceInfo?: InsuranceBindInfo | null;
}

// ─── 헬퍼 함수 ───────────────────────────────────────────────────────────────

/**
 * birth_date(YYMMDD) → "YYYY년 MM월 DD일" 형식
 * "900515" → "1990년 05월 15일"
 * 2000년대는 "00" ~ "09" 가 아닌 년도 추정이 필요하므로:
 *   앞 두자리 > 현재 년도 끝 두자리면 1900s, 아니면 2000s
 */
export function formatBirthDate(yymmdd: string | null | undefined): string {
  if (!yymmdd || yymmdd.length < 6) return yymmdd ?? '';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY ? 1900 + yy : 2000 + yy;
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `${fullYear}년 ${mm}월 ${dd}일`;
}

/**
 * 주민번호 하이픈 삽입
 * "1234561234567" → "123456-1234567"
 * 이미 하이픈 있으면 그대로 반환. 13자리 아닌 경우 그대로 반환.
 * T-20260526-foot-DOC-FORM-REVISE AC-C1
 */
export function formatRrn(rrn: string | null | undefined): string {
  if (!rrn) return '';
  const clean = rrn.replace(/-/g, '');
  if (clean.length === 13) return `${clean.slice(0, 6)}-${clean.slice(6)}`;
  return rrn; // 13자리 아닌 경우 그대로
}

/**
 * birth_date(YYMMDD) → 만 나이 계산
 */
export function calcAge(yymmdd: string | null | undefined): string {
  if (!yymmdd || yymmdd.length < 6) return '';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY ? 1900 + yy : 2000 + yy;
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1;
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const birth = new Date(fullYear, mm, dd);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age--;
  return age >= 0 ? String(age) : '';
}

/**
 * gender 'M'/'F' → 체크박스 형태 문자열
 * (DIAG_OPINION_HTML {{patient_gender}} 바인딩용)
 */
export function formatGenderCheckbox(gender: 'M' | 'F' | null | undefined): string {
  if (gender === 'F') return '☑ 여  ☐ 남';
  if (gender === 'M') return '☐ 여  ☑ 남';
  return '☐ 여  ☐ 남';
}

/**
 * medical_charts.diagnosis 텍스트에서 ICD 코드 분리 시도.
 * 예: "L60.0 내향성 발톱" → { code: "L60.0", name: "내향성 발톱" }
 * 추출 실패 시: { code: "", name: 원본 텍스트 }
 */
export function parseIcdFromText(text: string | null | undefined): { code: string; name: string } {
  if (!text) return { code: '', name: '' };
  const match = text.match(/^([A-Z][0-9]{2,3}(?:\.[0-9])?)\s+(.+)$/);
  if (match) return { code: match[1], name: match[2].trim() };
  return { code: '', name: text.trim() };
}

export function buildAutoBindValues(ctx: AutoBindContext): Record<string, string> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const visitDate = ctx.checkIn.checked_in_at
    ? format(new Date(ctx.checkIn.checked_in_at), 'yyyy-MM-dd')
    : today;

  // T-20260520-foot-PRINT-FORM-BIND: 주소 조합 (address + address_detail)
  const addrParts = [ctx.customer?.address, ctx.customer?.address_detail].filter(Boolean);
  const fullAddress = addrParts.join(' ');

  // T-20260520-foot-PRINT-FORM-BIND: 주민번호 마스킹 없이 그대로 (서류 출력용)
  // T-20260526-foot-DOC-FORM-REVISE AC-C1: 하이픈 삽입 (123456-1234567)
  const patientRrn = formatRrn(ctx.customer?.rrn);

  // T-20260520-foot-PRINT-FORM-BIND: 전화/팩스 조합 (clinic)
  const clinicPhoneFax = [
    ctx.clinic?.phone ? formatPhone(ctx.clinic.phone) : '',
    ctx.clinic?.fax ? 'FAX ' + formatPhone(ctx.clinic.fax) : '',
  ].filter(Boolean).join(' / ');

  return {
    patient_name: ctx.customer?.name ?? ctx.checkIn.customer_name ?? '',
    patient_phone: formatPhone(ctx.customer?.phone ?? ctx.checkIn.customer_phone),
    patient_rrn: patientRrn,
    patient_address: fullAddress,
    // T-20260520-foot-PRINT-FORM-BIND: 신규 바인딩 필드
    patient_gender: formatGenderCheckbox(ctx.customer?.gender),
    patient_birthdate: formatBirthDate(ctx.customer?.birth_date),
    patient_age: calcAge(ctx.customer?.birth_date),
    visit_date: visitDate,
    doctor_name: ctx.doctor ?? '',
    total_amount: ctx.payments ? formatAmount(ctx.payments.total) : '',
    // 진료비계산서 field_map (T-20260504-foot-INSURANCE-COPAYMENT)
    insurance_covered: ctx.payments ? formatAmount(ctx.payments.insurance_covered) : '',
    copayment: ctx.payments ? formatAmount(ctx.payments.copayment ?? 0) : '',
    non_covered: ctx.payments ? formatAmount(ctx.payments.non_covered) : '',
    clinic_name: ctx.clinic?.name ?? '오블리브 풋센터 종로',
    clinic_address: ctx.clinic?.address ?? '',
    issue_date: today,
    // T-20260516-foot-CLINIC-DOC-INFO: 원장·병원 상세 정보
    doctor_license_no: ctx.clinicDoctor?.license_no ?? '',
    doctor_specialist_no: ctx.clinicDoctor?.specialist_no ?? '',
    doctor_seal_image: ctx.clinicDoctor?.seal_image_url ?? '',
    clinic_business_no: ctx.clinic?.business_no ?? '',
    clinic_phone: clinicPhoneFax || (ctx.clinic?.phone ?? ''),
    clinic_established_date: ctx.clinic?.established_date ?? '',
    // T-20260520-foot-PRINT-FORM-BIND: 요양기관번호 + 팩스
    clinic_nhis_code: ctx.clinic?.nhis_code ?? '',
    clinic_code: ctx.clinic?.nhis_code ?? '',    // rx_standard {{clinic_code}} alias
    clinic_fax: ctx.clinic?.fax ? formatPhone(ctx.clinic.fax) : '',
    // T-20260520-foot-PRINT-FORM-BIND: 차트번호 (record_no fallback)
    record_no: ctx.customer?.chart_number ?? ctx.checkIn.customer_id?.slice(0, 8) ?? '',
    // T-20260520-foot-PRINT-FORM-BIND: 진단 코드·명칭
    // T-20260526-foot-DOC-DIAG-TRUNC: code3/4 추가 + 행 가시성 플래그
    diag_code_1: ctx.diagCodes?.code1 ?? '',
    diag_name_1: ctx.diagCodes?.name1 ?? '',
    diag_code_2: ctx.diagCodes?.code2 ?? '',
    diag_name_2: ctx.diagCodes?.name2 ?? '',
    diag_code_3: ctx.diagCodes?.code3 ?? '',
    diag_name_3: ctx.diagCodes?.name3 ?? '',
    diag_code_4: ctx.diagCodes?.code4 ?? '',
    diag_name_4: ctx.diagCodes?.name4 ?? '',
    diag_row_3_style: ctx.diagCodes?.code3 ? '' : 'display:none',
    diag_row_4_style: ctx.diagCodes?.code4 ? '' : 'display:none',
    diag_extra_codes_html: [ctx.diagCodes?.code3, ctx.diagCodes?.code4]
      .filter(Boolean).map((c) => `<br>${c}`).join(''),
    // 하위 호환 alias
    business_reg_no: ctx.clinic?.business_no ?? '',
    // T-20260522-foot-INS-DOC-PRINT: 건보 등급·부담률·산정특례 바인딩
    insurance_grade_label: ctx.insuranceInfo?.gradeLabel ?? '',
    copay_rate:            ctx.insuranceInfo?.copayRateText ?? '',
    special_treatment_code: ctx.insuranceInfo?.specialTreatmentCode ?? '',
    // T-20260526-foot-DOC-FORM-REVISE AC-C1: 주민번호 분리 (진료의뢰서 rrn_front/rrn_back)
    rrn_front: patientRrn.includes('-') ? patientRrn.split('-')[0] : patientRrn.slice(0, 6),
    rrn_back:  patientRrn.includes('-') ? (patientRrn.split('-')[1] ?? '') : patientRrn.slice(6),
    // T-20260526-foot-DOC-FORM-REVISE AC#2: 치료기간 일수 (기본 1일, 외래 단일 방문)
    visit_days: '1',
    // T-20260526-foot-DOC-FORM-REVISE AC#5: 진료의뢰서 4필드 자동 바인딩
    referral_year:    format(new Date(), 'yyyy'),
    referral_month:   format(new Date(), 'MM'),
    referral_day:     format(new Date(), 'dd'),
    dept_name:        '족부의학과',
    referring_doctor: ctx.doctor ?? '',
    // T-20260526-foot-DOC-FORM-REVISE AC#7: 납입증명서 연도 자동 바인딩
    year: format(new Date(), 'yyyy'),
    // T-20260526-foot-DOC-FORM-7FIX AC-7⑤: 납입증명서 "본 진료비는 {{year}}년 {{month}}월까지" 날짜 자동기입
    month: format(new Date(), 'MM'),
    // T-20260526-foot-DOC-FORM-REVISE AC-C2: 의사 성명 근방 도장 HTML (직인 이미지 or "(인)" fallback)
    doctor_seal_html: ctx.clinicDoctor?.seal_image_url
      ? `<img src="${ctx.clinicDoctor.seal_image_url}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`
      : '(인)',
  };
}

/**
 * DB에서 자동 바인딩 데이터를 일괄 로드
 *
 * 경로 1 (DocumentPrintPanel) + 경로 4 (PaymentMiniWindow) 공용.
 *
 * @param doctorNameOverride — 듀티 로스터에서 미리 결정된 원장님 이름.
 *   undefined이면 duty_roster 조회 후 fallback(최초 활성 director) 사용.
 *   '' (빈 문자열)이면 복수 근무로 아직 미선택 — doctor_name 빈 채로 반환.
 * @param clinicDoctorId — T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 선택된 의사 ID.
 *   undefined이면 doctor_name으로 이름 매칭, 그래도 없으면 default 또는 첫 번째.
 */
export async function loadAutoBindContext(
  checkIn: CheckIn,
  doctorNameOverride?: string,
  clinicDoctorId?: string,
): Promise<Record<string, string>> {
  // T-20260520-foot-PRINT-FORM-BIND: 고객 정보 확장 (rrn/address/birth_date/gender/chart_number)
  // T-20260522-foot-INS-DOC-PRINT: insurance_grade 추가 로드
  let customer: CustomerBindInfo | null = null;
  let customerInsuranceGrade: InsuranceGrade | null = null;
  if (checkIn.customer_id) {
    const [custRes, rrnRes] = await Promise.all([
      supabase
        .from('customers')
        .select('name, phone, address, address_detail, birth_date, chart_number, gender, insurance_grade')
        .eq('id', checkIn.customer_id)
        .maybeSingle(),
      // rrn_decrypt RPC — 주민번호 복호화 (암호화된 컬럼 직접 접근 불가)
      supabase.rpc('rrn_decrypt', { customer_uuid: checkIn.customer_id }),
    ]);
    if (custRes.data) {
      customer = {
        ...custRes.data,
        rrn: (rrnRes.data as string | null) ?? null,
      };
      customerInsuranceGrade = (custRes.data.insurance_grade as InsuranceGrade | null) ?? null;
    }
  }

  // 결제 정보
  const { data: payData } = await supabase
    .from('payments')
    .select('amount, payment_type')
    .eq('check_in_id', checkIn.id);

  const payTotal = (payData ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);

  // 보험 영수증
  const { data: insData } = await supabase
    .from('insurance_receipts')
    .select('insurance_covered, non_covered')
    .eq('check_in_id', checkIn.id);

  const insCoveredFromReceipts = (insData ?? []).reduce((s, r) => s + (r.insurance_covered ?? 0), 0);
  const nonCoveredFromReceipts = (insData ?? []).reduce((s, r) => s + (r.non_covered ?? 0), 0);

  // service_charges 합산 (T-20260504-foot-INSURANCE-COPAYMENT)
  const { data: chargesData } = await supabase
    .from('service_charges')
    .select('insurance_covered_amount, copayment_amount, base_amount, is_insurance_covered')
    .eq('check_in_id', checkIn.id);

  const charges = chargesData ?? [];
  const hasCharges = charges.length > 0;
  const chargesCovered = charges.reduce((s, r) => s + (r.insurance_covered_amount ?? 0), 0);
  const chargesCopay = charges.reduce((s, r) => s + (r.copayment_amount ?? 0), 0);
  const chargesNonCovered = charges
    .filter((r) => !r.is_insurance_covered)
    .reduce((s, r) => s + (r.base_amount ?? 0), 0);

  const insCovered = hasCharges ? chargesCovered : insCoveredFromReceipts;
  const copayment = hasCharges ? chargesCopay : 0;
  const nonCovered = hasCharges ? chargesNonCovered : nonCoveredFromReceipts;

  // T-20260520-foot-PRINT-FORM-BIND: 클리닉 정보 확장 (nhis_code, fax 추가)
  const { data: clinicData } = await supabase
    .from('clinics')
    .select('name, address, phone, fax, nhis_code, business_no, established_date')
    .eq('id', checkIn.clinic_id)
    .maybeSingle();

  // T-20260520-foot-PRINT-FORM-BIND: medical_charts에서 진단명·코드 조회 (최신 1건)
  let diagCodes: AutoBindContext['diagCodes'] = null;
  if (checkIn.customer_id) {
    const visitDate = checkIn.checked_in_at
      ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd');
    const { data: chartRow } = await supabase
      .from('medical_charts')
      .select('diagnosis')
      .eq('customer_id', checkIn.customer_id)
      .eq('clinic_id', checkIn.clinic_id)
      .eq('visit_date', visitDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (chartRow?.diagnosis) {
      const parsed = parseIcdFromText(chartRow.diagnosis);
      diagCodes = { code1: parsed.code, name1: parsed.name };
    }
  }

  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 전체 로드
  const { data: clinicDoctorsData } = await supabase
    .from('clinic_doctors')
    .select('id, name, license_no, specialist_no, seal_image_url, is_default')
    .eq('clinic_id', checkIn.clinic_id)
    .eq('active', true)
    .order('sort_order')
    .order('created_at');

  type ClinicDoctorRow = { id: string; name: string; license_no: string | null; specialist_no: string | null; seal_image_url: string | null; is_default: boolean };
  const clinicDoctors = (clinicDoctorsData ?? []) as ClinicDoctorRow[];

  // ── 진료 의사 결정 (T-20260502-foot-DUTY-ROSTER) ──
  // 1순위: 외부에서 전달된 이름 (이미 결정됨)
  // 2순위: 당일 duty_roster 1명이면 자동
  // 3순위: 첫 번째 활성 director (fallback)
  let doctorName: string | null = null;

  if (doctorNameOverride !== undefined) {
    // 빈 문자열('')이면 미선택 상태 유지, 비어있지 않으면 사용
    doctorName = doctorNameOverride || null;
  } else {
    // duty_roster 조회
    const visitDateStr = checkIn.checked_in_at
      ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd');

    const dutyDocs = await fetchDutyDoctors(checkIn.clinic_id, visitDateStr);

    if (dutyDocs.length === 1) {
      doctorName = dutyDocs[0].name;
    } else if (dutyDocs.length === 0) {
      // Fallback: 첫 번째 활성 director
      const { data: fallbackStaff } = await supabase
        .from('staff')
        .select('name')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('role', 'director')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      doctorName = fallbackStaff?.name ?? null;
    }
    // dutyDocs.length > 1: doctorName = null → UI에서 선택 (DocPrintPanel만 해당)
  }

  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 원장 상세 결정
  // 1순위: clinicDoctorId 직접 지정
  // 2순위: doctorName으로 이름 매칭
  // 3순위: is_default=true 의사
  // 4순위: 첫 번째 등록 의사
  let clinicDoctor: ClinicDoctorRow | null = null;
  if (clinicDoctors.length > 0) {
    if (clinicDoctorId) {
      clinicDoctor = clinicDoctors.find((d) => d.id === clinicDoctorId) ?? null;
    }
    if (!clinicDoctor && doctorName) {
      clinicDoctor = clinicDoctors.find((d) => d.name === doctorName) ?? null;
    }
    if (!clinicDoctor) {
      clinicDoctor = clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0];
    }
  }

  // 직인 이미지: storage path → signed URL (1시간)
  if (clinicDoctor?.seal_image_url) {
    const { data: signed } = await supabase.storage
      .from('documents')
      .createSignedUrl(clinicDoctor.seal_image_url, 3600);
    if (signed?.signedUrl) {
      clinicDoctor = { ...clinicDoctor, seal_image_url: signed.signedUrl };
    }
  }

  // T-20260522-foot-INS-DOC-PRINT: 건보 등급·부담률·산정특례 바인딩
  let insuranceInfo: InsuranceBindInfo | null = null;
  if (customerInsuranceGrade) {
    const rate = getBaseCopayRate(customerInsuranceGrade);
    insuranceInfo = {
      gradeLabel: INSURANCE_GRADE_LABELS[customerInsuranceGrade] ?? customerInsuranceGrade,
      copayRateText: `${Math.round(rate * 100)}%`,
      specialTreatmentCode: '',  // 현장 운영 중 확인 후 추가 (Phase 2)
    };
  }

  return buildAutoBindValues({
    customer,
    checkIn,
    payments: {
      total: payTotal,
      insurance_covered: insCovered,
      copayment,
      non_covered: nonCovered,
    },
    clinic: clinicData,
    doctor: doctorName,
    clinicDoctor,
    diagCodes,
    insuranceInfo,
  });
}

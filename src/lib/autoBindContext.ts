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
import { QR_CODE_API_ENDPOINT } from '@/lib/externalServices';
import { formatAmount } from '@/lib/format';
import { formatPhone } from '@/lib/format';
import { fetchDutyDoctors } from '@/hooks/useDutyRoster';
import type { CheckIn } from '@/lib/types';
import {
  INSURANCE_GRADE_LABELS,
  getBaseCopayRate,
  type InsuranceGrade,
} from '@/lib/insurance';
import { getStampUrl } from '@/lib/formTemplates';

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
  customer_email?: string | null; // T-20260611-foot-EMAIL-BINDING-FIX: 서류 patient_email 바인딩
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
    // T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND: 병원(기관) 이메일 — 환자 이메일과 별개
    email?: string | null;
    // T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET #2: 요양기관 대표자(대표원장) 성명. 법인 대표와 별개 축.
    representative_name?: string | null;
    // T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT (axis A): 요양기관명(HIRA 등록 명칭).
    //   표시명(name)과 별개 축. 출력서류 요양기관명 셀 데이터원. NULL→name silent 폴백 금지.
    hira_institution_name?: string | null;
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

/**
 * T-20260601-foot-DOC-PRINT-8FIX (AC-2①/AC-5①②/AC-6①②):
 *   서류의 성별·연령이 "연동 안 됨" 재발 근본원인 = customers.gender / birth_date 컬럼이
 *   비어있는 고객이 다수(현장은 주민번호만 입력). 기존 바인딩은 두 컬럼만 참조 → 공란 출력.
 *   → 주민번호(복호화본)에서 성별·생년월일을 직접 산출하는 fallback을 추가한다.
 *
 * 주민번호 13자리 YYMMDD-GXXXXXX 규칙:
 *   7번째 자리(뒷자리 첫 숫자) = 성별 + 세기
 *     1·2 → 1900년대,  3·4 → 2000년대,  5·6 → 1900년대(외국인),
 *     7·8 → 2000년대(외국인),  9·0 → 1800년대
 *     홀수(1,3,5,7,9) = 남(M),  짝수(2,4,6,8,0) = 여(F)
 */
function rrnDigits(rrn: string | null | undefined): string | null {
  if (!rrn) return null;
  const clean = rrn.replace(/[^0-9]/g, '');
  return clean.length === 13 ? clean : null;
}

/** 주민번호 → 'M' | 'F' | null */
export function deriveGenderFromRrn(rrn: string | null | undefined): 'M' | 'F' | null {
  const d = rrnDigits(rrn);
  if (!d) return null;
  const g = parseInt(d[6], 10);
  if (Number.isNaN(g) || g === 0) return g === 0 ? 'F' : null; // 0 → 1800년대 여
  return g % 2 === 1 ? 'M' : 'F';
}

/** 주민번호 → birth_date(YYMMDD 6자리). formatBirthDate/calcAge가 세기를 자체 추정. */
export function deriveBirthYYMMDDFromRrn(rrn: string | null | undefined): string | null {
  const d = rrnDigits(rrn);
  if (!d) return null;
  return d.slice(0, 6);
}

/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [AC-6 v2, 김주연 총괄 U0ATDB587PV 최종 확정
 *   2026-07-14T10:30 KST, MSG-20260714-104310-1b9f].
 * 서류 도장 슬롯을 오블리브오리진 법인 인감(getStampUrl priority-2)으로 강제할지 판정한다.
 * 도장 매핑 최종 3분기:
 *   ① 한동훈·김윤기·김상은 지정(is_default=false, 폴백 아님) → false → 각 개인 도장(印) 유지.
 *   ② 문지은 원장(대표원장 is_default=true) 지정 → true → 법인 인감(개인 직인 미사용).
 *   ③ 진료의 미지정 폴백(sealFallbackToInstitution) → true → 법인 인감.
 * ★의료서류 공식 인장의 법적 정확성(오매핑 0). DB seal drift(문지은 개인직인 재업로드) 시에도
 *   is_default 조건으로 법인 인감이 강제되도록 코드-레벨 이중 방어.
 */
export function shouldForceInstitutionSeal(
  isDefaultDoctor: boolean | null | undefined,
  sealFallbackToInstitution: boolean,
): boolean {
  return sealFallbackToInstitution || isDefaultDoctor === true;
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

  // T-20260601-foot-DOC-PRINT-8FIX: 성별·연령 — 컬럼 우선, 없으면 주민번호 산출 fallback
  const effGender = ctx.customer?.gender ?? deriveGenderFromRrn(ctx.customer?.rrn);
  const effBirthYYMMDD = ctx.customer?.birth_date ?? deriveBirthYYMMDDFromRrn(ctx.customer?.rrn);

  // T-20260601-foot-DOC-PRINT-8FIX AC-3④: 처방전 QR — record_no + 발행일 식별값 (api.qrserver 재사용, 신규 의존 없음)
  // QR 정의는 RX-PRINT-DUAL 범위 재사용 (OPEN-Q3: 검증 URL 확정 시 data payload 교체).
  const rxRecordNo = ctx.customer?.chart_number ?? ctx.checkIn.customer_id?.slice(0, 8) ?? '';
  const rxQrData = `RX|${rxRecordNo}|${today}`;
  const rxQrUrl = `${QR_CODE_API_ENDPOINT}?size=140x140&qzone=1&margin=0&format=png&data=${encodeURIComponent(rxQrData)}`;

  return {
    patient_name: ctx.customer?.name ?? ctx.checkIn.customer_name ?? '',
    patient_phone: formatPhone(ctx.customer?.phone ?? ctx.checkIn.customer_phone),
    patient_rrn: patientRrn,
    patient_address: fullAddress,
    // T-20260611-foot-EMAIL-BINDING-FIX: 서류 출력 시 이메일 공란 버그 — customers.customer_email 바인딩
    patient_email: ctx.customer?.customer_email ?? '',
    // T-20260520-foot-PRINT-FORM-BIND: 신규 바인딩 필드
    // T-20260601-foot-DOC-PRINT-8FIX: 컬럼 공란 시 주민번호 산출본 사용
    patient_gender: formatGenderCheckbox(effGender),
    patient_birthdate: formatBirthDate(effBirthYYMMDD),
    patient_age: calcAge(effBirthYYMMDD),
    visit_date: visitDate,
    doctor_name: ctx.doctor ?? '',
    total_amount: ctx.payments ? formatAmount(ctx.payments.total) : '',
    // 진료비계산서 field_map (T-20260504-foot-INSURANCE-COPAYMENT)
    insurance_covered: ctx.payments ? formatAmount(ctx.payments.insurance_covered) : '',
    copayment: ctx.payments ? formatAmount(ctx.payments.copayment ?? 0) : '',
    non_covered: ctx.payments ? formatAmount(ctx.payments.non_covered) : '',
    clinic_name: ctx.clinic?.name ?? '오블리브 풋센터 종로',
    // T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT (axis A): 요양기관명 셀 전용 바인딩.
    //   ⚠ affirmative — NULL 시 clinics.name silent 폴백 금지(공란 렌더). 요양기관명≠표시명 축 분리.
    //   현재 값 = 사업자상호 동일('오블리브의원 서울오리진점')이나 정식발번 divergence 대비 별개 슬롯.
    hira_institution_name: ctx.clinic?.hira_institution_name ?? '',
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
    // T-20260601-foot-DOC-PRINT-8FIX AC-3①: 처방전 전화칸 옆 팩스 중복 제거용 — 팩스 없는 순수 전화번호.
    // clinic_phone(=전화/FAX 조합)은 "전화 및 팩스" 라벨 양식 전용 유지.
    clinic_phone_only: ctx.clinic?.phone ? formatPhone(ctx.clinic.phone) : '',
    // T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND: 처방전 의료기관 블록 E-mail 주소 자동 바인딩.
    //   병원(기관) 이메일 — 환자 이메일(patient_email)과 별개. 미입력 시 빈칸(회귀 방지).
    clinic_email: ctx.clinic?.email ?? '',
    // T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET #2: 대표자 컨텍스트 바인딩(데이터원 준비).
    //   ⚠ print 재배선 금지 — 출력서류 대표자셀 {{doctor_name}} 유지(진료의 축 별도 티켓).
    //   여기서는 {{representative_name}} 슬롯 데이터만 제공(템플릿 미접촉).
    representative_name: ctx.clinic?.representative_name ?? '',
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
    // T-20260601-foot-DOC-PRINT-8FIX AC-7: 진료의뢰서 "의뢰병원" 자동 기입 (의뢰 주체 = 본원)
    referral_to_hospital: ctx.clinic?.name ?? '오블리브 풋센터 종로',
    // T-20260601-foot-DOC-PRINT-8FIX AC-3②: 처방전 사용기간 "교부일로부터 ( 3 ) 일간" 통일 기본값
    usage_days: '3',
    // T-20260601-foot-DOC-PRINT-8FIX AC-3④: 처방전 QR 자동 삽입 (_html 접미사 → 이스케이프 생략)
    rx_qr_html: `<img src="${rxQrUrl}" alt="처방전 QR" style="width:72px;height:72px;display:block;" onerror="this.style.display='none'" />`,
    // T-20260526-foot-DOC-FORM-REVISE AC#7: 납입증명서 연도 자동 바인딩
    year: format(new Date(), 'yyyy'),
    // T-20260526-foot-DOC-FORM-7FIX AC-7⑤: 납입증명서 "본 진료비는 {{year}}년 {{month}}월까지" 날짜 자동기입
    month: format(new Date(), 'MM'),
    // T-20260526-foot-DOC-FORM-REVISE AC-C2: 의사 성명 근방 도장 HTML (직인 이미지 or "(인)" fallback)
    // T-20260601-foot-DOC-SEAL-NULL-FALLBACK AC-1: DB seal_image_url null 회귀 복구.
    //   1순위 DB clinicDoctor.seal_image_url → 2순위 로컬자산 getStampUrl()(jongno-foot-stamp.png)
    //   → 3순위 텍스트 "(인)". 우하단 stampOverlay 부활 금지(8FIX/REOPEN2 제거분 유지, 위치는 의사성명 근방).
    doctor_seal_html: (() => {
      const sealUrl = ctx.clinicDoctor?.seal_image_url || getStampUrl();
      return sealUrl
        ? `<img src="${sealUrl}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`
        : '(인)';
    })(),
  };
}

/**
 * T-20260606-foot-DOC-FIELD-MISSING-3 AC-1/2/3:
 * 보험청구서·진료비계산서 금액 필드(공단부담금/본인부담금/비급여) 라이브 보강.
 *
 * 배경: autobind은 service_charges / insurance_receipts 테이블에서 금액을 읽는다.
 *   그러나 결제창(PATH-4) 단독 발행 등 service_charges 미기록 경로에서는 autobind이
 *   0/빈값을 반환 → 보험청구서/진료비계산서에 공단부담금·비급여가 "미표기"된다.
 *   현장 결제·시술 화면에는 이미 실 산출값이 존재하므로 이를 폴백 주입한다.
 *
 * 정책:
 *   - 이미 billing 산출값(service_charges)이 들어있으면 그대로 보존 (덮어쓰지 않음).
 *     → AC-1 "billing 산출값 그대로 표기" 충족, 임의 변경 금지.
 *   - autobind 값이 비어있거나 0인 경우에만 라이브 산출값으로 보강.
 *   - 라이브 값도 0 이하이면 보강 생략 (정상 0 처리 — 임의 누락 금지).
 *
 * @param values autobind 결과 (in-place 수정)
 * @param live   라이브 산출값(원 단위 number). 미지정/0 이하 필드는 건너뜀.
 */
export function applyBillingFallback(
  values: Record<string, string>,
  live: { insuranceCovered?: number; copayment?: number; nonCovered?: number; total?: number },
): void {
  const isBlankOrZero = (v: string | undefined): boolean => {
    if (v == null || v === '') return true;
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return !Number.isFinite(n) || n === 0;
  };
  const fill = (key: string, amount: number | undefined) => {
    if (amount != null && amount > 0 && isBlankOrZero(values[key])) {
      values[key] = formatAmount(amount);
    }
  };
  fill('insurance_covered', live.insuranceCovered);
  fill('copayment', live.copayment);
  fill('non_covered', live.nonCovered);
  // T-20260609-foot-PAY-DOCPRINT-FEE-MISSING AC-1/2/3: 진료비 총액 라이브 보강.
  //   total_amount/subtotal_amount는 autobind이 payments 테이블(payTotal)에서 읽는다.
  //   payments는 executeAutoDone(수납) 후에만 기록 → 수납 클릭 전 서류 출력 시 0/빈값 →
  //   영수증·진료비계산서·납입증명서 등에 진료비가 "누락"(0)된 채 출력되는 버그.
  //   화면 산출 진료비(수납 예정액 = deductMode?deductAmount:grandTotal, 즉 payments.amount와 동일)로
  //   폴백. autobind 값(수납 후 payTotal)이 있으면 보존 → 수납 전/후 출력본 금액 동일(AC-3 회귀 방지).
  //   ⚠ 실제 수납/결제 금액 산정 로직 불변 — 출력 데이터 소스만 '수납 완료 상태' 의존에서 분리.
  fill('total_amount', live.total);
  fill('subtotal_amount', live.total);
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
        .select('name, phone, address, address_detail, birth_date, chart_number, gender, insurance_grade, customer_email')
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
    .select('name, address, phone, fax, nhis_code, business_no, established_date, email, representative_name, hira_institution_name')
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
      // T-20260606-foot-DX-MGMT-OVERHAUL Stage 4 [D]: 출력에 상병코드 동반 표시.
      //   폴더 picker(DiagnosisFolderPicker)는 저장값을 "순수 상병명"만 기록(텍스트 오염 방지)
      //   → parseIcdFromText 는 코드를 못 뽑음(code='') → 출력에 코드 누락. 이를 보강:
      //   상병명으로 services(category_label='상병') 마스터를 역조회해 service_code 를 채운다.
      //   (clinic 스코프·등록 상병만 — 타 환자 차트 이력 비참조, 보안 불변식 유지.)
      let code1 = parsed.code;
      if (!code1 && parsed.name) {
        const { data: dxMaster } = await supabase
          .from('services')
          .select('service_code')
          .eq('clinic_id', checkIn.clinic_id)
          .eq('category_label', '상병')
          .eq('name', parsed.name)
          .limit(1)
          .maybeSingle();
        if (dxMaster?.service_code) code1 = dxMaster.service_code;
      }
      diagCodes = { code1, name1: parsed.name };
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

  // ── 치료테이블 지정 진료의 (T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED) ──
  //   RC: 치료테이블 '진료의' 선택은 check_ins.treating_doctor_id(=clinic_doctors.id)에 저장되나
  //   (TreatingDoctorSelect → 진료콜 명단·진료환자이력 공용 write), 서류 렌더는 이 필드를 전혀
  //   읽지 않고 duty_roster/fallback director로만 진료의를 결정해 왔다 → 지정 의사가 서류에 미반영
  //   (저장 O · 렌더 전달 X, 처음부터 결선 누락). 렌더 소스를 저장 소스에 결선한다.
  //   checkIn 객체에 값이 안 실려 오는 호출부(PATH-4 PaymentMiniWindow 등) 대비 단일 컬럼 DB 재조회.
  let treatingDoctorId: string | null = (checkIn.treating_doctor_id ?? null) as string | null;
  if (treatingDoctorId === null && checkIn.id) {
    const { data: ciRow } = await supabase
      .from('check_ins')
      .select('treating_doctor_id')
      .eq('id', checkIn.id)
      .maybeSingle();
    treatingDoctorId = (ciRow?.treating_doctor_id as string | null) ?? null;
  }
  const treatingDoctor =
    treatingDoctorId ? clinicDoctors.find((d) => d.id === treatingDoctorId) ?? null : null;

  // ── 진료 의사 결정 (T-20260502-foot-DUTY-ROSTER) ──
  // 1순위: 외부 명시 override (호출부 UI 선택)
  // 2순위: 치료테이블 지정 진료의 (T-20260713) — 명시 override 없을 때
  // 3순위: 당일 duty_roster 1명이면 자동
  // 4순위: 첫 번째 활성 director (fallback)
  let doctorName: string | null = null;

  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#3, field-confirm B안 2026-07-14T10:22 KST,
  //   김주연 총괄 U0ATDB587PV]: 진료의 "미지정 폴백" 서류의 도장은 대표원장(문지은) 개인직인이 아니라
  //   오블리브오리진 법인 인감(빨간, 기관 대표 도장)으로 찍어야 한다("문지은 원장님 도장은 요청한 적
  //   없는데 기존 대표 도장 어디갔어?"). 법인 인감 = getStampUrl()(jongno-foot-stamp.png, priority-2)
  //   = 7-13 이전 미지정 서류에 실제로 찍히던 '기존 대표 도장'. 아래 폴백 경로에서만 true → 도장 슬롯을
  //   법인 인감으로 강제(개인직인 seal_image_url 우회). 지정 진료의(override/치료테이블/clinicDoctorId)는
  //   무영향 — 해당 원장 개인 도장(한동훈印/김윤기印/김상은印) 그대로 유지(오매핑 0, ★법적 정확성).
  let sealFallbackToInstitution = false;

  if (doctorNameOverride !== undefined) {
    // 빈 문자열('')이면 미선택 상태 유지, 비어있지 않으면 사용
    doctorName = doctorNameOverride || null;
  } else if (treatingDoctor?.name) {
    // 치료테이블에서 지정한 진료의를 서류 진료의로 사용
    doctorName = treatingDoctor.name;
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

    // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN field-soak]:
    //   RC(현장 라이브 재현) — 결제창(PATH-4, 현장 1순위)은 override 미전달(undefined)이라
    //   UI 진료의 선택칸이 없다. 그런데 (a) 치료테이블 미지정(치료건 174 중 지정 8) + (b) 복수
    //   근무일(오늘 3명)이면 위 분기에서 doctorName=null로 떨어져 세부산정내역서 '대표자'/
    //   계산서·영수증 '진료의사'가 공란으로 발행된다(❶). 도장도 sort_order[0](대표원장) seal_null →
    //   기관 도장/공란으로 대체돼 붉은 인장이 안 찍힌다(❷). code-inspection은 지정 진료의 경로만
    //   검증해 통과했으나 현장 지배 경로(미지정·복수근무)에서 재발.
    //   → override 미전달(자동 발행 경로)에서는 공란 대신 요양기관 대표(is_default clinic_doctor,
    //     = 대표원장)로 폴백해 이름을 항상 채운다(공란 방지, AC-8/9). ★단 [REOPEN#3, 2026-07-14 field]:
    //     도장은 대표원장 개인직인이 아니라 오블리브오리진 법인 인감(getStampUrl priority-2)으로 찍는다
    //     (sealFallbackToInstitution=true → 아래 seal 우회). '기존 대표 도장'(법인 인감) 복원.
    //     지정 진료의가 있으면 위에서 이미 그 원장(개인 도장 유지)으로 결선되므로 무영향.
    //     override='' (복수근무 UI 대기, DocumentPrintPanel)는 상단 분기라 여기 도달 안 함 → UX 무회귀.
    if (doctorName === null && clinicDoctors.length > 0) {
      const representative =
        clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0] ?? null;
      if (representative?.name) {
        // 대표원장으로 임시 세팅 → 아래 clinicDoctor 상세(면허번호 등) 결선에 사용.
        //   최종 이름·도장은 sealFallbackToInstitution 블록(하단)에서 기관명+법인 인감으로 재정합
        //   ('문지은 이름 + 법인 도장' 미스매치 방지, REOPEN#4).
        doctorName = representative.name;
        sealFallbackToInstitution = true;
      }
    }
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
    // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED: 명시 clinicDoctorId/override 없으면 치료테이블
    //   지정 진료의로 상세(면허번호·직인)까지 일치시킨다(이름-매칭 동명이인 오결선 방지).
    if (!clinicDoctor && clinicDoctorId === undefined && doctorNameOverride === undefined && treatingDoctor) {
      clinicDoctor = treatingDoctor;
    }
    if (!clinicDoctor && doctorName) {
      clinicDoctor = clinicDoctors.find((d) => d.name === doctorName) ?? null;
    }
    if (!clinicDoctor) {
      clinicDoctor = clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0];
      // REOPEN#3 B안: 지정 진료의를 특정하지 못해 is_default(대표원장)로 떨어진 경우도 미지정 폴백 →
      //   도장은 법인 인감(director-fallback 등 doctorName이 clinic_doctor와 미매칭인 경로 포함).
      sealFallbackToInstitution = true;
    }
  }

  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [REOPEN#4 name↔seal 정합 보정, planner FIX-REQUEST
  //   MSG-20260714-103328-mq1p, 김주연 총괄 U0ATDB587PV field-confirm 2026-07-14T10:22 KST]:
  //   미지정 폴백 슬롯의 도장은 대표원장(문지은) 개인직인이 아니라 오블리브오리진 법인 인감으로 렌더한다.
  //   개인직인 seal_image_url을 비워 doctor_seal_html(L317)이 getStampUrl()(법인 인감, priority-2)로
  //   폴스루하게 한다. ★단 REOPEN#3에서 도장만 법인 인감으로 되돌리고 이름란(세부산정 '대표자'/
  //   계산서·영수증 '진료의사')은 문지은 개인명으로 남겨 '문지은 이름 + 법인 도장' 미스매치가 발생.
  //   총괄 명시("문지은 원장님 도장은 요청한 적 없다") → 미지정 이름란도 문지은 개인명 제거하고
  //   기관명으로 채운다(이름↔도장 세트 정합). 공란은 ❶ 재발(AC-8/9 회귀)이므로 기관명 채택 —
  //   기관명 vs 공란 최종 표기는 종결 confirm_gate ★★ 라이브 렌더 현장 실측에서 확정 후 스왑 가능.
  //   지정 진료의(한동훈/김윤기/김상은)는 상단에서 개인 이름·개인 도장으로 결선되어 이 분기 미도달 →
  //   무영향(오매핑 0, ★법적 정확성). ★DB 데이터 정합(문지은 seal_image_url NULL)과 이중 방어.
  //
  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED [AC-6 v2, 김주연 총괄 U0ATDB587PV 최종 확정
  //   2026-07-14T10:30 KST, MSG-20260714-104310-1b9f / planner FIX-REQUEST MSG-20260714-104648-wwls]:
  //   도장 매핑 최종 3분기 — ①한동훈·김윤기·김상은 지정 → 각 개인 도장(印) / ②문지은 원장 지정 →
  //   오블리브오리진 법인 인감(개인 직인 미사용) / ③미지정 → 법인 인감. B안에 '문지은 원장=항상
  //   법인 인감' 규칙을 추가한 확장.
  //   ★핵심 차이: ②문지은 '지정'은 도장만 법인 인감으로 폴스루하고 이름(문지은)은 유지한다
  //   (문지은이 실제 지정 진료의이므로 이름란은 문지은). vs ③미지정은 이름·도장 둘 다 기관으로.
  //   문지은 = 대표원장(is_default) — 이 CRM에서 대표원장은 개인 직인 대신 법인 인감을 쓴다.
  //   구현: 문지은 개인직인 seal_image_url을 비워(현재 DB=NULL, 데이터 정합) doctor_seal_html(L317)이
  //   getStampUrl()(법인 인감 priority-2)로 폴스루하게 하되, DB drift(문지은 개인직인 재업로드) 시에도
  //   법인 인감이 강제되도록 코드 가드로 이중 방어한다(오매핑 0, ★의료서류 공식 인장 법적 정확성).
  //   한동훈·김윤기·김상은(is_default=false)은 이 가드 미해당 → 개인 도장 그대로 유지.
  const forceInstitutionSeal = shouldForceInstitutionSeal(clinicDoctor?.is_default, sealFallbackToInstitution);
  if (sealFallbackToInstitution) {
    // ③미지정 폴백: 이름란도 기관명으로 재정합('문지은 이름 + 법인 도장' 미스매치 방지, REOPEN#4).
    const institutionName = (clinicData?.name ?? '오블리브 풋센터 종로').trim();
    if (institutionName) doctorName = institutionName;
  }
  // ②문지은 지정(+③미지정 포함): 도장 슬롯을 법인 인감으로 강제(개인직인 seal_image_url 비움 → 폴스루).
  //   이름은 위 분기에서만 변경 → 문지은 지정 시 이름=문지은 유지.
  if (forceInstitutionSeal && clinicDoctor?.seal_image_url) {
    clinicDoctor = { ...clinicDoctor, seal_image_url: null };
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

/**
 * T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED:
 * 치료테이블에서 지정한 진료의(check_ins.treating_doctor_id → clinic_doctors.name)를 반환.
 * DocumentPrintPanel '진료 원장님' 드롭다운의 기본 선택을 지정 진료의로 맞추는 데 사용한다
 * (사용자는 여전히 드롭다운으로 변경 가능 — 명시 선택이 최우선).
 * 미지정/미연결(clinic_doctors 매칭 실패) 시 null → 호출부는 기존 duty 기본값 유지(회귀 없음).
 */
export async function loadTreatingDoctorName(
  checkIn: Pick<CheckIn, 'id' | 'treating_doctor_id'>,
): Promise<string | null> {
  let treatingDoctorId: string | null = (checkIn.treating_doctor_id ?? null) as string | null;
  if (treatingDoctorId === null && checkIn.id) {
    const { data: ciRow } = await supabase
      .from('check_ins')
      .select('treating_doctor_id')
      .eq('id', checkIn.id)
      .maybeSingle();
    treatingDoctorId = (ciRow?.treating_doctor_id as string | null) ?? null;
  }
  if (!treatingDoctorId) return null;
  const { data: cd } = await supabase
    .from('clinic_doctors')
    .select('name')
    .eq('id', treatingDoctorId)
    .maybeSingle();
  const name = ((cd?.name as string | null) ?? '').trim();
  return name || null;
}

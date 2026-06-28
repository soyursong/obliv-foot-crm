// LOGIC-LOCK: L-001 — 셀프접수 고객정보 노출 금지. 변경 시 현장 승인 필수
/**
 * 셀프체크인 페이지 — /checkin/:clinicSlug
 *
 * 인증 불필요 (anon). 태블릿/모바일 전체화면 최적화 (키오스크 모드).
 *
 * T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 초진 동선 재구성
 *   - 신규 단계: personal_info (주민번호+주소+동의서) + qr (발건강질문지 QR)
 *   - 초진 흐름: input → personal_info → confirm → submit → qr → done
 *   - 재진 흐름: input → confirm → submit → done (기존 동일)
 *   - 워크인 6필드: 성함/연락처/방문경로(유입경로)/주민번호/주소/동의서
 *   - QR 코드: 발건강질문지 /health-q/:token (fn_selfcheckin_create_health_q_token)
 *   - 개인정보: fn_selfcheckin_update_personal_info (SECURITY DEFINER, 30분 내 체크인)
 *
 * 기존 기능:
 *   - 완료 화면 15초 자동 리셋 (카운트다운)
 *   - 입력 화면 60초 비활동 타임아웃
 *   - 전화번호 입력 시 오늘 예약 조회 + 자동 방문유형 채움
 *   - 터치 최적화 숫자패드 (온스크린)
 *   - 초진/예약없이 방문 시 신분증 확인 필요 플래그 자동 설정
 *
 * 디자인: 브라운/베이지 고급 웰니스 클리닉 테마 (T-20260428-foot-CHECKIN-UX)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import type { VisitType } from '@/lib/types';
import { normalizeToE164 } from '@/lib/phone';
import { todaySeoulISODate, nowSeoulHHMM } from '@/lib/format';
import ForeignStayAddressInput from '@/components/ForeignStayAddressInput';

// 셀프체크인 전용 Supabase 클라이언트 (anon, 세션 없음)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 브라운/베이지 컬러 토큰 (고급 웰니스 테마)
const C = {
  bgFrom: '#F5EFE7',
  bgTo: '#FAF7F2',
  dark: '#3D2B1A',
  primary: '#5C3D1E',
  medium: '#7B5130',
  muted: '#8B7355',
  border: '#D4C5B2',
  borderActive: '#7B5130',
  beige: '#F5EFE7',
  cream: '#FDF8F2',
  gold: '#C9A97A',
  bannerBg: '#FDF5E4',
  bannerBorder: '#C9A97A',
} as const;

// T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 신규 단계 추가
// T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 'select-reservation' 추가 (예약자 목록 선택)
type Step = 'input' | 'select-reservation' | 'personal_info' | 'confirm' | 'qr' | 'done' | 'error';
type Lang = 'ko' | 'en';

/** 예약 여부 1단계 선택값 */
type ReservationType = 'reserved' | 'walkin';

/**
 * T-20260601-foot-SELFLOGIN-RESV-LIST-QR
 * 화면에 표시되는 마스킹된 예약 항목 (anon 공개 라우트 — 마스킹값만 보관)
 */
interface MaskedReservation {
  reservation_id: string;
  customer_id: string | null;
  masked_name: string;   // 예: "김*현"
  masked_phone: string;  // 예: "02*9"
  reservation_time: string; // "HH:MM"
  visit_type: VisitType;
}

const T: Record<Lang, {
  selfCheckIn: string;
  name: string;
  namePlaceholder: string;
  phone: string;
  phonePlaceholder: string;
  visitType: string;
  visitStep1Reserved: string;
  visitStep1WalkIn: string;
  visitStep2Title: string;
  visitNew: string;
  visitNewDesc: string;
  visitReturning: string;
  visitReturningDesc: string;
  walkInModalTitle: string;
  walkInModalBody: string;
  walkInModalConfirm: string;
  leadSourceTitle: string;
  leadSNS: string;
  leadSearch: string;
  leadReferral: string;
  leadPartnerEtc: string;
  leadSNSSubTitle: string;
  leadInstagram: string;
  leadFacebook: string;
  leadTiktokYoutube: string;
  leadBlogCafe: string;
  leadSearchSubTitle: string;
  leadNaver: string;
  leadGoogle: string;
  leadReferralNameTitle: string;
  leadReferralNamePlaceholder: string;
  checkIn: string;
  confirm: string;
  edit: string;
  processing: string;
  confirmTitle: string;
  contact: string;
  done: string;
  doneMsg: (name: string) => string;
  queueNumber: string;
  autoReset: (s: number) => string;
  newCheckIn: string;
  errorTitle: string;
  retry: string;
  clinicNotFound: string;
  clinicNotFoundDesc: string;
  loading: string;
  clearAll: string;
  reservationBanner: (time: string, type: string) => string;
  failPrefix: string;
  errorPrefix: string;
  // T-20260529-foot-RESV-CHECKIN-NOSAVE AC-4: 예약 중복 접수 에러 메시지
  duplicateCheckIn: string;
  // T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 레이블
  smsOptIn: string;
  // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-3: SMS 수신동의 부가 안내
  smsOptInNote: string;
  // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 단계
  personalInfoTitle: string;
  rrnLabel: string;
  rrnPlaceholder: string;
  rrnNote: string;
  addressLabel: string;
  addressPlaceholder: string;
  // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-1: 우편번호 검색 + 상세주소
  postcodeSearchBtn: string;
  postcodeLabel: string;
  postcodePlaceholder: string;
  addressDetailLabel: string;
  addressDetailPlaceholder: string;
  privacyConsentLabel: string;
  // AC-7: 건강보험 조회 동의
  insuranceConsentLabel: string;
  insuranceConsentNote: string;
  // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-2: 동의서 본문 항목별 정렬
  consentPrivacyTitle: string;
  consentPrivacyItems: string[];
  consentHiraTitle: string;
  consentHiraItems: string[];
  personalInfoNext: string;
  personalInfoBack: string;
  // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: QR 단계
  qrTitle: string;
  qrGuide: string;
  qrDone: string;
  qrBack: string;
  qrAutoReset: (s: number) => string;
  qrLoading: string;
  qrError: string;
  // T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 목록 선택 동선
  selectReservationTitle: string;
  selectReservationGuide: string;
  openReservationList: string;
  reservationListLoading: string;
  noReservationTitle: string;
  noReservationDesc: string;
  backToPhoneCheckin: string;
  reservationListBack: string;
  reservationNowBadge: string;
  // OQ1(가정 A): 셀프접수 페이지 URL QR
  scanToPhoneCaption: string;
  // T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW: 외국인 전용(English 분기) 추가 항목
  emailLabel: string;
  emailPlaceholder: string;
  contactEitherHint: string;        // 워크인 외국인: 연락처 or 이메일 택1 안내
  stayAddressLabel: string;
  stayAddressPlaceholder: string;
  stayAddressDetailLabel: string;
  stayAddressDetailPlaceholder: string;
  stayManualToggle: string;
  stayManualHint: string;
  foreignConsentTitle: string;      // §C 동의서 제목
  foreignConsentItems: string[];    // §C 동의서 본문(항목별)
  foreignConsentCheckbox: string;   // §C 동의 체크 레이블
}> = {
  ko: {
    selfCheckIn: '셀프 접수',
    name: '성함',
    namePlaceholder: '홍길동',
    phone: '연락처',
    phonePlaceholder: '예약하신 번호로 입력해주세요',
    visitType: '방문 유형',
    visitStep1Reserved: '예약하고 왔어요',
    visitStep1WalkIn: '예약 없이 방문했어요',
    visitStep2Title: '방문 구분',
    visitNew: '초진',
    visitNewDesc: '처음 방문입니다',
    visitReturning: '재진',
    visitReturningDesc: '재방문입니다',
    walkInModalTitle: '안내',
    walkInModalBody: '당일 예약 상황에 따라\n진료가 어려울 수 있습니다.\n데스크에 문의해주세요.',
    walkInModalConfirm: '확인 후 접수하기',
    leadSourceTitle: '유입경로',
    leadSNS: 'SNS',
    leadSearch: '검색',
    leadReferral: '지인소개',
    leadPartnerEtc: '제휴·기타',
    leadSNSSubTitle: 'SNS 채널 선택',
    leadInstagram: '인스타그램',
    leadFacebook: '페이스북',
    leadTiktokYoutube: '틱톡·유튜브',
    leadBlogCafe: '블로그·카페',
    leadSearchSubTitle: '검색 채널 선택',
    leadNaver: '네이버',
    leadGoogle: '구글',
    leadReferralNameTitle: '소개자 성함',
    leadReferralNamePlaceholder: '예: 홍길동',
    checkIn: '접수하기',
    confirm: '접수하기',
    edit: '수정',
    processing: '처리 중...',
    confirmTitle: '접수 정보 확인',
    contact: '연락처',
    done: '접수 완료',
    doneMsg: (name) => `${name}님, 접수가 완료되었습니다.`,
    queueNumber: '대기번호',
    autoReset: (s) => `${s}초 후 자동으로 초기화됩니다`,
    newCheckIn: '새 접수',
    errorTitle: '접수 실패',
    retry: '다시 시도',
    clinicNotFound: '지점을 찾을 수 없습니다',
    clinicNotFoundDesc: '올바른 체크인 링크인지 확인해 주세요.',
    loading: '불러오는 중...',
    clearAll: '전체삭제',
    reservationBanner: (time, type) => `오늘 예약이 있습니다: ${time} ${type}`,
    failPrefix: '접수 실패: ',
    errorPrefix: '오류가 발생했습니다: ',
    duplicateCheckIn: '이미 접수된 예약입니다. 대기열을 확인하거나 직원에게 문의해 주세요.',
    smsOptIn: '예약 안내 문자 수신에 동의합니다 (선택)',
    // T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-5: 미동의 영향 안내 문구(현장 지정 정문안)
    smsOptInNote: '미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다',
    // 개인정보 입력 단계
    personalInfoTitle: '개인 정보 입력',
    rrnLabel: '주민번호',
    rrnPlaceholder: 'YYMMDD-XXXXXXX',
    rrnNote: '생년월일(앞 6자리)만 저장됩니다. 개인정보는 안전하게 보호됩니다.',
    addressLabel: '주소',
    addressPlaceholder: '주소를 입력해주세요',
    postcodeSearchBtn: '우편번호 검색',
    postcodeLabel: '우편번호',
    postcodePlaceholder: '우편번호 검색을 눌러주세요',
    addressDetailLabel: '상세주소',
    addressDetailPlaceholder: '상세주소 (동·호수·건물명 등)',
    privacyConsentLabel: '개인정보 수집·이용에 동의합니다 (필수)',
    // AC-7: 건강보험 조회 동의
    insuranceConsentLabel: '건강보험 자격조회에 동의합니다 (선택)',
    insuranceConsentNote: '동의 시 건강보험 급여 적용을 위한 자격 조회가 가능합니다.',
    // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-2: 동의서 본문 항목별 정렬
    consentPrivacyTitle: '개인정보 수집·이용 동의 (필수)',
    consentPrivacyItems: [
      '수집항목 : 성함, 주민등록번호, 연락처, 주소 등 기본 정보',
      '수집목적 : 진료를 위한 정보 수집',
      '보유기간 : 관련 법령에 따른 보관 기간 동안 보유',
    ],
    consentHiraTitle: '건강보험 조회에 동의합니다 (필수)',
    consentHiraItems: [
      '수집항목 : 성함, 주민등록번호(또는 생년월일), 건강보험 자격정보(가입 여부, 보험종류, 자격상태 등)',
      '수집목적 : 건강보험 자격 확인, 보험 적용 진료비 산정 및 청구, 보험 급여 적정성 확인',
      '보유기간 : 관련 법령에 따른 보관 기간 동안 보유',
    ],
    personalInfoNext: '다음',
    personalInfoBack: '뒤로',
    // QR 단계
    qrTitle: '발건강 질문지 작성',
    qrGuide: '핸드폰으로 QR을 촬영하여\n발건강 질문지를 작성해주세요',
    qrDone: '정상접수(QR 스캔 완료)',
    qrBack: '이전 단계로 돌아가기',
    qrAutoReset: (s) => `${s}초 후 자동으로 처음 화면으로 돌아갑니다`,
    qrLoading: 'QR 코드 생성 중...',
    qrError: 'QR 코드를 불러올 수 없습니다. 데스크에 문의해주세요.',
    // T-20260601-foot-SELFLOGIN-RESV-LIST-QR
    selectReservationTitle: '예약자 명단',
    selectReservationGuide: '본인 성함을 선택해주세요',
    openReservationList: '예약자 명단에서 찾기',
    reservationListLoading: '예약자 명단을 불러오는 중...',
    noReservationTitle: '오늘 예약자 명단에 없습니다',
    noReservationDesc: '데스크에 문의하시거나\n전화번호로 직접 접수해주세요.',
    backToPhoneCheckin: '전화번호로 접수하기',
    reservationListBack: '← 돌아가기',
    reservationNowBadge: '지금',
    scanToPhoneCaption: 'QR을 스캔해 휴대폰으로 접수할 수 있어요',
    // T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW (외국인 전용 — 한국어 흐름에선 미사용, 폴백용)
    emailLabel: '이메일',
    emailPlaceholder: 'name@example.com',
    contactEitherHint: '연락처 또는 이메일 중 하나 이상 입력해주세요',
    stayAddressLabel: '국내 체류지 (숙소/주소)',
    stayAddressPlaceholder: '숙소명 또는 주소 검색',
    stayAddressDetailLabel: '상세주소',
    stayAddressDetailPlaceholder: '동·호수·층 등',
    stayManualToggle: '주소 직접 입력',
    stayManualHint: '체류지 주소를 직접 입력해주세요.',
    foreignConsentTitle: '외국인 환자 개인정보 수집·이용 동의',
    foreignConsentItems: [
      '본 의원은 진료 접수, 환자 본인 확인, 진료기록 관리 및 관련 행정업무를 위해 아래 정보를 수집·이용합니다.',
      '수집항목 : 성명 / 생년월일 / 국적 / 연락처 / 여권번호(또는 외국인등록번호) / 국내 체류지(선택)',
      '보유기간 : 관련 법령에 따른 보존기간까지 보관',
      '귀하는 개인정보 수집·이용에 대한 동의를 거부할 권리가 있으나, 필수정보 미제공 시 진료 접수가 제한될 수 있습니다.',
    ],
    foreignConsentCheckbox: '개인정보 수집·이용에 동의합니다 (필수)',
  },
  en: {
    selfCheckIn: 'Self Check-In',
    name: 'Name',
    namePlaceholder: 'Hong Gil-dong',
    phone: 'Phone',
    phonePlaceholder: 'Your reservation phone number',
    visitType: 'Visit Type',
    visitStep1Reserved: 'I have a reservation',
    visitStep1WalkIn: 'Walk-in (no reservation)',
    visitStep2Title: 'Visit Category',
    visitNew: 'New Patient',
    visitNewDesc: 'First visit',
    visitReturning: 'Follow-up',
    visitReturningDesc: 'Returning visit',
    walkInModalTitle: 'Please Note',
    walkInModalBody: 'Walk-in availability depends\non daily schedule.\nPlease check with the front desk.',
    walkInModalConfirm: 'Understood, proceed',
    leadSourceTitle: 'How did you hear about us?',
    leadSNS: 'SNS',
    leadSearch: 'Search',
    leadReferral: 'Friend / Family',
    leadPartnerEtc: 'Partnership / Other',
    leadSNSSubTitle: 'Select SNS channel',
    leadInstagram: 'Instagram',
    leadFacebook: 'Facebook',
    leadTiktokYoutube: 'TikTok / YouTube',
    leadBlogCafe: 'Blog / Cafe',
    leadSearchSubTitle: 'Select search channel',
    leadNaver: 'Naver',
    leadGoogle: 'Google',
    leadReferralNameTitle: 'Referrer name',
    leadReferralNamePlaceholder: 'e.g. Hong Gil-dong',
    checkIn: 'Check In',
    confirm: 'Confirm',
    edit: 'Edit',
    processing: 'Processing...',
    confirmTitle: 'Confirm Your Information',
    contact: 'Phone',
    done: 'Check-In Complete',
    doneMsg: (name) => `${name}, your check-in is complete.`,
    queueNumber: 'Queue Number',
    autoReset: (s) => `Auto-reset in ${s} seconds`,
    newCheckIn: 'New Check-In',
    errorTitle: 'Check-In Failed',
    retry: 'Try Again',
    clinicNotFound: 'Clinic not found',
    clinicNotFoundDesc: 'Please verify your check-in link.',
    loading: 'Loading...',
    clearAll: 'Clear',
    reservationBanner: (time, type) => `Reservation found: ${time} ${type}`,
    failPrefix: 'Failed: ',
    errorPrefix: 'Error: ',
    duplicateCheckIn: 'Already checked in. Please check the queue or contact the front desk.',
    smsOptIn: 'I agree to receive appointment and other SMS notifications (optional)',
    smsOptInNote: 'If you do not consent, you may be excluded from automated messages such as appointment reminders and home-care guides.',
    // Personal info step
    personalInfoTitle: 'Personal Information',
    rrnLabel: 'ID Number',
    rrnPlaceholder: 'YYMMDD-XXXXXXX',
    rrnNote: 'Only birth date (first 6 digits) will be stored securely.',
    addressLabel: 'Address',
    addressPlaceholder: 'Enter your address',
    postcodeSearchBtn: 'Search Postcode',
    postcodeLabel: 'Postcode',
    postcodePlaceholder: 'Tap "Search Postcode"',
    addressDetailLabel: 'Address Detail',
    addressDetailPlaceholder: 'Detail (unit, floor, building, etc.)',
    privacyConsentLabel: 'I consent to the collection of personal information (required)',
    // AC-7: insurance consent
    insuranceConsentLabel: 'I consent to health insurance eligibility inquiry (optional)',
    insuranceConsentNote: 'Consent allows us to check your health insurance eligibility for coverage.',
    // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-2: itemized consent body
    consentPrivacyTitle: 'Consent to Collection and Use of Personal Information (Required)',
    consentPrivacyItems: [
      'Items collected: name, resident registration number, contact, address and other basic information',
      'Purpose: collection of information for medical treatment',
      'Retention: retained for the period required by relevant laws',
    ],
    consentHiraTitle: 'I consent to health insurance inquiry (Required)',
    consentHiraItems: [
      'Items collected: name, resident registration number (or birth date), health insurance eligibility information (enrollment status, insurance type, eligibility status, etc.)',
      'Purpose: verify health insurance eligibility, calculate and claim covered treatment costs, confirm benefit adequacy',
      'Retention: retained for the period required by relevant laws',
    ],
    personalInfoNext: 'Next',
    personalInfoBack: 'Back',
    // QR step
    qrTitle: 'Health Questionnaire',
    qrGuide: 'Please scan the QR code with your phone\nto fill out the health questionnaire',
    qrDone: 'Check-in Complete (QR scanned)',
    qrBack: 'Back to previous step',
    qrAutoReset: (s) => `Returning to the start screen in ${s} seconds`,
    qrLoading: 'Generating QR code...',
    qrError: 'QR code unavailable. Please ask the front desk.',
    // T-20260601-foot-SELFLOGIN-RESV-LIST-QR
    selectReservationTitle: 'Reservation List',
    selectReservationGuide: 'Please select your name',
    openReservationList: 'Find me in the reservation list',
    reservationListLoading: 'Loading reservation list...',
    noReservationTitle: 'Not found in today’s reservations',
    noReservationDesc: 'Please ask the front desk\nor check in with your phone number.',
    backToPhoneCheckin: 'Check in by phone number',
    reservationListBack: '← Back',
    reservationNowBadge: 'Now',
    scanToPhoneCaption: 'Scan the QR to check in on your phone',
    // T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW (foreign-patient flow)
    emailLabel: 'Email',
    emailPlaceholder: 'name@example.com',
    contactEitherHint: 'Enter at least one: phone number or email',
    stayAddressLabel: 'Stay in Korea (Hotel / Address)',
    stayAddressPlaceholder: 'Search hotel or address',
    stayAddressDetailLabel: 'Address Detail',
    stayAddressDetailPlaceholder: 'Room / floor / building',
    stayManualToggle: 'Enter address manually',
    stayManualHint: 'Type your stay address directly.',
    foreignConsentTitle: 'Consent to Collection & Use of Personal Information (Foreign Patients)',
    foreignConsentItems: [
      'This clinic collects and uses the information below for reception, identity verification, medical record management, and related administrative tasks.',
      'Items collected: name / date of birth / nationality / contact / passport number (or foreign registration number) / domestic stay address (optional)',
      'Retention: stored until the end of the period required by relevant laws',
      'You have the right to refuse consent; however, reception may be limited if required information is not provided.',
    ],
    foreignConsentCheckbox: 'I consent to the collection and use of my personal information (required)',
  },
};

/** 완료 화면 자동 리셋 (초) */
const DONE_RESET_SECONDS = 15;
/** 입력 화면 비활동 타임아웃 (초) */
const IDLE_TIMEOUT_SECONDS = 60;
/** QR 화면 자동 타임아웃 (초) — T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX: 120→180, 종료 시 초기 화면 복귀 */
const QR_SCREEN_SECONDS = 180;

// ── 공통 폰트 스타일 (Pretendard 모던 고딕 — T-20260514-foot-SELFCHECKIN-FONT) ──
const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
};

// ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: RRN 유틸 함수 ──────────────────
/** RRN 입력값을 YYMMDD-XXXXXXX 포맷으로 자동 변환 */
function formatRrn(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}
/** RRN에서 생년월일(앞 6자리) 추출. 6자리 미만 → null */
function extractBirthDate(rrnStr: string): string | null {
  const digits = rrnStr.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return digits.slice(0, 6);
}
// T-20260603-foot-SELFCHECKIN-RRN-UNMASK: 셀프접수 본인 입력 화면 주민번호 전체 표시로 변경.
// 기존 maskRrn(YYMMDD-*******) 로컬 함수는 호출처 2곳(입력 실시간/최종확인) 제거로 미사용 → 삭제.
// (다른 RRN 마스킹은 edge function maskRrnInRaw — 별개 함수, 영향 없음)

// ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 목록 마스킹 유틸 (롱레 동일) ──
/** 이름 마스킹: 두 번째 글자부터 * (예: 김도현→김*현, 박소→박*) */
function maskName(name: string): string {
  if (!name) return '';
  if (name.length === 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

/**
 * 전화번호 마스킹: 끝 4자리 중 앞 2자리 마스킹 → "0*{끝2자리}"
 * 예: 010-1234-5609 → 0*09 (현장 예시 "02*9" 기준 — 롱레 maskPhone 통일)
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 2) return '0*';
  return '0*' + digits.slice(-2);
}

// ── 숫자패드 컴포넌트 ──
function NumPad({
  onDigit,
  onDelete,
  onClear,
  clearLabel = '전체삭제',
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onClear: () => void;
  clearLabel?: string;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => {
        if (k === 'clear') {
          return (
            <button
              key={k}
              type="button"
              onClick={onClear}
              className="flex h-14 items-center justify-center rounded-xl text-sm font-semibold transition active:scale-95"
              style={{ backgroundColor: C.beige, color: C.primary, border: `1.5px solid ${C.border}` }}
            >
              {clearLabel}
            </button>
          );
        }
        if (k === 'del') {
          return (
            <button
              key={k}
              type="button"
              onClick={onDelete}
              className="flex h-14 items-center justify-center rounded-xl text-lg font-semibold transition active:scale-95"
              style={{ backgroundColor: C.beige, color: C.primary, border: `1.5px solid ${C.border}` }}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l7-7h11a1 1 0 011 1v12a1 1 0 01-1 1H10l-7-7z" />
              </svg>
            </button>
          );
        }
        return (
          <button
            key={k}
            type="button"
            onClick={() => onDigit(k)}
            className="flex h-14 items-center justify-center rounded-xl text-xl font-bold transition active:scale-95"
            style={{
              backgroundColor: 'white',
              border: `1.5px solid ${C.border}`,
              color: C.dark,
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.beige;
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.borderActive;
            }}
            onPointerUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'white';
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
            }}
            onPointerLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'white';
              (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
            }}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

// ── 워크인 안내 팝업 ──
function WalkInModal({
  open,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  fontStyle,
}: {
  open: boolean;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  fontStyle: React.CSSProperties;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(61,43,26,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-xl"
        style={{ backgroundColor: 'white', border: `2px solid ${C.border}`, ...fontStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 아이콘 */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: C.bannerBg, border: `2px solid ${C.bannerBorder}` }}>
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: C.medium }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        {/* 본문 */}
        <p className="text-center text-base leading-relaxed" style={{ color: C.dark, whiteSpace: 'pre-line' }}>
          {body}
        </p>
        {/* 확인 버튼 */}
        <button
          type="button"
          onClick={onConfirm}
          className="mt-6 w-full rounded-xl py-4 text-lg font-bold text-white transition active:scale-[0.99]"
          style={{ backgroundColor: C.primary }}
        >
          {confirmLabel}
        </button>
        {/* 취소 */}
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-xl py-3 text-base font-medium transition active:scale-[0.99]"
          style={{ border: `1.5px solid ${C.border}`, color: C.muted, backgroundColor: 'white' }}
        >
          돌아가기
        </button>
      </div>
    </div>
  );
}

export default function SelfCheckIn() {
  const { clinicSlug } = useParams<{ clinicSlug: string }>();

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [clinicName, setClinicName] = useState<string>('');
  const [clinicNotFound, setClinicNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>('ko');

  const [step, setStep] = useState<Step>('input');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW: 외국인 워크인 연락수단(이메일) — phone or email 택1.
  //   저장 = customers.customer_email (⚠ 기관 email 아님). DA Q3: nullable 재사용, FE 강제.
  const [customerEmail, setCustomerEmail] = useState('');

  // ── 방문유형 2단계 (T-20260517-foot-CHECKIN-2STEP) ──
  const [reservationType, setReservationType] = useState<ReservationType | null>(null);
  const [visitType, setVisitType] = useState<VisitType>('new');   // 최종 DB 저장값
  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [walkInConfirmed, setWalkInConfirmed] = useState(false);

  // ── 유입경로 2단계 (T-20260517-foot-CHECKIN-2STEP) ──
  // T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH: 4대그룹 2×2 (sns/search/referral/partner_etc)
  //   - sns:    instagram | facebook | tiktok_youtube | blog_cafe
  //   - search: naver | google
  //   - referral: 성함 텍스트(referralName)
  //   - partner_etc: 추가 입력 없음
  const [leadSource, setLeadSource] = useState<string | null>(null);
  const [leadSourceDetail, setLeadSourceDetail] = useState<string | null>(null);
  const [referralName, setReferralName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX AC2: SMS 수신동의는 '선택' 동의(기본 미체크였음).
  // T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-4: 현장(김주연 총괄) 지시로 기본 체크(true) 전환.
  //   예약 안내 문자 수신을 기본 동의로 노출 — 미동의 시 AC-5 안내문구로 영향 고지.
  const [smsOptIn, setSmsOptIn] = useState(true);

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 상태 ──
  const [rrn, setRrn] = useState('');                    // YYMMDD-XXXXXXX 포맷
  const [address, setAddress] = useState('');
  // T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-1: 우편번호 + 상세주소
  const [postalCode, setPostalCode] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  // T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX AC2: 개인정보 동의 기본 체크(true).
  //   boolean 저장·필수성·privacy_consent_at 기록 로직 불변, 초기값만 true.
  const [privacyConsent, setPrivacyConsent] = useState(true);
  // AC-7: 건강보험 조회 동의 (→ customers.hira_consent)
  // T-20260603 AC2: 건강보험 동의 기본 체크(true). 기록 로직 불변.
  const [insuranceConsent, setInsuranceConsent] = useState(true);
  // 발건강질문지 QR 토큰
  const [healthQToken, setHealthQToken] = useState<string | null>(null);
  // QR 화면 카운트다운
  const [qrCountdown, setQrCountdown] = useState(QR_SCREEN_SECONDS);

  // ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 목록 선택 동선 ──
  // 화면 표시용 마스킹 목록 (PII 가드: 마스킹값만 state 보관)
  const [maskedReservations, setMaskedReservations] = useState<MaskedReservation[]>([]);
  const [reservationListLoading, setReservationListLoading] = useState(false);
  // 비마스킹 원본은 ref 에만 보관 (React state/DOM 노출 금지) — 선택 시에만 1건 꺼내 사용
  const rawReservationsRef = useRef<Map<string, { name: string; phone: string }>>(new Map());

  // T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL AC-2: 현재 시각대 자동 스크롤 선노출
  // 명단 스크롤 컨테이너 + 항목별 ref. 진입/갱신 시 "현재 시각 이후 가장 가까운 예약"으로 스크롤.
  const reservationListRef = useRef<HTMLDivElement>(null);
  const reservationItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // 동일 명단 시그니처에는 1회만 자동 스크롤 → 사용자 수동 스크롤 점유 시 강제 점프 회피.
  const autoScrolledSigRef = useRef<string>('');
  // 자동 스크롤 대상(현재 시각대) 항목 — 시각적 선노출 하이라이트용.
  const [nowTargetId, setNowTargetId] = useState<string | null>(null);

  const t = T[lang];

  // 예약 정보
  const [reservationBanner, setReservationBanner] = useState<{
    time: string;
    visitType: string;
    // T-20260613-foot-SELFCHECKIN-BANNER-NAME: 배너에 예약자 성함 표기 (비마스킹, ref 원본)
    name: string;
  } | null>(null);

  // 완료 화면 카운트다운
  const [countdown, setCountdown] = useState(DONE_RESET_SECONDS);

  // LOGIC-LOCK L-001: 폼 DOM 강제 재마운트 카운터
  const [resetKey, setResetKey] = useState(0);

  // 비활동 타임아웃 ref
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 클리닉 조회 ──
  useEffect(() => {
    if (!clinicSlug) {
      setClinicNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await anonClient
        .from('clinics')
        .select('id, name')
        .eq('slug', clinicSlug)
        .maybeSingle();
      if (error || !data) {
        setClinicNotFound(true);
      } else {
        setClinicId(data.id as string);
        setClinicName(data.name as string);
      }
      setLoading(false);
    })();
  }, [clinicSlug]);

  // ── 폼 리셋 ──
  const resetForm = useCallback(() => {
    try { sessionStorage.clear(); } catch { /* 무시 */ }
    setResetKey((k) => k + 1);
    setStep('input');
    setName('');
    setPhone('');
    setCustomerEmail(''); // T-20260625-FOREIGN-SELFCHECKIN
    setReservationType(null);
    setVisitType('new');
    setWalkInModalOpen(false);
    setWalkInConfirmed(false);
    setLeadSource(null);
    setLeadSourceDetail(null);
    setQueueNumber(null);
    setErrorMsg('');
    setReservationBanner(null);
    setCountdown(DONE_RESET_SECONDS);
    // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP
    setRrn('');
    setAddress('');
    // T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX AC2: 동의 기본값 재설정.
    //   필수 동의(개인정보/건강보험)는 기본 체크(true).
    // T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-4: SMS 선택동의도 기본 체크(true)로 통일.
    setPrivacyConsent(true);
    setInsuranceConsent(true); // AC-7
    setSmsOptIn(true);
    setHealthQToken(null);
    setQrCountdown(QR_SCREEN_SECONDS);
    // T-20260601-foot-SELFLOGIN-RESV-LIST-QR
    setMaskedReservations([]);
    setReservationListLoading(false);
    rawReservationsRef.current.clear();
  }, []);

  // ── 완료 화면 자동 리셋 (15초 카운트다운) ──
  useEffect(() => {
    if (step !== 'done') return;
    setCountdown(DONE_RESET_SECONDS);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          resetForm();
          return DONE_RESET_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, resetForm]);

  // ── T-20260603-foot-SELFCHECKIN-RETURN-CONSENT-QR-4FIX: QR 화면 자동 타임아웃 (180초 → 초기 화면 복귀) ──
  // 기존: 120초 후 done 으로 전진. 변경: 180초 후 셀프접수 초기 화면으로 자동 복귀(resetForm).
  useEffect(() => {
    if (step !== 'qr') return;
    setQrCountdown(QR_SCREEN_SECONDS);
    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          resetForm();
          return QR_SCREEN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, resetForm]);

  // ── 입력 화면 비활동 타임아웃 (60초) ──
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      resetForm();
    }, IDLE_TIMEOUT_SECONDS * 1000);
  }, [resetForm]);

  useEffect(() => {
    if (step !== 'input') {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    resetIdleTimer();
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const handler = () => resetIdleTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((e) => window.removeEventListener(e, handler));
    };
  }, [step, resetIdleTimer]);

  // ── 전화번호 자동 포맷 ──
  const formatPhone = useCallback((digits: string): string => {
    const d = digits.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }, []);

  const handleNumPadDigit = useCallback(
    (digit: string) => {
      const currentDigits = phone.replace(/\D/g, '');
      if (currentDigits.length >= 11) return;
      setPhone(formatPhone(currentDigits + digit));
    },
    [phone, formatPhone],
  );

  const handleNumPadDelete = useCallback(() => {
    const currentDigits = phone.replace(/\D/g, '');
    if (currentDigits.length === 0) return;
    setPhone(formatPhone(currentDigits.slice(0, -1)));
  }, [phone, formatPhone]);

  const handleNumPadClear = useCallback(() => {
    setPhone('');
    setReservationBanner(null);
  }, []);

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: RRN 숫자패드 핸들러 ──
  const handleRrnDigit = useCallback((digit: string) => {
    setRrn((prev) => {
      const currentDigits = prev.replace(/\D/g, '');
      if (currentDigits.length >= 13) return prev;
      return formatRrn(currentDigits + digit);
    });
  }, []);

  const handleRrnDelete = useCallback(() => {
    setRrn((prev) => {
      const currentDigits = prev.replace(/\D/g, '');
      if (currentDigits.length === 0) return prev;
      return formatRrn(currentDigits.slice(0, -1));
    });
  }, []);

  const handleRrnClear = useCallback(() => setRrn(''), []);

  // ── 전화번호 완성 시 오늘 예약 조회 ──
  const reservationCheckedRef = useRef<string>('');

  useEffect(() => {
    if (!clinicId) return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      if (reservationBanner) setReservationBanner(null);
      reservationCheckedRef.current = '';
      return;
    }
    if (reservationCheckedRef.current === digits) return;
    reservationCheckedRef.current = digits;

    (async () => {
      try {
        // ── T-20260627-ANON-RLS-PHASE2B(2b 컷오버): reservations 직접 SELECT 2종 → RPC 1콜 ──
        //   fn_selfcheckin_reservation_banner 가 clinic 스코프 + 오늘(KST) + status='confirmed'
        //   + 연락처 digit 완전일치를 내부 처리(zero-PII: 시간/방문유형만 반환). 포맷 변종 비교 불요.
        const { data: bannerRows } = await anonClient.rpc('fn_selfcheckin_reservation_banner', {
          p_clinic_id: clinicId,
          p_phone: phone,
        });
        const reservation =
          (bannerRows as Array<{ reservation_time: string; visit_type: string }> | null)?.[0] ?? null;

        if (reservation) {
          const timeStr = (reservation.reservation_time as string).slice(0, 5);
          const vt = reservation.visit_type as VisitType;
          // 예약 배너 표시 — 방문유형 라벨 (체험 제외, new/returning만)
          const vtLabel = vt === 'new' ? t.visitNew : vt === 'returning' ? t.visitReturning : '';
          // 전화번호 직접조회 경로: name select 미수집(DB 조회 추가 없음) → 빈값, 배너 성함 접두 생략
          setReservationBanner({ time: timeStr, visitType: vtLabel, name: '' });
          // 예약 확인되면 자동으로 '예약하고 왔어요' + 해당 방문유형 설정
          if (vt === 'new' || vt === 'returning') {
            setReservationType('reserved');
            setVisitType(vt);
          }
        } else {
          setReservationBanner(null);
        }
      } catch {
        setReservationBanner(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, phone]);

  // ── 방문유형 1단계 선택 핸들러 ──
  const handleReservationTypeSelect = useCallback((rt: ReservationType) => {
    if (rt === 'walkin') {
      setReservationType('walkin');
      setWalkInModalOpen(true);
    } else {
      setReservationType('reserved');
      setWalkInModalOpen(false);
      setWalkInConfirmed(false);
      // T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 예약 경로는 leadSource 미수집
      setLeadSource(null);
      setLeadSourceDetail(null);
      setReferralName('');
    }
  }, []);

  // ── 워크인 확인 핸들러 ──
  const handleWalkInConfirm = useCallback(() => {
    setWalkInModalOpen(false);
    setWalkInConfirmed(true);
    setVisitType('new'); // 워크인 = 초진으로 접수
  }, []);

  const handleWalkInCancel = useCallback(() => {
    setWalkInModalOpen(false);
    setReservationType(null); // 선택 취소
    setLeadSource(null);
    setLeadSourceDetail(null);
    setReferralName('');
  }, []);

  // ── 유입경로 대분류 선택 (T-20260609 4대그룹) ──
  // 대분류 변경 시 하위 입력(소분류/성함) 초기화. sns·search는 소분류 선택 대기.
  const handleLeadSourceSelect = useCallback((source: string) => {
    setLeadSource(source);
    setLeadSourceDetail(null);
    setReferralName('');
  }, []);

  // ── 제출 가능 여부 ──
  // 1) 이름+전화 완성
  // 2) 방문유형 완성: (reserved + visitType 선택) 또는 (walkin confirmed)
  // 3) 유입경로 완성: leadSource 선택 + SNS면 detail도 선택
  const visitTypeComplete =
    (reservationType === 'reserved' && (visitType === 'new' || visitType === 'returning')) ||
    (reservationType === 'walkin' && walkInConfirmed);

  // 유입경로 완성 판정 (T-20260609):
  //   sns/search → 소분류 선택 필요. referral → 성함 선택(빈값 허용, AC-3). partner_etc → 즉시 완료.
  const leadSourceComplete =
    leadSource !== null &&
    ((leadSource !== 'sns' && leadSource !== 'search') || leadSourceDetail !== null);

  // 고객차트 방문경로 소분류 매핑 (T-20260609 수정2, 코드 기준 확정 enum)
  //   값: SNS_인스타그램 / SNS_페이스북 / SNS_틱톡유튜브 / SNS_블로그카페
  //       검색_네이버 / 검색_구글 / 지인소개_{성함}(또는 지인소개) / 제휴기타
  //   visit_route_detail 은 자유 TEXT(CHECK 미적용) — 성함 인라인 + enum 확장 자유.
  const visitRouteDetail = (() => {
    if (leadSource === 'sns') {
      const m: Record<string, string> = {
        instagram: 'SNS_인스타그램',
        facebook: 'SNS_페이스북',
        tiktok_youtube: 'SNS_틱톡유튜브',
        blog_cafe: 'SNS_블로그카페',
      };
      return leadSourceDetail ? m[leadSourceDetail] ?? null : null;
    }
    if (leadSource === 'search') {
      const m: Record<string, string> = { naver: '검색_네이버', google: '검색_구글' };
      return leadSourceDetail ? m[leadSourceDetail] ?? null : null;
    }
    if (leadSource === 'referral') {
      const nm = referralName.trim();
      return nm ? `지인소개_${nm}` : '지인소개';
    }
    if (leadSource === 'partner_etc') return '제휴기타';
    return null;
  })();

  // T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 워크인만 유입경로 수집
  const showLeadSource = reservationType === 'walkin';

  // ── T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW: 외국인 흐름 = English 선택 시 자동 진입(별도 QR/버튼 無) ──
  const isForeign = lang === 'en';
  const phoneFilled = phone.replace(/\D/g, '').length >= 10;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim());
  // 외국인 워크인: 연락처 또는 이메일 택1 최소1개(DA Q3 — FE 강제, DB CHECK 금지). 내국인: 연락처 필수.
  const contactComplete = isForeign ? (phoneFilled || emailValid) : phoneFilled;

  const canSubmit =
    name.trim().length >= 1 &&
    contactComplete &&
    visitTypeComplete &&
    (!showLeadSource || leadSourceComplete);

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 완료 여부 ──
  // T-20260625-FOREIGN: 외국인은 주민번호 미수집(여권=PASSPORT-PORT) → RRN 게이트 면제.
  //   동의서(§C)는 외국인이면 예약/워크인 모두 필수.
  const personalInfoComplete =
    (isForeign || extractBirthDate(rrn) !== null) &&
    address.trim().length >= 2 &&
    ((reservationType !== 'walkin' && !isForeign) || privacyConsent);

  // ── T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-1: 우편번호 검색(다음/카카오 postcode) ──
  // CustomerChartPage.openKakaoPostcode 패턴 재사용. 선택 시 우편번호+기본주소 자동기입.
  // 상세주소는 사용자가 별도 입력. 저장은 접수 제출 시(handleSubmit) customers 컬럼으로.
  const openAddressSearch = () => {
    const runPostcode = () => {
      // @ts-expect-error Kakao/Daum Postcode global
      new window.daum.Postcode({
        oncomplete: (data: { zonecode: string; address: string }) => {
          setPostalCode(data.zonecode || '');
          setAddress(data.address || '');
        },
      }).open();
    };
    // @ts-expect-error Kakao/Daum Postcode global
    if (!window.daum?.Postcode) {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = () => runPostcode();
      document.head.appendChild(script);
    } else {
      runPostcode();
    }
  };

  // ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 오늘 예약자 목록 로드 ──
  // "예약하고 왔어요" + 초진/재진 선택 후 호출 → 마스킹 목록 화면으로 전환.
  const handleLoadReservations = useCallback(async () => {
    if (!clinicId) return;
    setReservationListLoading(true);
    rawReservationsRef.current.clear();
    setStep('select-reservation');
    try {
      // KST '오늘' — 중앙 헬퍼(en-CA + Asia/Seoul). 기존 toISOString()은 UTC 기준이라
      // 00:00~08:59 KST 새벽 접수 시 전날을 조회해 빈 목록을 유발했음.
      const today = todaySeoulISODate();
      const { data, error } = await anonClient.rpc('fn_selfcheckin_today_reservations', {
        p_clinic_id: clinicId,
        p_date: today,
      });
      if (error) throw error;

      const rows = (data || []) as Array<{
        id: string;
        customer_id: string | null;
        customer_name: string | null;
        customer_phone: string | null;
        reservation_time: string;
        visit_type: string;
      }>;

      // PII 가드: 수신 즉시 마스킹 변환. 원본 name/phone 은 ref 에만 저장.
      const masked: MaskedReservation[] = rows.map((r) => {
        const rawName = r.customer_name ?? '';
        const rawPhone = r.customer_phone ?? '';
        rawReservationsRef.current.set(r.id, { name: rawName, phone: rawPhone });
        return {
          reservation_id: r.id,
          customer_id: r.customer_id,
          masked_name: maskName(rawName),
          masked_phone: maskPhone(rawPhone),
          reservation_time: String(r.reservation_time).slice(0, 5),
          visit_type: (r.visit_type as VisitType) ?? 'returning',
        };
      });

      // T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL AC-1: 예약시간 오름차순 고정.
      // RPC가 ORDER BY reservation_time ASC 로 정렬하지만, 어떤 경로로든(향후 부분 갱신·
      // append 포함) 순서가 흔들려도 명단은 항상 전체 재정렬 후 렌더한다. (append 금지)
      const sorted = [...masked].sort((a, b) =>
        a.reservation_time.localeCompare(b.reservation_time),
      );

      setMaskedReservations(sorted);
    } catch {
      // 목록 로드 실패 → 빈 목록(폴백 안내) 표시. 콘솔에 PII 미노출.
      setMaskedReservations([]);
    } finally {
      setReservationListLoading(false);
    }
  }, [clinicId]);

  // ── T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL AC-2: 현재 시각대 자동 스크롤 선노출 ──
  // 트리거: 예약자 명단 진입 시 AND 명단 갱신(재정렬) 후.
  // 대상: 현재 시각 이후 가장 가까운 예약 항목(없으면 마지막). viewport 상단에 오도록 scrollIntoView.
  // 가드: 동일 명단 시그니처에는 1회만 점프 → 사용자가 수동 스크롤 중일 때 강제 점프 회피.
  useEffect(() => {
    if (step !== 'select-reservation') {
      // 화면 이탈 시 시그니처 리셋 → 재진입 시 다시 1회 자동 스크롤.
      autoScrolledSigRef.current = '';
      return;
    }
    if (maskedReservations.length === 0) {
      setNowTargetId(null);
      return;
    }

    // 현재 시각(KST) 이후 가장 가까운 예약 → 없으면 마지막 항목.
    const nowHHMM = nowSeoulHHMM();
    const target =
      maskedReservations.find((r) => r.reservation_time >= nowHHMM) ??
      maskedReservations[maskedReservations.length - 1];
    setNowTargetId(target.reservation_id);

    // 명단 내용(순서/구성)이 바뀌었을 때만 자동 스크롤 1회 — 수동 스크롤 점유 회피.
    const sig = maskedReservations.map((r) => `${r.reservation_id}:${r.reservation_time}`).join('|');
    if (autoScrolledSigRef.current === sig) return;
    autoScrolledSigRef.current = sig;

    // 렌더 직후 DOM ref 확정 보장.
    const raf = requestAnimationFrame(() => {
      const el = reservationItemRefs.current.get(target.reservation_id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [step, maskedReservations]);

  // ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 항목 선택 → 고객정보 자동 로드 ──
  // 선택 시점에만 ref 에서 본인 1건의 원본 name/phone 을 꺼내 폼 state 에 주입.
  const handleSelectReservation = useCallback(
    (item: MaskedReservation) => {
      const raw = rawReservationsRef.current.get(item.reservation_id);
      const rawName = raw?.name ?? '';
      const rawPhone = raw?.phone ?? '';

      // 전화번호 표시 정규화: E164(+8210…) → 010… 후 하이픈 포맷
      let digits = rawPhone.replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('82')) digits = '0' + digits.slice(2);
      const displayPhone = formatPhone(digits);

      setName(rawName);
      setPhone(displayPhone);
      setReservationType('reserved');
      const vt: VisitType = item.visit_type === 'new' ? 'new' : item.visit_type === 'experience' ? 'experience' : 'returning';
      setVisitType(vt);
      // 예약 경로 → 유입경로 미수집
      setLeadSource(null);
      setLeadSourceDetail(null);
      // 예약 배너 표시 (선택 항목 정보)
      setReservationBanner({
        time: item.reservation_time,
        visitType: vt === 'new' ? t.visitNew : vt === 'returning' ? t.visitReturning : '',
        // ref 원본 성함 (DB 추가 조회 없음, 빈값 가능)
        name: rawName,
      });
      // 전화 자동조회 useEffect 재트리거 방지 (이미 채워진 번호)
      reservationCheckedRef.current = digits;

      // 초진 → 개인정보 입력 / 재진·체험 → 바로 확인
      if (vt === 'new') {
        setStep('personal_info');
      } else {
        setStep('confirm');
      }
    },
    [formatPhone, t],
  );

  // ── T-20260529: input → personal_info(초진) 또는 confirm(재진) ──
  const handleConfirm = () => {
    if (!canSubmit) return;
    if (visitType === 'new') {
      setStep('personal_info');
    } else {
      setStep('confirm');
    }
  };

  const handleSubmit = async () => {
    if (!clinicId) return;
    setSubmitting(true);
    setErrorMsg('');

    try {
      // LOGIC-LOCK L-001: 화면에서 고객 선택/표시 금지
      let customerId: string | null = null;
      const phoneDigits = phone.replace(/\D/g, '');
      const phoneE164 = normalizeToE164(phone);
      const phoneStored = phoneE164 ?? phoneDigits;

      // ── 고객 해소: 복합키(성함 AND 연락처) — T-20260627-ANON-RLS-PHASE2B Gate B 컷오버 ──
      //   2b(anon SELECT/INSERT...RETURNING 제거) 대비: customers 직접 SELECT/UPDATE/INSERT 경로를
      //   SECURITY DEFINER RPC fn_selfcheckin_upsert_customer_resolve_v2 1콜로 통합.
      //   RPC 가 서버 권위로: 복합키[성함 AND 연락처 canonical] 매칭 → 1건 linked(멱등 UPDATE) /
      //   0건 created(INSERT) / 2건+ ambiguous(자동연결·신규생성 동시 보류, customer_id NULL).
      //   (gap#1 오배정 6/17 김사비→문자테스트 해소 — 동명이인+연락처중복 임의연결 차단.)
      //   분기 판단(외국인/워크인/신규)은 FE 유지 — 전달할 값만 계산해 넘기고 RPC 는 멱등 persist.
      let ambiguousLink = false; // 성함+연락처 동시중복 → 자동연결/신규생성 모두 보류
      const isNewVisit = visitType === 'new';
      // 동의/이메일 수집 게이트(원본 분기 보존 — RPC 재파생 금지):
      //   privacy: 초진 & (외국인 또는 워크인) / hira: 초진 & 워크인 & 내국인 / email: 외국인 & 입력
      const collectPrivacy = isNewVisit && (isForeign || reservationType === 'walkin');
      const collectHira = isNewVisit && reservationType === 'walkin' && !isForeign;
      const emailParam = isForeign && customerEmail.trim() ? customerEmail.trim() : null;
      const { data: resolveRows, error: resolveErr } = await anonClient.rpc(
        'fn_selfcheckin_upsert_customer_resolve_v2',
        {
          p_clinic_id: clinicId,
          p_name: name.trim(),
          // 외국인 워크인은 연락처 대신 이메일만 가능 → phone 빈값이면 null(컬럼 nullable).
          p_phone: phoneStored || null,
          p_visit_type: visitType === 'new' ? 'new' : 'returning',
          p_sms_opt_in: smsOptIn,
          p_birth_date: isNewVisit ? extractBirthDate(rrn) ?? null : null,
          p_address: isNewVisit && address.trim() ? address.trim() : null,
          p_postal_code: isNewVisit && postalCode.trim() ? postalCode.trim() : null,
          p_address_detail: isNewVisit && addressDetail.trim() ? addressDetail.trim() : null,
          // ⚠ customer_email = 환자 이메일(기관 email 아님, DA Q3 MUST).
          p_customer_email: emailParam,
          p_privacy_consent: collectPrivacy ? privacyConsent : null,
          // 외국인은 국내 건강보험 비대상 → hira 미전달(NULL=유지).
          p_hira_consent: collectHira ? insuranceConsent : null,
        },
      );
      if (resolveErr) {
        throw new Error(`고객 등록 실패: ${resolveErr.message}`);
      }
      const resolved =
        (resolveRows as Array<{ customer_id: string | null; link_status: string }> | null)?.[0] ?? null;
      if (resolved?.link_status === 'ambiguous') {
        // customerId NULL 유지 → check_in 은 denormalized 성함/연락처만 기록(미연결). 대시보드에서 재해소.
        ambiguousLink = true;
      } else if (resolved?.customer_id) {
        customerId = resolved.customer_id;
      }

      // ── T-20260506-foot-SELFCHECKIN-MERGE: 예약 merge 로직 ────────────────
      // KST '오늘' — toISOString()(UTC)은 +09:00 범위와 조합 시 새벽에 전날 범위를 만들어 오매칭.
      const todayDate = todaySeoulISODate();

      // (1) 당일 기존 체크인 중복 방지 — T-20260627-ANON-RLS-PHASE2B(2b): check_ins 직접 SELECT → RPC.
      //   fn_selfcheckin_existing_checkin_today 가 clinic 스코프 + 오늘(KST) 을 내부 처리.
      if (customerId) {
        const { data: existingRows } = await anonClient.rpc('fn_selfcheckin_existing_checkin_today', {
          p_clinic_id: clinicId,
          p_customer_id: customerId,
        });
        const existingCi =
          (existingRows as Array<{ id: string; queue_number: number | null }> | null)?.[0] ?? null;
        if (existingCi) {
          setQueueNumber(existingCi.queue_number ?? null);
          // T-20260529: 기존 체크인이 있으면 done으로 직행 (QR 재발급 없음)
          setStep('done');
          setSubmitting(false);
          return;
        }
      }

      // (2) 당일 예약 매칭 — T-20260627-ANON-RLS-PHASE2B(2b): reservations 직접 SELECT 다종 → RPC 1콜.
      //   fn_selfcheckin_match_reservation: customer_id 우선 → 연락처 digit 완전일치 順 (clinic·오늘·confirmed).
      //   ★ Fallback B(고객명 단독 매칭)는 RPC 미포팅 — §16-3 ④ 이름단독 폴백 금지(enumeration 차단).
      //     의도된 보안 발산이며 회귀 아님(둘 다 제공 동선의 narrowing 만 허용, OR-widening 불가).
      let matchedReservationId: string | null = null;
      try {
        const { data: matchedId } = await anonClient.rpc('fn_selfcheckin_match_reservation', {
          p_clinic_id: clinicId,
          p_customer_id: customerId,
          p_phone: phoneStored,
          p_name: name.trim(),
        });
        if (matchedId) matchedReservationId = matchedId as string;
      } catch {
        // 예약 조회 실패 → 신규 접수로 처리
      }

      // (2.5) 예약에 연결된 기존 체크인 확인 — T-20260627-ANON-RLS-PHASE2B(2b): check_ins 직접 SELECT → RPC.
      if (matchedReservationId) {
        try {
          const { data: linkedRows } = await anonClient.rpc('fn_selfcheckin_linked_checkin', {
            p_clinic_id: clinicId,
            p_reservation_id: matchedReservationId,
          });
          const linkedCi =
            (linkedRows as Array<{ id: string; queue_number: number | null }> | null)?.[0] ?? null;
          if (linkedCi) {
            setQueueNumber(linkedCi.queue_number ?? null);
            setStep('done');
            setSubmitting(false);
            return;
          }
        } catch {
          // RLS 차단 등 → 무시
        }
      }

      const { data: queueData, error: queueErr } = await anonClient.rpc('next_queue_number', {
        p_clinic_id: clinicId,
        p_date: todayDate,
      });

      let queue: number | null = null;
      if (!queueErr) queue = queueData as number;

      // notes: 신분증 확인 + 워크인 플래그 + 유입경로 저장
      const notesParts: Record<string, unknown> = {};
      // T-20260617 (AC-1 ①): 성함+연락처 동시중복으로 자동연결 보류 → 현장 재해소 플래그(미연결 체크인 식별용).
      if (ambiguousLink) notesParts.unlinked_ambiguous = true;
      if (visitType === 'new') notesParts.id_check_required = true;
      if (reservationType === 'walkin') notesParts.walk_in = true;
      if (leadSource) notesParts.lead_source = leadSource;
      if (leadSourceDetail) notesParts.lead_source_detail = leadSourceDetail;
      // T-20260609: 지인소개 성함 + 매핑된 차트 소분류도 notes 에 흔적 남김(감사·추적용)
      if (leadSource === 'referral' && referralName.trim()) notesParts.referral_name = referralName.trim();
      if (visitRouteDetail) notesParts.visit_route_detail = visitRouteDetail;
      const notesPayload = Object.keys(notesParts).length > 0 ? notesParts : null;

      // T-20260627-ANON-RLS-PHASE2B(2b): check_ins INSERT...RETURNING 직접 경로 → fn_selfcheckin_create_check_in RPC.
      //   2b 에서 anon SELECT 제거 시 .insert().select('id') 가 42501(RETURNING=read) → RPC 로 id 반환.
      //   RPC 가 status 화이트리스트(registered/treatment_waiting/consult_waiting/receiving)·clinic 스코프 강제.
      // T-20260602-foot-CHECKIN-RECEIVING-SLOT:
      //   재진→치료대기 직행 / 초진→[접수중](발건강질문지 작성 중) / 그 외(예약없이방문)→상담대기 직행
      const ciStatus = visitType === 'returning'
        ? 'treatment_waiting'
        : visitType === 'new'
          ? 'receiving'
          : 'consult_waiting';
      const { data: ciInsertData, error: ciErr } = await anonClient.rpc('fn_selfcheckin_create_check_in', {
        p_clinic_id: clinicId,
        p_customer_id: customerId,
        p_customer_name: name.trim(),
        p_customer_phone: phoneStored,
        p_visit_type: visitType,
        p_status: ciStatus,
        p_queue_number: queue,
        p_notes: notesPayload,
        p_reservation_id: matchedReservationId,
      });

      if (ciErr) {
        // T-20260529-foot-RESV-CHECKIN-NOSAVE AC-4:
        // 23505 = unique violation — 예약 ID 중복 (취소 후 재접수 시나리오)
        // DB 수준은 unique_reservation_checkin 인덱스 재정의(cancelled 제외)로 해결.
        // FE 레벨 방어: 그럼에도 충돌 시 사용자 친화적 메시지 표시.
        const msg = ciErr.code === '23505'
          ? t.duplicateCheckIn
          : `${t.failPrefix}${ciErr.message}`;
        setErrorMsg(msg);
        setStep('error');
        setSubmitting(false);
        return;
      }

      // fn_selfcheckin_create_check_in RETURNS UUID → data 가 check_in id(string) 직접.
      const newCheckInId = (ciInsertData as string | null) ?? null;

      // (3) 매칭된 예약 → checked_in 상태 업데이트
      //   write-path(UPDATE, no RETURNING) — 2b(anon SELECT revoke) 무관. anon UPDATE 정책은 2c 게이트까지 보존
      //   (20260615180000 revoke 파일 §15 주석: SELECT=2b / INSERT·UPDATE=2c 분리). 본 컷오버 범위 밖.
      if (matchedReservationId) {
        try {
          await anonClient
            .from('reservations')
            .update({ status: 'checked_in' })
            .eq('id', matchedReservationId)
            .eq('status', 'confirmed');
        } catch {
          // RLS/권한 오류 → 무시
        }
      }

      // (3.5) TA3 — 도파민 visited 콜백 fire-and-forget
      if (matchedReservationId) {
        anonClient.functions
          .invoke('checkin-visited-fire', {
            body: { reservation_id: matchedReservationId },
          })
          .catch(() => {
            // 네트워크 오류 등 — 무시
          });
      }

      setQueueNumber(queue);

      // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 초진 → 개인정보 업데이트 + QR 토큰 ──
      if (visitType === 'new' && newCheckInId && clinicId) {
        // (4) 개인정보 업데이트 (birth_date + address + privacy_consent)
        // 기존 고객은 업데이트, 신규 고객은 INSERT 시 이미 포함. 중복 업데이트 허용 (멱등).
        try {
          const { error: piErr } = await anonClient.rpc('fn_selfcheckin_update_personal_info', {
            p_check_in_id:       newCheckInId,
            p_clinic_id:         clinicId,
            p_birth_date:        extractBirthDate(rrn) ?? null,
            p_address:           address.trim() || null,
            // T-20260625-FOREIGN: 외국인은 워크인/예약 모두 §C 동의 필수 → 동의값 전달(멱등 재확정).
            p_privacy_consent:   (reservationType === 'walkin' || isForeign) ? privacyConsent : null,
            // T-20260625-FOREIGN: 외국인은 국내 건강보험 비대상 → hira 동의 미전달(NULL=유지).
            p_insurance_consent: isForeign ? null : (insuranceConsent || null), // AC-7: true 시만 전달
            // T-20260609 수정2: 워크인 동선만 방문경로 대분류(워크인)+소분류(유입경로) 전달
            p_visit_route:        reservationType === 'walkin' ? '워크인' : null,
            p_visit_route_detail: reservationType === 'walkin' ? visitRouteDetail : null,
          });
          // T-20260611-foot-WALKIN-CHART-HIRA-CONSENT-NOTSAVED AC-2: silent-fail 표면화.
          //   기존 빈 catch{} 가 RPC 시그니처 불일치(PGRST202 등)를 삼켜, hira/주소/동의 미저장 버그가
          //   현장 신고 전까지 무관측이었다. 접수 완료 UX 는 계속 비블로킹이되 콘솔/모니터링에 노출한다.
          if (piErr) {
            console.error('[selfcheckin] fn_selfcheckin_update_personal_info 실패 (개인정보/동의/주소 미저장 위험):', piErr);
          }
        } catch (e) {
          // 네트워크/예외 — 접수 완료 UX 는 블록하지 않되 표면화(AC-2)
          console.error('[selfcheckin] fn_selfcheckin_update_personal_info 예외:', e);
        }

        // (4.5) AC-9: 주민번호 자동 매칭 — 데스크 기입 레코드와 병합 시도
        // 결과에 관계없이 silent (매칭 실패해도 접수 완료 UX 블록 안 함)
        try {
          await anonClient.rpc('fn_selfcheckin_rrn_match', {
            p_check_in_id: newCheckInId,
            p_clinic_id:   clinicId,
          });
        } catch {
          // RRN 매칭 실패 → 무시 (접수 완료 계속 진행)
        }

        // (5) 발건강질문지 QR 토큰 생성
        try {
          // T-20260625-FOREIGN: 외국인(English) → 영문 발건강질문지 토큰(lang='en') 발급.
          //   p_lang 은 마이그 20260625150000(함수 3-arg 확장) 적용 후 동작. 마이그 미적용 구간 방어:
          //   내국인(ko)은 p_lang 미전달 → 기존 2-arg 함수와 후방호환 유지(QR 무회귀). 외국인만 p_lang 전달.
          const tokenArgs: Record<string, unknown> = {
            p_check_in_id: newCheckInId,
            p_clinic_id:   clinicId,
          };
          if (isForeign) tokenArgs.p_lang = 'en';
          const { data: tokenResult } = await anonClient.rpc('fn_selfcheckin_create_health_q_token', tokenArgs);
          const tokenRes = tokenResult as { success: boolean; token?: string } | null;
          if (tokenRes?.success && tokenRes.token) {
            setHealthQToken(tokenRes.token);
          }
        } catch {
          // QR 토큰 생성 실패 → QR 없이 done으로 이동
        }

        // 초진: QR 화면으로
        setStep('qr');
      } else {
        // 재진: done으로
        setStep('done');
      }
    } catch (err) {
      setErrorMsg(`${t.errorPrefix}${(err as Error).message}`);
      setStep('error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 언어 전환 버튼 ──
  const LangToggle = () => (
    <button
      type="button"
      onClick={() => setLang((l) => (l === 'ko' ? 'en' : 'ko'))}
      data-testid="lang-toggle"
      className="fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold shadow-md transition active:scale-95"
      style={{
        backgroundColor: C.cream,
        border: `1.5px solid ${C.border}`,
        color: C.muted,
        fontFamily: FONT_STYLE.fontFamily,
      }}
    >
      <span className="text-base">{lang === 'ko' ? '🇺🇸' : '🇰🇷'}</span>
      <span>{lang === 'ko' ? 'EN' : '한국어'}</span>
    </button>
  );

  // ── 로딩 ──
  if (loading) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <p className="text-lg" style={{ color: C.muted }}>{t.loading}</p>
      </div>
    );
  }

  // ── 클리닉 없음 ──
  if (clinicNotFound) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(to bottom, #FEF2F2, white)`, ...FONT_STYLE }}
      >
        <LangToggle />
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-red-600">{t.clinicNotFound}</h1>
          <p className="text-gray-500">{t.clinicNotFoundDesc}</p>
        </div>
      </div>
    );
  }

  // ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 목록 선택 화면 ──
  if (step === 'select-reservation') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center px-6"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
        data-testid="select-reservation-screen"
      >
        <LangToggle />
        {/* 헤더 */}
        <header className="px-6 pb-2 pt-10 text-center">
          <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: C.gold }}>
            OBLIV FOOT CENTER
          </p>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.dark }}>
            {t.selectReservationTitle}
          </h1>
          <p className="mt-1 text-sm tracking-wide" style={{ color: C.muted }}>{clinicName}</p>
          <div className="mx-auto mt-3 h-px w-16" style={{ backgroundColor: C.gold }} />
        </header>

        <main className="flex w-full flex-1 flex-col items-center px-2 pb-8 pt-3">
          <div className="w-full max-w-md space-y-4">
            {reservationListLoading ? (
              <p className="py-12 text-center text-base" style={{ color: C.muted }} data-testid="reservation-list-loading">
                {t.reservationListLoading}
              </p>
            ) : maskedReservations.length === 0 ? (
              /* 시나리오 3: 오늘 예약 없음 — 폴백 안내 */
              <div className="space-y-5 py-8 text-center" data-testid="reservation-list-empty">
                <h2 className="text-lg font-bold" style={{ color: C.dark }}>{t.noReservationTitle}</h2>
                <p className="text-base leading-relaxed" style={{ color: C.muted, whiteSpace: 'pre-line' }}>
                  {t.noReservationDesc}
                </p>
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="h-14 w-full rounded-xl text-lg font-bold text-white transition active:scale-[0.99]"
                    style={{ backgroundColor: C.primary }}
                    data-testid="btn-back-to-phone-checkin"
                  >
                    {t.backToPhoneCheckin}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-center text-sm font-medium" style={{ color: C.medium }}>
                  {t.selectReservationGuide}
                </p>
                <div
                  ref={reservationListRef}
                  className="max-h-[60vh] space-y-2 overflow-y-auto"
                  data-testid="reservation-list"
                >
                  {maskedReservations.map((item) => {
                    // T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL AC-2:
                    // 현재 시각대(자동 스크롤 대상) 항목 시각적 선노출 하이라이트.
                    const isNow = item.reservation_id === nowTargetId;
                    return (
                      <button
                        key={item.reservation_id}
                        ref={(el) => {
                          if (el) reservationItemRefs.current.set(item.reservation_id, el);
                          else reservationItemRefs.current.delete(item.reservation_id);
                        }}
                        type="button"
                        onClick={() => handleSelectReservation(item)}
                        className="flex min-h-[68px] w-full items-center justify-between rounded-xl px-5 py-4 text-left transition active:scale-[0.99]"
                        style={{
                          border: `1.5px solid ${isNow ? C.primary : C.border}`,
                          backgroundColor: isNow ? `${C.primary}0D` : 'white',
                        }}
                        data-testid="reservation-item"
                        data-now={isNow ? 'true' : undefined}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold" style={{ color: C.dark }}>
                            {item.masked_name}
                          </span>
                          <span className="text-base" style={{ color: C.muted }}>
                            {item.masked_phone}
                          </span>
                        </div>
                        <span className="flex shrink-0 items-center gap-2">
                          {isNow && (
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                              style={{ backgroundColor: C.primary }}
                              data-testid="reservation-now-badge"
                            >
                              {t.reservationNowBadge}
                            </span>
                          )}
                          <span className="text-base font-semibold tabular-nums" style={{ color: C.medium }}>
                            {item.reservation_time}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* 돌아가기 — 전화번호 접수 폴백 동선 진입점 */}
            <button
              type="button"
              onClick={() => setStep('input')}
              className="mt-2 w-full rounded-xl py-4 text-base font-medium transition active:scale-95"
              style={{ border: `1.5px solid ${C.border}`, color: C.muted, backgroundColor: 'white' }}
              data-testid="btn-reservation-list-back"
            >
              {t.reservationListBack}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: QR 화면 ──
  if (step === 'qr') {
    const qrUrl = healthQToken
      ? `${window.location.origin}/health-q/${healthQToken}`
      : null;
    const qrImageUrl = qrUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrUrl)}&qzone=2&margin=0&format=png`
      : null;

    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
        data-testid="qr-screen"
      >
        <LangToggle />
        <div className="w-full max-w-md space-y-6 text-center">
          {/* 클리닉명 */}
          <p className="text-sm font-medium tracking-wide" style={{ color: C.medium }}>
            {clinicName}
          </p>

          {/* QR 화면 제목 */}
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.dark }}>
              {t.qrTitle}
            </h1>
            {/* AC-2: QR 상단 안내 멘트 */}
            <p
              className="mt-3 text-base leading-relaxed"
              style={{ color: C.medium, whiteSpace: 'pre-line' }}
              data-testid="qr-guide-text"
            >
              {t.qrGuide}
            </p>
          </div>

          {/* QR 코드 영역 — AC-1, AC-2, AC-3 */}
          <div
            className="mx-auto flex flex-col items-center justify-center rounded-2xl p-6 shadow-md"
            style={{ backgroundColor: 'white', border: `2px solid ${C.border}`, width: 'fit-content' }}
            data-testid="qr-code-container"
          >
            {qrImageUrl ? (
              <img
                src={qrImageUrl}
                alt="발건강 질문지 QR 코드"
                width={280}
                height={280}
                className="rounded-lg"
                style={{ display: 'block' }}
                onError={(e) => {
                  // QR 이미지 로드 실패 시 에러 메시지 표시
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const errorEl = target.nextElementSibling as HTMLElement | null;
                  if (errorEl) errorEl.style.display = 'block';
                }}
                data-testid="qr-code-image"
              />
            ) : null}
            {/* QR 이미지 없거나 로드 실패 시 fallback */}
            <div
              style={{ display: qrImageUrl ? 'none' : 'block', textAlign: 'center' }}
              data-testid="qr-fallback"
            >
              <div
                className="flex h-[280px] w-[280px] items-center justify-center rounded-lg"
                style={{ backgroundColor: C.beige, border: `2px dashed ${C.border}` }}
              >
                <p className="text-sm px-4" style={{ color: C.muted }}>
                  {t.qrError}
                </p>
              </div>
            </div>
          </div>

          {/* 대기번호 (있는 경우) */}
          {queueNumber != null && (
            <div>
              <p className="text-sm" style={{ color: C.muted }}>{t.queueNumber}</p>
              <p className="mt-1 text-6xl font-black tabular-nums" style={{ color: C.primary }}>
                #{queueNumber}
              </p>
            </div>
          )}

          {/* 자동 전진 카운트다운 */}
          <p className="text-sm" style={{ color: C.gold }}>
            {t.qrAutoReset(qrCountdown)}
          </p>

          {/* 정상접수(QR 스캔 완료) 버튼 — T-20260603 항목4 */}
          <button
            onClick={() => setStep('done')}
            className="w-full rounded-xl py-5 text-xl font-bold text-white transition active:scale-[0.99]"
            style={{ backgroundColor: C.primary }}
            data-testid="btn-qr-done"
          >
            {t.qrDone}
          </button>

          {/* 이전 단계로 돌아가기 버튼 — T-20260603 항목4: 정상접수 버튼 아래.
              setStep('confirm') 시 QR 타이머 useEffect cleanup 으로 카운트다운 자동 중단. */}
          <button
            onClick={() => setStep('confirm')}
            className="w-full rounded-xl py-4 text-base font-medium transition active:scale-95"
            style={{ border: `1.5px solid ${C.border}`, color: C.muted, backgroundColor: 'white' }}
            data-testid="btn-qr-back"
          >
            {t.qrBack}
          </button>
        </div>
      </div>
    );
  }

  // ── 완료 ──
  if (step === 'done') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <LangToggle />
        <div className="w-full max-w-md space-y-8 text-center">
          <p className="text-base font-medium tracking-wide" style={{ color: C.medium }}>
            {clinicName}
          </p>
          <div
            className="mx-auto flex h-28 w-28 items-center justify-center rounded-full animate-pulse"
            style={{ backgroundColor: C.beige, border: `2px solid ${C.gold}` }}
          >
            <svg
              className="h-14 w-14"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              style={{ color: C.primary }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: C.dark }}>{t.done}</h1>
            {queueNumber != null && (
              <div className="mt-6">
                <p className="text-sm" style={{ color: C.muted }}>{t.queueNumber}</p>
                <p className="mt-1 text-8xl font-black tabular-nums" style={{ color: C.primary }}>
                  #{queueNumber}
                </p>
              </div>
            )}
            <p className="mt-6 text-lg" style={{ color: C.muted }}>
              {t.doneMsg(name.trim())}
            </p>
          </div>
          <p className="text-sm" style={{ color: C.gold }}>
            {t.autoReset(countdown)}
          </p>
          <button
            onClick={resetForm}
            className="mx-auto block rounded-xl px-8 py-4 text-lg font-medium transition active:scale-95"
            style={{ backgroundColor: C.beige, color: C.medium, border: `1.5px solid ${C.border}` }}
          >
            {t.newCheckIn}
          </button>
        </div>
      </div>
    );
  }

  // ── 에러 ──
  if (step === 'error') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(to bottom, #FEF2F2, white)`, ...FONT_STYLE }}
      >
        <LangToggle />
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-2xl font-bold text-red-600">{t.errorTitle}</h1>
          <p className="text-gray-600">{errorMsg}</p>
          <button
            onClick={() => setStep('input')}
            className="mx-auto block rounded-xl px-8 py-4 text-lg font-medium transition active:scale-95"
            style={{ backgroundColor: C.beige, color: C.medium, border: `1.5px solid ${C.border}` }}
          >
            {t.retry}
          </button>
        </div>
      </div>
    );
  }

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 화면 ──
  // 초진 고객(예약 있음/워크인)이 주민번호+주소+(동의서) 입력하는 단계
  if (step === 'personal_info') {
    return (
      <div
        className="flex min-h-dvh flex-col"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
        data-testid="personal-info-screen"
      >
        <LangToggle />

        {/* 헤더 */}
        <header className="px-6 pb-2 pt-10 text-center">
          <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: C.gold }}>
            OBLIV FOOT CENTER
          </p>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.dark }}>
            {t.personalInfoTitle}
          </h1>
          <div className="mx-auto mt-3 h-px w-16" style={{ backgroundColor: C.gold }} />
        </header>

        <main className="flex flex-1 flex-col items-center px-6 pb-8 pt-5">
          <div className="w-full max-w-md space-y-5">

            {/* 예약 배너 (예약 있는 경우) */}
            {reservationBanner && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3"
                style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}
              >
                <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: C.medium }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium" style={{ color: C.medium }} data-testid="reservation-banner">
                  {reservationBanner.name ? `${reservationBanner.name}님, ` : ''}
                  {t.reservationBanner(reservationBanner.time, reservationBanner.visitType)}
                </span>
              </div>
            )}

            {/* 주민번호 입력 — RRN NumPad.
                T-20260625-FOREIGN: 외국인은 주민번호 미수집(여권 = PASSPORT-PORT 번들) → 숨김. */}
            {!isForeign && (
            <div className="space-y-2">
              <label className="block text-sm font-medium tracking-wide" style={{ color: C.medium }}>
                {t.rrnLabel}
              </label>
              {/* 입력값 표시 (뒷자리 마스킹) */}
              <div
                className="flex h-14 w-full items-center rounded-xl px-4 text-lg font-mono"
                style={{
                  border: `1.5px solid ${rrn ? C.borderActive : C.border}`,
                  backgroundColor: 'white',
                }}
                data-testid="rrn-display"
              >
                {rrn ? (
                  <span style={{ color: C.dark }}>{rrn}</span>
                ) : (
                  <span className="text-base font-sans" style={{ color: C.border }}>
                    {t.rrnPlaceholder}
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: C.muted }}>{t.rrnNote}</p>
              {/* RRN 전용 숫자패드 */}
              <NumPad
                onDigit={handleRrnDigit}
                onDelete={handleRrnDelete}
                onClear={handleRrnClear}
                clearLabel={t.clearAll}
              />
            </div>
            )}

            {/* T-20260625-FOREIGN: 외국인 = 국내 체류지(숙소) 검색 위젯(카카오 로컬). 내국인 = 우편번호 검색. */}
            {isForeign ? (
              <ForeignStayAddressInput
                address={address}
                onAddressChange={setAddress}
                addressDetail={addressDetail}
                onAddressDetailChange={setAddressDetail}
                searchLabel={t.stayAddressLabel}
                searchPlaceholder={t.stayAddressPlaceholder}
                detailLabel={t.stayAddressDetailLabel}
                detailPlaceholder={t.stayAddressDetailPlaceholder}
                manualToggleLabel={t.stayManualToggle}
                manualHint={t.stayManualHint}
              />
            ) : (
            /* 주소 입력 — T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-1:
                우편번호 검색(자동기입) + 기본주소 + 상세주소칸 */
            <div className="space-y-1.5">
              <label
                htmlFor="pi-address"
                className="block text-sm font-medium tracking-wide"
                style={{ color: C.medium }}
              >
                {t.addressLabel}
              </label>

              {/* 우편번호 행: [우편번호 표시] [검색 버튼] */}
              <div className="flex gap-2">
                <div
                  className="flex h-14 flex-1 items-center rounded-xl px-4 text-lg"
                  style={{
                    border: `1.5px solid ${postalCode.trim() ? C.borderActive : C.border}`,
                    backgroundColor: 'white',
                  }}
                  data-testid="pi-postal-code"
                >
                  {postalCode.trim() ? (
                    <span style={{ color: C.dark }}>{postalCode}</span>
                  ) : (
                    <span className="text-base" style={{ color: C.border }}>{t.postcodePlaceholder}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openAddressSearch}
                  className="flex-none rounded-xl px-5 text-base font-medium text-white transition active:scale-95"
                  style={{ backgroundColor: C.primary }}
                  data-testid="pi-postcode-search"
                >
                  {t.postcodeSearchBtn}
                </button>
              </div>

              {/* 기본주소 (우편번호 검색 시 자동기입, 직접 입력도 가능) */}
              <input
                id="pi-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t.addressPlaceholder}
                className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
                style={{
                  border: `1.5px solid ${address.trim() ? C.borderActive : C.border}`,
                  backgroundColor: 'white',
                  color: C.dark,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.borderActive;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = address.trim() ? C.borderActive : C.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                data-testid="pi-address-input"
              />

              {/* 상세주소 — 기본주소와 분리된 입력칸 (동·호수 등) */}
              <input
                id="pi-address-detail"
                type="text"
                value={addressDetail}
                onChange={(e) => setAddressDetail(e.target.value)}
                placeholder={t.addressDetailPlaceholder}
                aria-label={t.addressDetailLabel}
                className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
                style={{
                  border: `1.5px solid ${addressDetail.trim() ? C.borderActive : C.border}`,
                  backgroundColor: 'white',
                  color: C.dark,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.borderActive;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = addressDetail.trim() ? C.borderActive : C.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                data-testid="pi-address-detail-input"
              />
            </div>
            )}

            {/* 개인정보 동의 — 워크인(AC-5) 또는 외국인(§C, T-20260625) 필수 표시 */}
            {(reservationType === 'walkin' || isForeign) && (
              <label
                htmlFor="pi-consent"
                className="flex items-start gap-3 cursor-pointer select-none rounded-xl p-4"
                style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}
                data-testid="pi-consent-label"
              >
                <input
                  id="pi-consent"
                  type="checkbox"
                  checked={privacyConsent}
                  onChange={(e) => setPrivacyConsent(e.target.checked)}
                  className="mt-0.5 h-6 w-6 flex-shrink-0 rounded"
                  style={{ accentColor: C.primary }}
                  data-testid="pi-consent-checkbox"
                />
                <span className="text-sm leading-relaxed font-medium" style={{ color: C.dark }}>
                  {isForeign ? t.foreignConsentCheckbox : t.privacyConsentLabel}
                </span>
              </label>
            )}

            {/* AC-7: 건강보험 조회 동의 — 초진 전체(예약+워크인) 표시, 선택사항.
                T-20260625-FOREIGN: 외국인은 국내 건강보험 비대상 → 숨김. */}
            {!isForeign && (
            <label
              htmlFor="pi-insurance-consent"
              className="flex items-start gap-3 cursor-pointer select-none rounded-xl p-4"
              style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}
              data-testid="pi-insurance-consent-label"
            >
              <input
                id="pi-insurance-consent"
                type="checkbox"
                checked={insuranceConsent}
                onChange={(e) => setInsuranceConsent(e.target.checked)}
                className="mt-0.5 h-6 w-6 flex-shrink-0 rounded"
                style={{ accentColor: C.primary }}
                data-testid="pi-insurance-consent-checkbox"
              />
              <div>
                <span className="block text-sm leading-relaxed font-medium" style={{ color: C.dark }}>
                  {t.insuranceConsentLabel}
                </span>
                <span className="block text-xs mt-0.5 leading-relaxed" style={{ color: C.muted }}>
                  {t.insuranceConsentNote}
                </span>
              </div>
            </label>
            )}

            {/* 동의서 본문.
                T-20260625-FOREIGN: 외국인(English) = §C 외국인 환자 개인정보 동의 전문.
                내국인 = 기존 개인정보 + 건강보험 항목별 정렬(AC-2). */}
            {isForeign ? (
            <div
              className="rounded-xl p-4 space-y-2"
              style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}
              data-testid="pi-consent-detail-foreign"
            >
              <p className="text-sm font-semibold" style={{ color: C.dark }}>
                {t.foreignConsentTitle}
              </p>
              <ul className="space-y-1.5">
                {t.foreignConsentItems.map((line, i) => (
                  <li key={`foreign-consent-${i}`} className="flex gap-1.5 text-xs leading-relaxed" style={{ color: C.muted }}>
                    <span aria-hidden="true" className="select-none">•</span>
                    <span className="flex-1">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            ) : (
            /* T-20260603-foot-SELFCHECKIN-ADDR-CONSENT-LAYOUT AC-2:
                동의서 본문 — '쭉 연결' 대신 항목별(수집항목/수집목적/보유기간) 줄바꿈 정렬 */
            <div
              className="rounded-xl p-4 space-y-3"
              style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}
              data-testid="pi-consent-detail"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold" style={{ color: C.dark }}>
                  {t.consentPrivacyTitle}
                </p>
                {/* T-20260608 round-2.5: 항목별 줄분리 시각 강화 — bullet(•) 마커 + flex(분리 보장).
                    각 li는 block-flow flex item으로 세로 누적 → 한 줄 합산 렌더 원천 차단. 문구 텍스트 불변. */}
                <ul className="space-y-1">
                  {t.consentPrivacyItems.map((line, i) => (
                    <li key={`priv-${i}`} className="flex gap-1.5 text-xs leading-relaxed" style={{ color: C.muted }}>
                      <span aria-hidden="true" className="select-none">•</span>
                      <span className="flex-1">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold" style={{ color: C.dark }}>
                  {t.consentHiraTitle}
                </p>
                <ul className="space-y-1">
                  {t.consentHiraItems.map((line, i) => (
                    <li key={`hira-${i}`} className="flex gap-1.5 text-xs leading-relaxed" style={{ color: C.muted }}>
                      <span aria-hidden="true" className="select-none">•</span>
                      <span className="flex-1">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            )}

            {/* 버튼 영역 */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep('input')}
                className="flex-none rounded-xl px-6 py-4 text-base font-medium transition active:scale-95"
                style={{ border: `1.5px solid ${C.border}`, color: C.muted, backgroundColor: 'white' }}
                data-testid="btn-personal-info-back"
              >
                {t.personalInfoBack}
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!personalInfoComplete}
                className="flex-1 rounded-xl py-4 text-xl font-bold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: personalInfoComplete ? C.primary : C.muted }}
                data-testid="btn-personal-info-next"
              >
                {t.personalInfoNext}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── 확인 ──
  if (step === 'confirm') {
    const visitLabel = visitType === 'new' ? t.visitNew : t.visitReturning;
    const reservationLabel = reservationType === 'walkin' ? t.visitStep1WalkIn : t.visitStep1Reserved;
    const leadSourceLabel: Record<string, string> = {
      sns: t.leadSNS,
      search: t.leadSearch,
      referral: t.leadReferral,
      partner_etc: t.leadPartnerEtc,
    };
    const leadDetailLabel: Record<string, string> = {
      instagram: t.leadInstagram,
      facebook: t.leadFacebook,
      tiktok_youtube: t.leadTiktokYoutube,
      blog_cafe: t.leadBlogCafe,
      naver: t.leadNaver,
      google: t.leadGoogle,
    };
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <LangToggle />
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <p className="text-sm tracking-widest uppercase mb-2" style={{ color: C.gold }}>{clinicName}</p>
            <h1 className="text-2xl font-bold" style={{ color: C.dark }}>{t.confirmTitle}</h1>
          </div>
          {/* T-20260613-foot-SELFCHECKIN-BANNER-NAME: 예약 확인 배너 — 재진 select 경로는 confirm 직행이라
              여기에서 성함 인사를 노출(personal_info/input 배너와 동일 형식, name 빈값 시 접두 생략) */}
          {reservationBanner && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3"
              style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}
            >
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: C.medium }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium" style={{ color: C.medium }} data-testid="reservation-banner">
                {reservationBanner.name ? `${reservationBanner.name}님, ` : ''}
                {t.reservationBanner(reservationBanner.time, reservationBanner.visitType)}
              </span>
            </div>
          )}
          <div
            className="space-y-4 rounded-2xl p-6 shadow-sm"
            style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}
          >
            <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
              <span style={{ color: C.muted }}>{t.name}</span>
              <span className="font-semibold" style={{ color: C.dark }}>{name.trim()}</span>
            </div>
            <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
              {/* T-20260625-FOREIGN: 외국인 연락처 미입력 시 이메일 표기 */}
              <span style={{ color: C.muted }}>{phone ? t.contact : t.emailLabel}</span>
              <span className="font-semibold" style={{ color: C.dark }}>{phone || customerEmail.trim()}</span>
            </div>
            {/* T-20260529: 초진인 경우 주민번호(앞6자리)+주소 표시 */}
            {visitType === 'new' && rrn && (
              <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
                <span style={{ color: C.muted }}>{t.rrnLabel}</span>
                <span className="font-semibold font-mono" style={{ color: C.dark }}>{rrn}</span>
              </div>
            )}
            {visitType === 'new' && address.trim() && (
              <div className={`flex justify-between pb-3${reservationType !== 'walkin' ? '' : ' border-b'}`} style={{ borderColor: C.border }}>
                <span style={{ color: C.muted }}>{t.addressLabel}</span>
                <span className="font-semibold text-right max-w-[200px] truncate" style={{ color: C.dark }}>
                  {[postalCode.trim() ? `(${postalCode.trim()})` : '', address.trim(), addressDetail.trim()].filter(Boolean).join(' ')}
                </span>
              </div>
            )}
            {/* T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 워크인일 때만 border-b */}
            <div
              className={`flex justify-between pb-3${reservationType === 'walkin' ? ' border-b' : ''}`}
              style={{ borderColor: C.border }}
            >
              <span style={{ color: C.muted }}>{t.visitType}</span>
              <span className="font-semibold text-right" style={{ color: C.dark }}>
                {reservationLabel} / {visitLabel}
              </span>
            </div>
            {/* T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 워크인만 유입경로 표시 */}
            {reservationType === 'walkin' && (
              <div className="flex justify-between">
                <span style={{ color: C.muted }}>{t.leadSourceTitle}</span>
                <span className="font-semibold" style={{ color: C.dark }}>
                  {leadSource ? leadSourceLabel[leadSource] ?? leadSource : '-'}
                  {leadSourceDetail ? ` / ${leadDetailLabel[leadSourceDetail] ?? leadSourceDetail}` : ''}
                  {leadSource === 'referral' && referralName.trim() ? ` / ${referralName.trim()}` : ''}
                </span>
              </div>
            )}
          </div>
          {/* T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 체크박스
              T-20260608-foot-RESV-INTAKE-REGRESSION-BATCH AC-5: 체크박스 하단에 미동의 영향 안내문구
              (현장 지정 정문안) 재노출. 4FIX 에서 제거했던 보조문구를 현장 요청으로 신규 문안으로 복원. */}
          <div className="space-y-1">
            <label
              htmlFor="sms-opt-in"
              className="flex items-start gap-3 cursor-pointer select-none"
              style={{ color: C.muted }}
            >
              <input
                id="sms-opt-in"
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-teal-600"
                style={{ accentColor: C.primary }}
              />
              <span className="text-sm leading-relaxed">{t.smsOptIn}</span>
            </label>
            {/* AC-5: 미동의 시 영향 안내 — 회색 보조문구, 체크박스 라벨 들여쓰기에 맞춤 */}
            <p className="text-xs leading-relaxed pl-8" style={{ color: C.muted }} data-testid="sms-opt-in-note">
              {t.smsOptInNote}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => visitType === 'new' ? setStep('personal_info') : setStep('input')}
              className="flex-1 rounded-xl py-4 text-lg font-medium transition active:scale-95"
              style={{ border: `1.5px solid ${C.border}`, color: C.muted, backgroundColor: 'white' }}
            >
              {t.edit}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl py-4 text-lg font-bold text-white transition active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: submitting ? C.medium : C.primary }}
            >
              {submitting ? t.processing : t.confirm}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 입력 폼 ──
  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{ background: `linear-gradient(to bottom, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
    >
      <LangToggle />

      {/* 워크인 안내 팝업 */}
      <WalkInModal
        open={walkInModalOpen}
        body={t.walkInModalBody}
        confirmLabel={t.walkInModalConfirm}
        onConfirm={handleWalkInConfirm}
        onCancel={handleWalkInCancel}
        fontStyle={FONT_STYLE}
      />

      {/* 헤더 */}
      <header className="px-6 pb-2 pt-10 text-center">
        <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: C.gold }}>
          OBLIV FOOT CENTER
        </p>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.dark }}>
          {clinicName}
        </h1>
        <p className="mt-1 text-sm tracking-wide" style={{ color: C.muted }}>{t.selfCheckIn}</p>
        <div className="mx-auto mt-3 h-px w-16" style={{ backgroundColor: C.gold }} />
      </header>

      {/* 폼 */}
      <main className="flex flex-1 flex-col items-center px-6 pb-8 pt-5">
        <div className="w-full max-w-md space-y-5">

          {/* 성함 */}
          <div className="space-y-1.5">
            <label
              htmlFor="sc-name"
              className="block text-sm font-medium tracking-wide"
              style={{ color: C.medium }}
            >
              {t.name}
            </label>
            <div className="relative">
              {/* LOGIC-LOCK: L-001 */}
              <input
                key={`sc-name-${resetKey}`}
                id="sc-name"
                type="text"
                name="obliv-fn-lock"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePlaceholder}
                autoComplete="new-password"
                className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
                style={{
                  border: `1.5px solid ${C.border}`,
                  backgroundColor: 'white',
                  color: C.dark,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.borderActive;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {/* 연락처 */}
          <div className="space-y-2">
            <label
              htmlFor="sc-phone"
              className="block text-sm font-medium tracking-wide"
              style={{ color: C.medium }}
            >
              {t.phone}
            </label>
            <div
              className="flex h-14 w-full items-center rounded-xl px-4 text-lg"
              style={{
                border: `1.5px solid ${phone ? C.borderActive : C.border}`,
                backgroundColor: 'white',
                color: phone ? C.dark : C.muted,
              }}
            >
              {phone ? (
                <span style={{ color: C.dark }}>{phone}</span>
              ) : (
                <span className="text-base" style={{ color: C.border }}>
                  {t.phonePlaceholder}
                </span>
              )}
            </div>

            {/* 예약 배너 */}
            {reservationBanner && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3"
                style={{
                  backgroundColor: C.bannerBg,
                  border: `1.5px solid ${C.bannerBorder}`,
                }}
              >
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{ color: C.medium }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium" style={{ color: C.medium }} data-testid="reservation-banner">
                  {reservationBanner.name ? `${reservationBanner.name}님, ` : ''}
                  {t.reservationBanner(reservationBanner.time, reservationBanner.visitType)}
                </span>
              </div>
            )}

            {/* 온스크린 숫자패드 */}
            <NumPad
              onDigit={handleNumPadDigit}
              onDelete={handleNumPadDelete}
              onClear={handleNumPadClear}
              clearLabel={t.clearAll}
            />

            {/* T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW: 외국인(English) — 연락처 or 이메일 택1 */}
            {isForeign && (
              <div className="space-y-1.5 pt-1" data-testid="foreign-email-block">
                <label
                  htmlFor="sc-email"
                  className="block text-sm font-medium tracking-wide"
                  style={{ color: C.medium }}
                >
                  {t.emailLabel}
                </label>
                <input
                  id="sc-email"
                  type="email"
                  inputMode="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder={t.emailPlaceholder}
                  autoComplete="off"
                  className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
                  style={{
                    border: `1.5px solid ${customerEmail.trim() ? C.borderActive : C.border}`,
                    backgroundColor: 'white',
                    color: C.dark,
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = C.borderActive;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = customerEmail.trim() ? C.borderActive : C.border;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  data-testid="foreign-email-input"
                />
                <p className="text-xs" style={{ color: C.muted }} data-testid="foreign-contact-hint">
                  {t.contactEitherHint}
                </p>
              </div>
            )}
          </div>

          {/* 방문유형 — 2단계 (T-20260517-foot-CHECKIN-2STEP) */}
          <div className="space-y-3">
            <span className="block text-sm font-medium tracking-wide" style={{ color: C.medium }}>
              {t.visitType}
            </span>

            {/* 1단계: 예약 여부 */}
            <div className="grid grid-cols-2 gap-3">
              {(['reserved', 'walkin'] as ReservationType[]).map((rt) => {
                const isActive =
                  rt === 'reserved'
                    ? reservationType === 'reserved'
                    : reservationType === 'walkin' && walkInConfirmed;
                const label = rt === 'reserved' ? t.visitStep1Reserved : t.visitStep1WalkIn;
                return (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => handleReservationTypeSelect(rt)}
                    className="flex min-h-[72px] w-full items-center justify-center rounded-xl px-4 py-4 text-center transition active:scale-[0.99]"
                    style={{
                      border: `1.5px solid ${isActive ? C.primary : C.border}`,
                      backgroundColor: isActive ? C.beige : 'white',
                      boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                    }}
                    data-testid={rt === 'walkin' ? 'btn-walkin' : 'btn-reserved'}
                  >
                    <span
                      className="text-base font-bold leading-snug"
                      style={{ color: isActive ? C.dark : C.muted }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 2단계: 초진/재진 (예약 고객만 표시) */}
            {reservationType === 'reserved' && (
              <div className="space-y-2 pt-1">
                <span className="block text-xs font-medium tracking-wide" style={{ color: C.gold }}>
                  {t.visitStep2Title}
                </span>
                {([
                  { value: 'new' as VisitType, label: t.visitNew, desc: t.visitNewDesc },
                  { value: 'returning' as VisitType, label: t.visitReturning, desc: t.visitReturningDesc },
                ]).map((c) => {
                  const isActive = visitType === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setVisitType(c.value)}
                      className="flex w-full items-center justify-between rounded-xl px-5 py-4 text-left transition active:scale-[0.99]"
                      style={{
                        border: `1.5px solid ${isActive ? C.primary : C.border}`,
                        backgroundColor: isActive ? C.beige : 'white',
                        boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                      }}
                      // T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL FIX: 안정 셀렉터 부여.
                      // E2E 가 라벨 텍스트(getByRole name)에 의존하지 않도록 초진/재진에 data-testid.
                      data-testid={c.value === 'new' ? 'btn-visit-new' : 'btn-visit-returning'}
                    >
                      <div>
                        <span
                          className="text-lg font-bold"
                          style={{ color: isActive ? C.dark : C.muted }}
                        >
                          {c.label}
                        </span>
                        <p className="text-sm mt-0.5" style={{ color: isActive ? C.medium : C.border }}>
                          {c.desc}
                        </p>
                      </div>
                      <div
                        className="h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ml-3"
                        style={{
                          border: `2px solid ${isActive ? C.primary : C.border}`,
                          backgroundColor: isActive ? C.primary : 'white',
                        }}
                      >
                        {isActive && (
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: 'white' }} />
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 예약자 명단에서 본인 찾기 (전화 타이핑 대체 동선) */}
                <button
                  type="button"
                  onClick={handleLoadReservations}
                  className="mt-2 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-center transition active:scale-[0.99]"
                  style={{ backgroundColor: C.beige, border: `1.5px solid ${C.primary}` }}
                  data-testid="btn-open-reservation-list"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: C.primary }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  <span className="text-base font-bold" style={{ color: C.primary }}>
                    {t.openReservationList}
                  </span>
                </button>
              </div>
            )}

            {/* 워크인 확인 후 안내 텍스트 */}
            {reservationType === 'walkin' && walkInConfirmed && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  backgroundColor: C.bannerBg,
                  border: `1.5px solid ${C.bannerBorder}`,
                  color: C.medium,
                }}
              >
                초진으로 접수됩니다. 데스크에서 안내 받으세요.
              </div>
            )}
          </div>

          {/* 유입경로 — 워크인만 표시 (T-20260520-foot-SELFCHECKIN-LEADSRC-COND)
              T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH: 4대그룹 2×2 그리드 + 그룹별 소분류/성함 입력 */}
          {showLeadSource && (
            <div className="space-y-3">
              <span className="block text-sm font-medium tracking-wide" style={{ color: C.medium }}>
                {t.leadSourceTitle}
              </span>

              {/* 1단계: 대분류 4그룹 2×2 */}
              <div className="grid grid-cols-2 gap-2" data-testid="leadsource-groups">
                {([
                  { value: 'sns', label: t.leadSNS },
                  { value: 'search', label: t.leadSearch },
                  { value: 'referral', label: t.leadReferral },
                  { value: 'partner_etc', label: t.leadPartnerEtc },
                ]).map((src) => {
                  const isActive = leadSource === src.value;
                  return (
                    <button
                      key={src.value}
                      type="button"
                      data-testid={`leadsource-${src.value}`}
                      onClick={() => handleLeadSourceSelect(src.value)}
                      className="flex h-14 items-center justify-center rounded-xl px-2 text-center transition active:scale-[0.99]"
                      style={{
                        border: `1.5px solid ${isActive ? C.primary : C.border}`,
                        backgroundColor: isActive ? C.beige : 'white',
                        boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                      }}
                    >
                      <span
                        className="text-sm font-bold"
                        style={{ color: isActive ? C.dark : C.muted }}
                      >
                        {src.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 2단계-A: SNS 소분류 (인스타/페북/틱톡유튜브/블로그카페) */}
              {leadSource === 'sns' && (
                <div className="space-y-2 pt-1" data-testid="leadsource-sns-detail">
                  <span className="block text-xs font-medium tracking-wide" style={{ color: C.gold }}>
                    {t.leadSNSSubTitle}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'instagram', label: t.leadInstagram },
                      { value: 'facebook', label: t.leadFacebook },
                      { value: 'tiktok_youtube', label: t.leadTiktokYoutube },
                      { value: 'blog_cafe', label: t.leadBlogCafe },
                    ]).map((detail) => {
                      const isActive = leadSourceDetail === detail.value;
                      return (
                        <button
                          key={detail.value}
                          type="button"
                          data-testid={`leaddetail-${detail.value}`}
                          onClick={() => setLeadSourceDetail(detail.value)}
                          className="flex h-14 items-center justify-center rounded-xl px-3 text-center transition active:scale-[0.99]"
                          style={{
                            border: `1.5px solid ${isActive ? C.primary : C.border}`,
                            backgroundColor: isActive ? C.beige : 'white',
                            boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                          }}
                        >
                          <span
                            className="text-sm font-bold"
                            style={{ color: isActive ? C.dark : C.muted }}
                          >
                            {detail.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2단계-B: 검색 소분류 (네이버/구글) */}
              {leadSource === 'search' && (
                <div className="space-y-2 pt-1" data-testid="leadsource-search-detail">
                  <span className="block text-xs font-medium tracking-wide" style={{ color: C.gold }}>
                    {t.leadSearchSubTitle}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'naver', label: t.leadNaver },
                      { value: 'google', label: t.leadGoogle },
                    ]).map((detail) => {
                      const isActive = leadSourceDetail === detail.value;
                      return (
                        <button
                          key={detail.value}
                          type="button"
                          data-testid={`leaddetail-${detail.value}`}
                          onClick={() => setLeadSourceDetail(detail.value)}
                          className="flex h-14 items-center justify-center rounded-xl px-3 text-center transition active:scale-[0.99]"
                          style={{
                            border: `1.5px solid ${isActive ? C.primary : C.border}`,
                            backgroundColor: isActive ? C.beige : 'white',
                            boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                          }}
                        >
                          <span
                            className="text-sm font-bold"
                            style={{ color: isActive ? C.dark : C.muted }}
                          >
                            {detail.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2단계-C: 지인소개 성함 입력칸 (선택 — 빈값 허용 AC-3) */}
              {leadSource === 'referral' && (
                <div className="space-y-2 pt-1" data-testid="leadsource-referral-name">
                  <span className="block text-xs font-medium tracking-wide" style={{ color: C.gold }}>
                    {t.leadReferralNameTitle}
                  </span>
                  <input
                    type="text"
                    value={referralName}
                    onChange={(e) => setReferralName(e.target.value)}
                    placeholder={t.leadReferralNamePlaceholder}
                    data-testid="leadsource-referral-name-input"
                    className="h-14 w-full rounded-xl px-4 text-base font-medium outline-none transition"
                    style={{ border: `1.5px solid ${C.border}`, backgroundColor: 'white', color: C.dark }}
                  />
                </div>
              )}
            </div>
          )}

          {/* 접수 버튼 */}
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="mt-2 h-16 w-full rounded-xl text-xl font-bold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: canSubmit ? C.primary : C.muted }}
            data-testid="btn-checkin"
          >
            {t.checkIn}
          </button>

          {/*
            T-20260601-foot-SELFLOGIN-RESV-LIST-QR — OQ1(가정 A): 셀프접수 페이지 URL QR.
            데스크/입구에 부착·표시하거나 고객이 본인 휴대폰으로 스캔해 접수하도록 현재 페이지 URL 을 인코딩.
            OQ1 확정(A/B) 전 잠정 구현 — 확정 시 위치/노출 조정. health-q QR 와 동일하게 외부 이미지 API 재사용(신규 npm 없음).
          */}
          <div className="flex flex-col items-center gap-2 pt-4" data-testid="selfcheckin-url-qr">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.href)}&qzone=2&margin=0&format=png`}
              alt="셀프접수 페이지 QR 코드"
              width={120}
              height={120}
              className="rounded-lg"
              style={{ border: `1.5px solid ${C.border}`, backgroundColor: 'white' }}
              data-testid="selfcheckin-url-qr-image"
            />
            <p className="text-xs" style={{ color: C.muted }}>{t.scanToPhoneCaption}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

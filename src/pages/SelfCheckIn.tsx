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
  leadPartnership: string;
  leadOther: string;
  leadSNSSubTitle: string;
  leadInstagram: string;
  leadFacebook: string;
  leadYoutube: string;
  leadBlogCafe: string;
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
  // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 단계
  personalInfoTitle: string;
  rrnLabel: string;
  rrnPlaceholder: string;
  rrnNote: string;
  addressLabel: string;
  addressPlaceholder: string;
  privacyConsentLabel: string;
  // AC-7: 건강보험 조회 동의
  insuranceConsentLabel: string;
  insuranceConsentNote: string;
  personalInfoNext: string;
  personalInfoBack: string;
  // T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: QR 단계
  qrTitle: string;
  qrGuide: string;
  qrDone: string;
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
  // OQ1(가정 A): 셀프접수 페이지 URL QR
  scanToPhoneCaption: string;
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
    leadPartnership: '제휴',
    leadOther: '기타',
    leadSNSSubTitle: 'SNS 채널 선택',
    leadInstagram: '인스타그램',
    leadFacebook: '페이스북',
    leadYoutube: '유튜브',
    leadBlogCafe: '블로그/카페',
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
    // 개인정보 입력 단계
    personalInfoTitle: '개인 정보 입력',
    rrnLabel: '주민번호',
    rrnPlaceholder: 'YYMMDD-XXXXXXX',
    rrnNote: '생년월일(앞 6자리)만 저장됩니다. 개인정보는 안전하게 보호됩니다.',
    addressLabel: '주소',
    addressPlaceholder: '주소를 입력해주세요',
    privacyConsentLabel: '개인정보 수집·이용에 동의합니다 (필수)',
    // AC-7: 건강보험 조회 동의
    insuranceConsentLabel: '건강보험 자격조회에 동의합니다 (선택)',
    insuranceConsentNote: '동의 시 건강보험 급여 적용을 위한 자격 조회가 가능합니다.',
    personalInfoNext: '다음',
    personalInfoBack: '뒤로',
    // QR 단계
    qrTitle: '발건강 질문지 작성',
    qrGuide: '핸드폰으로 QR을 촬영하여\n발건강 질문지를 작성해주세요',
    qrDone: '질문지 작성 완료',
    qrAutoReset: (s) => `${s}초 후 자동으로 다음 단계로 넘어갑니다`,
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
    scanToPhoneCaption: 'QR을 스캔해 휴대폰으로 접수할 수 있어요',
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
    leadPartnership: 'Partnership',
    leadOther: 'Other',
    leadSNSSubTitle: 'Select SNS channel',
    leadInstagram: 'Instagram',
    leadFacebook: 'Facebook',
    leadYoutube: 'YouTube',
    leadBlogCafe: 'Blog / Cafe',
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
    smsOptIn: 'I agree to receive appointment reminders via SMS (optional)',
    // Personal info step
    personalInfoTitle: 'Personal Information',
    rrnLabel: 'ID Number',
    rrnPlaceholder: 'YYMMDD-XXXXXXX',
    rrnNote: 'Only birth date (first 6 digits) will be stored securely.',
    addressLabel: 'Address',
    addressPlaceholder: 'Enter your address',
    privacyConsentLabel: 'I consent to the collection of personal information (required)',
    // AC-7: insurance consent
    insuranceConsentLabel: 'I consent to health insurance eligibility inquiry (optional)',
    insuranceConsentNote: 'Consent allows us to check your health insurance eligibility for coverage.',
    personalInfoNext: 'Next',
    personalInfoBack: 'Back',
    // QR step
    qrTitle: 'Health Questionnaire',
    qrGuide: 'Please scan the QR code with your phone\nto fill out the health questionnaire',
    qrDone: 'Questionnaire Complete',
    qrAutoReset: (s) => `Auto-advance in ${s} seconds`,
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
    scanToPhoneCaption: 'Scan the QR to check in on your phone',
  },
};

/** 완료 화면 자동 리셋 (초) */
const DONE_RESET_SECONDS = 15;
/** 입력 화면 비활동 타임아웃 (초) */
const IDLE_TIMEOUT_SECONDS = 60;
/** QR 화면 자동 전진 타임아웃 (초) — T-20260529-foot-SELFCHECKIN-FLOW-REVAMP */
const QR_SCREEN_SECONDS = 120;

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
/** RRN 뒷자리 마스킹 (YYMMDD-*******) */
function maskRrn(rrnStr: string): string {
  const digits = rrnStr.replace(/\D/g, '');
  if (digits.length <= 6) return rrnStr;
  return `${digits.slice(0, 6)}-${'*'.repeat(Math.min(7, digits.length - 6))}`;
}

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

  // ── 방문유형 2단계 (T-20260517-foot-CHECKIN-2STEP) ──
  const [reservationType, setReservationType] = useState<ReservationType | null>(null);
  const [visitType, setVisitType] = useState<VisitType>('new');   // 최종 DB 저장값
  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [walkInConfirmed, setWalkInConfirmed] = useState(false);

  // ── 유입경로 2단계 (T-20260517-foot-CHECKIN-2STEP) ──
  const [leadSource, setLeadSource] = useState<string | null>(null);
  const [leadSourceDetail, setLeadSourceDetail] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 (기본 true — 동의함)
  const [smsOptIn, setSmsOptIn] = useState(true);

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 상태 ──
  const [rrn, setRrn] = useState('');                    // YYMMDD-XXXXXXX 포맷
  const [address, setAddress] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  // AC-7: 건강보험 조회 동의 (→ customers.hira_consent)
  const [insuranceConsent, setInsuranceConsent] = useState(false);
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

  const t = T[lang];

  // 예약 정보
  const [reservationBanner, setReservationBanner] = useState<{
    time: string;
    visitType: string;
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
    setPrivacyConsent(false);
    setInsuranceConsent(false); // AC-7
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

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: QR 화면 자동 전진 (120초) ──
  useEffect(() => {
    if (step !== 'qr') return;
    setQrCountdown(QR_SCREEN_SECONDS);
    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStep('done');
          return QR_SCREEN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

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

    const phoneE164 = normalizeToE164(phone);
    const today = new Date().toISOString().slice(0, 10);

    (async () => {
      try {
        let reservation = null;
        if (phoneE164) {
          const { data } = await anonClient
            .from('reservations')
            .select('reservation_time, visit_type')
            .eq('clinic_id', clinicId)
            .eq('customer_phone', phoneE164)
            .eq('reservation_date', today)
            .eq('status', 'confirmed')
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          reservation = data;
        }
        if (!reservation && phoneE164 && digits !== phoneE164) {
          const { data } = await anonClient
            .from('reservations')
            .select('reservation_time, visit_type')
            .eq('clinic_id', clinicId)
            .eq('customer_phone', digits)
            .eq('reservation_date', today)
            .eq('status', 'confirmed')
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          reservation = data;
        }

        if (reservation) {
          const timeStr = (reservation.reservation_time as string).slice(0, 5);
          const vt = reservation.visit_type as VisitType;
          // 예약 배너 표시 — 방문유형 라벨 (체험 제외, new/returning만)
          const vtLabel = vt === 'new' ? t.visitNew : vt === 'returning' ? t.visitReturning : '';
          setReservationBanner({ time: timeStr, visitType: vtLabel });
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
  }, []);

  // ── 유입경로 대분류 선택 ──
  const handleLeadSourceSelect = useCallback((source: string) => {
    setLeadSource(source);
    if (source !== 'sns') {
      // SNS 외 → 즉시 완료 (소분류 없음)
      setLeadSourceDetail(null);
    } else {
      // SNS → 소분류 선택 대기 (detail 초기화)
      setLeadSourceDetail(null);
    }
  }, []);

  // ── 제출 가능 여부 ──
  // 1) 이름+전화 완성
  // 2) 방문유형 완성: (reserved + visitType 선택) 또는 (walkin confirmed)
  // 3) 유입경로 완성: leadSource 선택 + SNS면 detail도 선택
  const visitTypeComplete =
    (reservationType === 'reserved' && (visitType === 'new' || visitType === 'returning')) ||
    (reservationType === 'walkin' && walkInConfirmed);

  const leadSourceComplete =
    leadSource !== null && (leadSource !== 'sns' || leadSourceDetail !== null);

  // T-20260520-foot-SELFCHECKIN-LEADSRC-COND: 워크인만 유입경로 수집
  const showLeadSource = reservationType === 'walkin';

  const canSubmit =
    name.trim().length >= 1 &&
    phone.replace(/\D/g, '').length >= 10 &&
    visitTypeComplete &&
    (!showLeadSource || leadSourceComplete);

  // ── T-20260529-foot-SELFCHECKIN-FLOW-REVAMP: 개인정보 입력 완료 여부 ──
  const personalInfoComplete =
    extractBirthDate(rrn) !== null &&
    address.trim().length >= 2 &&
    (reservationType !== 'walkin' || privacyConsent); // 워크인만 동의서 필수

  // ── T-20260601-foot-SELFLOGIN-RESV-LIST-QR: 오늘 예약자 목록 로드 ──
  // "예약하고 왔어요" + 초진/재진 선택 후 호출 → 마스킹 목록 화면으로 전환.
  const handleLoadReservations = useCallback(async () => {
    if (!clinicId) return;
    setReservationListLoading(true);
    rawReservationsRef.current.clear();
    setStep('select-reservation');
    try {
      const today = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }),
      )
        .toISOString()
        .slice(0, 10);
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

      setMaskedReservations(masked);
    } catch {
      // 목록 로드 실패 → 빈 목록(폴백 안내) 표시. 콘솔에 PII 미노출.
      setMaskedReservations([]);
    } finally {
      setReservationListLoading(false);
    }
  }, [clinicId]);

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

      // 전화번호로 고객 조회 (submit 처리 전용 — UI 미노출)
      let existing: { id: string } | null = null;
      if (!existing) {
        const res = await anonClient
          .from('customers')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('phone', phoneStored)
          .maybeSingle();
        existing = res.data as { id: string } | null;
      }
      if (!existing && phoneE164 && phoneDigits !== phoneE164) {
        const { data: legacy } = await anonClient
          .from('customers')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('phone', phoneDigits)
          .maybeSingle();
        existing = legacy;
      }
      // 세 번째 시도: 하이픈 포맷 (010-XXXX-XXXX)
      if (!existing) {
        const d = phoneDigits;
        const phoneFormatted =
          d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` :
          d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
        if (phoneFormatted && phoneFormatted !== phoneStored && phoneFormatted !== phoneDigits) {
          const { data: formattedMatch } = await anonClient
            .from('customers')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('phone', phoneFormatted)
            .maybeSingle();
          existing = formattedMatch as { id: string } | null;
        }
      }

      if (existing) {
        customerId = existing.id as string;
        // T-20260525-foot-MESSAGING-V1 AC-5: 기존 고객 sms_opt_in 업데이트 (anon RLS 없으면 silent fail)
        await anonClient
          .from('customers')
          .update({ sms_opt_in: smsOptIn })
          .eq('id', customerId);
      } else {
        // T-20260529: 워크인 신규 고객 INSERT 시 birth_date, address, privacy_consent 포함
        const newCustomerPayload: Record<string, unknown> = {
          clinic_id: clinicId,
          name: name.trim(),
          phone: phoneStored,
          visit_type: visitType === 'new' ? 'new' : 'returning',
          // T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 저장
          sms_opt_in: smsOptIn,
        };
        if (visitType === 'new') {
          const bd = extractBirthDate(rrn);
          if (bd) newCustomerPayload.birth_date = bd;
          if (address.trim()) newCustomerPayload.address = address.trim();
          if (reservationType === 'walkin') newCustomerPayload.privacy_consent = privacyConsent;
        }

        const { data: created, error: cErr } = await anonClient
          .from('customers')
          .insert(newCustomerPayload)
          .select('id')
          .single();
        if (cErr) {
          if (cErr.code === '23505') {
            const { data: retryData } = await anonClient
              .from('customers')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('phone', phoneStored)
              .maybeSingle();
            if (retryData) {
              customerId = (retryData as { id: string }).id;
            } else {
              throw new Error(`고객 등록 실패 (중복 확인 불가): ${cErr.message}`);
            }
          } else {
            throw new Error(`고객 등록 실패: ${cErr.message}`);
          }
        } else if (created) {
          customerId = (created as { id: string }).id;
        }
      }

      // ── T-20260506-foot-SELFCHECKIN-MERGE: 예약 merge 로직 ────────────────
      const todayDate = new Date().toISOString().slice(0, 10);
      const todayStart = `${todayDate}T00:00:00+09:00`;
      const todayEnd = `${todayDate}T23:59:59+09:00`;

      // (1) 당일 기존 체크인 중복 방지
      if (customerId) {
        const { data: existingCi } = await anonClient
          .from('check_ins')
          .select('id, queue_number')
          .eq('clinic_id', clinicId)
          .eq('customer_id', customerId)
          .gte('checked_in_at', todayStart)
          .lte('checked_in_at', todayEnd)
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingCi) {
          const ci = existingCi as { id: string; queue_number?: number | null };
          setQueueNumber(ci.queue_number ?? null);
          // T-20260529: 기존 체크인이 있으면 done으로 직행 (QR 재발급 없음)
          setStep('done');
          setSubmitting(false);
          return;
        }
      }

      // (2) 당일 예약 매칭
      let matchedReservationId: string | null = null;
      try {
        if (customerId) {
          const { data: resvById } = await anonClient
            .from('reservations')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('customer_id', customerId)
            .eq('reservation_date', todayDate)
            .eq('status', 'confirmed')
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (resvById) matchedReservationId = (resvById as { id: string }).id;
        }

        if (!matchedReservationId) {
          const d = phoneDigits;
          const phoneFormatted =
            d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` :
            d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
          const phonesToTry = [...new Set(
            [phoneStored, phoneE164, phoneDigits, phoneFormatted].filter(Boolean) as string[]
          )];
          for (const ph of phonesToTry) {
            const { data: resvByPhone } = await anonClient
              .from('reservations')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('customer_phone', ph)
              .eq('reservation_date', todayDate)
              .eq('status', 'confirmed')
              .order('reservation_time', { ascending: true })
              .limit(1)
              .maybeSingle();
            if (resvByPhone) {
              matchedReservationId = (resvByPhone as { id: string }).id;
              break;
            }
          }
        }

        // Fallback A: digits-only 비교 (E164 정규화 포함)
        // 원인 2 수정 (T-20260529-foot-RESV-FLAG-NOSAVE):
        //   '+821012345678'.replace(/\D/g,'') = '821012345678' (E164 prefix)
        //   ≠ phoneDigits '01012345678' → 폴백 실패.
        //   normalizeToE164() 적용으로 양측 정규화 후 비교.
        if (!matchedReservationId && phoneDigits.length >= 10) {
          const { data: allResv } = await anonClient
            .from('reservations')
            .select('id, customer_phone')
            .eq('clinic_id', clinicId)
            .eq('reservation_date', todayDate)
            .eq('status', 'confirmed');
          if (allResv) {
            const digitsMatch = (allResv as { id: string; customer_phone: string | null }[]).find(
              (r) => {
                const rPhone = r.customer_phone ?? '';
                // 1) 정규화된 E164 비교
                const rE164 = normalizeToE164(rPhone);
                if (rE164 && phoneE164 && rE164 === phoneE164) return true;
                // 2) 끝자리 8자리 비교 (마지막 안전망)
                const rDigits = rPhone.replace(/\D/g, '');
                return rDigits.length >= 8 && rDigits.endsWith(phoneDigits.slice(-8));
              },
            );
            if (digitsMatch) matchedReservationId = digitsMatch.id;
          }
        }

        // Fallback B: 고객명 비교 (reservationType='reserved' 전용)
        // 원인 3 수정 (T-20260529-foot-RESV-FLAG-NOSAVE):
        //   "예약했어요"를 명시적으로 선택했으나 전화번호 포맷 불일치로 모든 폰 폴백 실패 시
        //   고객명으로 한 번 더 시도.
        if (!matchedReservationId && reservationType === 'reserved' && name.trim().length >= 1) {
          const { data: resvByName } = await anonClient
            .from('reservations')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('customer_name', name.trim())
            .eq('reservation_date', todayDate)
            .eq('status', 'confirmed')
            .order('reservation_time', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (resvByName) matchedReservationId = (resvByName as { id: string }).id;
        }
      } catch {
        // 예약 조회 실패 → 신규 접수로 처리
      }

      // (2.5) 예약에 연결된 기존 체크인 확인
      if (matchedReservationId) {
        try {
          const { data: linkedCi } = await anonClient
            .from('check_ins')
            .select('id, queue_number')
            .eq('clinic_id', clinicId)
            .eq('reservation_id', matchedReservationId)
            .neq('status', 'cancelled')
            .maybeSingle();
          if (linkedCi) {
            const lci = linkedCi as { id: string; queue_number?: number | null };
            setQueueNumber(lci.queue_number ?? null);
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
      if (visitType === 'new') notesParts.id_check_required = true;
      if (reservationType === 'walkin') notesParts.walk_in = true;
      if (leadSource) notesParts.lead_source = leadSource;
      if (leadSourceDetail) notesParts.lead_source_detail = leadSourceDetail;
      const notesPayload = Object.keys(notesParts).length > 0 ? notesParts : null;

      // T-20260529: check_in INSERT — .select('id').single() 으로 ID 반환
      const { data: ciInsertData, error: ciErr } = await anonClient.from('check_ins').insert({
        clinic_id: clinicId,
        customer_id: customerId,
        customer_name: name.trim(),
        customer_phone: phoneStored,
        visit_type: visitType,
        // 재진→치료대기 직행 / 초진→상담대기 직행
        status: visitType === 'returning' ? 'treatment_waiting' : 'consult_waiting',
        queue_number: queue,
        notes: notesPayload,
        reservation_id: matchedReservationId,
      }).select('id').single();

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

      const newCheckInId = (ciInsertData as { id: string } | null)?.id ?? null;

      // (3) 매칭된 예약 → checked_in 상태 업데이트
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
          await anonClient.rpc('fn_selfcheckin_update_personal_info', {
            p_check_in_id:       newCheckInId,
            p_clinic_id:         clinicId,
            p_birth_date:        extractBirthDate(rrn) ?? null,
            p_address:           address.trim() || null,
            p_privacy_consent:   reservationType === 'walkin' ? privacyConsent : null,
            p_insurance_consent: insuranceConsent || null, // AC-7: true 시만 전달
          });
        } catch {
          // 개인정보 저장 실패는 silent — 접수 완료 UX를 블록하지 않음
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
          const { data: tokenResult } = await anonClient.rpc('fn_selfcheckin_create_health_q_token', {
            p_check_in_id: newCheckInId,
            p_clinic_id:   clinicId,
          });
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
                <div className="max-h-[60vh] space-y-2 overflow-y-auto" data-testid="reservation-list">
                  {maskedReservations.map((item) => (
                    <button
                      key={item.reservation_id}
                      type="button"
                      onClick={() => handleSelectReservation(item)}
                      className="flex min-h-[68px] w-full items-center justify-between rounded-xl px-5 py-4 text-left transition active:scale-[0.99]"
                      style={{ border: `1.5px solid ${C.border}`, backgroundColor: 'white' }}
                      data-testid="reservation-item"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold" style={{ color: C.dark }}>
                          {item.masked_name}
                        </span>
                        <span className="text-base" style={{ color: C.muted }}>
                          {item.masked_phone}
                        </span>
                      </div>
                      <span className="shrink-0 text-base font-semibold tabular-nums" style={{ color: C.medium }}>
                        {item.reservation_time}
                      </span>
                    </button>
                  ))}
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

          {/* 질문지 작성 완료 버튼 */}
          <button
            onClick={() => setStep('done')}
            className="w-full rounded-xl py-5 text-xl font-bold text-white transition active:scale-[0.99]"
            style={{ backgroundColor: C.primary }}
            data-testid="btn-qr-done"
          >
            {t.qrDone}
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
                <span className="text-sm font-medium" style={{ color: C.medium }}>
                  {t.reservationBanner(reservationBanner.time, reservationBanner.visitType)}
                </span>
              </div>
            )}

            {/* 주민번호 입력 — RRN NumPad */}
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
                  <span style={{ color: C.dark }}>{maskRrn(rrn)}</span>
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

            {/* 주소 입력 — 텍스트 input */}
            <div className="space-y-1.5">
              <label
                htmlFor="pi-address"
                className="block text-sm font-medium tracking-wide"
                style={{ color: C.medium }}
              >
                {t.addressLabel}
              </label>
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
            </div>

            {/* 개인정보 동의 — 워크인(AC-5)만 필수 표시 */}
            {reservationType === 'walkin' && (
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
                  {t.privacyConsentLabel}
                </span>
              </label>
            )}

            {/* AC-7: 건강보험 조회 동의 — 초진 전체(예약+워크인) 표시, 선택사항 */}
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
      partnership: t.leadPartnership,
      other: t.leadOther,
    };
    const leadDetailLabel: Record<string, string> = {
      instagram: t.leadInstagram,
      facebook: t.leadFacebook,
      youtube: t.leadYoutube,
      blog_cafe: t.leadBlogCafe,
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
          <div
            className="space-y-4 rounded-2xl p-6 shadow-sm"
            style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}
          >
            <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
              <span style={{ color: C.muted }}>{t.name}</span>
              <span className="font-semibold" style={{ color: C.dark }}>{name.trim()}</span>
            </div>
            <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
              <span style={{ color: C.muted }}>{t.contact}</span>
              <span className="font-semibold" style={{ color: C.dark }}>{phone}</span>
            </div>
            {/* T-20260529: 초진인 경우 주민번호(앞6자리)+주소 표시 */}
            {visitType === 'new' && rrn && (
              <div className="flex justify-between border-b pb-3" style={{ borderColor: C.border }}>
                <span style={{ color: C.muted }}>{t.rrnLabel}</span>
                <span className="font-semibold font-mono" style={{ color: C.dark }}>{maskRrn(rrn)}</span>
              </div>
            )}
            {visitType === 'new' && address.trim() && (
              <div className={`flex justify-between pb-3${reservationType !== 'walkin' ? '' : ' border-b'}`} style={{ borderColor: C.border }}>
                <span style={{ color: C.muted }}>{t.addressLabel}</span>
                <span className="font-semibold text-right max-w-[200px] truncate" style={{ color: C.dark }}>{address.trim()}</span>
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
                </span>
              </div>
            )}
          </div>
          {/* T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 체크박스 */}
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
                <span className="text-sm font-medium" style={{ color: C.medium }}>
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

          {/* 유입경로 — 워크인만 표시 (T-20260520-foot-SELFCHECKIN-LEADSRC-COND) */}
          {showLeadSource && (
            <div className="space-y-3">
              <span className="block text-sm font-medium tracking-wide" style={{ color: C.medium }}>
                {t.leadSourceTitle}
              </span>

              {/* 1단계: 대분류 5종 */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'sns', label: t.leadSNS },
                  { value: 'search', label: t.leadSearch },
                  { value: 'referral', label: t.leadReferral },
                  { value: 'partnership', label: t.leadPartnership },
                  { value: 'other', label: t.leadOther },
                ]).map((src) => {
                  const isActive = leadSource === src.value;
                  return (
                    <button
                      key={src.value}
                      type="button"
                      onClick={() => handleLeadSourceSelect(src.value)}
                      className="flex h-14 items-center justify-center rounded-xl px-2 text-center transition active:scale-[0.99]"
                      style={{
                        border: `1.5px solid ${isActive ? C.primary : C.border}`,
                        backgroundColor: isActive ? C.beige : 'white',
                        boxShadow: isActive ? `0 0 0 2px ${C.primary}22` : 'none',
                        gridColumn: src.value === 'other' ? 'span 1' : undefined,
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

              {/* 2단계: SNS 소분류 (SNS 선택 시만 표시) */}
              {leadSource === 'sns' && (
                <div className="space-y-2 pt-1">
                  <span className="block text-xs font-medium tracking-wide" style={{ color: C.gold }}>
                    {t.leadSNSSubTitle}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'instagram', label: t.leadInstagram },
                      { value: 'facebook', label: t.leadFacebook },
                      { value: 'youtube', label: t.leadYoutube },
                      { value: 'blog_cafe', label: t.leadBlogCafe },
                    ]).map((detail) => {
                      const isActive = leadSourceDetail === detail.value;
                      return (
                        <button
                          key={detail.value}
                          type="button"
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

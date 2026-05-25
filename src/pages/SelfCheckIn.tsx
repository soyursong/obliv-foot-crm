// LOGIC-LOCK: L-001 — 셀프접수 고객정보 노출 금지. 변경 시 현장 승인 필수
/**
 * 셀프체크인 페이지 — /checkin/:clinicSlug
 *
 * 인증 불필요 (anon). 태블릿/모바일 전체화면 최적화 (키오스크 모드).
 * 흐름: 성함+전화번호 입력 → 방문유형(2단계) 선택 → 유입경로(워크인만) 선택 → 접수 확인 → 접수 완료
 *
 * 키오스크 기능:
 * - 완료 화면 15초 자동 리셋 (카운트다운 표시)
 * - 입력 화면 60초 비활동 타임아웃 (자동 리셋)
 * - 전화번호 입력 시 오늘 예약 조회 + 자동 방문유형 채움
 * - 터치 최적화 숫자패드 (온스크린)
 * - 접수 완료 화면 강화 (체크마크 펄스 애니메이션, 클리닉명 표시)
 * - 초진/예약없이 방문 시 신분증 확인 필요 플래그 자동 설정
 *
 * 디자인: 브라운/베이지 고급 웰니스 클리닉 테마 (T-20260428-foot-CHECKIN-UX)
 *
 * T-20260517-foot-CHECKIN-2STEP:
 *  - 방문유형 2단계: 예약여부(1단계) → 초진/재진(2단계)
 *  - 워크인 안내 팝업 → 초진으로 접수
 *  - 체험(experience) 셀프체크인 노출 제거 (TM CRM 직접 입력용)
 *  - 유입경로 2단계: 대분류(1단계) → SNS 소분류(2단계)
 *  - 소개자 이름+전화번호 입력란 제거
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

type Step = 'input' | 'confirm' | 'done' | 'error';
type Lang = 'ko' | 'en';

/** 예약 여부 1단계 선택값 */
type ReservationType = 'reserved' | 'walkin';

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
  waitMsg: string;
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
  // T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 레이블
  smsOptIn: string;
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
    waitMsg: '잠시만 기다려 주세요.',
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
    smsOptIn: '예약 안내 문자 수신에 동의합니다 (선택)',
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
    waitMsg: 'Please wait to be called.',
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
    smsOptIn: 'I agree to receive appointment reminders via SMS (optional)',
  },
};

/** 완료 화면 자동 리셋 (초) */
const DONE_RESET_SECONDS = 15;
/** 입력 화면 비활동 타임아웃 (초) */
const IDLE_TIMEOUT_SECONDS = 60;

// ── 공통 폰트 스타일 (Pretendard 모던 고딕 — T-20260514-foot-SELFCHECKIN-FONT) ──
const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
};

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

  const handleConfirm = () => {
    if (!canSubmit) return;
    setStep('confirm');
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
        const { data: created, error: cErr } = await anonClient
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: name.trim(),
            phone: phoneStored,
            visit_type: visitType === 'new' ? 'new' : 'returning',
            // T-20260525-foot-MESSAGING-V1 AC-5: SMS 수신동의 저장
            sms_opt_in: smsOptIn,
          })
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

        // Fallback: digits-only 비교
        if (!matchedReservationId && phoneDigits.length >= 10) {
          const { data: allResv } = await anonClient
            .from('reservations')
            .select('id, customer_phone')
            .eq('clinic_id', clinicId)
            .eq('reservation_date', todayDate)
            .eq('status', 'confirmed');
          if (allResv) {
            const digitsMatch = (allResv as { id: string; customer_phone: string | null }[]).find(
              (r) => (r.customer_phone ?? '').replace(/\D/g, '') === phoneDigits,
            );
            if (digitsMatch) matchedReservationId = digitsMatch.id;
          }
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

      const { error: ciErr } = await anonClient.from('check_ins').insert({
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
      });

      if (ciErr) {
        setErrorMsg(`${t.failPrefix}${ciErr.message}`);
        setStep('error');
        setSubmitting(false);
        return;
      }

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
      // 도파민 경유 예약(source_system='dopamine')인 경우에만 EF가 내부 판정 후 발사.
      // 실패해도 체크인 완료 UX를 블록하지 않음.
      if (matchedReservationId) {
        anonClient.functions
          .invoke('checkin-visited-fire', {
            body: { reservation_id: matchedReservationId },
          })
          .catch(() => {
            // 네트워크 오류 등 — 무시. outbound_log 재시도는 서버 측 담당.
          });
      }

      setQueueNumber(queue);
      setStep('done');
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
              <br />
              {t.waitMsg}
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
              onClick={() => setStep('input')}
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
          >
            {t.checkIn}
          </button>
        </div>
      </main>
    </div>
  );
}

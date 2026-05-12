/**
 * 셀프체크인 페이지 — /checkin/:clinicSlug
 *
 * 인증 불필요 (anon). 태블릿/모바일 전체화면 최적화 (키오스크 모드).
 * 흐름: 성함+전화번호 입력 → 방문유형 선택 → 접수 확인 → 접수 완료
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

const T: Record<Lang, {
  selfCheckIn: string;
  name: string;
  namePlaceholder: string;
  phone: string;
  phonePlaceholder: string;
  visitType: string;
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
  visitNew: string;
  visitNewDesc: string;
  visitReturning: string;
  visitReturningDesc: string;
  visitExperience: string;
  visitExperienceDesc: string;
  failPrefix: string;
  errorPrefix: string;
  referrer: string;
  referrerPlaceholder: string;
}> = {
  ko: {
    selfCheckIn: '셀프 접수',
    name: '성함',
    namePlaceholder: '홍길동',
    phone: '연락처',
    phonePlaceholder: '예약하신 번호로 입력해주세요',
    visitType: '방문 유형',
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
    visitNew: '초진',
    visitNewDesc: '처음 방문 입니다',
    visitReturning: '재진',
    visitReturningDesc: '재방문 입니다',
    visitExperience: '예약없이 방문',
    visitExperienceDesc: '',
    failPrefix: '접수 실패: ',
    errorPrefix: '오류가 발생했습니다: ',
    referrer: '추천인',
    referrerPlaceholder: '추천해 주신 분 성함 (선택)',
  },
  en: {
    selfCheckIn: 'Self Check-In',
    name: 'Name',
    namePlaceholder: 'Hong Gil-dong',
    phone: 'Phone',
    phonePlaceholder: 'Your reservation phone number',
    visitType: 'Visit Type',
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
    visitNew: 'New Patient',
    visitNewDesc: 'First visit',
    visitReturning: 'Follow-up',
    visitReturningDesc: 'Returning visit',
    visitExperience: 'Walk-in',
    visitExperienceDesc: 'No reservation',
    failPrefix: 'Failed: ',
    errorPrefix: 'Error: ',
    referrer: 'Referred by',
    referrerPlaceholder: 'Name of person who referred you (optional)',
  },
};

function visitChoices(lang: Lang): { value: VisitType; label: string; desc: string }[] {
  const t = T[lang];
  return [
    { value: 'new', label: t.visitNew, desc: t.visitNewDesc },
    { value: 'returning', label: t.visitReturning, desc: t.visitReturningDesc },
    { value: 'experience', label: t.visitExperience, desc: t.visitExperienceDesc },
  ];
}

/** 완료 화면 자동 리셋 (초) */
const DONE_RESET_SECONDS = 15;
/** 입력 화면 비활동 타임아웃 (초) */
const IDLE_TIMEOUT_SECONDS = 60;

/** 신분증 확인 필요 여부 — 초진(new) + 예약없이 방문(experience) */
const needsIdCheck = (vt: VisitType) => vt === 'new' || vt === 'experience';

// ── 공통 폰트 스타일 (Noto Serif KR 고급 웰니스 테마) ──
const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'Noto Serif KR', 'Apple SD Gothic Neo', 'Malgun Gothic', Georgia, serif",
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
  const [visitType, setVisitType] = useState<VisitType>('new');
  const [referrerName, setReferrerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const t = T[lang];
  const VISIT_CHOICES = visitChoices(lang);

  // 예약 정보
  const [reservationBanner, setReservationBanner] = useState<{
    time: string;
    visitType: string;
  } | null>(null);

  // 완료 화면 카운트다운
  const [countdown, setCountdown] = useState(DONE_RESET_SECONDS);

  // T-20260510-foot-SELFCHECKIN-NO-PREFILL: 인라인 환자 검색 상태 제거
  // (selectedPatientId는 submit 시 서버 매칭 결과 캐시로만 사용. 폼 자동 채움 X)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  // T-20260510-foot-SELFCHECKIN-NO-PREFILL: 폼 DOM 강제 재마운트 카운터
  // 매 리셋마다 key가 바뀌어 브라우저 자동완성 캐시를 무효화한다
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
  // T-20260510-foot-SELFCHECKIN-NO-PREFILL: resetKey 증가 → 입력 DOM 재마운트 → 브라우저 자동완성 캐시 무효화
  const resetForm = useCallback(() => {
    // sessionStorage 전체 초기화 (셀프접수 페이지 전용 스토리지 보호)
    try { sessionStorage.clear(); } catch { /* 무시 */ }
    setResetKey((k) => k + 1);
    setStep('input');
    setName('');
    setPhone('');
    setVisitType('new');
    setReferrerName('');
    setQueueNumber(null);
    setErrorMsg('');
    setReservationBanner(null);
    setCountdown(DONE_RESET_SECONDS);
    setSelectedPatientId(null);
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
          const vtLabel = VISIT_CHOICES.find((c) => c.value === vt)?.label ?? vt;
          setReservationBanner({ time: timeStr, visitType: vtLabel });
          setVisitType(vt);
        } else {
          setReservationBanner(null);
        }
      } catch {
        setReservationBanner(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, phone]);

  // T-20260510-foot-SELFCHECKIN-NO-PREFILL: 이름/전화 자동완성 검색 비활성화
  // 기존 고객 매칭은 submit 이후 서버 측 로직(handleSubmit)에서만 수행한다.
  // (인라인 드롭다운 자동 채움 UX 제거 — 매번 빈 폼으로 시작)

  // T-20260510-foot-SELFCHECKIN-NO-PREFILL: handleKioskPatientSelect 제거
  // (이전 고객 자동 채움 UX 폐지)

  const canSubmit = name.trim().length >= 1 && phone.replace(/\D/g, '').length >= 10;

  const handleConfirm = () => {
    if (!canSubmit) return;
    setStep('confirm');
  };

  const handleSubmit = async () => {
    if (!clinicId) return;
    setSubmitting(true);
    setErrorMsg('');

    try {
      // 인라인 검색으로 선택된 환자 ID 우선 사용
      let customerId: string | null = selectedPatientId ?? null;
      const phoneDigits = phone.replace(/\D/g, '');
      const phoneE164 = normalizeToE164(phone);
      const phoneStored = phoneE164 ?? phoneDigits;

      // customerId 없을 경우 전화번호로 조회
      let existing: { id: string } | null = customerId ? { id: customerId } : null;
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
      // 세 번째 시도: 하이픈 포맷 (010-XXXX-XXXX) — 레거시 DB 엔트리 대응
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
      } else {
        const { data: created, error: cErr } = await anonClient
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: name.trim(),
            phone: phoneStored,
            visit_type: visitType === 'new' ? 'new' : 'returning',
            referrer_name: referrerName.trim() || null,
          })
          .select('id')
          .single();
        if (cErr) {
          // unique constraint 위반(23505): phone이 이미 존재 → 재조회
          // (E164 변환 이전 포맷으로 저장된 고객 등 phone 불일치 시 발생)
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
      // 한 박스 원칙: 이름+전화번호 일치 시 무조건 단일 박스 유지
      const todayDate = new Date().toISOString().slice(0, 10);
      const todayStart = `${todayDate}T00:00:00+09:00`;
      const todayEnd = `${todayDate}T23:59:59+09:00`;

      // (1) 당일 기존 체크인 중복 방지: 동일 고객 check_in 존재 시 새 INSERT 금지
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
          // 이미 접수된 고객 → 중복 생성 금지, 완료 화면으로 이동
          const ci = existingCi as { id: string; queue_number?: number | null };
          setQueueNumber(ci.queue_number ?? null);
          setStep('done');
          setSubmitting(false);
          return;
        }
      }

      // (2) 당일 예약 매칭: customer_id 기준 → fallback: customer_phone 기준
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
          // Fallback 1: phone 기준 (중복 제거 후 순서대로 시도)
          // 하이픈 포맷 포함 — 레거시 DB 엔트리 대응
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

        // Fallback 2: digits-only 비교 (E164/하이픈/공백 무관)
        // DB에 어떤 포맷으로 저장되어 있어도 숫자만 비교해 매칭
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
        // 예약 조회 실패 → 무시 (신규 접수로 처리)
      }
      // ── merge 로직 끝 ──────────────────────────────────────────────────────

      // (2.5) 예약에 연결된 기존 체크인 확인 (staff 선체크인 중복 INSERT 방지)
      // staff가 대시보드에서 예약 슬롯을 클릭해 이미 체크인 생성한 경우 → 고객 셀프접수 시 재생성 금지
      // customer_id 기반 step (1)이 customer_id=null 케이스를 놓칠 수 있으므로 reservation_id로 재확인
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
          // RLS 차단 등 조회 실패 → 무시, 새 INSERT 진행
        }
      }

      const { data: queueData, error: queueErr } = await anonClient.rpc('next_queue_number', {
        p_clinic_id: clinicId,
        p_date: todayDate,
      });

      let queue: number | null = null;
      if (!queueErr) queue = queueData as number;

      // 신분증 확인 필요 플래그: 초진(new) + 예약없이 방문(experience)은 자동 ON
      // 예약없이 방문(walk_in) 플래그: 슬롯 라우팅 추적용
      const notesParts: Record<string, unknown> = {};
      if (needsIdCheck(visitType)) notesParts.id_check_required = true;
      if (visitType === 'experience') notesParts.walk_in = true;
      const notesPayload = Object.keys(notesParts).length > 0 ? notesParts : null;

      const { error: ciErr } = await anonClient.from('check_ins').insert({
        clinic_id: clinicId,
        customer_id: customerId,
        customer_name: name.trim(),
        customer_phone: phoneStored,
        visit_type: visitType,
        // 재진→치료대기(treatment_waiting) 직행 / 초진·체험→상담대기(consult_waiting) 직행
        status: visitType === 'returning' ? 'treatment_waiting' : 'consult_waiting',
        queue_number: queue,
        notes: notesPayload,
        // T-20260506-foot-SELFCHECKIN-MERGE: 예약 있으면 reservation_id 링크 (중복 박스 방지)
        reservation_id: matchedReservationId,
      });

      if (ciErr) {
        setErrorMsg(`${t.failPrefix}${ciErr.message}`);
        setStep('error');
        setSubmitting(false);
        return;
      }

      // (3) 매칭된 예약 → checked_in 상태 업데이트 (최선 노력, RLS 차단 시 무시)
      if (matchedReservationId) {
        try {
          await anonClient
            .from('reservations')
            .update({ status: 'checked_in' })
            .eq('id', matchedReservationId)
            .eq('status', 'confirmed'); // safety: confirmed 상태만 업데이트
        } catch {
          // RLS/권한 오류 → 체크인 자체는 성공이므로 무시
        }
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
          {/* 클리닉명 */}
          <p className="text-base font-medium tracking-wide" style={{ color: C.medium }}>
            {clinicName}
          </p>

          {/* 체크마크 펄스 */}
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
    const visitLabel = VISIT_CHOICES.find((c) => c.value === visitType)?.label ?? visitType;
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
            <div className={`flex justify-between${referrerName.trim() ? ' border-b pb-3' : ''}`} style={{ borderColor: C.border }}>
              <span style={{ color: C.muted }}>{t.visitType}</span>
              <span className="font-semibold" style={{ color: C.dark }}>{visitLabel}</span>
            </div>
            {referrerName.trim() && (
              <div className="flex justify-between">
                <span style={{ color: C.muted }}>{t.referrer}</span>
                <span className="font-semibold" style={{ color: C.dark }}>{referrerName.trim()}</span>
              </div>
            )}
          </div>
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
              <input
                key={`sc-name-${resetKey}`}
                id="sc-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (selectedPatientId) setSelectedPatientId(null);
                }}
                placeholder={t.namePlaceholder}
                autoComplete="new-password"
                className="h-14 w-full rounded-xl px-4 text-lg outline-none transition"
                style={{
                  border: `1.5px solid ${selectedPatientId ? C.medium : C.border}`,
                  backgroundColor: selectedPatientId ? C.bannerBg : 'white',
                  color: C.dark,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.borderActive;
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.borderActive}18`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = selectedPatientId ? C.medium : C.border;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {/* T-20260510-foot-SELFCHECKIN-NO-PREFILL: 이름 검색 드롭다운 제거 */}
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

            {/* T-20260510-foot-SELFCHECKIN-NO-PREFILL: 전화번호 인라인 환자 매칭 드롭다운 제거 */}

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

          {/* 방문 유형 — 세로 스택 (태블릿 터치 최적화) */}
          <div className="space-y-2">
            <span className="block text-sm font-medium tracking-wide" style={{ color: C.medium }}>
              {t.visitType}
            </span>
            <div className="space-y-2">
              {VISIT_CHOICES.map((c) => {
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
                      {c.desc && (
                        <p className="text-sm mt-0.5" style={{ color: isActive ? C.medium : C.border }}>
                          {c.desc}
                        </p>
                      )}
                    </div>
                    {/* 라디오 인디케이터 */}
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
          </div>

          {/* 추천인 — 신규 방문 시만 표시 */}
          {visitType === 'new' && (
            <div className="space-y-1.5">
              <label
                htmlFor="sc-referrer"
                className="block text-sm font-medium tracking-wide"
                style={{ color: C.medium }}
              >
                {t.referrer} <span className="text-xs font-normal" style={{ color: C.muted }}>(선택)</span>
              </label>
              <input
                key={`sc-referrer-${resetKey}`}
                id="sc-referrer"
                type="text"
                value={referrerName}
                onChange={(e) => setReferrerName(e.target.value)}
                placeholder={t.referrerPlaceholder}
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

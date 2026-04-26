/**
 * 셀프체크인 페이지 — /checkin/:clinicSlug
 *
 * 인증 불필요 (anon). 태블릿/모바일 전체화면 최적화 (키오스크 모드).
 * 흐름: 이름+전화번호 입력 → 유형 선택 → 접수 확인 → 접수 완료
 *
 * 키오스크 기능:
 * - 완료 화면 15초 자동 리셋 (카운트다운 표시)
 * - 입력 화면 60초 비활동 타임아웃 (자동 리셋)
 * - 전화번호 입력 시 오늘 예약 조회 + 자동 방문유형 채움
 * - 터치 최적화 숫자패드 (온스크린)
 * - 접수 완료 화면 강화 (체크마크 펄스 애니메이션, 클리닉명 표시)
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

type Step = 'input' | 'confirm' | 'done' | 'error';

const VISIT_CHOICES: { value: VisitType; label: string; desc: string }[] = [
  { value: 'new', label: '신규', desc: '처음 방문하셨습니다' },
  { value: 'returning', label: '재진', desc: '재방문입니다' },
  { value: 'experience', label: '체험', desc: '체험을 원합니다' },
];

/** 완료 화면 자동 리셋 (초) */
const DONE_RESET_SECONDS = 15;
/** 입력 화면 비활동 타임아웃 (초) */
const IDLE_TIMEOUT_SECONDS = 60;

// ── 숫자패드 컴포넌트 ──
function NumPad({
  onDigit,
  onDelete,
  onClear,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onClear: () => void;
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
              className="flex h-14 items-center justify-center rounded-xl bg-gray-200 text-base font-semibold text-gray-600 transition active:bg-gray-300 active:scale-95"
            >
              전체삭제
            </button>
          );
        }
        if (k === 'del') {
          return (
            <button
              key={k}
              type="button"
              onClick={onDelete}
              className="flex h-14 items-center justify-center rounded-xl bg-gray-200 text-lg font-semibold text-gray-600 transition active:bg-gray-300 active:scale-95"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            className="flex h-14 items-center justify-center rounded-xl bg-white border-2 border-gray-200 text-xl font-bold text-gray-800 transition active:bg-teal-50 active:border-teal-400 active:scale-95"
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

  const [step, setStep] = useState<Step>('input');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('new');
  const [submitting, setSubmitting] = useState(false);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 예약 정보
  const [reservationBanner, setReservationBanner] = useState<{
    time: string;
    visitType: string;
  } | null>(null);

  // 완료 화면 카운트다운
  const [countdown, setCountdown] = useState(DONE_RESET_SECONDS);

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
    setStep('input');
    setName('');
    setPhone('');
    setVisitType('new');
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
      // step === 'input' 상태에서만 리셋
      resetForm();
    }, IDLE_TIMEOUT_SECONDS * 1000);
  }, [resetForm]);

  useEffect(() => {
    if (step !== 'input') {
      // input이 아닌 화면에서는 idle timer 해제
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return;
    }
    // input 화면 진입 시 타이머 시작
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

  const handlePhoneChange = useCallback(
    (raw: string) => {
      setPhone(formatPhone(raw));
    },
    [formatPhone],
  );

  // 숫자패드 핸들러
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

  // ── 전화번호 완성 시 오늘 예약 조회 (10-11자리 도달 시 자동 트리거) ──
  const reservationCheckedRef = useRef<string>('');

  useEffect(() => {
    if (!clinicId) return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      // 번호가 지워지면 배너 해제 + 이전 체크 기록 초기화
      if (reservationBanner) setReservationBanner(null);
      reservationCheckedRef.current = '';
      return;
    }
    // 동일 번호로 이미 조회했으면 스킵
    if (reservationCheckedRef.current === digits) return;
    reservationCheckedRef.current = digits;

    const phoneE164 = normalizeToE164(phone);
    const today = new Date().toISOString().slice(0, 10);

    (async () => {
      try {
        // E.164 우선 조회
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

        // E.164 미매칭 시 digits 폴백
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
          const timeStr = (reservation.reservation_time as string).slice(0, 5); // HH:MM
          const vt = reservation.visit_type as VisitType;
          const vtLabel = VISIT_CHOICES.find((c) => c.value === vt)?.label ?? vt;
          setReservationBanner({ time: timeStr, visitType: vtLabel });
          setVisitType(vt);
        } else {
          setReservationBanner(null);
        }
      } catch {
        // 예약 조회 실패는 무시 (체크인 자체는 진행 가능)
        setReservationBanner(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, phone]);

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
      // 기존 고객 조회 — PHONE_E164: E.164 우선 매칭, 미매칭 시 legacy digits 폴백
      let customerId: string | null = null;
      const phoneDigits = phone.replace(/\D/g, '');
      const phoneE164 = normalizeToE164(phone);
      const phoneStored = phoneE164 ?? phoneDigits;
      let { data: existing } = await anonClient
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', phoneStored)
        .maybeSingle();
      if (!existing && phoneE164 && phoneDigits !== phoneE164) {
        const { data: legacy } = await anonClient
          .from('customers')
          .select('id')
          .eq('clinic_id', clinicId)
          .eq('phone', phoneDigits)
          .maybeSingle();
        existing = legacy;
      }

      if (existing) {
        customerId = existing.id as string;
      } else {
        // 신규 고객 생성
        const { data: created, error: cErr } = await anonClient
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: name.trim(),
            phone: phoneStored,
            visit_type: visitType === 'new' ? 'new' : 'returning',
          })
          .select('id')
          .single();
        if (cErr) {
          // RLS 정책 미비 시 고객 생성 없이 진행
          console.warn('Customer insert failed (RLS?):', cErr.message);
        } else {
          customerId = (created as { id: string }).id;
        }
      }

      // 대기번호 발급
      const { data: queueData, error: queueErr } = await anonClient.rpc('next_queue_number', {
        p_clinic_id: clinicId,
        p_date: new Date().toISOString().slice(0, 10),
      });

      let queue: number | null = null;
      if (queueErr) {
        console.warn('Queue number RPC failed:', queueErr.message);
      } else {
        queue = queueData as number;
      }

      // 체크인 INSERT
      const { error: ciErr } = await anonClient.from('check_ins').insert({
        clinic_id: clinicId,
        customer_id: customerId,
        customer_name: name.trim(),
        customer_phone: phoneStored,
        visit_type: visitType,
        status: 'registered',
        queue_number: queue,
      });

      if (ciErr) {
        setErrorMsg(`접수 실패: ${ciErr.message}`);
        setStep('error');
        setSubmitting(false);
        return;
      }

      setQueueNumber(queue);
      setStep('done');
    } catch (err) {
      setErrorMsg(`오류가 발생했습니다: ${(err as Error).message}`);
      setStep('error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 로딩 ──
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-teal-50 to-white">
        <p className="text-lg text-muted-foreground">불러오는 중...</p>
      </div>
    );
  }

  // ── 클리닉 없음 ──
  if (clinicNotFound) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-red-50 to-white px-6">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-red-600">지점을 찾을 수 없습니다</h1>
          <p className="text-muted-foreground">
            올바른 체크인 링크인지 확인해 주세요.
          </p>
        </div>
      </div>
    );
  }

  // ── 완료 ──
  if (step === 'done') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-teal-50 to-white px-6">
        <div className="w-full max-w-md space-y-8 text-center">
          {/* 클리닉명 */}
          <p className="text-lg font-medium text-teal-600">{clinicName}</p>

          {/* 체크마크 펄스 애니메이션 */}
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-teal-100 animate-pulse">
            <svg
              className="h-14 w-14 text-teal-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-teal-700">접수 완료</h1>
            {queueNumber != null && (
              <div className="mt-6">
                <p className="text-sm text-gray-500">대기번호</p>
                <p className="mt-1 text-8xl font-black text-teal-600 tabular-nums">
                  #{queueNumber}
                </p>
              </div>
            )}
            <p className="mt-6 text-lg text-gray-600">
              <strong>{name.trim()}</strong>님, 접수가 완료되었습니다.
              <br />
              잠시만 기다려 주세요.
            </p>
          </div>

          {/* 카운트다운 */}
          <p className="text-sm text-gray-400">
            {countdown}초 후 자동으로 초기화됩니다
          </p>

          <button
            onClick={resetForm}
            className="mx-auto block rounded-xl bg-gray-100 px-8 py-4 text-lg font-medium text-gray-700 transition hover:bg-gray-200 active:bg-gray-300"
          >
            새 접수
          </button>
        </div>
      </div>
    );
  }

  // ── 에러 ──
  if (step === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-red-50 to-white px-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <h1 className="text-2xl font-bold text-red-600">접수 실패</h1>
          <p className="text-gray-600">{errorMsg}</p>
          <button
            onClick={() => setStep('input')}
            className="mx-auto block rounded-xl bg-gray-100 px-8 py-4 text-lg font-medium text-gray-700 transition hover:bg-gray-200"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // ── 확인 ──
  if (step === 'confirm') {
    const visitLabel = VISIT_CHOICES.find((c) => c.value === visitType)?.label ?? visitType;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-teal-50 to-white px-6">
        <div className="w-full max-w-md space-y-8">
          <h1 className="text-center text-2xl font-bold text-gray-800">접수 정보 확인</h1>
          <div className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex justify-between border-b pb-3">
              <span className="text-gray-500">이름</span>
              <span className="font-semibold">{name.trim()}</span>
            </div>
            <div className="flex justify-between border-b pb-3">
              <span className="text-gray-500">연락처</span>
              <span className="font-semibold">{phone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">방문 유형</span>
              <span className="font-semibold">{visitLabel}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('input')}
              className="flex-1 rounded-xl border-2 border-gray-300 py-4 text-lg font-medium text-gray-700 transition hover:bg-gray-50 active:bg-gray-100"
            >
              수정
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl bg-teal-600 py-4 text-lg font-bold text-white transition hover:bg-teal-700 active:bg-teal-800 disabled:opacity-50"
            >
              {submitting ? '처리 중...' : '접수하기'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 입력 폼 ──
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-teal-50 to-white">
      {/* 헤더 */}
      <header className="px-6 pb-2 pt-8 text-center">
        <h1 className="text-2xl font-bold text-teal-700">{clinicName}</h1>
        <p className="mt-1 text-gray-500">셀프 접수</p>
      </header>

      {/* 폼 */}
      <main className="flex flex-1 flex-col items-center px-6 pb-8 pt-4">
        <div className="w-full max-w-md space-y-6">
          {/* 이름 */}
          <div className="space-y-2">
            <label htmlFor="sc-name" className="block text-sm font-medium text-gray-700">
              이름
            </label>
            <input
              id="sc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              autoComplete="name"
              className="h-14 w-full rounded-xl border-2 border-gray-200 bg-white px-4 text-lg outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />
          </div>

          {/* 연락처 */}
          <div className="space-y-2">
            <label htmlFor="sc-phone" className="block text-sm font-medium text-gray-700">
              연락처
            </label>
            <input
              id="sc-phone"
              type="tel"
              inputMode="none"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="010-1234-5678"
              autoComplete="tel"
              readOnly
              className="h-14 w-full rounded-xl border-2 border-gray-200 bg-white px-4 text-lg outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
            />

            {/* 예약 배너 */}
            {reservationBanner && (
              <div className="flex items-center gap-2 rounded-xl border-2 border-teal-200 bg-teal-50 px-4 py-3">
                <svg className="h-5 w-5 flex-shrink-0 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium text-teal-700">
                  오늘 예약이 있습니다: {reservationBanner.time} {reservationBanner.visitType}
                </span>
              </div>
            )}

            {/* 온스크린 숫자패드 */}
            <NumPad
              onDigit={handleNumPadDigit}
              onDelete={handleNumPadDelete}
              onClear={handleNumPadClear}
            />
          </div>

          {/* 방문 유형 */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-gray-700">방문 유형</span>
            <div className="grid grid-cols-3 gap-3">
              {VISIT_CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setVisitType(c.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 py-5 text-center transition active:scale-[0.97] ${
                    visitType === c.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg font-bold">{c.label}</span>
                  <span className="text-xs text-gray-400">{c.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 접수 버튼 */}
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="mt-4 h-16 w-full rounded-xl bg-teal-600 text-xl font-bold text-white transition hover:bg-teal-700 active:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            접수
          </button>
        </div>
      </main>
    </div>
  );
}

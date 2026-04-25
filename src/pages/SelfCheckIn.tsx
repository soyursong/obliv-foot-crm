/**
 * 셀프체크인 페이지 — /checkin/:clinicSlug
 *
 * 인증 불필요 (anon). 태블릿/모바일 전체화면 최적화.
 * 흐름: 이름+전화번호 입력 → 유형 선택 → 접수 완료
 */
import { useEffect, useState } from 'react';
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

  // 클리닉 조회
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

  // 전화번호 자동 포맷
  const handlePhoneChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) {
      setPhone(digits);
    } else if (digits.length <= 7) {
      setPhone(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    } else {
      setPhone(`${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`);
    }
  };

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

  const resetForm = () => {
    setStep('input');
    setName('');
    setPhone('');
    setVisitType('new');
    setQueueNumber(null);
    setErrorMsg('');
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
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-teal-100">
            <svg className="h-12 w-12 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-teal-700">접수 완료</h1>
            {queueNumber && (
              <p className="mt-4 text-6xl font-black text-teal-600">
                #{queueNumber}
              </p>
            )}
            <p className="mt-4 text-lg text-gray-600">
              <strong>{name.trim()}</strong>님, 접수가 완료되었습니다.
              <br />
              잠시만 기다려 주세요.
            </p>
          </div>
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
              inputMode="numeric"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="010-1234-5678"
              autoComplete="tel"
              className="h-14 w-full rounded-xl border-2 border-gray-200 bg-white px-4 text-lg outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-200"
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

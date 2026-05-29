/**
 * T-20260529-foot-HEALTH-Q-MOBILE
 *
 * 발건강질문지 — 고객 모바일 자가작성 페이지
 *
 * 라우트 : /health-q/:token  (anon, 로그인 불필요)
 * 흐름   : fn_health_q_validate_token → 폼 작성 → fn_health_q_submit
 * 저장   : health_q_results (DB) + documents 버킷 JSON (선택)
 *
 * AC-1: 발건강질문지 전 항목 체크박스/라디오 UI
 * AC-2: 모바일 최적화 (375~430px, 단일컬럼, 44px+ 터치, sticky 제출)
 * AC-3: 토큰 URL → 로그인 없이 접근 → 제출 시 DB 저장 (차트 데이터 격리)
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';

// ── anon Supabase 클라이언트 ────────────────────────────────────────────────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── 컬러 토큰 (teal-emerald 풋센터 테마) ────────────────────────────────────────
const C = {
  bgFrom:       '#F0FDF9',
  bgTo:         '#ECFDF5',
  dark:         '#134E4A',
  primary:      '#0F766E',
  medium:       '#0D9488',
  muted:        '#5EEAD4',
  mutedText:    '#6B7280',
  border:       '#99F6E4',
  borderActive: '#0D9488',
  light:        '#F0FDFA',
  cream:        '#FFFFFF',
  gold:         '#10B981',
  bannerBg:     '#ECFDF5',
  bannerBorder: '#6EE7B7',
  error:        '#DC2626',
} as const;

const FONT: React.CSSProperties = {
  fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
};

// ── 헬퍼 ────────────────────────────────────────────────────────────────────────
function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

// ── 설문 항목 정의 ───────────────────────────────────────────────────────────────
// 발건강질문지 일반/어르신 공통 항목 (오블리브_발톱_발건강_질문지 기반)

const VISIT_PURPOSE_OPTIONS = [
  '발톱 관련 시술',
  '굳은살/티눈 제거',
  '무좀 치료',
  '발 건조/각질 관리',
  '발 냄새 관리',
  '기타',
];

const SYMPTOM_OPTIONS = [
  '내성발톱',
  '무지외반증',
  '굳은살/티눈',
  '무좀/진균감염',
  '발냄새',
  '발 건조/각질',
  '당뇨발/혈액순환',
  '발목 통증',
  '발바닥 통증',
  '기타',
];

const NAIL_ROWS = [
  ['엄지(좌)', '검지(좌)', '중지(좌)', '약지(좌)', '소지(좌)'],
  ['엄지(우)', '검지(우)', '중지(우)', '약지(우)', '소지(우)'],
];

const PAIN_DURATION_OPTIONS = [
  '1개월 미만',
  '1~3개월',
  '3~6개월',
  '6개월~1년',
  '1년 이상',
];

const PAIN_SEVERITY_OPTIONS = [
  { value: '1', label: '경미', emoji: '😊' },
  { value: '2', label: '불편', emoji: '😐' },
  { value: '3', label: '심함', emoji: '😣' },
  { value: '4', label: '매우 심함', emoji: '😰' },
];

const MEDICAL_HISTORY_OPTIONS = [
  '당뇨', '고혈압', '심장질환', '혈관질환', '면역질환',
  '신장질환', '간질환', '골다공증', '기타',
];

const MEDICATION_OPTIONS = [
  '항응고제(혈액희석제)',
  '항생제',
  '스테로이드',
  '혈압약',
  '당뇨약',
  '아스피린',
  '기타',
];

const ALLERGY_OPTIONS = ['마취제', '항생제', '소독제', '금속', '약물', '기타'];

const PRIOR_TREATMENT_OPTIONS = [
  '발톱 매식술',
  '내성발톱 절제술',
  '레이저 시술',
  '굳은살 제거 시술',
  '없음',
];

const REFERRAL_OPTIONS = [
  '네이버 검색',
  '지인 소개',
  'SNS/인스타',
  '블로그/카페',
  'TV/언론',
  '기타',
];

// ── 데이터 타입 ─────────────────────────────────────────────────────────────────
interface HealthQData {
  // 방문 목적
  visit_purpose:        string[];
  visit_purpose_other:  string;
  // 증상
  symptoms:             string[];
  symptoms_other:       string;
  // 발톱 통증 부위·기간·정도
  nail_locations:       string[];
  pain_duration:        string;
  pain_severity:        string;
  // 과거 병력
  medical_history:      string[];
  medical_history_other: string;
  // 이전 치료 경험
  prior_treatment:      string[];
  prior_conditions:     string; // 기왕증 자유서술
  family_history:       string;
  // 현재 복용 약물
  medications:          string[];
  medications_other:    string;
  medications_none:     boolean;
  // 알레르기
  has_allergy:          boolean;
  allergy_types:        string[];
  allergy_other:        string;
  // 방문 경로
  referral_source:      string;
}

const emptyData = (): HealthQData => ({
  visit_purpose:         [],
  visit_purpose_other:   '',
  symptoms:              [],
  symptoms_other:        '',
  nail_locations:        [],
  pain_duration:         '',
  pain_severity:         '',
  medical_history:       [],
  medical_history_other: '',
  prior_treatment:       [],
  prior_conditions:      '',
  family_history:        '',
  medications:           [],
  medications_other:     '',
  medications_none:      false,
  has_allergy:           false,
  allergy_types:         [],
  allergy_other:         '',
  referral_source:       '',
});

type PageStep = 'loading' | 'error' | 'form' | 'submitting' | 'done' | 'already_used';

interface TokenInfo {
  token_id:      string;
  customer_id:   string;
  customer_name: string;
  clinic_id:     string;
  check_in_id:   string | null;
  form_type:     string;
}

// ── 큰 선택 버튼 ────────────────────────────────────────────────────────────────
function BigBtn({
  active, onClick, children, color = 'teal', danger, full, className,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: 'teal' | 'emerald' | 'amber' | 'rose';
  danger?: boolean;
  full?: boolean;
  className?: string;
}) {
  const scheme = danger
    ? { on: 'border-red-500 bg-red-50 text-red-700', off: 'border-gray-200 bg-white text-gray-700' }
    : {
        teal:    { on: 'border-teal-600 bg-teal-50 text-teal-800',    off: 'border-gray-200 bg-white text-gray-700' },
        emerald: { on: 'border-emerald-600 bg-emerald-50 text-emerald-800', off: 'border-gray-200 bg-white text-gray-700' },
        amber:   { on: 'border-amber-500 bg-amber-50 text-amber-800', off: 'border-gray-200 bg-white text-gray-700' },
        rose:    { on: 'border-rose-500 bg-rose-50 text-rose-700',    off: 'border-gray-200 bg-white text-gray-700' },
      }[color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-[44px] rounded-xl border-2 px-4 py-2.5 text-[15px] font-medium transition active:scale-[0.97]',
        full && 'w-full text-left',
        active ? (typeof scheme === 'string' ? scheme : scheme.on) : (typeof scheme === 'string' ? scheme : scheme.off),
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── 섹션 헤더 ──────────────────────────────────────────────────────────────────
function SectionHeader({ num, title, sub }: { num: number; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 pb-2 border-b border-teal-100">
      <span
        className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white shrink-0"
        style={{ backgroundColor: C.primary }}
      >
        {num}
      </span>
      <div>
        <h2 className="text-base font-semibold" style={{ color: C.dark }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color: C.mutedText }}>{sub}</p>}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
export default function HealthQMobilePage() {
  const { token } = useParams<{ token: string }>();

  const [step,     setStep]     = useState<PageStep>('loading');
  const [info,     setInfo]     = useState<TokenInfo | null>(null);
  const [data,     setData]     = useState<HealthQData>(emptyData);
  const [errorMsg, setErrorMsg] = useState('');

  // ── 토큰 검증 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setErrorMsg('잘못된 URL입니다. 직원에게 다시 링크를 요청해주세요.');
      setStep('error');
      return;
    }
    (async () => {
      const { data: result, error } = await anonClient.rpc('fn_health_q_validate_token', {
        p_token: token,
      });
      if (error) {
        setErrorMsg(`오류: ${error.message}`);
        setStep('error');
        return;
      }
      const res = result as {
        success:       boolean;
        error?:        string;
        token_id?:     string;
        customer_id?:  string;
        customer_name?: string;
        clinic_id?:    string;
        check_in_id?:  string | null;
        form_type?:    string;
      };
      if (!res.success) {
        if (res.error === 'already_used') {
          setStep('already_used');
          return;
        }
        if (res.error === 'token_expired') {
          setErrorMsg('링크가 만료되었습니다. 직원에게 새 링크를 요청해주세요.');
        } else {
          setErrorMsg('유효하지 않은 링크입니다. 직원에게 다시 링크를 요청해주세요.');
        }
        setStep('error');
        return;
      }
      setInfo({
        token_id:      res.token_id!,
        customer_id:   res.customer_id!,
        customer_name: res.customer_name ?? '',
        clinic_id:     res.clinic_id!,
        check_in_id:   res.check_in_id ?? null,
        form_type:     res.form_type ?? 'general',
      });
      setStep('form');
    })();
  }, [token]);

  // ── 제출 ──────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!token || !info) return;
    setStep('submitting');

    try {
      let storagePath: string | null = null;

      // documents 버킷에 JSON 백업 (optional — 실패해도 제출 계속)
      try {
        const payload = {
          form_type:     info.form_type,
          title:         '발건강질문지',
          customer_name: info.customer_name,
          data,
          submitted_at:  new Date().toISOString(),
        };
        const ts   = Date.now();
        const path = `customer/${info.customer_id}/health_q_${ts}.json`;
        const { error: uploadErr } = await anonClient.storage
          .from('documents')
          .upload(path, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), {
            contentType: 'application/json',
            upsert: false,
          });
        if (!uploadErr) storagePath = path;
      } catch {
        // 스토리지 업로드 실패는 무시 — DB 저장이 주 경로
      }

      const { data: result, error } = await anonClient.rpc('fn_health_q_submit', {
        p_token:        token,
        p_form_data:    data as unknown as Record<string, unknown>,
        p_storage_path: storagePath,
      });

      if (error) throw new Error(error.message);
      const res = result as { success: boolean; error?: string };
      if (!res.success) {
        if (res.error === 'already_submitted') {
          setStep('already_used');
          return;
        }
        throw new Error(res.error ?? '저장 실패');
      }
      setStep('done');
    } catch (e) {
      setErrorMsg((e as Error).message);
      setStep('error');
    }
  }, [token, info, data]);

  const set = (k: keyof HealthQData, v: unknown) =>
    setData((prev) => ({ ...prev, [k]: v }));
  const d = data;

  // ── 상태별 렌더 ─────────────────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT }}>
        <div className="text-center space-y-4">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4"
            style={{ borderColor: C.border, borderTopColor: C.primary }} />
          <p className="text-lg font-medium" style={{ color: C.dark }}>불러오는 중…</p>
        </div>
      </div>
    );
  }

  if (step === 'submitting') {
    return (
      <div className="flex min-h-dvh items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT }}>
        <div className="text-center space-y-4">
          <div className="mx-auto h-16 w-16 animate-spin rounded-full border-4"
            style={{ borderColor: C.border, borderTopColor: C.primary }} />
          <p className="text-xl font-medium" style={{ color: C.dark }}>저장 중…</p>
          <p className="text-sm" style={{ color: C.mutedText }}>잠시만 기다려 주세요</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5"
        style={{ background: 'linear-gradient(135deg, #FEF2F2, white)', ...FONT }}>
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
            <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-red-600">링크 오류</h1>
          <p className="text-gray-600 text-sm">{errorMsg}</p>
          <p className="text-xs text-gray-400">오블리브 풋센터 직원에게 문의해주세요.</p>
        </div>
      </div>
    );
  }

  if (step === 'already_used') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT }}>
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: C.bannerBg, border: `3px solid ${C.gold}` }}>
            <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              style={{ color: C.primary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold" style={{ color: C.dark }}>이미 작성 완료</h1>
          <p className="text-sm" style={{ color: C.mutedText }}>
            발건강질문지가 이미 제출되었습니다.<br />새 작성이 필요하면 직원에게 새 링크를 요청해주세요.
          </p>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-5"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT }}>
        <div className="w-full max-w-sm text-center space-y-6">
          <p className="text-xs font-bold tracking-widest uppercase" style={{ color: C.gold }}>
            OBLIV FOOT CENTER
          </p>
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full animate-bounce"
            style={{ backgroundColor: C.bannerBg, border: `3px solid ${C.gold}` }}>
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              style={{ color: C.primary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: C.dark }}>작성 완료!</h1>
            <p className="mt-3 text-base" style={{ color: C.mutedText }}>
              {info?.customer_name}님, 감사합니다.
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}>
            <p className="text-sm font-medium" style={{ color: C.primary }}>
              📋 발건강질문지가 저장되었습니다
            </p>
            <p className="text-xs mt-1" style={{ color: C.mutedText }}>
              담당 직원이 내용을 확인 후 안내해드립니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 폼 단계 ──────────────────────────────────────────────────────────────────
  const isSenior = info?.form_type === 'senior';

  return (
    <div className="min-h-dvh" style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT }}>

      {/* ── 상단 헤더 (sticky) ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 shadow-sm"
        style={{ backgroundColor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(8px)' }}>
        <div className="px-4 py-3 max-w-lg mx-auto">
          <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.gold }}>
            OBLIV FOOT CENTER
          </p>
          <h1 className="text-lg font-bold leading-tight" style={{ color: C.dark }}>
            발건강 질문지{isSenior ? ' (어르신용)' : ''}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: C.mutedText }}>
            {info?.customer_name}님 — 솔직한 답변이 정확한 진료에 도움이 됩니다
          </p>
        </div>
      </header>

      {/* ── 폼 본문 ──────────────────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-5 space-y-5 pb-36">

        {/* ① 방문 목적 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={1} title="방문 목적" sub="해당 항목 모두 선택해주세요" />
          <div className="flex flex-wrap gap-2">
            {VISIT_PURPOSE_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.visit_purpose.includes(opt)}
                onClick={() => set('visit_purpose', toggle(d.visit_purpose, opt))}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.visit_purpose.includes('기타') && (
            <input type="text" value={d.visit_purpose_other}
              onChange={(e) => set('visit_purpose_other', e.target.value)}
              placeholder="기타 목적 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
        </section>

        {/* ② 발 관련 증상 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={2} title="발 관련 증상" sub="해당 항목 모두 선택해주세요" />
          <div className="flex flex-wrap gap-2">
            {SYMPTOM_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.symptoms.includes(opt)}
                onClick={() => set('symptoms', toggle(d.symptoms, opt))}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.symptoms.includes('기타') && (
            <input type="text" value={d.symptoms_other}
              onChange={(e) => set('symptoms_other', e.target.value)}
              placeholder="기타 증상 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
        </section>

        {/* ③ 발톱 통증 부위·기간·정도 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={3} title="발톱 통증 부위·기간·정도" />

          {/* 부위: 5열 그리드 × 2행 (좌/우) */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: C.mutedText }}>통증 발톱 (해당 항목 선택)</p>
            {NAIL_ROWS.map((row, ri) => (
              <div key={ri} className="grid grid-cols-5 gap-1.5">
                {row.map((nail) => (
                  <button key={nail} type="button"
                    onClick={() => set('nail_locations', toggle(d.nail_locations, nail))}
                    className={cn(
                      'min-h-[44px] rounded-xl border-2 py-1 text-xs font-medium transition active:scale-95',
                      d.nail_locations.includes(nail)
                        ? 'border-teal-600 bg-teal-50 text-teal-700'
                        : 'border-gray-200 bg-white text-gray-600',
                    )}
                  >
                    {nail}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* 기간 */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: C.mutedText }}>유병 기간</p>
            <div className="flex flex-wrap gap-2">
              {PAIN_DURATION_OPTIONS.map((opt) => (
                <BigBtn key={opt}
                  active={d.pain_duration === opt}
                  onClick={() => set('pain_duration', d.pain_duration === opt ? '' : opt)}
                  color="teal"
                >
                  {opt}
                </BigBtn>
              ))}
            </div>
          </div>

          {/* 정도 */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: C.mutedText }}>통증 정도</p>
            <div className="grid grid-cols-4 gap-2">
              {PAIN_SEVERITY_OPTIONS.map((opt) => (
                <button key={opt.value} type="button"
                  onClick={() => set('pain_severity', d.pain_severity === opt.value ? '' : opt.value)}
                  className={cn(
                    'min-h-[56px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition active:scale-95',
                    d.pain_severity === opt.value
                      ? 'border-teal-600 bg-teal-50'
                      : 'border-gray-200 bg-white',
                  )}
                >
                  <span className="text-xl">{opt.emoji}</span>
                  <span className={cn('text-xs font-medium',
                    d.pain_severity === opt.value ? 'text-teal-700' : 'text-gray-600'
                  )}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ④ 과거 병력 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={4} title="과거 병력 · 만성질환"
            sub="해당 항목 모두 선택해주세요" />
          <div className="flex flex-wrap gap-2">
            {MEDICAL_HISTORY_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.medical_history.includes(opt)}
                onClick={() => set('medical_history', toggle(d.medical_history, opt))}
                color="amber"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.medical_history.includes('기타') && (
            <input type="text" value={d.medical_history_other}
              onChange={(e) => set('medical_history_other', e.target.value)}
              placeholder="기타 병력 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
          {/* 기왕증 */}
          <div className="pt-2 border-t space-y-2" style={{ borderColor: C.border }}>
            <p className="text-xs font-medium" style={{ color: C.mutedText }}>기왕증 / 이전 치료 경험 (자유 서술)</p>
            <textarea value={d.prior_conditions}
              onChange={(e) => set('prior_conditions', e.target.value)}
              placeholder="이전 발 관련 치료나 수술이 있으면 적어주세요 (없으면 생략)"
              rows={2}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
              style={{ borderColor: C.border, color: C.dark }} />
          </div>
          {/* 가족력 */}
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: C.mutedText }}>가족력</p>
            <textarea value={d.family_history}
              onChange={(e) => set('family_history', e.target.value)}
              placeholder="가족 중 당뇨, 혈관질환, 발 관련 질환이 있으면 적어주세요 (없으면 생략)"
              rows={2}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
              style={{ borderColor: C.border, color: C.dark }} />
          </div>
        </section>

        {/* ⑤ 이전 발 시술 경험 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={5} title="이전 발 시술 경험"
            sub="받아보셨던 시술이 있으면 선택해주세요" />
          <div className="flex flex-wrap gap-2">
            {PRIOR_TREATMENT_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.prior_treatment.includes(opt)}
                onClick={() => set('prior_treatment', toggle(d.prior_treatment, opt))}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
        </section>

        {/* ⑥ 현재 복용 약물 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={6} title="현재 복용 약물" />
          <div className="flex flex-wrap gap-2">
            <BigBtn
              active={d.medications_none}
              onClick={() => set('medications_none', !d.medications_none)}
              color="emerald"
            >
              없음
            </BigBtn>
            {MEDICATION_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.medications.includes(opt) && !d.medications_none}
                onClick={() => {
                  set('medications_none', false);
                  set('medications', toggle(d.medications, opt));
                }}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.medications.includes('기타') && !d.medications_none && (
            <input type="text" value={d.medications_other}
              onChange={(e) => set('medications_other', e.target.value)}
              placeholder="약물명 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
        </section>

        {/* ⑦ 알레르기 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={7} title="알레르기" />
          <div className="grid grid-cols-2 gap-2">
            <BigBtn active={!d.has_allergy} onClick={() => set('has_allergy', false)} color="emerald" full>
              없음
            </BigBtn>
            <BigBtn active={d.has_allergy} onClick={() => set('has_allergy', true)} danger full>
              있음
            </BigBtn>
          </div>
          {d.has_allergy && (
            <>
              <div className="flex flex-wrap gap-2">
                {ALLERGY_OPTIONS.map((opt) => (
                  <BigBtn key={opt}
                    active={d.allergy_types.includes(opt)}
                    onClick={() => set('allergy_types', toggle(d.allergy_types, opt))}
                    danger
                  >
                    {opt}
                  </BigBtn>
                ))}
              </div>
              <textarea value={d.allergy_other}
                onChange={(e) => set('allergy_other', e.target.value)}
                placeholder="알레르기 내역 상세 (선택)"
                rows={2}
                className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
                style={{ borderColor: '#FCA5A5', color: C.dark }} />
            </>
          )}
        </section>

        {/* ⑧ 방문 경로 */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={8} title="방문 경로 (선택)" />
          <div className="flex flex-wrap gap-2">
            {REFERRAL_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.referral_source === opt}
                onClick={() => set('referral_source', d.referral_source === opt ? '' : opt)}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
        </section>

        <p className="text-center text-xs pb-4" style={{ color: C.mutedText }}>
          모든 정보는 진료 목적으로만 사용됩니다
        </p>
      </main>

      {/* ── sticky 제출 버튼 ─────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-safe"
        style={{ background: 'linear-gradient(to top, rgba(255,255,255,1) 70%, transparent)' }}>
        <div className="max-w-lg mx-auto pt-3 pb-4">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full min-h-[56px] rounded-2xl text-xl font-bold text-white transition active:scale-[0.99] shadow-lg"
            style={{ backgroundColor: C.primary }}
          >
            ✓ 작성 완료 — 제출하기
          </button>
          <p className="text-center text-xs mt-2" style={{ color: C.mutedText }}>
            제출 후 수정이 불가합니다. 작성 내용을 확인 후 제출해주세요.
          </p>
        </div>
      </div>
    </div>
  );
}

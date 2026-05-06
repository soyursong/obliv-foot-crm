/**
 * TabletChecklistPage — 태블릿 사전 체크리스트 (anon 접근)
 *
 * T-20260430-foot-PRESCREEN-CHECKLIST
 *
 * 라우트: /checklist/:checkInId
 * 흐름: fn_prescreen_start → 폼 작성 → 서명 → 저장 → fn_complete_prescreen_checklist
 * 상태 전이: registered → checklist → exam_waiting (Realtime 자동 칸반 반영)
 *
 * 저장물:
 *   - documents/customer/{id}/checklist_{ts}.json
 *   - documents/customer/{id}/signature_checklist_{ts}.png
 *
 * 의료 판단이 필요한 항목은 문지은 원장님 최종 확인 대기 (blocked_by 조건)
 * 현재: 티켓 명세 5종 + ChecklistForm 기본 항목 사용
 *
 * 2026-05-06 dev-foot
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { SignaturePad, type SignaturePadHandle } from '@/components/forms/SignaturePad';
import { cn } from '@/lib/utils';

// ── anon Supabase 클라이언트 (태블릿 페이지 전용) ──────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── 컬러 토큰 (teal-emerald 풋센터 테마) ───────────────────────────────────────
const C = {
  bgFrom: '#F0FDF9',
  bgTo: '#ECFDF5',
  dark: '#134E4A',
  primary: '#0F766E',
  medium: '#0D9488',
  muted: '#5EEAD4',
  mutedText: '#6B7280',
  border: '#99F6E4',
  borderActive: '#0D9488',
  light: '#F0FDFA',
  cream: '#FFFFFF',
  gold: '#10B981',
  bannerBg: '#ECFDF5',
  bannerBorder: '#6EE7B7',
  error: '#DC2626',
} as const;

const FONT_STYLE: React.CSSProperties = {
  fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
};

// ── 설문 항목 정의 ──────────────────────────────────────────────────────────────
// 의료 판단 필요 항목 — 문지은 원장님 확인 대기 (T-20260430-foot-PRESCREEN-CHECKLIST)
// 현재: 티켓 명세 5종 + ChecklistForm 기본 구조
const SYMPTOM_OPTIONS = [
  '굳은살/티눈',
  '무좀/진균',
  '내성발톱',
  '발냄새',
  '발건조/각질',
  '당뇨발/혈액순환',
  '기타',
];

const NAIL_LOCATIONS = [
  '엄지(좌)', '검지(좌)', '중지(좌)', '약지(좌)', '소지(좌)',
  '엄지(우)', '검지(우)', '중지(우)', '약지(우)', '소지(우)',
];

const PAIN_DURATION_OPTIONS = [
  '1개월 미만',
  '1~3개월',
  '3~6개월',
  '6개월~1년',
  '1년 이상',
];

const PAIN_SEVERITY_OPTIONS = [
  { value: '1', label: '경미' },
  { value: '2', label: '불편' },
  { value: '3', label: '심함' },
  { value: '4', label: '매우 심함' },
];

// F10: 병력 (당뇨/혈관질환/면역질환)
const MEDICAL_HISTORY_OPTIONS = ['당뇨', '고혈압', '심장질환', '혈관질환', '면역질환', '기타'];

// F10: 약 복용 (항응고제/항생제 등)
const MEDICATION_OPTIONS = ['항응고제', '항생제', '스테로이드', '혈압약', '당뇨약', '기타'];

// F10: 알러지
const ALLERGY_OPTIONS = ['마취제', '약물', '소독제', '금속', '기타'];

const REFERRAL_OPTIONS = ['네이버 검색', '지인 소개', 'SNS/인스타', '블로그', 'TV/언론', '기타'];

const PRIVACY_TEXT = [
  '1. 수집 항목: 성명, 생년월일, 연락처, 발 건강 정보, 시술 사진',
  '2. 수집 목적: 시술·상담 진행, 예약 관리, 사후 관리',
  '3. 보유 기간: 의료법에 따른 진료기록 보존 기간 (최소 5년)',
  '4. 동의를 거부할 권리가 있으나, 거부 시 시술이 제한될 수 있습니다.',
];

const MARKETING_TEXT = [
  '1. 수집 항목: 성명, 연락처',
  '2. 수집 목적: 마케팅 정보 발송 (이벤트·신규 시술 안내)',
  '3. 보유 기간: 동의 철회 시까지',
  '4. 본 동의는 선택이며 거부해도 시술 이용에 제한이 없습니다.',
];

// ── 데이터 타입 ─────────────────────────────────────────────────────────────────
interface ChecklistData {
  // 증상 / 발톱 통증 (F10: 발톱 통증 부위/기간/정도)
  symptoms: string[];
  symptoms_other: string;
  nail_locations: string[];       // 통증 부위
  pain_duration: string;          // 기간
  pain_severity: string;          // 정도
  // F10: 병력 (당뇨/혈관질환/면역질환)
  medical_history: string[];
  medical_history_other: string;
  // F10: 약 복용 (항응고제/항생제 등)
  medications: string[];
  medications_other: string;
  medications_none: boolean;
  // F10: 알러지 (마취/약/소독제)
  has_allergy: boolean;
  allergy_types: string[];
  allergy_other: string;
  // F10: 기왕증 / 가족력
  prior_conditions: string;       // 이전 치료 경험 + 기왕증
  family_history: string;         // 가족력
  // 개인정보 동의
  agree_privacy: boolean;
  agree_marketing: boolean;
  // 유입 경로
  referral_source: string;
}

const initialData = (): ChecklistData => ({
  symptoms: [],
  symptoms_other: '',
  nail_locations: [],
  pain_duration: '',
  pain_severity: '',
  medical_history: [],
  medical_history_other: '',
  medications: [],
  medications_other: '',
  medications_none: false,
  has_allergy: false,
  allergy_types: [],
  allergy_other: '',
  prior_conditions: '',
  family_history: '',
  agree_privacy: false,
  agree_marketing: false,
  referral_source: '',
});

// ── 헬퍼 ───────────────────────────────────────────────────────────────────────
type Step = 'loading' | 'error' | 'form' | 'signature' | 'submitting' | 'done' | 'already_done';

interface PrescreenInfo {
  customer_name: string;
  customer_phone: string;
  customer_id: string | null;
  clinic_id: string;
  visit_type: string;
  status: string;
}

// 토글 헬퍼
function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

// ── 대형 버튼 ─────────────────────────────────────────────────────────────────
function BigBtn({
  active,
  onClick,
  children,
  color = 'teal',
  danger,
  className,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: 'teal' | 'amber' | 'rose' | 'emerald';
  danger?: boolean;
  className?: string;
}) {
  const colors = {
    teal: {
      on: 'border-teal-600 bg-teal-50 text-teal-700',
      off: 'border-gray-200 bg-white text-gray-700 hover:bg-teal-50/50',
    },
    amber: {
      on: 'border-amber-500 bg-amber-50 text-amber-700',
      off: 'border-gray-200 bg-white text-gray-700 hover:bg-amber-50/50',
    },
    rose: {
      on: 'border-rose-500 bg-rose-50 text-rose-700',
      off: 'border-gray-200 bg-white text-gray-700 hover:bg-rose-50/50',
    },
    emerald: {
      on: 'border-emerald-600 bg-emerald-50 text-emerald-700',
      off: 'border-gray-200 bg-white text-gray-700 hover:bg-emerald-50/50',
    },
  };
  const scheme = danger
    ? { on: 'border-red-500 bg-red-50 text-red-700', off: 'border-gray-200 bg-white text-gray-700' }
    : colors[color];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-14 rounded-xl border-2 px-5 py-3 text-base font-medium transition active:scale-[0.98]',
        active ? scheme.on : scheme.off,
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── 섹션 헤더 ─────────────────────────────────────────────────────────────────
function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <div className="flex items-center gap-3 pb-1 border-b border-teal-100">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white shrink-0"
        style={{ backgroundColor: C.primary }}
      >
        {num}
      </span>
      <h2 className="text-lg font-semibold" style={{ color: C.dark }}>{title}</h2>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
export default function TabletChecklistPage() {
  const { checkInId } = useParams<{ checkInId: string }>();

  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<PrescreenInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState<ChecklistData>(initialData);
  const [sigEmpty, setSigEmpty] = useState(true);
  const sigRef = useRef<SignaturePadHandle>(null);

  // ── 마운트 시 fn_prescreen_start 호출 ──────────────────────────────────────
  useEffect(() => {
    if (!checkInId) {
      setErrorMsg('잘못된 URL입니다. 접수증의 QR코드를 다시 스캔해주세요.');
      setStep('error');
      return;
    }
    (async () => {
      const { data: result, error } = await anonClient.rpc('fn_prescreen_start', {
        p_check_in_id: checkInId,
      });
      if (error) {
        setErrorMsg(`접수 정보 확인 실패: ${error.message}`);
        setStep('error');
        return;
      }
      const res = result as {
        success: boolean;
        error?: string;
        customer_name?: string;
        customer_phone?: string;
        customer_id?: string;
        clinic_id?: string;
        visit_type?: string;
        status?: string;
      };
      if (!res.success) {
        if (res.error === 'check_in_not_found') {
          setErrorMsg('접수 정보를 찾을 수 없습니다. 먼저 접수(셀프체크인)를 완료해주세요.');
        } else {
          setErrorMsg(`오류: ${res.error ?? '알 수 없는 오류'}`);
        }
        setStep('error');
        return;
      }
      // 이미 체크리스트 완료된 경우
      if (
        res.status &&
        !['registered', 'checklist'].includes(res.status)
      ) {
        setInfo({
          customer_name: res.customer_name ?? '',
          customer_phone: res.customer_phone ?? '',
          customer_id: res.customer_id ?? null,
          clinic_id: res.clinic_id ?? '',
          visit_type: res.visit_type ?? '',
          status: res.status,
        });
        setStep('already_done');
        return;
      }
      setInfo({
        customer_name: res.customer_name ?? '',
        customer_phone: res.customer_phone ?? '',
        customer_id: res.customer_id ?? null,
        clinic_id: res.clinic_id ?? '',
        visit_type: res.visit_type ?? '',
        status: res.status ?? '',
      });
      setStep('form');
    })();
  }, [checkInId]);

  // ── Storage 업로드 (anon) ──────────────────────────────────────────────────
  const uploadAnon = useCallback(
    async (
      customerId: string,
      prefix: string,
      body: Blob | string,
      ext: string,
      contentType: string,
    ): Promise<string | null> => {
      const ts = Date.now();
      const path = `customer/${customerId}/${prefix}_${ts}.${ext}`;
      let blob: Blob;
      if (typeof body === 'string') {
        if (body.startsWith('data:')) {
          const res = await fetch(body);
          blob = await res.blob();
        } else {
          blob = new Blob([body], { type: contentType });
        }
      } else {
        blob = body;
      }
      const { error } = await anonClient.storage
        .from('documents')
        .upload(path, blob, { contentType, upsert: false });
      if (error) return null;
      return path;
    },
    [],
  );

  // ── 제출 ───────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!checkInId || !info) return;
    if (!data.agree_privacy) {
      alert('개인정보 수집·이용에 동의해주세요 (필수)');
      return;
    }
    if (sigRef.current?.isEmpty()) {
      alert('서명을 해주세요');
      return;
    }

    setStep('submitting');

    try {
      let storagePath: string | null = null;
      const customerId = info.customer_id;

      if (customerId) {
        // 1) 서명 PNG 업로드
        const sigDataUrl = sigRef.current!.toDataURL('image/png');
        const sigPath = await uploadAnon(
          customerId,
          'signature_checklist',
          sigDataUrl,
          'png',
          'image/png',
        );

        // 2) 체크리스트 JSON 업로드 (서명 경로 포함)
        const payload = {
          form_type: 'checklist',
          title: '첫방문 발건강 질문지 + 개인정보 동의서',
          check_in_id: checkInId,
          customer_name: info.customer_name,
          data,
          signature_path: sigPath,
          saved_at: new Date().toISOString(),
        };
        const jsonPath = await uploadAnon(
          customerId,
          'checklist',
          JSON.stringify(payload, null, 2),
          'json',
          'application/json',
        );
        storagePath = jsonPath;
      }

      // 3) fn_complete_prescreen_checklist 호출 → checklists INSERT + status→exam_waiting
      const { data: result, error } = await anonClient.rpc(
        'fn_complete_prescreen_checklist',
        {
          p_check_in_id: checkInId,
          p_checklist_data: data as unknown as Record<string, unknown>,
          p_storage_path: storagePath,
        },
      );

      if (error) throw new Error(error.message);
      const res = result as { success: boolean; error?: string };
      if (!res.success) {
        if (res.error === 'already_completed') {
          setStep('already_done');
          return;
        }
        throw new Error(res.error ?? '저장 실패');
      }

      setStep('done');
    } catch (e) {
      setErrorMsg((e as Error).message);
      setStep('error');
    }
  }, [checkInId, info, data, uploadAnon]);

  const d = data;
  const set = (k: keyof ChecklistData, v: unknown) =>
    setData((prev) => ({ ...prev, [k]: v }));

  // ── 로딩 ────────────────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <div className="text-center space-y-4">
          <div
            className="mx-auto h-12 w-12 animate-spin rounded-full border-4"
            style={{ borderColor: C.border, borderTopColor: C.primary }}
          />
          <p className="text-lg font-medium" style={{ color: C.dark }}>불러오는 중…</p>
        </div>
      </div>
    );
  }

  // ── 오류 ─────────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(135deg, #FEF2F2, white)`, ...FONT_STYLE }}
      >
        <div className="w-full max-w-md text-center space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
            <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-red-600">오류가 발생했습니다</h1>
            <p className="mt-2 text-gray-600">{errorMsg}</p>
          </div>
          <p className="text-sm text-gray-400">코디네이터에게 문의해주세요.</p>
        </div>
      </div>
    );
  }

  // ── 이미 완료 ────────────────────────────────────────────────────────────────
  if (step === 'already_done') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <div className="w-full max-w-md text-center space-y-6">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full" style={{ backgroundColor: C.bannerBg, border: `3px solid ${C.gold}` }}>
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: C.primary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: C.dark }}>이미 작성 완료되었습니다</h1>
            <p className="mt-2" style={{ color: C.mutedText }}>
              {info?.customer_name}님의 사전 체크리스트가 이미 제출되었습니다.
            </p>
          </div>
          <p className="text-sm" style={{ color: C.mutedText }}>잠시만 기다려 주세요. 코디네이터가 안내해드립니다.</p>
        </div>
      </div>
    );
  }

  // ── 완료 ─────────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-6"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <div className="w-full max-w-md text-center space-y-8">
          <p className="text-sm font-medium tracking-widest uppercase" style={{ color: C.gold }}>
            OBLIV FOOT CENTER
          </p>
          <div
            className="mx-auto flex h-28 w-28 items-center justify-center rounded-full animate-bounce"
            style={{ backgroundColor: C.bannerBg, border: `3px solid ${C.gold}` }}
          >
            <svg className="h-14 w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ color: C.primary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold" style={{ color: C.dark }}>작성 완료!</h1>
            <p className="mt-4 text-xl" style={{ color: C.mutedText }}>
              {info?.customer_name}님, 감사합니다.
            </p>
            <p className="mt-2" style={{ color: C.mutedText }}>
              잠시만 기다려 주시면 코디네이터가 안내해드립니다.
            </p>
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}
          >
            <p className="text-sm font-medium" style={{ color: C.primary }}>
              📋 사전 체크리스트가 자동으로 저장되었습니다
            </p>
            <p className="text-xs mt-1" style={{ color: C.mutedText }}>
              초진 대기 순서로 자동 이동됩니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 제출 중 ───────────────────────────────────────────────────────────────────
  if (step === 'submitting') {
    return (
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        <div className="text-center space-y-4">
          <div
            className="mx-auto h-16 w-16 animate-spin rounded-full border-4"
            style={{ borderColor: C.border, borderTopColor: C.primary }}
          />
          <p className="text-xl font-medium" style={{ color: C.dark }}>저장 중…</p>
          <p className="text-sm" style={{ color: C.mutedText }}>잠시만 기다려 주세요</p>
        </div>
      </div>
    );
  }

  // ── 서명 단계 ─────────────────────────────────────────────────────────────────
  if (step === 'signature') {
    return (
      <div
        className="min-h-dvh"
        style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
      >
        {/* 상단 헤더 */}
        <header className="sticky top-0 z-10 px-6 py-4 shadow-sm" style={{ backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              type="button"
              onClick={() => setStep('form')}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition active:scale-95"
              style={{ border: `1.5px solid ${C.border}`, color: C.primary, backgroundColor: C.light }}
            >
              ← 이전
            </button>
            <div className="text-center">
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: C.gold }}>OBLIV FOOT CENTER</p>
              <p className="text-sm font-bold" style={{ color: C.dark }}>서명 확인</p>
            </div>
            <div className="w-20" />
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
          {/* 개인정보 동의 */}
          <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
            <SectionHeader num={1} title="개인정보 수집·이용 동의 (필수)" />
            <div className="space-y-1 text-sm leading-relaxed" style={{ color: C.mutedText }}>
              {PRIVACY_TEXT.map((line, i) => <p key={i}>{line}</p>)}
            </div>
            <label className="flex items-center gap-3 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={d.agree_privacy}
                onChange={(e) => set('agree_privacy', e.target.checked)}
                className="h-6 w-6 rounded border-gray-300 accent-teal-600"
              />
              <span className="text-base font-medium" style={{ color: C.dark }}>
                위 내용을 확인하였으며 개인정보 수집·이용에 동의합니다.
              </span>
            </label>
          </section>

          {/* 마케팅 동의 */}
          <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid #E5E7EB` }}>
            <h3 className="text-base font-semibold" style={{ color: C.mutedText }}>마케팅 정보 수신 동의 (선택)</h3>
            <div className="space-y-1 text-sm leading-relaxed" style={{ color: C.mutedText }}>
              {MARKETING_TEXT.map((line, i) => <p key={i}>{line}</p>)}
            </div>
            <label className="flex items-center gap-3 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={d.agree_marketing}
                onChange={(e) => set('agree_marketing', e.target.checked)}
                className="h-6 w-6 rounded border-gray-300 accent-teal-600"
              />
              <span className="text-base" style={{ color: C.dark }}>마케팅 정보 수신에 동의합니다.</span>
            </label>
          </section>

          {/* 서명 */}
          <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <SectionHeader num={2} title="서명 *" />
              <button
                type="button"
                onClick={() => { sigRef.current?.clear(); setSigEmpty(true); }}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition active:scale-95"
                style={{ border: `1.5px solid ${C.border}`, color: C.mutedText, backgroundColor: C.light }}
              >
                ↺ 다시 쓰기
              </button>
            </div>
            <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: sigEmpty ? '#E5E7EB' : C.borderActive }}>
              <SignaturePad
                ref={sigRef}
                width={560}
                height={200}
                className="w-full"
                onChange={(empty) => setSigEmpty(empty)}
              />
            </div>
            <p className="text-center text-sm" style={{ color: C.mutedText }}>
              위 박스 안에 서명해 주세요
            </p>
          </section>

          {/* 제출 버튼 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!d.agree_privacy || sigEmpty}
            className="w-full rounded-2xl py-5 text-xl font-bold text-white transition active:scale-[0.99] disabled:opacity-40"
            style={{ backgroundColor: (!d.agree_privacy || sigEmpty) ? C.mutedText : C.primary }}
          >
            {!d.agree_privacy ? '개인정보 동의 필요' : sigEmpty ? '서명이 필요합니다' : '✓ 작성 완료'}
          </button>
        </main>
      </div>
    );
  }

  // ── 폼 단계 ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-dvh"
      style={{ background: `linear-gradient(135deg, ${C.bgFrom}, ${C.bgTo})`, ...FONT_STYLE }}
    >
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-10 shadow-sm" style={{ backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-2xl mx-auto px-6 py-4">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: C.gold }}>OBLIV FOOT CENTER</p>
            <h1 className="text-xl font-bold" style={{ color: C.dark }}>사전 체크리스트</h1>
            <p className="text-sm mt-1" style={{ color: C.mutedText }}>
              {info?.customer_name}님 — 솔직한 답변이 정확한 진료에 도움이 됩니다
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-10">

        {/* ① 발 관련 증상 */}
        <section className="space-y-5 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={1} title="발 관련 증상 (해당 항목 모두 선택)" />
          <div className="flex flex-wrap gap-3">
            {SYMPTOM_OPTIONS.map((opt) => (
              <BigBtn
                key={opt}
                active={d.symptoms.includes(opt)}
                onClick={() => set('symptoms', toggle(d.symptoms, opt))}
                color="teal"
                className="flex-shrink-0"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.symptoms.includes('기타') && (
            <input
              type="text"
              value={d.symptoms_other}
              onChange={(e) => set('symptoms_other', e.target.value)}
              placeholder="기타 증상 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-2"
              style={{ borderColor: C.border, color: C.dark }}
            />
          )}
        </section>

        {/* ② 발톱 통증 부위 / 기간 / 정도 (F10) */}
        <section className="space-y-5 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={2} title="발톱 통증 부위·기간·정도" />

          {/* 부위 */}
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: C.mutedText }}>통증 부위 (해당 발톱 선택)</p>
            <div className="grid grid-cols-5 gap-2">
              {NAIL_LOCATIONS.map((nail) => (
                <button
                  key={nail}
                  type="button"
                  onClick={() => set('nail_locations', toggle(d.nail_locations, nail))}
                  className={cn(
                    'min-h-12 rounded-xl border-2 py-2 text-sm font-medium transition active:scale-95',
                    d.nail_locations.includes(nail)
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-gray-200 bg-white text-gray-600',
                  )}
                >
                  {nail}
                </button>
              ))}
            </div>
          </div>

          {/* 기간 */}
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: C.mutedText }}>유병 기간</p>
            <div className="flex flex-wrap gap-2">
              {PAIN_DURATION_OPTIONS.map((opt) => (
                <BigBtn
                  key={opt}
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
            <p className="text-sm font-medium" style={{ color: C.mutedText }}>통증 정도</p>
            <div className="flex gap-3">
              {PAIN_SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('pain_severity', d.pain_severity === opt.value ? '' : opt.value)}
                  className={cn(
                    'flex-1 min-h-14 rounded-xl border-2 py-3 text-sm font-semibold transition active:scale-95',
                    d.pain_severity === opt.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-gray-200 bg-white text-gray-600',
                  )}
                >
                  <span className="text-lg">{'⬛'.repeat(Number(opt.value))}</span>
                  <span className="block text-xs mt-0.5">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ③ 병력 (F10: 당뇨/혈관질환/면역질환) */}
        <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={3} title="과거병력 · 만성질환" />
          <p className="text-sm" style={{ color: C.mutedText }}>해당되는 항목을 모두 선택해 주세요</p>
          <div className="flex flex-wrap gap-3">
            {MEDICAL_HISTORY_OPTIONS.map((opt) => (
              <BigBtn
                key={opt}
                active={d.medical_history.includes(opt)}
                onClick={() => set('medical_history', toggle(d.medical_history, opt))}
                color="amber"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
          {d.medical_history.includes('기타') && (
            <input
              type="text"
              value={d.medical_history_other}
              onChange={(e) => set('medical_history_other', e.target.value)}
              placeholder="기타 병력 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border }}
            />
          )}
          {/* 기왕증 */}
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium" style={{ color: C.mutedText }}>기왕증 / 이전 치료 경험</p>
            <textarea
              value={d.prior_conditions}
              onChange={(e) => set('prior_conditions', e.target.value)}
              placeholder="이전 발 관련 치료나 수술 경험이 있으면 적어주세요 (없으면 생략)"
              rows={3}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
              style={{ borderColor: C.border, color: C.dark }}
            />
          </div>
          {/* 가족력 */}
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: C.mutedText }}>가족력</p>
            <textarea
              value={d.family_history}
              onChange={(e) => set('family_history', e.target.value)}
              placeholder="가족 중 당뇨, 혈관질환, 발 관련 질환이 있으면 적어주세요 (없으면 생략)"
              rows={2}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
              style={{ borderColor: C.border, color: C.dark }}
            />
          </div>
        </section>

        {/* ④ 약 복용 (F10: 항응고제/항생제 등) */}
        <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={4} title="현재 복용 약물" />
          <div className="flex flex-wrap gap-3">
            <BigBtn
              active={d.medications_none}
              onClick={() => set('medications_none', !d.medications_none)}
              color="emerald"
            >
              없음
            </BigBtn>
            {MEDICATION_OPTIONS.map((opt) => (
              <BigBtn
                key={opt}
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
            <input
              type="text"
              value={d.medications_other}
              onChange={(e) => set('medications_other', e.target.value)}
              placeholder="약물명 직접 입력"
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border }}
            />
          )}
        </section>

        {/* ⑤ 알러지 (F10: 마취/약/소독제) */}
        <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={5} title="알레르기" />
          <div className="flex gap-3">
            <BigBtn
              active={!d.has_allergy}
              onClick={() => set('has_allergy', false)}
              color="emerald"
              className="flex-1"
            >
              없음
            </BigBtn>
            <BigBtn
              active={d.has_allergy}
              onClick={() => set('has_allergy', true)}
              danger
              className="flex-1"
            >
              있음
            </BigBtn>
          </div>
          {d.has_allergy && (
            <>
              <div className="flex flex-wrap gap-3 pt-1">
                {ALLERGY_OPTIONS.map((opt) => (
                  <BigBtn
                    key={opt}
                    active={d.allergy_types.includes(opt)}
                    onClick={() => set('allergy_types', toggle(d.allergy_types, opt))}
                    danger
                  >
                    {opt}
                  </BigBtn>
                ))}
              </div>
              <textarea
                value={d.allergy_other}
                onChange={(e) => set('allergy_other', e.target.value)}
                placeholder="알레르기 내역 상세 (선택)"
                rows={2}
                className="w-full rounded-xl border px-4 py-3 text-base outline-none resize-none"
                style={{ borderColor: '#FCA5A5', color: C.dark }}
              />
            </>
          )}
        </section>

        {/* 방문 경로 */}
        <section className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={6} title="방문 경로 (선택)" />
          <div className="flex flex-wrap gap-3">
            {REFERRAL_OPTIONS.map((opt) => (
              <BigBtn
                key={opt}
                active={d.referral_source === opt}
                onClick={() => set('referral_source', d.referral_source === opt ? '' : opt)}
                color="teal"
              >
                {opt}
              </BigBtn>
            ))}
          </div>
        </section>

        {/* 다음 단계 버튼 */}
        <button
          type="button"
          onClick={() => setStep('signature')}
          className="w-full rounded-2xl py-5 text-xl font-bold text-white transition active:scale-[0.99]"
          style={{ backgroundColor: C.primary }}
        >
          다음 → 동의서 & 서명
        </button>

        <p className="text-center text-sm pb-8" style={{ color: C.mutedText }}>
          모든 정보는 진료 목적으로만 사용됩니다
        </p>
      </main>
    </div>
  );
}

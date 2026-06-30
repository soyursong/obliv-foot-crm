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

// ── 컬러 토큰 (브라운/베이지 — SelfCheckIn 톤앤매너 통일) ────────────────────────
// T-20260601-foot-HEALTHQ-SELF-RESTRUCTURE: teal-emerald → 셀프체크인 브라운/베이지 팔레트로 통일
const C = {
  bgFrom:       '#F5EFE7',
  bgTo:         '#FAF7F2',
  dark:         '#3D2B1A',
  primary:      '#5C3D1E',
  medium:       '#7B5130',
  muted:        '#8B7355',
  mutedText:    '#8B7355',
  border:       '#D4C5B2',
  borderActive: '#7B5130',
  light:        '#F5EFE7',
  cream:        '#FDF8F2',
  gold:         '#C9A97A',
  bannerBg:     '#FDF5E4',
  bannerBorder: '#C9A97A',
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
// 발건강질문지 5섹션 최종 확정본 (MSG-175815-mlsv)

// ── 1번 발 관련 증상 (다중) — 현장 확정 순서·텍스트 그대로 ──────────────────────
const SYMPTOM_OPTIONS = [
  '발톱 변색 및 변형',
  '내성발톱(파고드는 발톱)',
  '발가락 통증',
  '발냄새',
  '발건조 및 각질',
  '발 땀 많음',
  '가려움증',
  '발톱 끝 부서짐',
  '울퉁불퉁한 발톱',
  '기타',
];

// ── 2번 발 건강 관련 경험 (4문) — 현장 확정 ────────────────────────────────────
// Q1 문제성 발톱 치료: 없음 / 있음 → 치료방법
const NAIL_TREATMENT_HISTORY_OPTIONS = ['없음', '있음'];
// 치료방법 (OQ3 — 선택방식 현장확정 전 다중선택 가정)
const NAIL_TREATMENT_METHOD_OPTIONS = ['먹는 약', '바르는 약', '레이저'];
// Q2 증상 시작 시점
const SYMPTOM_ONSET_OPTIONS = ['6개월 이내', '1~3년', '3~5년', '10년 이상'];
// Q3 가족력
const FAMILY_HISTORY_TYPE_OPTIONS = ['발톱무좀', '내성발톱', '둘 다', '모름 / 없음'];
// Q4 발 통증 여부
// T-20260602-foot-HEALTHQ-PAIN-NONE-LAYOUT: '없음'(통증 0단계)을 통증 4단계와
// 동일 박스로 한 그리드에 나란히 — 첫 칸 배치. 저장값은 기존과 동일한 string '없음'.
const FOOT_PAIN_LEVEL_OPTIONS = [
  { value: '없음',     emoji: '🙂' },
  { value: '경미',     emoji: '😐' },
  { value: '불편',     emoji: '😮‍💨' },
  { value: '심함',     emoji: '😣' },
  { value: '매우 심함', emoji: '😰' },
];

// ── 3번 나의 건강 상태 (다중) — OQ1 해소 최종 11항(없음 토글 별도) ──────────────
// T-20260602-foot-HEALTHQ-CONTENT-ADD: '임신중 또는 임신준비중' 선택지 추가
// T-20260623-foot-OPINIONDOC-AUTOLINK-HEALTHQ (AC-2): '간염보균자' 항목 추가(간질환 옆 그룹핑).
//   §확인-2 단일 라벨 채택 — B형/C형 세분은 CONTRAIND-COMBINE(substituteHepatitisType)에서 치환.
//   ⚠ 이 라벨('간염보균자')은 소견서 자동연동 매핑(OpinionDocTab HEALTHQ_AUTOCHECK_MAP.hbv_carrier)의
//      정확 일치 키 — 변경 시 양쪽 동기화 필수.
const MEDICAL_HISTORY_OPTIONS = [
  '당뇨', '고혈압', '간질환', '간염보균자', '고지혈증', '심장질환', '자가면역질환',
  '갑상선질환', '우울증·공황장애', '위장장애·역류성식도염', '임신중 또는 임신준비중', '기타',
];

// ── 4번 현재 복용 중인 약 (다중) — 현장 확정(없음 토글 별도) ──────────────────────
const MEDICATION_OPTIONS = [
  '당뇨약', '혈압약', '콜레스테롤약', '정신과약', '협심증약', '항암제', '기타약물',
];

// ── 5번 치료 및 내원 계획 (3문 단일선택) 🆕 ─────────────────────────────────────
const TREATMENT_START_OPTIONS = ['즉시', '1주일 이내', '한 달 이내', '계획없음'];
const VISIT_FREQUENCY_OPTIONS = ['주 1회', '2주에 한 번', '월 1회', '정기 내원 어려움'];
const INSURANCE_OPTIONS = ['예', '아니오'];

// ── T-20260625-foot-FOREIGN-HEALTHQ-EN: 외국인 전용 설문지(영문) ──────────────────
// 설계 원칙: 저장 VALUE는 한국어 canonical 유지(차트 표시 무회귀) + 표시 LABEL만 영문 분기.
//            ko 모드는 optL()/tt() 헬퍼가 원본 그대로 반환 → 완전 무회귀.

// 내원 목적 3종 (영문 모드 진입 시 선택). value = 한국어 canonical (visit_purpose 키 재사용)
const VISIT_PURPOSE_OPTIONS = [
  { value: '발톱무좀',   en: 'Nail fungus',      flow: 'standard' as const },
  { value: '내성발톱',   en: 'Ingrown toenail',  flow: 'standard' as const },
  { value: '발각질케어', en: 'Foot callus care', flow: 'callus'   as const },
];

// 발각질케어 신규 1번 — 발 고민 증상 (복수). DA 신규 키 foot_concern_symptoms(value=한국어 canonical=stable 코드)
const CALLUS_SYMPTOM_OPTIONS = [
  '발뒤꿈치', '발바닥 전체', '발가락 사이', '가려움증',
  '건조함', '티눈·사마귀', '발톱 청결 문제', '발냄새',
];

// ── T-20260629-foot-HEALTHQ-SELF-ADD-2Q: 자가작성 신규 항목 2종 ────────────────────
// 항목 A — 패디큐어 제거 유무 (국문 + 영문 전체 양식).
//   value=한국어 canonical(차트 표시 무회귀) + en 라벨 명시.
//   ⚠ 공유 EN_LABELS는 '없음'→'None' 매핑이라 Yes/No 항목엔 못 씀 → 전용 en 라벨 사용.
const PEDICURE_REMOVED_OPTIONS = [
  { value: '있음', en: 'Yes' },
  { value: '없음', en: 'No' },
];
// 항목 B — 30분 이상 엎드려 시술 가능 여부.
//   T-20260629-foot-HEALTHQ-SELF-ADD-2Q REWORK(현장 김주연 총괄 확정):
//   · 노출범위 B안 = 발각질케어(callus) 선택 시에만 조건부 노출 → 렌더 게이트 `isCallus`.
//   · 영문 카피 현장 확정: 라벨 "...more than 30 minutes..." + 선택지 Possible/Not possible → Yes/No.
//   ⚠ value=한국어 canonical(가능/불가능) 불변 — JSONB 저장값/차트 표시 무회귀. 표시 라벨(en)만 교체.
const PRONE_30MIN_OPTIONS = [
  { value: '가능',   en: 'Yes' },
  { value: '불가능', en: 'No' },
];

// 옵션 값(한국어 canonical) → 영문 라벨. 누락 시 원본 value 폴백.
const EN_LABELS: Record<string, string> = {
  // 1번 발 관련 증상
  '발톱 변색 및 변형':       'Nail discoloration / deformity',
  '내성발톱(파고드는 발톱)': 'Ingrown toenail',
  '발가락 통증':             'Toe pain',
  '발냄새':                  'Foot odor',
  '발건조 및 각질':          'Dry skin / calluses',
  '발 땀 많음':              'Excessive foot sweating',
  '가려움증':                'Itchiness',
  '발톱 끝 부서짐':          'Crumbling nail tips',
  '울퉁불퉁한 발톱':         'Bumpy / ridged nails',
  '기타':                    'Other',
  // 2번 치료 경험
  '없음':                    'None',
  '있음':                    'Yes',
  '먹는 약':                 'Oral medication',
  '바르는 약':               'Topical medication',
  '레이저':                  'Laser',
  '6개월 이내':              'Within 6 months',
  '1~3년':                   '1–3 years',
  '3~5년':                   '3–5 years',
  '10년 이상':               'Over 10 years',
  '발톱무좀':                'Nail fungus',
  '내성발톱':                'Ingrown toenail',
  '둘 다':                   'Both',
  '모름 / 없음':             'Unknown / None',
  '경미':                    'Mild',
  '불편':                    'Uncomfortable',
  '심함':                    'Severe',
  '매우 심함':               'Very severe',
  // 3번 건강 상태
  '당뇨':                    'Diabetes',
  '고혈압':                  'Hypertension',
  '간질환':                  'Liver disease',
  '간염보균자':              'Hepatitis carrier',
  '고지혈증':                'Hyperlipidemia',
  '심장질환':                'Heart disease',
  '자가면역질환':            'Autoimmune disease',
  '갑상선질환':              'Thyroid disease',
  '우울증·공황장애':         'Depression / panic disorder',
  '위장장애·역류성식도염':   'GI disorder / acid reflux',
  '임신중 또는 임신준비중':  'Pregnant or planning pregnancy',
  // 4번 복용약
  '당뇨약':                  'Diabetes medication',
  '혈압약':                  'Blood pressure medication',
  '콜레스테롤약':            'Cholesterol medication',
  '정신과약':                'Psychiatric medication',
  '협심증약':                'Angina medication',
  '항암제':                  'Chemotherapy drugs',
  '기타약물':                'Other medication',
  // 5번 치료/내원
  '즉시':                    'Immediately',
  '1주일 이내':              'Within a week',
  '한 달 이내':              'Within a month',
  '계획없음':                'No plan',
  '주 1회':                  'Once a week',
  '2주에 한 번':             'Every 2 weeks',
  '월 1회':                  'Once a month',
  '정기 내원 어려움':        'Hard to visit regularly',
  '예':                      'Yes',
  '아니오':                  'No',
  // 발각질 증상
  '발뒤꿈치':                'Heel',
  '발바닥 전체':             'Entire sole',
  '발가락 사이':             'Between toes',
  '건조함':                  'Dryness',
  '티눈·사마귀':             'Corn / wart',
  '발톱 청결 문제':          'Nail hygiene issue',
};

// ── 데이터 타입 (5섹션 최종 확정본) ───────────────────────────────────────────────
interface HealthQData {
  // 1번 발 관련 증상
  symptoms:               string[];
  symptoms_other:         string;
  // 2번 발 건강 관련 경험
  nail_treatment_history: string;   // '없음' | '있음'
  nail_treatment_methods: string[]; // 있음일 때 치료방법
  symptom_onset:          string;
  family_history_type:    string;
  foot_pain_level:        string;
  // 3번 나의 건강 상태 (과거병력 포함)
  medical_history:        string[];
  medical_history_none:   boolean;
  medical_history_other:  string;
  // 4번 현재 복용 중인 약
  medications:            string[];
  medications_other:      string;
  medications_none:       boolean;
  // 5번 치료 및 내원 계획
  treatment_start_timing: string;
  visit_frequency:        string;
  has_private_insurance:  string;   // '예' | '아니오'
  insurance_company:      string;
  // T-20260625-foot-FOREIGN-HEALTHQ-EN: 영문 모드 내원목적 + 발각질 신규 3문항 (DA 키 규약)
  visit_purpose:          string;   // '발톱무좀' | '내성발톱' | '발각질케어'
  foot_concern_symptoms:  string[]; // 발각질 Q1 — 발 고민 증상 (신규 키, symptoms 와 별개)
  has_allergy:            boolean | null;  // 발각질 Q2 — null=미선택
  allergies:              string;          // 발각질 Q2 — 알레르기 종류 기입 (DA 명시 키)
  // T-20260629-foot-HEALTHQ-SELF-ADD-2Q: 자가작성 신규 항목 2종 (JSONB form_data 키 추가, 스키마 무변경)
  pedicure_removed:       string;   // 항목A — '있음' | '없음' (국문 + 영문 전체 양식)
  prone_30min_ok:         string;   // 항목B — '가능' | '불가능' (외국인 폼 전용, 국문 비노출)
}

const emptyData = (): HealthQData => ({
  symptoms:               [],
  symptoms_other:         '',
  nail_treatment_history: '',
  nail_treatment_methods: [],
  symptom_onset:          '',
  family_history_type:    '',
  foot_pain_level:        '',
  medical_history:        [],
  medical_history_none:   false,
  medical_history_other:  '',
  medications:            [],
  medications_other:      '',
  medications_none:       false,
  treatment_start_timing: '',
  visit_frequency:        '',
  has_private_insurance:  '',
  insurance_company:      '',
  visit_purpose:          '',
  foot_concern_symptoms:  [],
  has_allergy:            null,
  allergies:              '',
  pedicure_removed:       '',
  prone_30min_ok:         '',
});

type PageStep = 'loading' | 'error' | 'form' | 'submitting' | 'done' | 'already_used';

interface TokenInfo {
  token_id:      string;
  customer_id:   string;
  customer_name: string;
  clinic_id:     string;
  check_in_id:   string | null;
  form_type:     string;
  lang:          string;   // 'ko' | 'en' (T-20260625-foot-FOREIGN-HEALTHQ-EN)
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
  // 브라운/베이지 팔레트 통일 (teal/emerald → 브라운). 경고(amber)·위험(rose/danger)은 의미 보존
  const scheme = danger
    ? { on: 'border-red-500 bg-red-50 text-red-700', off: 'border-gray-200 bg-white text-gray-700' }
    : {
        teal:    { on: 'border-[#7B5130] bg-[#F5EFE7] text-[#5C3D1E]', off: 'border-gray-200 bg-white text-gray-700' },
        emerald: { on: 'border-[#7B5130] bg-[#FDF5E4] text-[#5C3D1E]', off: 'border-gray-200 bg-white text-gray-700' },
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
    <div className="flex items-start gap-3 pb-2 border-b" style={{ borderColor: C.border }}>
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
        lang?:         string;
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
        lang:          res.lang === 'en' ? 'en' : 'ko',
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

      // DA Q2 #4: form_data 에 _lang 메타키 동봉(self-describing — token join 끊겨도 응답 언어 보존).
      // 저장값은 언어중립 canonical(한국어 stable 코드), _lang 는 답변 설문 표시언어 메타만.
      const formData = {
        ...data,
        _lang: info.lang === 'en' ? 'en' : 'ko',
      };

      // documents 버킷에 JSON 백업 (optional — 실패해도 제출 계속)
      try {
        const payload = {
          form_type:     info.form_type,
          title:         '발건강질문지',
          customer_name: info.customer_name,
          data:          formData,
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
        p_form_data:    formData as unknown as Record<string, unknown>,
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

  // ── T-20260625-foot-FOREIGN-HEALTHQ-EN: 언어 분기 헬퍼 ──────────────────────
  // ko 모드면 tt()/optL() 모두 한국어 원본 그대로 반환 → 무회귀.
  const lang = info?.lang === 'en' ? 'en' : 'ko';
  const isEn = lang === 'en';
  const tt   = (koStr: string, enStr: string) => (isEn ? enStr : koStr);
  const optL = (v: string) => (isEn ? (EN_LABELS[v] ?? v) : v);

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
          <p className="text-xl font-medium" style={{ color: C.dark }}>{tt('저장 중…', 'Saving…')}</p>
          <p className="text-sm" style={{ color: C.mutedText }}>{tt('잠시만 기다려 주세요', 'Please wait a moment')}</p>
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
          <h1 className="text-xl font-bold text-red-600">{tt('링크 오류', 'Link Error')}</h1>
          <p className="text-gray-600 text-sm">{errorMsg}</p>
          <p className="text-xs text-gray-400">{tt('오블리브 풋센터 직원에게 문의해주세요.', 'Please contact the OBLIV Foot Center staff.')}</p>
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
          <h1 className="text-xl font-bold" style={{ color: C.dark }}>{tt('이미 작성 완료', 'Already Submitted')}</h1>
          <p className="text-sm" style={{ color: C.mutedText }}>
            {isEn ? (
              <>This questionnaire has already been submitted.<br />If you need to fill it out again, please ask the staff for a new link.</>
            ) : (
              <>발건강질문지가 이미 제출되었습니다.<br />새 작성이 필요하면 직원에게 새 링크를 요청해주세요.</>
            )}
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
            <h1 className="text-2xl font-bold" style={{ color: C.dark }}>{tt('작성 완료!', 'All done!')}</h1>
            <p className="mt-3 text-base" style={{ color: C.mutedText }}>
              {isEn ? `Thank you, ${info?.customer_name}.` : `${info?.customer_name}님, 감사합니다.`}
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.bannerBg, border: `1.5px solid ${C.bannerBorder}` }}>
            <p className="text-sm font-medium" style={{ color: C.primary }}>
              {tt('📋 발건강질문지가 저장되었습니다', '📋 Your questionnaire has been saved')}
            </p>
            <p className="text-xs mt-1" style={{ color: C.mutedText }}>
              {tt('담당 직원이 내용을 확인 후 안내해드립니다', 'Our staff will review it and assist you shortly')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 폼 단계 ──────────────────────────────────────────────────────────────────
  const isSenior = info?.form_type === 'senior';

  // ── T-20260625-foot-FOREIGN-HEALTHQ-EN: 영문 모드 내원목적 분기 게이트 ──────────
  // ko 모드: 목적 선택 단계 없이 기존 5섹션 그대로(무회귀).
  // en 모드: 목적 선택 → 발톱무좀/내성발톱 = 기존 5섹션(영문) / 발각질케어 = 신규 3문항.
  const purposeChosen   = !isEn || !!d.visit_purpose;
  const isCallus        = isEn && d.visit_purpose === '발각질케어';
  const showStandard    = purposeChosen && !isCallus;
  const submitDisabled  = isEn && !d.visit_purpose;

  // 복용약 섹션 — 표준 4번 / 발각질 Q3에서 공통 재사용 (기존 medications 키)
  const renderMedications = (num: number) => (
    <section className="space-y-4 rounded-2xl p-4"
      style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
      <SectionHeader num={num}
        title={tt('현재 복용 중인 약', 'Current medications')}
        sub={tt('해당 항목 모두 선택해주세요', 'Select all that apply')} />
      <div className="flex flex-wrap gap-2">
        <BigBtn
          active={d.medications_none}
          onClick={() => {
            const next = !d.medications_none;
            set('medications_none', next);
            if (next) { set('medications', []); set('medications_other', ''); }
          }}
          color="emerald"
        >
          {tt('없음', 'None')}
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
            {optL(opt)}
          </BigBtn>
        ))}
      </div>
      {d.medications.includes('기타약물') && !d.medications_none && (
        <input type="text" value={d.medications_other}
          onChange={(e) => set('medications_other', e.target.value)}
          placeholder={tt('약물명 직접 입력', 'Enter medication name')}
          className="w-full rounded-xl border px-4 py-3 text-base outline-none"
          style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
      )}
    </section>
  );

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
            {isEn ? 'Foot Health Questionnaire' : `발건강 질문지${isSenior ? ' (어르신용)' : ''}`}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: C.mutedText }}>
            {isEn
              ? `${info?.customer_name} — honest answers help us provide accurate care`
              : `${info?.customer_name}님 — 솔직한 답변이 정확한 진료에 도움이 됩니다`}
          </p>
        </div>
      </header>

      {/* ── 폼 본문 ──────────────────────────────────────────────────────────── */}
      <main className="max-w-lg mx-auto px-4 py-5 space-y-5 pb-36">

        {/* ── [영문 전용] 내원 목적 선택 (T-20260625-foot-FOREIGN-HEALTHQ-EN) ──── */}
        {isEn && (
          <section className="space-y-4 rounded-2xl p-4"
            style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
            <SectionHeader num={1} title="Reason for visit" sub="Please select the reason for your visit" />
            <div className="grid grid-cols-1 gap-2">
              {VISIT_PURPOSE_OPTIONS.map((opt) => (
                <BigBtn key={opt.value} full
                  active={d.visit_purpose === opt.value}
                  onClick={() => {
                    // 목적 변경 시: 동일 선택 토글 해제. 다른 목적으로 바꾸면 입력 초기화하지 않음
                    set('visit_purpose', d.visit_purpose === opt.value ? '' : opt.value);
                  }}
                  color="teal"
                >
                  {opt.en}
                </BigBtn>
              ))}
            </div>
            {!d.visit_purpose && (
              <p className="text-xs" style={{ color: C.mutedText }}>
                Select a reason above to continue.
              </p>
            )}
          </section>
        )}

        {/* ── [영문 전용] 발각질케어 신규 3문항 ────────────────────────────────── */}
        {isCallus && (
          <>
            {/* Callus Q1 — 발 고민 증상 (복수). DA 신규 키 foot_concern_symptoms (symptoms 와 별개) */}
            <section className="space-y-4 rounded-2xl p-4"
              style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
              <SectionHeader num={2} title="Foot concerns" sub="Select all that apply" />
              <div className="flex flex-wrap gap-2">
                {CALLUS_SYMPTOM_OPTIONS.map((opt) => (
                  <BigBtn key={opt}
                    active={d.foot_concern_symptoms.includes(opt)}
                    onClick={() => set('foot_concern_symptoms', toggle(d.foot_concern_symptoms, opt))}
                    color="teal"
                  >
                    {optL(opt)}
                  </BigBtn>
                ))}
              </div>
            </section>

            {/* Callus Q2 — 알레르기 여부 (has_allergy boolean + allergies 동적, DA 명시 키) */}
            <section className="space-y-4 rounded-2xl p-4"
              style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
              <SectionHeader num={3} title="Allergies" sub="Do you have any allergies?" />
              <div className="grid grid-cols-2 gap-2">
                <BigBtn full
                  active={d.has_allergy === true}
                  onClick={() => set('has_allergy', true)}
                  color="teal"
                >
                  Yes
                </BigBtn>
                <BigBtn full
                  active={d.has_allergy === false}
                  onClick={() => { set('has_allergy', false); set('allergies', ''); }}
                  color="teal"
                >
                  No
                </BigBtn>
              </div>
              {d.has_allergy === true && (
                <input type="text" value={d.allergies}
                  onChange={(e) => set('allergies', e.target.value)}
                  placeholder="Please specify your allergies"
                  className="w-full rounded-xl border px-4 py-3 text-base outline-none"
                  style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
              )}
            </section>

            {/* Callus Q3 — 현재 복용 중인 약 (기존 4번 항목 재사용) */}
            {renderMedications(4)}
          </>
        )}

        {/* ── 표준 5섹션 (ko 전체 / en 발톱무좀·내성발톱) ──────────────────────── */}
        {showStandard && (
        <>
        {/* ── 1번 발 관련 증상 (현장 확정) ─────────────────────────────────────── */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={1} title={tt('발 관련 증상', 'Foot symptoms')} sub={tt('해당 항목 모두 선택해주세요', 'Select all that apply')} />
          <div className="flex flex-wrap gap-2">
            {SYMPTOM_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.symptoms.includes(opt)}
                onClick={() => set('symptoms', toggle(d.symptoms, opt))}
                color="teal"
              >
                {optL(opt)}
              </BigBtn>
            ))}
          </div>
          {d.symptoms.includes('기타') && (
            <input type="text" value={d.symptoms_other}
              onChange={(e) => set('symptoms_other', e.target.value)}
              placeholder={tt('기타 증상 직접 입력', 'Enter other symptom')}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
        </section>

        {/* ── 2번 발 건강 관련 경험 (현장 확정 — 4문) ──────────────────────────── */}
        <section className="space-y-5 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={2} title={tt('발 건강 관련 경험', 'Foot health history')} sub={tt('각 항목에서 하나씩 선택해주세요', 'Select one for each item')} />

          {/* Q1 문제성 발톱 치료 경험 */}
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: C.dark }}>{tt('문제성 발톱 치료 경험', 'History of nail treatment')}</p>
            <div className="grid grid-cols-2 gap-2">
              {NAIL_TREATMENT_HISTORY_OPTIONS.map((opt) => (
                <BigBtn key={opt} full
                  active={d.nail_treatment_history === opt}
                  onClick={() => {
                    set('nail_treatment_history', d.nail_treatment_history === opt ? '' : opt);
                    if (opt !== '있음') set('nail_treatment_methods', []);
                  }}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
            {d.nail_treatment_history === '있음' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium" style={{ color: C.mutedText }}>{tt('치료 방법 (해당 항목 선택)', 'Treatment method (select all that apply)')}</p>
                <div className="flex flex-wrap gap-2">
                  {NAIL_TREATMENT_METHOD_OPTIONS.map((opt) => (
                    <BigBtn key={opt}
                      active={d.nail_treatment_methods.includes(opt)}
                      onClick={() => set('nail_treatment_methods', toggle(d.nail_treatment_methods, opt))}
                      color="teal"
                    >
                      {optL(opt)}
                    </BigBtn>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Q2 증상 시작 시점 */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>{tt('증상 시작 시점', 'When symptoms started')}</p>
            <div className="flex flex-wrap gap-2">
              {SYMPTOM_ONSET_OPTIONS.map((opt) => (
                <BigBtn key={opt}
                  active={d.symptom_onset === opt}
                  onClick={() => set('symptom_onset', d.symptom_onset === opt ? '' : opt)}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
          </div>

          {/* Q3 가족력 */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>{tt('가족력', 'Family history')}</p>
            <div className="flex flex-wrap gap-2">
              {FAMILY_HISTORY_TYPE_OPTIONS.map((opt) => (
                <BigBtn key={opt}
                  active={d.family_history_type === opt}
                  onClick={() => set('family_history_type', d.family_history_type === opt ? '' : opt)}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
          </div>

          {/* Q4 발 통증 여부 */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>{tt('발 통증 여부', 'Foot pain level')}</p>
            {/* T-20260602-foot-HEALTHQ-PAIN-NONE-LAYOUT: '없음'(0단계)+통증 4단계 = 5개를
                동일 박스로 한 그리드에 나란히. 단일선택(상호배타)·저장값 string '없음' 유지. */}
            <div className="grid grid-cols-5 gap-2">
              {FOOT_PAIN_LEVEL_OPTIONS.map((opt) => {
                const on = d.foot_pain_level === opt.value;
                return (
                  <button key={opt.value} type="button"
                    onClick={() => set('foot_pain_level', on ? '' : opt.value)}
                    className={cn(
                      'min-h-[56px] rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition active:scale-95',
                      on ? 'border-[#7B5130] bg-[#F5EFE7]' : 'border-gray-200 bg-white',
                    )}
                  >
                    <span className="text-xl">{opt.emoji}</span>
                    <span className="text-xs font-medium"
                      style={{ color: on ? C.primary : '#6B7280' }}>{optL(opt.value)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 3번 나의 건강 상태 (다중) — OQ1 해소 최종 11항 ───────────────────── */}
        <section className="space-y-4 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={3} title={tt('나의 건강 상태', 'My health status')} sub={tt('과거병력 포함 — 해당 항목 모두 선택해주세요', 'Including medical history — select all that apply')} />
          <div className="flex flex-wrap gap-2">
            <BigBtn
              active={d.medical_history_none}
              onClick={() => {
                const next = !d.medical_history_none;
                set('medical_history_none', next);
                if (next) { set('medical_history', []); set('medical_history_other', ''); }
              }}
              color="emerald"
            >
              {tt('없음', 'None')}
            </BigBtn>
            {MEDICAL_HISTORY_OPTIONS.map((opt) => (
              <BigBtn key={opt}
                active={d.medical_history.includes(opt) && !d.medical_history_none}
                onClick={() => {
                  set('medical_history_none', false);
                  set('medical_history', toggle(d.medical_history, opt));
                }}
                color="amber"
              >
                {optL(opt)}
              </BigBtn>
            ))}
          </div>
          {d.medical_history.includes('기타') && !d.medical_history_none && (
            <input type="text" value={d.medical_history_other}
              onChange={(e) => set('medical_history_other', e.target.value)}
              placeholder={tt('기타 건강상태 직접 입력', 'Enter other health condition')}
              className="w-full rounded-xl border px-4 py-3 text-base outline-none"
              style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
          )}
        </section>

        {/* ── 4번 현재 복용 중인 약 (다중) — 현장 확정 ─────────────────────────── */}
        {renderMedications(4)}

        {/* ── 5번 치료 및 내원 계획 (3문 단일선택) 🆕 ──────────────────────────── */}
        <section className="space-y-5 rounded-2xl p-4"
          style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
          <SectionHeader num={5} title={tt('치료 및 내원 계획', 'Treatment & visit plan')} sub={tt('각 항목에서 하나씩 선택해주세요', 'Select one for each item')} />

          {/* Q1 치료 시작 가능한 시기 */}
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: C.dark }}>{tt('치료 시작 가능한 시기', 'When can you start treatment')}</p>
            <div className="flex flex-wrap gap-2">
              {TREATMENT_START_OPTIONS.map((opt) => (
                <BigBtn key={opt}
                  active={d.treatment_start_timing === opt}
                  onClick={() => set('treatment_start_timing', d.treatment_start_timing === opt ? '' : opt)}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
          </div>

          {/* Q2 내원 가능 주기 */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>{tt('치료를 위해 내원 가능 주기', 'How often can you visit for treatment')}</p>
            <div className="flex flex-wrap gap-2">
              {VISIT_FREQUENCY_OPTIONS.map((opt) => (
                <BigBtn key={opt}
                  active={d.visit_frequency === opt}
                  onClick={() => set('visit_frequency', d.visit_frequency === opt ? '' : opt)}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
          </div>

          {/* Q3 실비보험 */}
          <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
            <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>{tt('실비보험을 보유하고 계신가요?', 'Do you have private health insurance?')}</p>
            <div className="grid grid-cols-2 gap-2">
              {INSURANCE_OPTIONS.map((opt) => (
                <BigBtn key={opt} full
                  active={d.has_private_insurance === opt}
                  onClick={() => {
                    set('has_private_insurance', d.has_private_insurance === opt ? '' : opt);
                    if (opt !== '예') set('insurance_company', '');
                  }}
                  color="teal"
                >
                  {optL(opt)}
                </BigBtn>
              ))}
            </div>
            {d.has_private_insurance === '예' && (
              <input type="text" value={d.insurance_company}
                onChange={(e) => set('insurance_company', e.target.value)}
                placeholder={tt('보험사명 직접 입력 (예: ○○화재)', 'Enter insurance company name')}
                className="w-full rounded-xl border px-4 py-3 text-base outline-none"
                style={{ borderColor: C.border, color: C.dark, minHeight: 44 }} />
            )}
          </div>
        </section>
        </>
        )}

        {/* ── 추가 확인 사항 (T-20260629-foot-HEALTHQ-SELF-ADD-2Q REWORK) ────────── */}
        {/* 항목A 패디큐어 제거 유무 = 국문 + 영문 전체(purposeChosen 시 모든 flow 1회 노출).
            항목B 엎드려 시술 가능 여부 = B안(현장 확정): 발각질케어(isCallus) 선택 시에만 노출.
            미선택/다른 목적/국문 = 비노출. */}
        {purposeChosen && (
          <section className="space-y-5 rounded-2xl p-4"
            style={{ backgroundColor: 'white', border: `1.5px solid ${C.border}` }}>
            <SectionHeader num={isCallus ? 5 : 6}
              title={tt('추가 확인 사항', 'Additional questions')}
              sub={tt('각 항목에서 하나씩 선택해주세요', 'Select one for each item')} />

            {/* 항목 A — 패디큐어 제거 유무 (국문 + 영문 전체) */}
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: C.dark }}>
                {tt('패디큐어 제거 유무', 'Pedicure removed?')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PEDICURE_REMOVED_OPTIONS.map((opt) => (
                  <BigBtn key={opt.value} full
                    active={d.pedicure_removed === opt.value}
                    onClick={() => set('pedicure_removed', d.pedicure_removed === opt.value ? '' : opt.value)}
                    color="teal"
                  >
                    {isEn ? opt.en : opt.value}
                  </BigBtn>
                ))}
              </div>
            </div>

            {/* 항목 B — 30분 이상 엎드려 시술 가능 여부 (B안: 발각질케어 선택 시에만 노출) */}
            {isCallus && (
              <div className="space-y-2 pt-1 border-t" style={{ borderColor: C.border }}>
                <p className="text-sm font-medium pt-2" style={{ color: C.dark }}>
                  Can you lie face down for more than 30 minutes during the treatment?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PRONE_30MIN_OPTIONS.map((opt) => (
                    <BigBtn key={opt.value} full
                      active={d.prone_30min_ok === opt.value}
                      onClick={() => set('prone_30min_ok', d.prone_30min_ok === opt.value ? '' : opt.value)}
                      color="teal"
                    >
                      {opt.en}
                    </BigBtn>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <p className="text-center text-xs pb-4" style={{ color: C.mutedText }}>
          {tt('모든 정보는 진료 목적으로만 사용됩니다', 'All information is used for medical purposes only')}
        </p>
      </main>

      {/* ── sticky 제출 버튼 ─────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-safe"
        style={{ background: 'linear-gradient(to top, rgba(255,255,255,1) 70%, transparent)' }}>
        <div className="max-w-lg mx-auto pt-3 pb-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="w-full min-h-[56px] rounded-2xl text-xl font-bold text-white transition active:scale-[0.99] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: C.primary }}
          >
            {isEn ? '✓ Submit' : '✓ 작성 완료 — 제출하기'}
          </button>
          <p className="text-center text-xs mt-2" style={{ color: C.mutedText }}>
            {submitDisabled
              ? tt('내원 목적을 먼저 선택해주세요', 'Please select your reason for visit first')
              : tt('제출 후 수정이 불가합니다. 작성 내용을 확인 후 제출해주세요.', 'You cannot edit after submitting. Please review your answers before submitting.')}
          </p>
        </div>
      </div>
    </div>
  );
}

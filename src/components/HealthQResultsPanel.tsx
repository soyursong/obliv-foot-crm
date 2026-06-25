/**
 * T-20260529-foot-HEALTH-Q-MOBILE
 *
 * HealthQResultsPanel — 직원용 발건강질문지 결과 조회 + 토큰 발급 패널
 *
 * AC-4: 직원 화면에서 제출 결과 조회
 * - health_q_results 테이블 조회 (인증된 직원 전용)
 * - fn_health_q_create_token RPC로 토큰 발급 → URL 복사
 * - PenChartTab의 list 모드에 삽입
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Plus, RefreshCw, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { QrViewModal } from '@/components/QrViewModal';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// ─── 타입 ──────────────────────────────────────────────────────────────────────
// T-20260602-foot-CHART2-HEALTHQ-VIEWER: 2번차트 상담내역 [내용보기]에서 재사용 위해 export
export interface HQResult {
  id:           string;
  form_type:    string;
  form_data:    Record<string, unknown>;
  submitted_at: string;
  created_at:   string;
}

interface Props {
  customerId: string;
  clinicId:   string;
  checkInId?: string;
}

// ─── 레이블 맵 ────────────────────────────────────────────────────────────────
const FORM_TYPE_LABEL: Record<string, string> = {
  general: '발건강 질문지 (일반)',
  senior:  '발건강 질문지 (어르신용)',
};

/** 섹션 레이블 (form_data key → 표시 이름) */
// T-20260601-foot-HEALTHQ-SELF-RESTRUCTURE: 신규 동의서 key 추가 + 구 key 후방호환 유지(AC-6)
const FIELD_LABELS: Record<string, string> = {
  // 1번 발 관련 증상
  symptoms:               '발 관련 증상',
  symptoms_other:         '발 관련 증상 (기타)',
  // 2번 발 건강 관련 경험 (신규)
  nail_treatment_history: '문제성 발톱 치료',
  nail_treatment_methods: '치료 방법',
  symptom_onset:          '증상 시작 시점',
  family_history_type:    '가족력',
  foot_pain_level:        '발 통증 여부',
  // 3번 나의 건강 상태
  medical_history:        '나의 건강 상태',
  medical_history_other:  '건강상태 (기타)',
  // 4번 현재 복용 중인 약
  medications:            '복용 중인 약',
  medications_other:      '복용약물 (기타)',
  // 5번 치료 및 내원 계획
  treatment_start_timing: '치료 시작 시기',
  visit_frequency:        '내원 가능 주기',
  has_private_insurance:  '실비보험',
  insurance_company:      '보험사',
  // ── 외국인 발각질케어 신규 문항 (T-20260625-foot-FOREIGN-HEALTHQ-EN) ──
  foot_concern_symptoms:  '발 고민 증상',
  allergies:              '알레르기 상세',
  // ── 후방호환 (구 제출분) ──
  visit_purpose:          '방문 목적',
  has_allergy:            '알레르기',
  allergy_types:          '알레르기 종류',
  allergy_other:          '알레르기 상세',
  referral_source:        '방문 경로',
  nail_locations:         '통증 발톱 부위',
  pain_duration:          '유병 기간',
  pain_severity:          '통증 정도',
  prior_treatment:        '이전 발 시술',
  prior_conditions:       '기왕증 / 이전 치료',
  family_history:         '가족력 (서술)',
};

const PAIN_SEVERITY_MAP: Record<string, string> = {
  '1': '1 — 경미 😊',
  '2': '2 — 불편 😐',
  '3': '3 — 심함 😣',
  '4': '4 — 매우 심함 😰',
};

function renderValue(key: string, val: unknown): string {
  if (key === 'pain_severity') {
    return PAIN_SEVERITY_MAP[String(val)] ?? String(val);
  }
  if (key === 'has_allergy') {
    return val ? '있음' : '없음';
  }
  if (key === 'medications_none' || key === 'medical_history_none') return '';
  if (Array.isArray(val)) return val.join(', ') || '—';
  if (typeof val === 'boolean') return val ? '예' : '아니오';
  return String(val || '—');
}

/** form_data 에서 표시할 필드만 추출 (빈 값 제외) */
function extractDisplayFields(data: Record<string, unknown>) {
  const ORDER = [
    // 5섹션 최종 확정본 순서
    'symptoms', 'symptoms_other',
    'nail_treatment_history', 'nail_treatment_methods', 'symptom_onset', 'family_history_type', 'foot_pain_level',
    'medical_history', 'medical_history_other',
    'medications', 'medications_other',
    'treatment_start_timing', 'visit_frequency', 'has_private_insurance', 'insurance_company',
    // 외국인 발각질케어 신규 문항 (foot_concern_symptoms = 발 고민 증상, allergies = 알레르기 상세)
    'visit_purpose', 'foot_concern_symptoms', 'has_allergy', 'allergies',
    // 후방호환 (구 제출분 key — 제거된 방문목적/알레르기/방문경로 + 구 통증·시술)
    'allergy_types', 'allergy_other', 'referral_source',
    'nail_locations', 'pain_duration', 'pain_severity', 'prior_treatment', 'prior_conditions', 'family_history',
  ];
  const result: Array<{ key: string; label: string; value: string }> = [];
  for (const key of ORDER) {
    if (!(key in data)) continue;
    const val = data[key];
    // 빈 값 건너뛰기
    if (val === '' || val === null || val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (key === 'medications_none') continue; // has_allergy 로 커버
    const rendered = renderValue(key, val);
    if (!rendered || rendered === '—') continue;
    result.push({ key, label: FIELD_LABELS[key] ?? key, value: rendered });
  }
  return result;
}

// ─── 결과 카드 ────────────────────────────────────────────────────────────────
// T-20260602-foot-CHART2-HEALTHQ-VIEWER: defaultExpanded — 상담내역 뷰어에서는 펼친 상태로 표시
export function ResultCard({ result, defaultExpanded = false }: { result: HQResult; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fields = extractDisplayFields(result.form_data);
  const submittedDate = format(new Date(result.submitted_at), 'yyyy.MM.dd HH:mm', { locale: ko });

  return (
    <div className="rounded-xl border border-teal-100 bg-white overflow-hidden">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-teal-50/50 transition"
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-teal-800">
            {FORM_TYPE_LABEL[result.form_type] ?? result.form_type}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">제출: {submittedDate}</p>
        </div>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
          : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        }
      </button>

      {/* 내용 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-teal-50">
          {fields.length === 0 ? (
            <p className="text-xs text-gray-400 pt-3">입력된 항목 없음</p>
          ) : (
            <dl className="grid grid-cols-1 gap-1.5 pt-3">
              {fields.map(({ key, label, value }) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-xs font-medium text-gray-500 shrink-0 w-28">{label}</dt>
                  <dd className="text-xs text-gray-700 flex-1">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function HealthQResultsPanel({ customerId, clinicId, checkInId }: Props) {
  const [results,      setResults]      = useState<HQResult[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [formType,     setFormType]     = useState<'general' | 'senior'>('general');
  // T-20260625-foot-FOREIGN-HEALTHQ-EN: 외국인 전용 영문 설문지 링크 발급
  const [lang,         setLang]         = useState<'ko' | 'en'>('ko');
  // T-20260603-foot-HEALTHQ-SELFLINK-QR-VIEW: 발급된 링크 QR 모달 (데스크 즉시 응대)
  const [qrOpen,       setQrOpen]       = useState(false);

  // ── 결과 로드 ──────────────────────────────────────────────────────────────
  const loadResults = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('health_q_results')
      .select('id, form_type, form_data, submitted_at, created_at')
      .eq('customer_id', customerId)
      .eq('clinic_id', clinicId)
      .order('submitted_at', { ascending: false })
      .limit(10);
    if (!error && data) setResults(data as HQResult[]);
    setLoading(false);
  }, [customerId, clinicId]);

  useEffect(() => { loadResults(); }, [loadResults]);

  // ── 토큰 발급 ──────────────────────────────────────────────────────────────
  const handleCreateToken = useCallback(async () => {
    setTokenLoading(true);
    setGeneratedUrl(null);
    try {
      const { data: result, error } = await supabase.rpc('fn_health_q_create_token', {
        p_customer_id:  customerId,
        p_clinic_id:    clinicId,
        p_form_type:    formType,
        p_check_in_id:  checkInId ?? null,
        p_expires_days: 7,
        p_lang:         lang,
      });
      if (error) throw new Error(error.message);
      const res = result as { success: boolean; token?: string; error?: string };
      if (!res.success) throw new Error(res.error ?? '토큰 생성 실패');
      const url = `${window.location.origin}/health-q/${res.token}`;
      setGeneratedUrl(url);
    } catch (e) {
      toast.error(`링크 생성 실패: ${(e as Error).message}`);
    } finally {
      setTokenLoading(false);
    }
  }, [customerId, clinicId, formType, checkInId, lang]);

  const handleCopy = useCallback(async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      toast.success('링크 복사됨');
    } catch {
      toast.error('복사 실패 — 수동으로 복사해주세요');
    }
  }, [generatedUrl]);

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">발건강질문지 자가작성</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { loadResults(); }}
          disabled={loading}
          className="h-7 px-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* 고객 링크 발급 */}
      <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 space-y-3">
        <p className="text-xs font-medium text-teal-700">고객용 링크 발급 (모바일 자가작성)</p>
        <div className="flex gap-2">
          {/* 양식 선택 */}
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value as 'general' | 'senior')}
            className="flex-1 rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-teal-400"
          >
            <option value="general">일반용</option>
            <option value="senior">어르신용</option>
          </select>
          {/* T-20260625-foot-FOREIGN-HEALTHQ-EN: 언어 (외국인 = 영문) */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'ko' | 'en')}
            className="flex-1 rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-teal-400"
            data-testid="healthq-lang-select"
          >
            <option value="ko">한국어</option>
            <option value="en">English (외국인)</option>
          </select>
          <Button
            size="sm"
            onClick={handleCreateToken}
            disabled={tokenLoading}
            /* T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST AC-2: 완전검정 → 모노톤 미드그레이(#666, 기입/생성 secondary) */
            className="gap-1.5 bg-[#666666] hover:bg-[#757575] text-white text-xs h-9 px-3"
          >
            <Plus className="h-3.5 w-3.5" />
            링크 생성
          </Button>
        </div>

        {/* 생성된 URL */}
        {generatedUrl && (
          <div className="rounded-lg border border-teal-200 bg-white p-2.5 space-y-2">
            <p className="text-xs text-gray-500 break-all font-mono leading-relaxed">{generatedUrl}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1 h-8 px-3 text-xs flex-1 border-teal-300">
                <Copy className="h-3 w-3" />
                복사
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => window.open(generatedUrl, '_blank')}
                className="gap-1 h-8 px-3 text-xs border-teal-300"
              >
                <ExternalLink className="h-3 w-3" />
                미리보기
              </Button>
              {/* T-20260603-foot-HEALTHQ-SELFLINK-QR-VIEW: 발급 링크 QR — 고객이 QR 놓친 경우 데스크 화면 스캔 응대 */}
              <Button size="sm" variant="outline"
                onClick={() => setQrOpen(true)}
                className="gap-1 h-8 px-3 text-xs border-teal-300"
                data-testid="healthq-qr-view-btn"
              >
                <QrCode className="h-3 w-3" />
                QR 보기
              </Button>
            </div>
            <p className="text-[10px] text-gray-400">유효 기간 7일. 제출 후 링크는 무효화됩니다.</p>
          </div>
        )}
      </div>

      {/* QR 모달 — 공통 QrViewModal 재사용 */}
      {/* T-20260622-foot-CHART2-UICLEAN-4FIX 요청5: 하단 QR 재표시 섹션 + 그 모달 제거
          (상단 진입 버튼과 중복). QR 진입점은 상단 1개만 유지. */}
      {generatedUrl && (
        <QrViewModal
          open={qrOpen}
          onOpenChange={setQrOpen}
          url={generatedUrl}
          title="발건강질문지 자가작성 링크"
          caption="고객 휴대폰으로 이 QR을 스캔하면 자가작성 화면이 열립니다."
        />
      )}

      {/* 제출된 결과 목록 */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-4">
            <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-teal-300 border-t-teal-600" />
          </div>
        ) : results.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">제출된 질문지가 없습니다</p>
        ) : (
          results.map((r) => <ResultCard key={r.id} result={r} />)
        )}
      </div>
    </div>
  );
}

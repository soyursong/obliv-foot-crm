/**
 * NhisLookupPanel — 건보공단 수진자 자격조회 Native 렌더링
 *
 * T-20260515-foot-KENBO-API-NATIVE
 *
 * AC-2: Edge Function 호출 → CRM 내 자격등급/본인부담률/적용일 직접 렌더링
 * AC-3: API 장애 시 graceful degradation (에러 메시지 + 외부 링크 fallback)
 * AC-4: sessionStorage 캐시 (TTL 4시간, customer_id 단위)
 *
 * 사전 조건:
 *   - 건보 조회 동의(hira_consent)=true 필요
 *   - 주민번호(RRN) 입력 필요 (미입력 시 에러 안내)
 *   - NHIS_API_URL / NHIS_API_KEY / NHIS_FACILITY_CODE 환경변수 설정 필요
 */

import { useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { INSURANCE_GRADE_LABELS, type InsuranceGrade } from '@/lib/insurance';
import { updateInsuranceGrade } from '@/hooks/useInsurance';

const NHIS_EXTERNAL_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';
/** 캐시 유효 시간: 4시간 (ms) */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface LookupResult {
  grade: InsuranceGrade;
  copayment_rate: number | null;
  effective_date: string | null;
}

interface NhisErrorCode {
  error: string;
  fallback_url?: string;
  detail?: string;
}

interface CacheEntry {
  result: LookupResult;
  ts: number;
}

function getCacheKey(customerId: string) {
  return `nhis_lookup_v1_${customerId}`;
}

function readCache(customerId: string): LookupResult | null {
  try {
    const raw = sessionStorage.getItem(getCacheKey(customerId));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(getCacheKey(customerId));
      return null;
    }
    return entry.result;
  } catch {
    return null;
  }
}

function writeCache(customerId: string, result: LookupResult) {
  try {
    const entry: CacheEntry = { result, ts: Date.now() };
    sessionStorage.setItem(getCacheKey(customerId), JSON.stringify(entry));
  } catch {
    // sessionStorage 쓰기 실패는 무시 (캐시 기능만 비활성)
  }
}

function clearCache(customerId: string) {
  try {
    sessionStorage.removeItem(getCacheKey(customerId));
  } catch {
    // ignore
  }
}

interface Props {
  customerId: string;
  clinicId: string;
  hiraConsent: boolean;
  /** 조회 완료 후 부모 컴포넌트에 등급 변경 알림 */
  onGradeUpdated?: () => void;
}

export function NhisLookupPanel({ customerId, clinicId: _clinicId, hiraConsent, onGradeUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(() => readCache(customerId));
  const [error, setError] = useState<{ message: string; showFallback: boolean } | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const performLookup = async (forceRefresh = false) => {
    if (!hiraConsent) {
      toast.warning('건보 조회 동의가 필요합니다. 조회동의를 Y로 설정해 주세요.');
      return;
    }

    // 캐시 확인 (강제 갱신 아닐 때)
    if (!forceRefresh) {
      const cached = readCache(customerId);
      if (cached) {
        setResult(cached);
        setError(null);
        return;
      }
    } else {
      clearCache(customerId);
    }

    setLoading(true);
    setError(null);

    try {
      // Supabase Edge Function 호출
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new Error('로그인 세션이 만료되었습니다.');
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const fnUrl = `${supabaseUrl}/functions/v1/nhis-lookup`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000); // 12s UI timeout

      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ customer_id: customerId }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const json: LookupResult | NhisErrorCode = await res.json();

      if (!res.ok) {
        const errJson = json as NhisErrorCode;
        const showFallback = !!errJson.fallback_url;
        const message = resolveErrorMessage(errJson.error, errJson.detail);
        setError({ message, showFallback });
        return;
      }

      const lookupResult = json as LookupResult;
      setResult(lookupResult);
      writeCache(customerId, lookupResult);
      setCachedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));

      // 조회 성공 시 customers.insurance_grade 자동 갱신 (source: hira_lookup)
      if (lookupResult.grade && lookupResult.grade !== 'unverified') {
        const memo = lookupResult.effective_date
          ? `건보공단 API 자동조회 · 적용일 ${lookupResult.effective_date}`
          : '건보공단 API 자동조회';
        await updateInsuranceGrade(customerId, lookupResult.grade, 'hira_lookup', memo);
        onGradeUpdated?.();
        toast.success('자격등급이 건보공단 API 조회 결과로 갱신되었습니다.');
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setError({
        message: isAbort
          ? '건보 자격조회 일시 불가 — 응답 시간 초과'
          : `건보 자격조회 일시 불가 — ${String(err)}`,
        showFallback: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const gradeLabel = result?.grade
    ? INSURANCE_GRADE_LABELS[result.grade] ?? result.grade
    : null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/30 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-800">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>건보공단 실시간 자격조회</span>
          {result && cachedAt && (
            <span className="font-normal text-blue-500">({cachedAt} 조회)</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {result && (
            <button
              type="button"
              onClick={() => performLookup(true)}
              disabled={loading}
              title="다시 조회"
              className="inline-flex items-center gap-0.5 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-50 transition disabled:opacity-50"
            >
              <RefreshCw className={cn('h-2.5 w-2.5', loading && 'animate-spin')} />
              갱신
            </button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => performLookup(false)}
            disabled={loading || !hiraConsent}
            className={cn(
              'h-7 px-3 text-[11px]',
              !hiraConsent && 'opacity-50 cursor-not-allowed',
            )}
            title={!hiraConsent ? '건보 조회 동의가 필요합니다' : '건보공단 API로 자격 조회'}
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                조회 중…
              </>
            ) : (
              '자격조회'
            )}
          </Button>
        </div>
      </div>

      {/* 조회 결과 */}
      {result && !error && (
        <div className="border-t border-blue-200 bg-white px-3 py-2.5 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {/* 자격등급 */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground shrink-0">자격등급</span>
              <Badge
                variant={result.grade && result.grade !== 'unverified' ? 'teal' : 'secondary'}
                className="text-[10px] px-1.5 py-0"
              >
                {gradeLabel ?? '미확인'}
              </Badge>
            </div>

            {/* 본인부담률 */}
            {result.copayment_rate != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground shrink-0">본인부담률</span>
                <span className="font-semibold text-teal-700 tabular-nums">
                  {result.copayment_rate}%
                </span>
              </div>
            )}

            {/* 적용 시작일 */}
            {result.effective_date && (
              <div className="flex items-center gap-1.5 col-span-2">
                <span className="text-muted-foreground shrink-0">적용 시작일</span>
                <span className="tabular-nums text-gray-700">{result.effective_date}</span>
              </div>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground">
            ※ 건보공단 API 조회 결과 · 자격등급 자동 반영됨
          </div>
        </div>
      )}

      {/* 에러 + fallback */}
      {error && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-2.5 space-y-2">
          <div className="flex items-start gap-1.5">
            <span className="text-red-600 text-xs leading-snug flex-1">{error.message}</span>
          </div>
          {error.showFallback && (
            <a
              href={NHIS_EXTERNAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 transition"
            >
              <ExternalLink className="h-3 w-3" />
              외부 조회 링크 (요양기관 정보마당)
            </a>
          )}
        </div>
      )}

      {/* 미동의 안내 */}
      {!hiraConsent && !result && !error && (
        <div className="border-t border-blue-100 bg-white px-3 py-2 text-[11px] text-muted-foreground">
          건보 조회 동의(Y)를 설정해야 자격조회가 가능합니다.
        </div>
      )}
    </div>
  );
}

/** 에러코드 → 사용자 메시지 변환 */
function resolveErrorMessage(code: string | undefined, detail?: string): string {
  switch (code) {
    case 'RRN_MISSING':
      return '주민등록번호가 입력되지 않았습니다. 고객 차트에서 주민번호를 먼저 입력해 주세요.';
    case 'NHIS_NOT_CONFIGURED':
      return '건보 자격조회 API가 아직 연동되지 않았습니다. 외부 조회 링크를 이용해 주세요.';
    case 'NHIS_API_ERROR':
      return `건보 자격조회 일시 불가 — 외부 조회 링크를 이용해 주세요.${detail ? ` (${detail.slice(0, 80)})` : ''}`;
    case 'UNAUTHORIZED':
      return '인증이 필요합니다. 다시 로그인해 주세요.';
    default:
      return `건보 자격조회 일시 불가 — 외부 조회 링크를 이용해 주세요.${detail ? ` (${detail.slice(0, 80)})` : ''}`;
  }
}

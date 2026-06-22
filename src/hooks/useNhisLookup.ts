/**
 * useNhisLookup — 건보공단 수진자 자격조회 공유 훅
 *
 * T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE
 *   건강보험 조회 3구역 정리 — 자격조회 로직을 1구역(좌측 '건보 조회' 진입점)과
 *   2구역(결과 표시 패널)이 동일 상태로 공유하도록 NhisLookupPanel 내부 로직을 훅으로 추출.
 *   - 트리거(performLookup)는 1구역 버튼 + 셀프접수 동의 이벤트로 일원화.
 *   - 2구역은 동일 controller 의 result/error 만 표시(트리거 버튼 제거 — A안).
 *
 * 원본: NhisLookupPanel (T-20260515-foot-KENBO-API-NATIVE)
 *   AC-2 Edge Function 호출 → 자격등급/본인부담률/적용일 렌더
 *   AC-3 API 장애 graceful degradation (에러 + 외부링크 fallback)
 *   AC-4 sessionStorage 캐시 (TTL 4시간, customer_id 단위)
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { type InsuranceGrade } from '@/lib/insurance';
import { updateInsuranceGrade } from '@/hooks/useInsurance';

/** 건보공단 외부 조회 링크 (요양기관 정보마당) — API 미연동 fallback */
export const NHIS_EXTERNAL_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';
/** 캐시 유효 시간: 4시간 (ms) */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export interface NhisLookupResult {
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
  result: NhisLookupResult;
  ts: number;
}

export interface NhisLookupError {
  message: string;
  showFallback: boolean;
}

/** performLookup 옵션 */
export interface NhisLookupOpts {
  /** true 면 토스트 억제 — 자동 트리거(셀프접수 동의·동의 클릭)에서 사용 */
  silent?: boolean;
  /**
   * true 면 hiraConsent=false 여도 조회 진행.
   * 동의 토글 직후처럼 동의가 막 부여됐지만 prop 이 아직 갱신 전(stale)일 때 사용.
   */
  bypassConsentGate?: boolean;
}

/** 자격조회 controller — 1구역(트리거)·2구역(표시)이 공유 */
export interface NhisLookupController {
  loading: boolean;
  result: NhisLookupResult | null;
  error: NhisLookupError | null;
  cachedAt: string | null;
  performLookup: (forceRefresh?: boolean, opts?: NhisLookupOpts) => Promise<void>;
}

interface UseNhisLookupOptions {
  /** 조회 성공 후 등급 갱신되면 호출 (3구역 자동산정 연쇄 트리거 등) */
  onGradeUpdated?: () => void;
}

function getCacheKey(customerId: string) {
  return `nhis_lookup_v1_${customerId}`;
}

function readCache(customerId: string): NhisLookupResult | null {
  if (!customerId) return null;
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

function writeCache(customerId: string, result: NhisLookupResult) {
  if (!customerId) return;
  try {
    const entry: CacheEntry = { result, ts: Date.now() };
    sessionStorage.setItem(getCacheKey(customerId), JSON.stringify(entry));
  } catch {
    // sessionStorage 쓰기 실패는 무시 (캐시 기능만 비활성)
  }
}

function clearCache(customerId: string) {
  if (!customerId) return;
  try {
    sessionStorage.removeItem(getCacheKey(customerId));
  } catch {
    // ignore
  }
}

/** 에러코드 → 사용자 메시지 변환 */
export function resolveNhisErrorMessage(code: string | undefined, detail?: string): string {
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

export function useNhisLookup(
  customerId: string,
  _clinicId: string,
  hiraConsent: boolean,
  options: UseNhisLookupOptions = {},
): NhisLookupController {
  const { onGradeUpdated } = options;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NhisLookupResult | null>(() => readCache(customerId));
  const [error, setError] = useState<NhisLookupError | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  // customerId 변경(차트 전환) 시 해당 고객 캐시 재반영
  useEffect(() => {
    setResult(readCache(customerId));
    setError(null);
    setCachedAt(null);
  }, [customerId]);

  const performLookup = useCallback(
    async (forceRefresh = false, opts: NhisLookupOpts = {}) => {
      const { silent = false, bypassConsentGate = false } = opts;

      if (!hiraConsent && !bypassConsentGate) {
        if (!silent) {
          toast.warning('건보 조회 동의가 필요합니다. 조회동의를 Y로 설정해 주세요.');
        }
        return;
      }
      if (!customerId) return;

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
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({ customer_id: customerId }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const json: NhisLookupResult | NhisErrorCode = await res.json();

        if (!res.ok) {
          const errJson = json as NhisErrorCode;
          const showFallback = !!errJson.fallback_url || errJson.error === 'NHIS_NOT_CONFIGURED';
          const message = resolveNhisErrorMessage(errJson.error, errJson.detail);
          setError({ message, showFallback });
          return;
        }

        const lookupResult = json as NhisLookupResult;
        setResult(lookupResult);
        writeCache(customerId, lookupResult);
        setCachedAt(
          new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        );

        // 조회 성공 시 customers.insurance_grade 자동 갱신 (source: hira_lookup)
        if (lookupResult.grade && lookupResult.grade !== 'unverified') {
          const memo = lookupResult.effective_date
            ? `건보공단 API 자동조회 · 적용일 ${lookupResult.effective_date}`
            : '건보공단 API 자동조회';
          await updateInsuranceGrade(customerId, lookupResult.grade, 'hira_lookup', memo);
          onGradeUpdated?.();
          if (!silent) {
            toast.success('자격등급이 건보공단 API 조회 결과로 갱신되었습니다.');
          }
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
    },
    [customerId, hiraConsent, onGradeUpdated],
  );

  return { loading, result, error, cachedAt, performLookup };
}

/**
 * useNhisLookup — 건보공단 수진자 자격 "수기 포털조회" 컨트롤러
 *
 * T-20260724-foot-NHIS-PARSER-REMOVE-MANUAL-ONLY (이은상 팀장 confirm=B, 파서 롤백)
 *   붙여넣기 자동파싱(파서) 접근을 롤백한다. 파서가 걸던 이름대조 STRONG 차단 → 거짓 "다른 환자"
 *   경고 + 등급 자동입력 차단의 원인이었다. 이제 데스크 동선은 **수기 선택 only**:
 *     [건보조회] → 포털 딥링크 open + 감사 RPC → 데스크가 포털에서 자격여부를 눈으로 확인 →
 *     우측 '건강보험 자격등급'(InsuranceGradeSelect)에서 등급을 직접 선택 → [저장].
 *   이 훅은 딥링크 open + 감사 개시 + 안내 패널 토글까지만 담당한다(파싱·제안 없음).
 *   확정(write)은 InsuranceGradeSelect → updateInsuranceGrade sink 를 그대로 재사용.
 *
 * 단일 choke point: performLookup(=openCapture). 두 트리거(1구역 버튼·셀프접수 effect)가 여기로
 *   수렴 → 평행경로 재오픈 없음. EF fetch 死호출 없음(nhis-lookup EF 는 동결 유지, 호출만 끊음).
 *
 * RRN·인증서는 CRM/클라우드를 절대 경유하지 않음 — 딥링크까지만, 포털/데스크 PC 내부 종결.
 *
 * 감사(하드가드 #5): 조회 개시(딥링크 open) 시 log_nhis_eligibility_lookup(customer_id) SECDEF RPC.
 *   실패해도 동선 무중단(소프트게이트). PII 미전송 — 인자는 customer_id 1개. (prod 적용 완료, 유지.)
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** 건보공단 수진자자격조회 포털 딥링크 (요양기관 정보마당) */
export const NHIS_EXTERNAL_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';

export interface NhisLookupError {
  message: string;
  showFallback: boolean;
}

/** performLookup 옵션 (하위호환) */
export interface NhisLookupOpts {
  /** true 면 자동 트리거(셀프접수 effect). 수기 조회에선 딥링크 자동 오픈/감사를 하지 않음(팝업차단·오조회 방지) */
  silent?: boolean;
  bypassConsentGate?: boolean;
}

/** 자격 조회 controller — 1구역(트리거)·안내 패널이 공유 */
export interface NhisLookupController {
  /** 인라인 안내 패널 노출 여부 */
  captureOpen: boolean;
  error: NhisLookupError | null;
  /** 하위호환: 항상 false (수기 조회는 비동기 조회 없음). 버튼 disabled 계산용 잔존 */
  loading: boolean;
  /** 조회 개시: 포털 딥링크 open + 안내 패널 노출 + 감사 RPC. (단일 choke point) */
  performLookup: (forceRefresh?: boolean, opts?: NhisLookupOpts) => Promise<void>;
  /** 안내 패널 닫기 */
  closeCapture: () => void;
}

interface UseNhisLookupOptions {
  onGradeUpdated?: () => void;
}

/** 조회 개시 감사(하드가드 #5). 실패해도 동선 무중단(소프트게이트). PII 미전송. */
async function logEligibilityLookup(customerId: string): Promise<void> {
  if (!customerId) return;
  try {
    await supabase.rpc('log_nhis_eligibility_lookup', { p_customer_id: customerId });
  } catch {
    // 감사 실패가 조회 동선을 break 하지 않는다 (§16-4b INV1 / 하드가드 #6).
  }
}

export function useNhisLookup(
  customerId: string,
  _clinicId: string,
  hiraConsent: boolean,
  options: UseNhisLookupOptions = {},
): NhisLookupController {
  void options; // onGradeUpdated 는 확정(InsuranceGradeSelect) 경로에서 처리 — 훅은 딥링크/안내까지만
  const [captureOpen, setCaptureOpen] = useState(false);
  const [error, setError] = useState<NhisLookupError | null>(null);

  // 차트 전환(customerId 변경) 시 안내 상태 초기화 — 이전 환자 잔류 방지(오조회 방어)
  useEffect(() => {
    setCaptureOpen(false);
    setError(null);
  }, [customerId]);

  const performLookup = useCallback(
    async (_forceRefresh = false, opts: NhisLookupOpts = {}) => {
      const { silent = false, bypassConsentGate = false } = opts;
      // 자동 트리거(셀프접수 effect)는 팝업 자동오픈/감사 없이 no-op — 수기 조회는 스태프가 명시 개시.
      if (silent) return;
      if (!hiraConsent && !bypassConsentGate) {
        setError({
          message: '건보 조회 동의가 필요합니다. 조회동의를 Y로 설정해 주세요.',
          showFallback: false,
        });
        return;
      }
      if (!customerId) return;

      setError(null);
      setCaptureOpen(true);

      // 포털 딥링크 새 창 오픈 (RRN/인증서는 포털·데스크 PC 내부 종결, CRM 미경유)
      try {
        window.open(NHIS_EXTERNAL_URL, '_blank', 'noopener,noreferrer');
      } catch {
        // 팝업 차단 등 — 안내 패널 내 링크로 폴백(showFallback)
        setError({
          message: '포털 창을 자동으로 열지 못했습니다. 아래 링크로 열어 주세요.',
          showFallback: true,
        });
      }

      // 조회 개시 감사 (비차단)
      void logEligibilityLookup(customerId);
    },
    [customerId, hiraConsent],
  );

  const closeCapture = useCallback(() => {
    setCaptureOpen(false);
  }, []);

  return {
    captureOpen,
    error,
    loading: false,
    performLookup,
    closeCapture,
  };
}

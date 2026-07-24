/**
 * useNhisLookup — 건보공단 수진자 자격 "수기 포털조회 + 인라인 캡처" 컨트롤러
 *
 * T-20260724-foot-NHIS-MANUAL-CAPTURE (Phase 1) — API 자동조회 pivot
 *   공단 API 자동조회 blocked(전용망+인증서, Deno mTLS 미지원, T-20260716) → 방향 전환:
 *   직원이 공단 포털에서 자격을 **직접 조회**(딥링크) → 결과를 복사 → 2번차트 붙여넣기 칸에
 *   붙여넣으면 파서가 읽어주되 **사람이 최종 확정**. RPA/자동로그인 아님.
 *   RRN·인증서는 CRM/클라우드를 절대 경유하지 않음 — 딥링크까지만, 포털/데스크 PC 내부 종결.
 *
 * 단일 choke point: performLookup(=openCapture). 두 트리거(1구역 버튼·셀프접수 effect)가 여기로
 *   수렴 → 평행경로 재오픈 없음. EF fetch 死호출 제거(nhis-lookup EF 는 동결 유지, 호출만 끊음).
 *
 * 결과 sink: 확정은 기존 updateInsuranceGrade→customers write(source='hira_lookup')+재산정 연쇄를
 *   그대로 재사용(N4). 이 훅은 파서 제안까지만 담당(자동확정 금지).
 *
 * 감사(하드가드 #5): 조회 개시(딥링크 open) 시 log_nhis_eligibility_lookup(customer_id) SECDEF RPC.
 *   실패해도 동선 무중단(소프트게이트). PII 미전송 — 인자는 customer_id 1개.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type InsuranceGrade } from '@/lib/insurance';
import {
  parseAndEvaluate,
  type NhisParsedResult,
  type NhisGuardContext,
} from '@/lib/nhisParse';

/** 건보공단 수진자자격조회 포털 딥링크 (요양기관 정보마당) */
export const NHIS_EXTERNAL_URL = 'https://medicare.nhis.or.kr/portal/refer/selectReferInq.do';

/**
 * 캡처 결과 계약 — cert_no scaffold 바인딩 하위호환 유지.
 * (기존 EF payload 계약 자리. 이제 파서 결과에서 채워짐. copayment_rate/effective_date 는
 *  포털 텍스트에 없어 null. cert_no 는 파서가 채움 → 증번호 칸 자동 바인딩 effect 계속 동작.)
 */
export interface NhisLookupResult {
  grade: InsuranceGrade;
  copayment_rate: number | null;
  effective_date: string | null;
  cert_no?: string | null;
}

export interface NhisLookupError {
  message: string;
  showFallback: boolean;
}

/** performLookup 옵션 (하위호환) */
export interface NhisLookupOpts {
  /** true 면 자동 트리거(셀프접수 effect). 수기 캡처에선 딥링크 자동 오픈/감사를 하지 않음(팝업차단·오조회 방지) */
  silent?: boolean;
  bypassConsentGate?: boolean;
}

/** 붙여넣기 파싱에 필요한 고객 컨텍스트(신원대조·나이가드) */
export interface NhisCaptureContext {
  customerName?: string | null;
  birthDateDisplay?: string | null;
}

/** 자격 캡처 controller — 1구역(트리거)·캡처 UI 가 공유 */
export interface NhisLookupController {
  /** 인라인 캡처 UI 노출 여부 */
  captureOpen: boolean;
  /** 파싱 결과 (평문 에코 + 경고 + 제안 등급) */
  parsed: NhisParsedResult | null;
  error: NhisLookupError | null;
  /** cert_no scaffold 바인딩 하위호환 — 파서가 채운 결과 */
  result: NhisLookupResult | null;
  /** 하위호환: 항상 false (수기 캡처는 비동기 조회 없음). 버튼 disabled 계산용 잔존 */
  loading: boolean;
  /** 조회 개시: 포털 딥링크 open + 캡처 UI 노출 + 감사 RPC. (단일 choke point) */
  performLookup: (forceRefresh?: boolean, opts?: NhisLookupOpts) => Promise<void>;
  /** 캡처 UI 닫기 */
  closeCapture: () => void;
  /** 붙여넣은 평문 파싱 → parsed 갱신 */
  applyPaste: (rawText: string, ctx: NhisCaptureContext) => void;
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
  void options; // onGradeUpdated 는 확정(InsuranceGradeSelect) 경로에서 처리 — 훅은 파싱까지만
  const [captureOpen, setCaptureOpen] = useState(false);
  const [parsed, setParsed] = useState<NhisParsedResult | null>(null);
  const [error, setError] = useState<NhisLookupError | null>(null);

  // 차트 전환(customerId 변경) 시 캡처 상태 초기화 — 이전 환자 결과 잔류 방지(오조회 방어)
  useEffect(() => {
    setCaptureOpen(false);
    setParsed(null);
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
        // 팝업 차단 등 — 캡처 UI 내 링크로 폴백(showFallback)
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

  const applyPaste = useCallback((rawText: string, ctx: NhisCaptureContext) => {
    const guardCtx: NhisGuardContext = {
      customerName: ctx.customerName ?? null,
      birthDateDisplay: ctx.birthDateDisplay ?? null,
    };
    const res = parseAndEvaluate(rawText, guardCtx, Date.now());
    setParsed(res);
  }, []);

  // cert_no scaffold 바인딩 하위호환: 파서가 증번호를 읽으면 result.cert_no 로 노출 →
  //   CustomerChartPage 의 기존 useEffect(nhis.result?.cert_no) 가 증번호 칸에 자동 채움.
  const result = useMemo<NhisLookupResult | null>(() => {
    if (!parsed) return null;
    return {
      grade: (parsed.suggestedGrade ?? 'unverified') as InsuranceGrade,
      copayment_rate: null,
      effective_date: parsed.acquiredDate,
      cert_no: parsed.certNo,
    };
  }, [parsed]);

  return {
    captureOpen,
    parsed,
    error,
    result,
    loading: false,
    performLookup,
    closeCapture,
    applyPaste,
  };
}

/**
 * NhisLookupPanel — 건보공단 수진자 자격조회 Native 렌더링
 *
 * T-20260515-foot-KENBO-API-NATIVE
 * T-20260622-foot-HEALTHINS-3ZONE-CONSOLIDATE:
 *   조회 로직을 useNhisLookup 훅으로 분리. 본 패널은 controller 주입 시 외부 상태를 표시(2구역 결과뷰),
 *   미주입 시 내부 훅으로 단독 동작(기존 CheckInDetailSheet 사용처 — 변동 없음).
 *   - controller prop: 1구역(트리거)과 공유하는 자격조회 상태. 트리거 일원화.
 *   - hideTrigger prop: true 면 '자격조회'/'갱신' 버튼 숨김 → 결과 표시 전용(A안 2구역).
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

import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { INSURANCE_GRADE_LABELS } from '@/lib/insurance';
import {
  NHIS_EXTERNAL_URL,
  useNhisLookup,
  type NhisLookupController,
} from '@/hooks/useNhisLookup';

interface Props {
  customerId: string;
  clinicId: string;
  hiraConsent: boolean;
  /** 조회 완료 후 부모 컴포넌트에 등급 변경 알림 (내부 훅 모드에서만 사용) */
  onGradeUpdated?: () => void;
  /**
   * 외부에서 주입한 자격조회 controller.
   * 제공 시 내부 훅 대신 이 상태를 표시 — 1구역(트리거)과 동일 상태 공유(2구역 결과뷰).
   */
  controller?: NhisLookupController;
  /**
   * true 면 '자격조회'/'갱신' 트리거 버튼을 숨김.
   * 2구역 A안: 트리거는 1구역으로 일원화하고 여기서는 결과만 표시.
   */
  hideTrigger?: boolean;
}

export function NhisLookupPanel({
  customerId,
  clinicId,
  hiraConsent,
  onGradeUpdated,
  controller,
  hideTrigger = false,
}: Props) {
  // controller 미주입 시 내부 훅으로 단독 동작 (기존 사용처 호환).
  // 주의: hooks 규칙상 항상 호출하되, controller 가 있으면 그 값을 우선 사용.
  const internal = useNhisLookup(customerId, clinicId, hiraConsent, { onGradeUpdated });
  const { loading, result, error, cachedAt, performLookup } = controller ?? internal;

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

        {/* 트리거 버튼 — hideTrigger(2구역 A안)면 숨김. 트리거는 1구역으로 일원화. */}
        {!hideTrigger && (
          <div className="flex items-center gap-1.5">
            {result && (
              <button
                type="button"
                onClick={() => performLookup(true)}
                disabled={loading}
                title="다시 조회"
                className="inline-flex items-center gap-0.5 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] text-neutral-700 hover:bg-neutral-100 transition disabled:opacity-50"
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
        )}

        {/* hideTrigger 모드(2구역)에서 로딩 표시 — 1구역 트리거로 조회 진행 중 */}
        {hideTrigger && loading && (
          <span className="inline-flex items-center gap-1 text-[10px] text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            조회 중…
          </span>
        )}
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
              className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 transition"
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

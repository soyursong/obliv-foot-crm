// InsuranceStatusPanel — 약품 급여여부(보험상태) 인라인 편집 패널 (SSOT)
// Ticket: T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE (AC-1/AC-2)
//
// 추출 출처: InsuranceStatusTab(제거됨)의 "선택 약품 + 급여여부 설정" 패널.
//   급여여부 mutation/STATUS 정의를 이 파일 단일 SSOT 로 통합(AC-2 "중복 분기 금지").
//   재사용처: DrugFoldersTab [전체보기] 우측 단(인라인 편집). 향후 다른 화면도 codeId 만 넘기면 동일 동작.
//
// 데이터 모델: prescription_codes.insurance_status / insurance_status_updated_at / insurance_status_source.
//   write = prescription_codes_admin_all RLS(is_admin_or_manager: admin/manager/director).
//   ※ 본 패널 write 노출은 호출부 canWrite 게이트(admin/manager)와 RLS 가 이중 가드. 저장은 항상 source='manual'.
// 게이트 소비측(checkRxInsuranceGate, 3진입점)은 본 패널이 채운 상태를 즉시 소비 — 게이트 로직 무변경(AC-3).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatDateTimeDots } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import {
  type InsuranceStatus,
  insuranceStatusLabel,
  isInsuranceBlockedStatus,
} from '@/lib/prescriptionGate';
import { Loader2, Pill, X, BadgeX } from 'lucide-react';

// 상태 선택지 — covered(통과) + 차단 3종. '미설정'은 별도 [해제] 버튼으로(NULL).
//   (구 InsuranceStatusTab.STATUS_OPTIONS 계승 — covered/non_covered/deleted/criteria_changed)
export const INSURANCE_STATUS_OPTIONS: InsuranceStatus[] = [
  'covered',
  'non_covered',
  'deleted',
  'criteria_changed',
];

export const INSURANCE_STATUS_STYLE: Record<InsuranceStatus, string> = {
  covered: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  non_covered: 'text-amber-700 border-amber-200 bg-amber-50',
  deleted: 'text-red-700 border-red-200 bg-red-50',
  criteria_changed: 'text-orange-700 border-orange-200 bg-orange-50',
};

const INSURANCE_STATUS_ACTIVE_STYLE: Record<InsuranceStatus, string> = {
  covered: 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-500',
  non_covered: 'bg-amber-500 text-white border-amber-500 hover:bg-amber-500',
  deleted: 'bg-red-500 text-white border-red-500 hover:bg-red-500',
  criteria_changed: 'bg-orange-500 text-white border-orange-500 hover:bg-orange-500',
};

interface RxCodeStatus {
  id: string;
  name_ko: string;
  claim_code: string | null;
  insurance_status: string | null;
  insurance_status_updated_at: string | null;
  insurance_status_source: string | null;
}

interface InsuranceStatusPanelProps {
  /** prescription_codes.id (필수) */
  codeId: string;
  /** 표시용 약품명 (fresh 조회 전 즉시 표기) */
  nameKo: string;
  /** 표시용 청구코드 */
  claimCode?: string | null;
  /** 편집 권한(admin/manager). false 면 읽기전용(버튼 비활성). RLS 와 이중 가드. */
  canWrite: boolean;
  /** 닫기(우측 패널 해제). 미지정 시 X 버튼 숨김. */
  onClose?: () => void;
  /** 저장 성공 콜백 — 호출부 목록(badge 등) 갱신용. */
  onSaved?: () => void;
}

export default function InsuranceStatusPanel({
  codeId,
  nameKo,
  claimCode,
  canWrite,
  onClose,
  onSaved,
}: InsuranceStatusPanelProps) {
  const qc = useQueryClient();

  // 선택 약품의 최신 급여상태 재조회(저장 후 즉시 반영). InsuranceStatusTab 동일 쿼리키 재사용.
  const { data: current } = useQuery({
    queryKey: ['rx_insurance_status', codeId],
    enabled: !!codeId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_codes')
        .select(
          'id,name_ko,claim_code,insurance_status,insurance_status_updated_at,insurance_status_source',
        )
        .eq('id', codeId)
        .single();
      if (error) throw error;
      return data as RxCodeStatus;
    },
  });

  // 급여상태 저장(수동) — source='manual', updated_at=now. (구 InsuranceStatusTab.upsert 로직 그대로)
  const upsert = useMutation({
    mutationFn: async (status: InsuranceStatus | null) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('prescription_codes')
        .update({
          insurance_status: status,
          insurance_status_updated_at: new Date().toISOString(),
          insurance_status_source: 'manual', // 수동 변경은 항상 manual 기록
        })
        .eq('id', codeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rx_insurance_status', codeId] });
      toast.success('급여여부가 저장됐어요.');
      onSaved?.();
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });

  const displayName = current?.name_ko ?? nameKo;
  const displayCode = current?.claim_code ?? claimCode ?? null;
  const currentStatus = (current?.insurance_status ?? null) as InsuranceStatus | null;

  return (
    <div className="rounded-lg border bg-card" data-testid="insurance-selected-panel">
      {/* 선택 약품 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <Pill className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="text-sm font-semibold truncate" data-testid="insurance-selected-name">
            {displayName}
          </span>
          {displayCode && (
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{displayCode}</span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            data-testid="insurance-clear-selected"
            aria-label="선택 해제"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 현재 상태 + 차단상태 경고 배너 */}
      <div className="px-3 py-2.5 border-b flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">현재 급여여부</span>
        <Badge
          variant="outline"
          className={`text-[11px] h-5 px-2 ${
            currentStatus ? INSURANCE_STATUS_STYLE[currentStatus] : 'text-muted-foreground border-border'
          }`}
          data-testid="insurance-current-badge"
        >
          {currentStatus ? insuranceStatusLabel(currentStatus) : '미설정 (게이트 통과)'}
        </Badge>
        {isInsuranceBlockedStatus(currentStatus) && (
          <span className="ml-auto flex items-center gap-1 text-red-600">
            <BadgeX className="h-3.5 w-3.5" />
            처방 시 경고+차단
          </span>
        )}
      </div>

      {/* 상태 선택 버튼 */}
      <div className="px-3 py-3 space-y-2">
        <Label className="text-xs font-semibold">급여여부 설정</Label>
        {!canWrite && (
          <p className="text-[10px] text-muted-foreground" data-testid="insurance-readonly-note">
            읽기 전용 — 급여여부 편집 권한이 없습니다.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2" data-testid="insurance-status-toggle">
          {INSURANCE_STATUS_OPTIONS.map((s) => {
            const active = currentStatus === s;
            return (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                disabled={!canWrite || upsert.isPending}
                onClick={() => upsert.mutate(s)}
                aria-pressed={active}
                className={`justify-start ${active ? INSURANCE_STATUS_ACTIVE_STYLE[s] : INSURANCE_STATUS_STYLE[s]}`}
                data-testid={`insurance-status-btn-${s}`}
              >
                {insuranceStatusLabel(s)}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-1">
          <p className="text-[10px] text-muted-foreground">
            {current?.insurance_status_updated_at
              ? `최근 변경: ${formatDateTimeDots(current.insurance_status_updated_at)}`
              : '변경 이력 없음'}
            {current?.insurance_status_source ? ` · 출처 ${current.insurance_status_source}` : ''}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canWrite || upsert.isPending || !current?.insurance_status}
            onClick={() => upsert.mutate(null)}
            className="text-xs text-muted-foreground"
            data-testid="insurance-status-clear-btn"
          >
            {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            미설정으로 해제
          </Button>
        </div>
      </div>
    </div>
  );
}

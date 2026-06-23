// PastHistoryTab — 의사 진료차트 '과거력' 탭 (T-20260623-foot-DOCCHART-PASTHX-TAB)
//
// 데이터 흐름:
//   1) health_q_results(read-only) → computePastHxFromHealthQ → 자동 prefill 초안.
//   2) 실장(canEdit) 더블체크 — 라인별 (-/+) 토글 + 자유 코멘트 → '확정/저장' → patient_past_history INSERT(append-only).
//   3) 의사 뷰 — 최신 확정값 read-only 표시. 미확정(확정 row 없음)이면 "질문지 자동초안(미확정)" 시각 구분.
//
// ★ 자동 prefill 은 초안일 뿐 — 확정 게이트가 SSOT(AC-3 GUARD). health_q_results 원본 수정 없음(AC-4).

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  PAST_HX_ITEMS,
  computePastHxFromHealthQ,
  normalizePastHxLines,
  formatPastHxText,
  emptyPastHxLines,
  type PastHxLines,
  type PastHxState,
} from '@/lib/pastHistory';
import type { PatientPastHistory } from '@/lib/types';

// ── 최신 발건강 질문지(read-only) ── (OpinionDocTab.useLatestHealthQ 컨벤션 미러)
function useLatestHealthQ(clinicId: string | null, customerId: string | null) {
  return useQuery<Record<string, unknown> | null>({
    queryKey: ['pasthx_latest_healthq', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return null;
      const { data, error } = await supabase
        .from('health_q_results')
        .select('form_data, submitted_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as { form_data?: Record<string, unknown> } | null;
      return row?.form_data ?? null;
    },
    staleTime: 30_000,
  });
}

// ── 최신 확정 과거력 1건(append-only → confirmed_at DESC LIMIT 1) ──
function useLatestPastHx(clinicId: string | null, customerId: string | null) {
  return useQuery<PatientPastHistory | null>({
    queryKey: ['pasthx_latest_confirmed', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return null;
      const { data, error } = await supabase
        .from('patient_past_history')
        .select('id, clinic_id, customer_id, lines, comment, confirmed_by, confirmed_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .order('confirmed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PatientPastHistory | null;
    },
    staleTime: 10_000,
  });
}

function useSavePastHx(clinicId: string | null, customerId: string | null) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ lines, comment }: { lines: PastHxLines; comment: string }) => {
      if (!clinicId || !customerId) throw new Error('clinic/customer 정보 없음');
      const { error } = await supabase.from('patient_past_history').insert({
        clinic_id: clinicId,
        customer_id: customerId,
        lines,
        comment: comment.trim() || null,
        confirmed_by: profile?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pasthx_latest_confirmed', clinicId, customerId] });
      toast.success('과거력 확정 저장 완료');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

export interface PastHistoryTabProps {
  customerId: string | null;
  clinicId: string | null;
  /** 실장(manager)·대표원장·admin = 편집 가능. 그 외(봉직의 등) = 조회. */
  canEdit: boolean;
}

export default function PastHistoryTab({ customerId, clinicId, canEdit }: PastHistoryTabProps) {
  const { data: formData, isLoading: hqLoading } = useLatestHealthQ(clinicId, customerId);
  const { data: confirmed, isLoading: pphLoading } = useLatestPastHx(clinicId, customerId);
  const save = useSavePastHx(clinicId, customerId);

  const isConfirmed = !!confirmed;

  // 편집 로컬 상태 — 확정값 있으면 그걸, 없으면 질문지 자동 초안을 출발점.
  const [lines, setLines] = useState<PastHxLines>(emptyPastHxLines());
  const [comment, setComment] = useState('');
  const [synced, setSynced] = useState(false);

  // 로딩 완료 후 1회 동기화 (확정값 우선 → 없으면 자동 prefill).
  useEffect(() => {
    if (hqLoading || pphLoading || synced) return;
    if (confirmed) {
      setLines(normalizePastHxLines(confirmed.lines));
      setComment(confirmed.comment ?? '');
    } else {
      setLines(computePastHxFromHealthQ(formData));
      setComment('');
    }
    setSynced(true);
  }, [hqLoading, pphLoading, synced, confirmed, formData]);

  if (hqLoading || pphLoading) {
    return (
      <div className="flex justify-center py-8" data-testid="pasthx-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggle = (key: keyof PastHxLines) => {
    setLines((prev) => ({ ...prev, [key]: (prev[key] === '+' ? '-' : '+') as PastHxState }));
  };

  // ── 의사 조회 모드 (canEdit=false) ──
  if (!canEdit) {
    return (
      <div className="space-y-3 pt-3" data-testid="pasthx-readonly">
        <StatusBadge isConfirmed={isConfirmed} />
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm font-sans" data-testid="pasthx-text">
          {formatPastHxText(lines)}
        </pre>
        {comment.trim() && (
          <div className="rounded-md border bg-amber-50 p-3 text-sm whitespace-pre-wrap" data-testid="pasthx-comment-view">
            {comment}
          </div>
        )}
      </div>
    );
  }

  // ── 실장 편집 모드 (canEdit=true) ──
  return (
    <div className="space-y-4 pt-3" data-testid="pasthx-edit">
      <StatusBadge isConfirmed={isConfirmed} />

      {/* 라인별 (-/+) 토글 */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">과거력 항목 (실장 더블체크)</Label>
        <div className="grid grid-cols-2 gap-2">
          {PAST_HX_ITEMS.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => toggle(it.key)}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                lines[it.key] === '+'
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : 'border-border bg-background text-muted-foreground'
              }`}
              data-testid={`pasthx-toggle-${it.key}`}
            >
              <span className="flex items-center gap-1">
                {it.label}
                {!it.autoSource && (
                  <span className="text-[9px] text-muted-foreground">(수동)</span>
                )}
              </span>
              <span className="font-mono font-semibold">{lines[it.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 미리보기 (현장 원문 포맷) */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">표시 미리보기</Label>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm font-sans" data-testid="pasthx-preview">
          {formatPastHxText(lines)}
        </pre>
      </div>

      {/* 자유 코멘트 */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">코멘트</Label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={'*유방암 항암 6년중\n*당뇨약 10년째 복용중, 혈당 정상범위내'}
          className="text-sm min-h-[90px] resize-none"
          data-testid="pasthx-comment-input"
        />
      </div>

      <Button
        onClick={() => save.mutate({ lines, comment })}
        disabled={save.isPending}
        className="w-full"
        data-testid="pasthx-confirm-btn"
      >
        {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
        확정/저장
      </Button>
    </div>
  );
}

function StatusBadge({ isConfirmed }: { isConfirmed: boolean }) {
  return isConfirmed ? (
    <Badge className="bg-green-100 text-green-700 border-0 text-[11px] gap-1" data-testid="pasthx-status-confirmed">
      <CheckCircle2 className="h-3 w-3" /> 확정
    </Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-700 border-0 text-[11px] gap-1" data-testid="pasthx-status-draft">
      <AlertCircle className="h-3 w-3" /> 질문지 자동초안 (미확정)
    </Badge>
  );
}

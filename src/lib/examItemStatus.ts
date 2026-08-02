// examItemStatus.ts — 치료테이블 [균검사]/[피검사] 접수 항목 행 액션(보류/신청취소/재검사) 상태 레이어.
// Ticket: T-20260726-foot-TREATTABLE-TESTITEM-ACTIONS-3BTN
//
// 상태 영속 = form_submissions(field_data JSONB) 재사용(신규 스키마 0, no-DDL) — T-20260724 LABTAB-SPLIT 패턴.
//   template_id NULL + field_data.form_key=<tab별 키> + field_data.request_date + field_data.item_status.
//   키 = customer_id × request_date (접수 리스트 행 grain 과 1:1). 접수 체크박스 row(blood_reception_daily)
//   와는 별 form_key row 로 분리 → 선행 LABTAB-BLOODLIST-4FIX 접수/서류 로직 무회귀(오버레이 레이어).
//
// 확정 스펙(2026-07-26 김주연 총괄, MSG-20260726-165316-xaz6) 상태 전이:
//   신청됨(active)    --[보류]----> 보류중(hold)        : 기존 행 상태 전이
//   신청됨(active)    --[신청취소]-> 취소됨(cancelled)   : soft-cancel(상태 전이, hard-DELETE 금지)
//   보류중(hold)      --[재검사]---> 신청됨(active)       : 기존 행 재활성(신규 row 없음)
//   취소됨(cancelled) --[재검사]---> 신규 접수 row       : 기존 INSERT 경로(request_*_for_customer RPC) 재사용
//     (신규 신청=오늘자 생성 → 취소 행과 다른 request_date → 별 행 활성. 동일자 재검사 edge 는 field-soak 수렴.)
//   · 보류 해제 = 별도 버튼 없음, [재검사]로 신청됨 복귀(Q1-b 확정).
//   · 권한 = 권한 A(최상위/관리자 tier) 만 — permissions.canActOnExamItem 게이트.

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ExamItemStatus = 'active' | 'hold' | 'cancelled';

// 접수 리스트 행 grain = customer × 검사신청일. 두 탭 공통 키.
export function examItemRowKey(customerId: string, requestDate: string): string {
  return `${customerId}__${requestDate}`;
}

export interface ExamItemStatusEntry {
  id: string | null; // form_submissions.id (없으면 미저장 = 기본 active)
  status: ExamItemStatus;
}

// 상태별 표시 메타(확정 Q3): 보류중=회색 배경+[보류] 뱃지 / 취소됨=취소선+회색+[취소] 뱃지.
export const EXAM_STATUS_META: Record<
  Exclude<ExamItemStatus, 'active'>,
  { label: string; badgeClass: string; rowClass: string }
> = {
  hold: {
    label: '보류',
    badgeClass: 'border-amber-300 bg-amber-100 text-amber-800',
    rowClass: 'bg-muted/50 text-muted-foreground',
  },
  cancelled: {
    label: '취소',
    badgeClass: 'border-neutral-300 bg-neutral-200 text-neutral-600',
    rowClass: 'bg-muted/40 text-muted-foreground line-through opacity-70',
  },
};

/** 행 상태 → tr className 오버레이(active=빈 문자열). */
export function examRowStatusClass(status: ExamItemStatus): string {
  if (status === 'active') return '';
  return EXAM_STATUS_META[status].rowClass;
}

// 접수 항목 상태 read — form_submissions(field_data.form_key=formKey). 키=customer_id×request_date.
//   방어성: 테이블/컬럼 미적용 prod(42P01/42703) → 빈 Map 폴백(섹션 무파손).
export function useExamItemStatuses(clinicId: string | null | undefined, formKey: string) {
  return useQuery<Map<string, ExamItemStatusEntry>>({
    queryKey: ['exam_item_status', clinicId, formKey],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, ExamItemStatusEntry>();
      if (!clinicId) return map;
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, field_data')
        .eq('clinic_id', clinicId)
        .eq('is_deleted', false)
        .contains('field_data', { form_key: formKey });
      if (error) {
        if (/form_submissions|relation|42P01|42703/.test(error.message ?? '')) return map;
        throw error;
      }
      for (const r of (data ?? []) as Array<{ id: string; customer_id: string; field_data: Record<string, unknown> | null }>) {
        const fd = r.field_data ?? {};
        const cid = String(r.customer_id ?? '');
        const reqDate = String(fd['request_date'] ?? '');
        if (!cid || !reqDate) continue;
        const raw = String(fd['item_status'] ?? 'active');
        const status: ExamItemStatus = raw === 'hold' || raw === 'cancelled' ? raw : 'active';
        map.set(examItemRowKey(cid, reqDate), { id: r.id, status });
      }
      return map;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 접수 항목 상태 저장 — 없으면 INSERT, 있으면 field_data.item_status UPDATE(soft, DELETE 없음). 낙관적 반영.
export function usePersistExamItemStatus(clinicId: string | null | undefined, formKey: string) {
  const qc = useQueryClient();
  const key = ['exam_item_status', clinicId, formKey] as const;
  return useMutation({
    mutationFn: async ({
      customerId,
      requestDate,
      checkInId,
      status,
    }: {
      customerId: string;
      requestDate: string;
      checkInId: string | null;
      status: ExamItemStatus;
    }) => {
      if (!clinicId) throw new Error('클리닉 정보가 없습니다.');
      const cache = qc.getQueryData<Map<string, ExamItemStatusEntry>>(key);
      const cur = cache?.get(examItemRowKey(customerId, requestDate));
      const fieldData = { form_key: formKey, request_date: requestDate, item_status: status };
      if (cur?.id) {
        const { error } = await supabase.from('form_submissions').update({ field_data: fieldData }).eq('id', cur.id);
        if (error) throw error;
        return { id: cur.id };
      }
      const { data, error } = await supabase
        .from('form_submissions')
        .insert({
          clinic_id: clinicId,
          customer_id: customerId,
          check_in_id: checkInId,
          template_id: null,
          field_data: fieldData,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;
      return { id: (data as { id: string }).id };
    },
    onMutate: async ({ customerId, requestDate, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Map<string, ExamItemStatusEntry>>(key);
      const rk = examItemRowKey(customerId, requestDate);
      const next = new Map(prev ?? []);
      const cur = next.get(rk) ?? { id: null, status: 'active' as ExamItemStatus };
      next.set(rk, { ...cur, status });
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: ({ id }, { customerId, requestDate }) => {
      // INSERT 로 새로 생긴 id 를 캐시에 반영(다음 전이가 UPDATE 경로 타도록).
      const rk = examItemRowKey(customerId, requestDate);
      const cache = qc.getQueryData<Map<string, ExamItemStatusEntry>>(key);
      if (cache && !cache.get(rk)?.id) {
        const next = new Map(cache);
        next.set(rk, { ...(next.get(rk) ?? { status: 'active' as ExamItemStatus }), id });
        qc.setQueryData(key, next);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

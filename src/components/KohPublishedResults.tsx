// KohPublishedResults — 2번차트 검사결과 탭에 발행된 균검사 결과지(검사결과 보고서) 목록
// Ticket: T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4)
//
// 발행(publish_koh_result)된 form_submissions(template=koh_result, status='published')는 customer_id로
//   연결되어 본 고객의 검사결과 탭에 자동 표시(현장 표현 "자동 업로드"). 각 항목 [보기/인쇄] 가능.
//   발행 = 비가역(AC-5) → 본 목록은 읽기전용(삭제·수정 UI 없음).
//
// 마이그(koh_result 템플릿) 미적용 시 템플릿 조회가 빈값 → 목록 빈 상태(폴백, 에러 미표출).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FlaskConical, Printer } from 'lucide-react';
import { seoulISODate } from '@/lib/format';
import { printKohResult } from '@/lib/printKohResult';

interface PublishedRow {
  id: string;
  field_data: Record<string, unknown>;
  created_at: string;
}

function usePublishedKohForCustomer(clinicId: string | null, customerId: string | null) {
  return useQuery<PublishedRow[]>({
    queryKey: ['koh_published_customer', clinicId, customerId],
    enabled: !!clinicId && !!customerId,
    queryFn: async () => {
      if (!clinicId || !customerId) return [];
      // koh_result 템플릿 id 확보 — 마이그 미적용 시 없음 → 빈 목록.
      const { data: tpl } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'koh_result')
        .limit(1)
        .maybeSingle();
      if (!tpl?.id) return [];
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data, created_at')
        .eq('clinic_id', clinicId)
        .eq('customer_id', customerId)
        .eq('template_id', tpl.id)
        .eq('status', 'published')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
        id: String(r['id']),
        field_data: (r['field_data'] ?? {}) as Record<string, unknown>,
        created_at: String(r['created_at'] ?? ''),
      }));
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export default function KohPublishedResults({
  clinicId,
  customerId,
}: {
  clinicId: string | null;
  customerId: string | null;
}) {
  const { data: rows = [], isLoading } = usePublishedKohForCustomer(clinicId, customerId);

  if (isLoading || rows.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white p-3 text-xs" data-testid="koh-published-results">
      <div className="mb-2 flex items-center gap-1.5 font-bold text-teal-800">
        <FlaskConical className="h-3.5 w-3.5 text-teal-600" />
        발행된 검사결과 보고서
        <span className="text-[10px] font-normal text-muted-foreground">({rows.length}건)</span>
      </div>
      <ul className="divide-y">
        {rows.map((r) => {
          const reqNo = String(r.field_data['request_no'] ?? '—');
          const specimen = String(r.field_data['specimen_type'] ?? '');
          const collected = String(r.field_data['collected_date'] ?? seoulISODate(r.created_at));
          return (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 py-1.5"
              data-testid="koh-published-item"
            >
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-semibold text-foreground">{reqNo}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {collected}
                  {specimen ? ` · ${specimen}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const ok = printKohResult(r.field_data);
                  if (!ok) {
                    // 팝업 차단 등 — 조용히 무시(현장 재시도). toast 미사용(컴포넌트 경량 유지).
                    window.alert('팝업이 차단되어 결과지를 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[10px] font-medium text-teal-700 transition hover:bg-teal-100"
                data-testid="koh-published-print"
              >
                <Printer className="h-3 w-3" /> 보기/인쇄
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

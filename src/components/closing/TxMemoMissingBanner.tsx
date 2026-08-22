// T-20260822-foot-CLOSING-TXMEMO-MISSING-ALERT (기능 B, 김주연 총괄 field-decided)
//
// 일마감 '총 매출(치료)' 섹션 최상단 배너 — 당일(마감 영업일) 회차 차감됐으나 특이사항(치료메모)
// 미작성 건을 빨간색으로 노출 + 개수 카운터 + [확인하기] → 미작성 고객 목록(바로 작성 이동).
//
//   AC1: N>0 시 "특이사항 미작성 N건 — 확인하기" 배너. [확인하기] → 목록 펼침 → 고객 클릭 시
//        해당 차트(/chart/:id)로 이동해 바로 작성 가능. N=0 시 미노출(null).
//   AC2: 미작성 건 빨간색 시각 표시 + 카운터.
//   AC4: display-only. 매출 합계/payload 렌더에 무개입(read-only 별도 쿼리, sum 미참조).
//   AC5: read-only, 기존 clinic-scoped RLS 내 (txMemoMissing.ts).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, PencilLine } from 'lucide-react';
import { fetchTxMemoMissing } from '@/lib/txMemoMissing';
import { sessionTypeLabel } from '@/lib/opinionRequest';

interface Props {
  clinicId: string | null | undefined;
  /** 마감 영업일 yyyy-MM-dd (Closing 의 date). */
  date: string;
}

export default function TxMemoMissingBanner({ clinicId, date }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const { data } = useQuery({
    queryKey: ['closing-txmemo-missing', clinicId, date],
    enabled: !!clinicId && !!date,
    queryFn: () => fetchTxMemoMissing(clinicId, date),
    staleTime: 30_000,
  });

  const count = data?.count ?? 0;
  if (count === 0) return null; // AC1/AC4: 0건이면 배너 미노출 (회귀 시 sum 화면 무변경)

  return (
    <div
      className="rounded-lg border border-red-300 bg-red-50 text-red-800"
      data-testid="txmemo-missing-banner"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        data-testid="txmemo-missing-toggle"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
        <span className="text-[15px] font-semibold">
          특이사항 미작성{' '}
          <span className="text-red-600" data-testid="txmemo-missing-count">
            {count}건
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1 text-[13px] font-medium text-red-700">
          확인하기
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <ul className="border-t border-red-200 divide-y divide-red-100" data-testid="txmemo-missing-list">
          {(data?.customers ?? []).map((c) => (
            <li key={c.customer_id}>
              <button
                type="button"
                onClick={() => navigate(`/chart/${c.customer_id}`)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-red-100 transition"
                data-testid="txmemo-missing-row"
              >
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="text-[14px] font-semibold text-red-900">{c.name}</span>
                  {c.chart_number && (
                    <span className="ml-2 text-[12px] text-red-500">#{c.chart_number}</span>
                  )}
                  {c.session_types.length > 0 && (
                    <span className="ml-2 text-[12px] text-red-600">
                      {c.session_types.map((t) => sessionTypeLabel(t) || t).join(', ')}
                    </span>
                  )}
                </span>
                <PencilLine className="h-4 w-4 shrink-0 text-red-500" />
                <span className="text-[12px] font-medium text-red-700">작성</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

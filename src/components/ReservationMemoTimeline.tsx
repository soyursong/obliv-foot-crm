// T-20260515-foot-RESV-MEMO-APPEND
// T-20260520-foot-RESV-MEMO-WALKIN: customer_id fallback — 예약 없는 워크인도 메모 작성 가능
// T-20260521-foot-WALKIN-MEMO-GAP: check_in_id fallback — customer_id도 없는 수기 워크인 지원
// 예약메모 누적 히스토리 타임라인 컴포넌트 (append-only)
// - reservation_memo_history 테이블에서 이력 조회
// - 최신 메모 상단 표시
// - 하단 입력 필드로 새 메모 추가
// - 우선순위: reservationId → customerId → checkInId

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';

export interface MemoHistoryItem {
  id: string;
  reservation_id: string | null;
  customer_id?: string | null;
  check_in_id?: string | null;
  content: string;
  created_by_name: string | null;
  created_at: string;
}

interface Props {
  /** 예약 ID (있을 때만 전달 — 없으면 customerId fallback) */
  reservationId?: string | null;
  /** 예약 없는 고객(워크인)의 customer_id fallback (T-20260520-foot-RESV-MEMO-WALKIN) */
  customerId?: string | null;
  /** customer_id도 없는 수기 워크인의 check_in_id 3순위 fallback (T-20260521-foot-WALKIN-MEMO-GAP) */
  checkInId?: string | null;
  clinicId: string;
  /** 현재 로그인 사용자 표시 이름 */
  authorName: string;
  /** compact=true 이면 히스토리 최대 3개, 나머지는 "…더 보기" */
  compact?: boolean;
  /** 삽입 성공 후 외부 상태 동기화 콜백 (optional) */
  onAdded?: () => void;
}

export function ReservationMemoTimeline({
  reservationId,
  customerId,
  checkInId,
  clinicId,
  authorName,
  compact = false,
  onAdded,
}: Props) {
  const [items, setItems] = useState<MemoHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputVal, setInputVal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // T-20260520-foot-RESV-MEMO-WALKIN: reservationId → customer_id 순 fallback
  // T-20260521-foot-WALKIN-MEMO-GAP: → check_in_id 3순위 fallback (customer_id도 없는 수기 워크인)
  const effectiveKey = reservationId
    ? `resv:${reservationId}`
    : customerId
    ? `cust:${customerId}`
    : checkInId
    ? `ci:${checkInId}`
    : null;

  // effectiveKey 없으면 로딩 상태 초기화
  useEffect(() => {
    if (!effectiveKey) setLoading(false);
  }, [effectiveKey]);

  useEffect(() => {
    if (!effectiveKey) return;
    let cancelled = false;
    setLoading(true);
    const query = supabase
      .from('reservation_memo_history')
      .select('id, reservation_id, customer_id, check_in_id, content, created_by_name, created_at')
      .order('created_at', { ascending: false });

    // T-20260521-foot-WALKIN-MEMO-GAP: 3순위 fallback — reservation_id → customer_id → check_in_id
    const filteredQuery = reservationId
      ? query.eq('reservation_id', reservationId)
      : customerId
      ? query.eq('customer_id', customerId)
      : query.eq('check_in_id', checkInId!);

    filteredQuery.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('[ReservationMemoTimeline] fetch error', error);
      } else {
        setItems((data as MemoHistoryItem[]) ?? []);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [effectiveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMemo = async () => {
    const content = inputVal.trim();
    if (!content) return;
    if (!reservationId && !customerId && !checkInId) return;
    setSubmitting(true);

    // T-20260520-foot-RESV-MEMO-WALKIN: reservationId 있으면 reservation 기준, 없으면 customer 기준
    // T-20260521-foot-WALKIN-MEMO-GAP: customer_id도 없으면 check_in_id 기준
    const insertPayload = reservationId
      ? { reservation_id: reservationId, clinic_id: clinicId, content, created_by_name: authorName || null }
      : customerId
      ? { customer_id: customerId, clinic_id: clinicId, content, created_by_name: authorName || null }
      : { check_in_id: checkInId, clinic_id: clinicId, content, created_by_name: authorName || null };

    const { data, error } = await supabase
      .from('reservation_memo_history')
      .insert(insertPayload)
      .select('id, reservation_id, customer_id, content, created_by_name, created_at')
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(`메모 저장 실패: ${error.message}`);
      return;
    }
    setItems((prev) => [data as MemoHistoryItem, ...prev]);
    setInputVal('');
    onAdded?.();
  };

  const displayItems = compact && !expanded ? items.slice(0, 3) : items;
  const hasMore = compact && !expanded && items.length > 3;

  return (
    <div className="space-y-2">
      {/* 히스토리 타임라인 */}
      {loading ? (
        <div className="text-xs text-muted-foreground py-1">불러오는 중…</div>
      ) : displayItems.length > 0 ? (
        <div className="space-y-1.5">
          {displayItems.map((item) => (
            <div
              key={item.id}
              className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs"
            >
              <span className="text-amber-600 font-medium tabular-nums mr-1">
                [{format(new Date(item.created_at), 'MM/dd HH:mm')}
                {item.created_by_name ? ` ${item.created_by_name}` : ''}]
              </span>
              <span className="whitespace-pre-wrap text-gray-800">{item.content}</span>
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs text-teal-600 hover:underline"
            >
              …{items.length - 3}개 더 보기
            </button>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">메모 없음</div>
      )}

      {/* 새 메모 입력 */}
      <div className="flex gap-1.5 items-start pt-1">
        <Textarea
          ref={textareaRef}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              addMemo();
            }
          }}
          placeholder="새 메모 입력 (Ctrl+Enter로 추가)"
          rows={2}
          className="text-xs flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs border-teal-300 text-teal-700 hover:bg-teal-50 shrink-0"
          onClick={addMemo}
          disabled={submitting || !inputVal.trim() || !effectiveKey}
          data-testid="memo-add-btn"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 mr-0.5" />
          추가
        </Button>
      </div>
    </div>
  );
}

/**
 * 예약 생성 시 아직 ID가 없는 경우 사용하는 단순 입력 버전.
 * 예약 저장 후 삽입을 외부(caller)에서 처리한다.
 */
export function ReservationMemoInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="예약메모 (저장 시 기록에 추가됨)"
      className="text-sm"
    />
  );
}

/** helper: 새 예약 저장 후 초기 메모를 이력에 삽입 */
export async function insertReservationMemo(
  reservationId: string,
  clinicId: string,
  content: string,
  authorName: string | null,
): Promise<void> {
  if (!content.trim()) return;
  const { error } = await supabase.from('reservation_memo_history').insert({
    reservation_id: reservationId,
    clinic_id: clinicId,
    content: content.trim(),
    created_by_name: authorName || null,
  });
  if (error) {
    console.error('[insertReservationMemo] error', error);
    toast.error('예약메모 저장 실패 (예약은 등록됨)');
  }
}

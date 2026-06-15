// T-20260515-foot-RESV-MEMO-APPEND
// T-20260520-foot-RESV-MEMO-WALKIN: customer_id fallback — 예약 없는 워크인도 메모 작성 가능
// T-20260521-foot-WALKIN-MEMO-GAP: check_in_id fallback — customer_id도 없는 수기 워크인 지원
// T-20260522-foot-ALT-BADGE: is_pinned/pinned_at — 히스토리 메모 고정 기능 (AC-9, AC-10)
// 예약메모 누적 히스토리 타임라인 컴포넌트 (append-only)
// - reservation_memo_history 테이블에서 이력 조회
// - 고정 메모 최상단 표시 (is_pinned=true), 나머지는 created_at DESC
// - 하단 입력 필드로 새 메모 추가
// - 우선순위: reservationId → customerId → checkInId
// - [고정] 버튼은 히스토리 형태(reservation_memo_history rows)에만 표시 (AC-10)
//   단건/일반 텍스트 메모(customers.customer_memo)에는 고정 기능 없음

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { MessageSquarePlus, Pin, PinOff } from 'lucide-react';
import { toast } from '@/lib/toast';
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
  // T-20260522-foot-ALT-BADGE AC-9,10: 고정 기능
  is_pinned: boolean;
  pinned_at: string | null;
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
  /**
   * T-20260615-foot-RESVPOPUP-DETAIL-8FIX AC7: 비고정 메모 색상 톤.
   * - 'amber'(기본): 기존 동작(주황 박스) — 타 4개 서피스 호환 유지.
   * - 'neutral': 예약상세 팝업 통일 — 컬러 텍스트 제거, 전체 흐름과 동일한 기본 색상.
   */
  tone?: 'amber' | 'neutral';
}

// T-20260522-foot-ALT-BADGE AC-10: 고정 정렬 — is_pinned 먼저(pinned_at DESC), 나머지 created_at DESC
function sortMemoItems(items: MemoHistoryItem[]): MemoHistoryItem[] {
  const pinned = items.filter((i) => i.is_pinned).sort((a, b) => {
    if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
    return 0;
  });
  const rest = items.filter((i) => !i.is_pinned).sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
  return [...pinned, ...rest];
}

export function ReservationMemoTimeline({
  reservationId,
  customerId,
  checkInId,
  clinicId,
  authorName,
  compact = false,
  onAdded,
  tone = 'amber',
}: Props) {
  const [items, setItems] = useState<MemoHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputVal, setInputVal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [togglingPinId, setTogglingPinId] = useState<string | null>(null);
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
    // T-20260522-foot-ALT-BADGE: is_pinned, pinned_at 포함해서 조회
    const query = supabase
      .from('reservation_memo_history')
      .select('id, reservation_id, customer_id, check_in_id, content, created_by_name, created_at, is_pinned, pinned_at')
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
        setItems(sortMemoItems((data as MemoHistoryItem[]) ?? []));
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
      .select('id, reservation_id, customer_id, content, created_by_name, created_at, is_pinned, pinned_at')
      .single();
    setSubmitting(false);
    if (error) {
      toast.error(`메모 저장 실패: ${error.message}`);
      return;
    }
    setItems((prev) => sortMemoItems([data as MemoHistoryItem, ...prev]));
    setInputVal('');
    onAdded?.();
  };

  // T-20260522-foot-ALT-BADGE AC-9: 고정/해제 토글
  const togglePin = useCallback(async (item: MemoHistoryItem) => {
    setTogglingPinId(item.id);
    const newPinned = !item.is_pinned;
    const { error } = await supabase
      .from('reservation_memo_history')
      .update({
        is_pinned: newPinned,
        pinned_at: newPinned ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
    setTogglingPinId(null);
    if (error) {
      toast.error(`고정 ${newPinned ? '설정' : '해제'} 실패: ${error.message}`);
      return;
    }
    setItems((prev) =>
      sortMemoItems(
        prev.map((i) =>
          i.id === item.id
            ? { ...i, is_pinned: newPinned, pinned_at: newPinned ? new Date().toISOString() : null }
            : i
        )
      )
    );
  }, []);

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
              className={`rounded border px-2 py-1.5 text-xs ${
                item.is_pinned
                  ? 'border-teal-300 bg-teal-50'
                  : tone === 'neutral'
                    ? 'border-border bg-card'
                    : 'border-amber-200 bg-amber-50'
              }`}
              data-testid={item.is_pinned ? 'memo-pinned' : 'memo-item'}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <span className={`font-medium tabular-nums mr-1 ${item.is_pinned ? 'text-teal-700' : tone === 'neutral' ? 'text-muted-foreground' : 'text-amber-600'}`}>
                    {item.is_pinned && (
                      <Pin className="inline h-3 w-3 mr-0.5 text-teal-600 shrink-0" />
                    )}
                    [{format(new Date(item.created_at), 'MM/dd HH:mm')}
                    {item.created_by_name ? ` ${item.created_by_name}` : ''}]
                  </span>
                  <span className="whitespace-pre-wrap text-gray-800">{item.content}</span>
                </div>
                {/* T-20260522-foot-ALT-BADGE AC-10: [고정] 버튼 — 히스토리 메모에만 표시 */}
                <button
                  type="button"
                  onClick={() => togglePin(item)}
                  disabled={togglingPinId === item.id}
                  title={item.is_pinned ? '고정 해제' : '최상단 고정'}
                  className={`shrink-0 rounded p-0.5 transition ${
                    item.is_pinned
                      ? 'text-teal-600 hover:bg-teal-100'
                      : 'text-gray-400 hover:text-teal-600 hover:bg-teal-50'
                  } disabled:opacity-40`}
                  data-testid={item.is_pinned ? 'memo-unpin-btn' : 'memo-pin-btn'}
                >
                  {item.is_pinned ? (
                    <PinOff className="h-3.5 w-3.5" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
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

/** T-20260522-foot-ALT-BADGE AC-11: ALT ON 시 고정 메모 삽입 helper */
export async function insertAltPinnedMemo(opts: {
  customerId: string;
  reservationId?: string | null;
  clinicId: string;
  altDetail: string | null;
  authorName: string | null;
}): Promise<void> {
  const content = `ALT 대상 — ${opts.altDetail?.trim() || '상세내용 없음'}`;
  const { error } = await supabase.from('reservation_memo_history').insert({
    ...(opts.reservationId ? { reservation_id: opts.reservationId } : {}),
    customer_id: opts.customerId,
    clinic_id: opts.clinicId,
    content,
    created_by_name: opts.authorName || null,
    is_pinned: true,
    pinned_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[insertAltPinnedMemo] error', error);
    toast.error('ALT 고정 메모 저장 실패');
  }
}

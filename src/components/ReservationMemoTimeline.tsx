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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MessageSquarePlus, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { formatDateTimeDots } from '@/lib/format';

// T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC2: 상단 통합 [저장]이 예약메모 입력칸의 미저장 내용을
// 새 히스토리 행으로 flush 할 수 있도록 노출하는 imperative handle. 입력이 비어 있으면 no-op(true).
export interface ReservationMemoTimelineHandle {
  /** 입력칸에 남은 내용을 히스토리에 추가. 빈 입력=성공(true), 추가 성공=true, 실패=false */
  flushPending: () => Promise<boolean>;
}

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
   * T-20260615-foot-RESVPOPUP-DETAIL-8FIX AC7 → T-20260629-foot-CHART1-FORMAT-UNIFY AC-3:
   * 비고정 메모 톤은 쿨그레이 모노톤(border-border bg-card)으로 전면 통일. amber(주황) 분기 폐지 —
   * 노란색 완전 제거(총괄 지시 MSG-20260629-170324). tone prop 제거(모든 서피스 단일 모노톤).
   */
  /**
   * T-20260624-foot-CHART2-RESVMEMO-UNIFY-MEMO-UI AC-1: 입력부 레이아웃을 2번차트 1구역 고객메모와 동일하게 통일.
   * - false(기본): 기존 동작(textarea + 우측 teal [추가] 버튼 side-by-side).
   * - true: 라벨/버튼 우측 상단 컴팩트 회색([추가]) + textarea 하단 full-width — 고객메모 칸과 한 세트 정렬.
   */
  unifyInput?: boolean;
  /**
   * T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC2: 인라인 [추가] 버튼 숨김.
   * 2번차트는 상단 통합 [저장] 1회로 flush(ReservationMemoTimelineHandle.flushPending) → 개별 [추가] 제거.
   * 미설정(기본)이면 기존 [추가] 버튼 유지(타 surface 영향 없음).
   */
  hideAddButton?: boolean;
  /**
   * T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC3: 히스토리 섹션 컴팩트(간격·폰트·패딩 축소).
   * 미설정(기본)이면 기존 간격 유지.
   */
  denseHistory?: boolean;
  /**
   * T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC4: 히스토리 항목 [수정]/[삭제] 노출.
   * 수정=기존 행 content UPDATE, 삭제=기존 행 hard DELETE(reservation_memo_history는 soft-delete 컬럼 없음).
   * 미설정(기본)이면 버튼 미노출(타 surface 영향 없음).
   */
  editable?: boolean;
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

export const ReservationMemoTimeline = forwardRef<ReservationMemoTimelineHandle, Props>(function ReservationMemoTimeline({
  reservationId,
  customerId,
  checkInId,
  clinicId,
  authorName,
  compact = false,
  onAdded,
  unifyInput = false,
  hideAddButton = false,
  denseHistory = false,
  editable = false,
}: Props, ref) {
  const [items, setItems] = useState<MemoHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputVal, setInputVal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [togglingPinId, setTogglingPinId] = useState<string | null>(null);
  // T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC4: 히스토리 항목 수정/삭제 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // flushPending이 항상 최신 inputVal/submitting을 읽도록 ref 동기화
  const inputValRef = useRef(inputVal);
  inputValRef.current = inputVal;

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

  const addMemo = async (): Promise<boolean> => {
    const content = inputVal.trim();
    if (!content) return true; // 빈 입력 = flush 대상 없음(성공 취급)
    if (!reservationId && !customerId && !checkInId) return false;
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
      return false;
    }
    setItems((prev) => sortMemoItems([data as MemoHistoryItem, ...prev]));
    setInputVal('');
    onAdded?.();
    return true;
  };

  // T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC2: 상단 통합 [저장]에서 입력칸 미저장 내용 flush.
  //   빈 입력=true(no-op). 항상 최신 inputVal을 ref로 읽어 stale-closure 방지.
  useImperativeHandle(ref, () => ({
    flushPending: async () => {
      if (!inputValRef.current.trim()) return true;
      return addMemo();
    },
  }), [addMemo]);

  // T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC4: 히스토리 항목 수정(기존 행 content UPDATE)
  const startEdit = (item: MemoHistoryItem) => { setEditingId(item.id); setEditingText(item.content); };
  const cancelEdit = () => { setEditingId(null); setEditingText(''); };
  const saveEdit = async (item: MemoHistoryItem) => {
    const content = editingText.trim();
    if (!content) { toast.error('내용을 입력해주세요'); return; }
    setSavingEditId(item.id);
    const { error } = await supabase
      .from('reservation_memo_history')
      .update({ content })
      .eq('id', item.id);
    setSavingEditId(null);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    setItems((prev) => sortMemoItems(prev.map((i) => (i.id === item.id ? { ...i, content } : i))));
    setEditingId(null);
    setEditingText('');
    onAdded?.(); // 1번차트 등 외부 동기화 재사용
  };

  // T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC4: 히스토리 항목 삭제.
  //   reservation_memo_history는 soft-delete 컬럼(deleted_at) 없음 → 기존 행 hard DELETE.
  //   (risk_reason "히스토리 수정/삭제=기존 행 UPDATE/DELETE CRUD"·db_change=false 정합. RLS rmh_clinic_access FOR ALL 커버)
  const deleteMemo = async (item: MemoHistoryItem) => {
    if (!window.confirm('이 예약메모를 삭제하시겠습니까?')) return;
    setDeletingId(item.id);
    const { error } = await supabase
      .from('reservation_memo_history')
      .delete()
      .eq('id', item.id);
    setDeletingId(null);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (editingId === item.id) cancelEdit();
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
  // T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC3: denseHistory 시 간격·폰트·패딩 축소
  const itemPad = denseHistory ? 'px-1.5 py-1' : 'px-2 py-1.5';
  const itemFont = denseHistory ? 'text-[11px]' : 'text-xs';
  const listGap = denseHistory ? 'space-y-1' : 'space-y-1.5';

  return (
    <div className={denseHistory ? 'space-y-1.5' : 'space-y-2'}>
      {/* 히스토리 타임라인 */}
      {loading ? (
        <div className="text-xs text-muted-foreground py-1">불러오는 중…</div>
      ) : displayItems.length > 0 ? (
        <div className={listGap}>
          {displayItems.map((item) => (
            <div
              key={item.id}
              className={`rounded border ${itemPad} ${itemFont} ${
                item.is_pinned
                  ? 'border-teal-300 bg-teal-50'
                  : 'border-border bg-card'
              }`}
              data-testid={item.is_pinned ? 'memo-pinned' : 'memo-item'}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <span className={`font-medium tabular-nums mr-1 ${item.is_pinned ? 'text-teal-700' : 'text-muted-foreground'}`}>
                    {item.is_pinned && (
                      <Pin className="inline h-3 w-3 mr-0.5 text-teal-600 shrink-0" />
                    )}
                    [{formatDateTimeDots(item.created_at)}
                    {item.created_by_name ? ` ${item.created_by_name}` : ''}]
                  </span>
                  {/* AC4: 수정 모드면 인라인 편집, 아니면 내용 표시 */}
                  {editable && editingId === item.id ? (
                    <div className="mt-1 space-y-1">
                      <Textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={2}
                        className="text-[11px] resize-none"
                        data-testid="memo-edit-input"
                      />
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingEditId === item.id}
                          className="rounded border border-gray-300 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          data-testid="memo-edit-cancel-btn"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(item)}
                          disabled={savingEditId === item.id || !editingText.trim()}
                          className="rounded bg-[#666666] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#757575] disabled:opacity-40"
                          data-testid="memo-edit-save-btn"
                        >
                          {savingEditId === item.id ? '저장 중…' : '저장'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap text-gray-800">{item.content}</span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* AC4: [수정]/[삭제] — editable 일 때만(타 surface 미노출). 편집 중엔 숨김 */}
                  {editable && editingId !== item.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        title="수정"
                        className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                        data-testid="memo-edit-btn"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMemo(item)}
                        disabled={deletingId === item.id}
                        title="삭제"
                        className="rounded p-0.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        data-testid="memo-delete-btn"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {/* T-20260522-foot-ALT-BADGE AC-10: [고정] 버튼 — 히스토리 메모에만 표시 */}
                  <button
                    type="button"
                    onClick={() => togglePin(item)}
                    disabled={togglingPinId === item.id}
                    title={item.is_pinned ? '고정 해제' : '최상단 고정'}
                    className={`rounded p-0.5 transition ${
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
      {unifyInput ? (
        /* T-20260624-foot-CHART2-RESVMEMO-UNIFY-MEMO-UI AC-1: 1구역 고객메모 칸과 동일 레이아웃·톤.
           우측 상단 컴팩트 회색 [추가] 버튼 + 하단 full-width textarea(text-[11px]). 노란색/teal 제거. */
        <div className="pt-1">
          {/* T-20260630-foot-CHART2-LABELCENTER-SAVEMERGE-MEMOHIST AC2: hideAddButton 시 개별 [추가] 제거(상단 통합 저장이 flush) */}
          {!hideAddButton && (
            <div className="flex items-center justify-end mb-1">
              <button
                type="button"
                onClick={addMemo}
                disabled={submitting || !inputVal.trim() || !effectiveKey}
                data-testid="memo-add-btn"
                className="rounded bg-[#666666] text-white px-2.5 py-0.5 text-[11px] font-medium hover:bg-[#757575] transition disabled:opacity-50"
              >
                {submitting ? '저장 중…' : '추가'}
              </button>
            </div>
          )}
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
            placeholder={hideAddButton ? '새 메모 입력 (상단 [저장] 시 함께 저장 · Ctrl+Enter로 즉시 추가)' : '새 메모 입력 (Ctrl+Enter로 추가)'}
            rows={2}
            className="text-[11px] resize-none"
          />
        </div>
      ) : (
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
      )}
    </div>
  );
});

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

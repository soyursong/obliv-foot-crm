// T-20260629-foot-CHART1-MEMO-INPUT-UNIFY
// 고객메모(customers.customer_memo)·기타메모(customers.memo) — 단일 text 컬럼을
// 예약메모(ReservationMemoTimeline)식 "한 줄 입력창 + [추가] + 누적 리스트" UI로 통일.
//
// 설계 (현장 A안, 김주연 총괄 MSG-20260629-185639-wlpt):
//   - 단일 text 컬럼을 줄(\n) 단위로 분해해 누적 항목으로 표시 (마이그 손실 0 — 기존 값 줄 분리만, DB 스키마 변경 없음).
//   - [추가](Ctrl+Enter 동일)는 입력 한 줄을 컬럼에 append 후 즉시 persist — 예약메모와 동작 일관(즉시 저장).
//   - 입력부 레이아웃·data-testid 는 ReservationMemoTimeline 기본(non-unify)과 동일하게 미러링.
//   - 예약메모는 row-backed(reservation_memo_history) 이라 ReservationMemoTimeline 그대로 사용 — 본 컴포넌트는
//     컬럼-backed(고객/기타메모) 전용. 두 백엔드를 한 컴포넌트로 섞지 않아 예약메모 동작·타 서피스 회귀 0.

import { useRef, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** 단일 text 컬럼을 누적 항목(줄 단위)으로 파싱. 공백 줄 제거, 원문 보존(trimEnd만). */
export function parseColumnMemoItems(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

interface Props {
  /** 현재 컬럼 원문 (controlled — 부모 상태와 동기화) */
  value: string;
  /** [추가] 시 부모가 컬럼에 append + persist + 상태/연동 처리. 한 줄(line)을 받음. */
  onAppend: (line: string) => Promise<void> | void;
  /** persist 진행 중 (버튼 비활성/문구) */
  saving?: boolean;
  /** customerId 없음 등으로 추가 불가 */
  disabled?: boolean;
  placeholder?: string;
  /** compact=true 이면 누적 항목 최대 3개, 나머지는 "…더 보기" (예약메모 compact와 동일) */
  compact?: boolean;
}

export function CustomerColumnMemo({
  value,
  onAppend,
  saving = false,
  disabled = false,
  placeholder,
  compact = false,
}: Props) {
  const [inputVal, setInputVal] = useState('');
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const items = parseColumnMemoItems(value);
  const displayItems = compact && !expanded ? items.slice(0, 3) : items;
  const hasMore = compact && !expanded && items.length > 3;

  const handleAdd = async () => {
    const line = inputVal.trim();
    if (!line || disabled || saving) return;
    await onAppend(line);
    setInputVal('');
  };

  return (
    <div className="space-y-2">
      {/* 누적 항목 리스트 — 예약메모 카드 chrome 미러링 (쿨그레이 모노톤, 컬럼-backed라 시각·작성자 메타는 없음).
          T-20260629-foot-CHART1-FORMAT-UNIFY AC-3: amber(노란색) → border-border bg-card 모노톤 통일. */}
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {displayItems.map((content, i) => (
            <div
              key={i}
              className="rounded border border-border bg-card px-2 py-1.5 text-xs"
              data-testid="memo-item"
            >
              <span className="whitespace-pre-wrap text-gray-800">{content}</span>
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

      {/* 새 메모 입력 — ReservationMemoTimeline 기본 레이아웃과 동일 (textarea flex-1 + teal [추가]) */}
      <div className="flex gap-1.5 items-start pt-1">
        <Textarea
          ref={textareaRef}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder ?? '새 메모 입력'}
          rows={2}
          className="text-xs flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs border-teal-300 text-teal-700 hover:bg-teal-50 shrink-0"
          onClick={handleAdd}
          disabled={saving || !inputVal.trim() || disabled}
          data-testid="memo-add-btn"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 mr-0.5" />
          추가
        </Button>
      </div>
    </div>
  );
}

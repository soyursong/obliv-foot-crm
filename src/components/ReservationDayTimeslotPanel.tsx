// T-20260614-foot-RESVPOPUP-TIMESLOT-PICKER AC1/AC2: 예약상세팝업 미니캘린더 날짜클릭 → 시간대별 예약현황 패널.
//   ⚠️ read-only(현황 표시 전용). 예약경로 write 입력란 신설 금지(GUARD). reservations read + 시간대 집계만.
//   ⚠️ 이 패널은 DB write 0 — AC2 시간 선택은 onSelectTime 콜백으로 부모(ReservationDetailPopup)에 시간만 버블업.
//      실제 reservation_time update(저장)는 부모가 anchor 예약에 수행(쓰기 책임 격리 유지).
//   시간대별 초/재/힐러 카운트 = RESVCAL-DISPLAY-REWORK item2 슬롯집계 로직 재사용(@/lib/resvSlotAgg, 중복 구현 금지).
//
//   [field clarify 확정 — slack reply ts=1781796980.363939]
//   - Q1 슬롯 단위 = 30분 단위 → 기존 슬롯집계(@/lib/resvSlotAgg, 30분 정규화 toSlotKey) 재사용. 신규 슬롯로직 금지.
//   - Q2 마감 표시 = 불필요(예약 현황 숫자만) → '마감' 라벨/최대인원 로직 미구현(카운트만 표기 유지).
//   - Q3 시간 선택 저장 = 저장 O → onSelectTime 으로 선택 시간(HH:mm) 버블업, 부모가 reservation_time update.
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { aggregateByTimeSlot, type SlotKindCount } from '@/lib/resvSlotAgg';

interface TimeslotRow {
  reservation_time: string;
  visit_type: string; // 'new'|'returning'|'experience' 등 — resvKind 가 분류
  // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF(Option A): is_healer_intent(영속) = 힐러 분류 SSOT.
  // AC4: 운영 DB 미배포 시 fallback 컬럼셋엔 부재 → optional. resvKind 가 undefined graceful 처리.
  is_healer_intent?: boolean | null;
  healer_flag: boolean | null;
  status: 'confirmed' | 'checked_in' | 'cancelled' | 'noshow';
}

export function ReservationDayTimeslotPanel({
  date,
  clinicId,
  selectedTime = null,
  onSelectTime,
}: {
  /** 미니캘린더에서 선택된 날짜. null 이면 안내문만 표시. */
  date: Date | null;
  /** 지점 스코프 — 해당 지점 예약만 집계. */
  clinicId: string;
  /** AC2: 현재 선택된 시간대(HH:mm). 하이라이트 표시용. */
  selectedTime?: string | null;
  /**
   * AC2: 시간대 선택 콜백(HH:mm). 제공되면 슬롯 행이 클릭 가능(선택 모드)으로 전환.
   * 미제공이면 read-only 현황 표시(AC1 기존 동작 — 신규모드 패널 등). DB write 는 부모 책임.
   */
  onSelectTime?: (time: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Array<{ time: string; counts: SlotKindCount }>>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!date) {
      setSlots([]);
      setErr(null);
      return;
    }
    let cancelled = false;
    const dateStr = format(date, 'yyyy-MM-dd');
    (async () => {
      setLoading(true);
      setErr(null);
      // AC1 read-only: 선택 일자 전체 예약 read(지점 스코프). 신규 write 경로 없음.
      // T-20260615-foot-RESVPOPUP-DETAIL-8FIX AC4 RC: is_healer_intent 컬럼이 운영 DB에 미반영(마이그 미적용)이면
      //   PostgREST 42703(undefined_column)으로 전체 select가 400 → "예약 현황을 불러오지 못했습니다" 표시(현장 신고 증상).
      //   ⇒ FE 내성화: 1차 시도 실패(컬럼 누락) 시 is_healer_intent 제외 컬럼셋으로 재조회.
      //      resvKind 는 is_healer_intent undefined 를 graceful 처리(healer_flag fallback) → 분류 정확도 유지.
      const FULL_COLS = 'reservation_time, visit_type, is_healer_intent, healer_flag, status';
      const FALLBACK_COLS = 'reservation_time, visit_type, healer_flag, status';
      const primary = await supabase
        .from('reservations')
        .select(FULL_COLS)
        .eq('clinic_id', clinicId)
        .eq('reservation_date', dateStr);
      // FULL/FALLBACK 컬럼셋이 서로 다른 추론 타입을 가지므로 공통 느슨한 타입으로 받아 재할당 안전화.
      let rows = primary.data as Record<string, unknown>[] | null;
      let error = primary.error;
      // 42703 = undefined_column (is_healer_intent 미배포). 컬럼 제외 후 재시도.
      if (error && (error.code === '42703' || /is_healer_intent/.test(error.message ?? ''))) {
        const retry = await supabase
          .from('reservations')
          .select(FALLBACK_COLS)
          .eq('clinic_id', clinicId)
          .eq('reservation_date', dateStr);
        rows = retry.data as Record<string, unknown>[] | null;
        error = retry.error;
      }
      if (cancelled) return;
      if (error) {
        setErr('예약 현황을 불러오지 못했습니다');
        setSlots([]);
        setLoading(false);
        return;
      }
      setSlots(aggregateByTimeSlot((rows ?? []) as unknown as TimeslotRow[]));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, clinicId]);

  if (!date) {
    return (
      <div className="text-[11px] text-muted-foreground italic px-1 py-2" data-testid="popup-timeslot-empty">
        날짜를 선택하면 시간대별 예약 현황이 표시됩니다.
      </div>
    );
  }

  const selectable = typeof onSelectTime === 'function';

  return (
    <div className="mt-2" data-testid="popup-timeslot-panel">
      <div className="text-[11px] font-semibold text-teal-700 mb-1.5 px-0.5">
        {format(date, 'M월 d일')} 시간대별 예약 현황
        {selectable && (
          <span className="ml-1 font-normal text-muted-foreground">— 시간대를 클릭해 예약 시간을 선택하세요</span>
        )}
      </div>
      {loading ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1 py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> 불러오는 중…
        </div>
      ) : err ? (
        <div className="text-[11px] text-red-500 px-1 py-2">{err}</div>
      ) : slots.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic px-1 py-2">
          이 날짜에 예약이 없습니다.
        </div>
      ) : (
        <div className="space-y-0.5 max-h-44 overflow-y-auto pr-0.5">
          {slots.map(({ time, counts }) => (
            <TimeslotLine
              key={time}
              time={time}
              counts={counts}
              selected={selectable && selectedTime === time}
              onSelect={selectable ? () => onSelectTime!(time) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 한 시간대 행: `10:00 — 초진 2 / 재진 3 / 힐러 1`. 0건 유형은 흐리게.
 *  AC2: onSelect 제공 시 클릭 가능(button) — 선택 시 teal 하이라이트. 미제공 시 read-only div(AC1). */
function TimeslotLine({
  time,
  counts,
  selected = false,
  onSelect,
}: {
  time: string;
  counts: SlotKindCount;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const baseClass = cn(
    'flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] w-full text-left',
    selected
      ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-400'
      : 'bg-card border-border/50',
    onSelect && !selected && 'hover:border-teal-300 hover:bg-teal-50/40 cursor-pointer transition-colors',
  );
  const inner = (
    <>
      <span className="font-semibold tabular-nums text-foreground w-11 flex-shrink-0">{time}</span>
      <span className="text-muted-foreground">—</span>
      <span className="flex items-center gap-1.5 flex-wrap">
        <KindChip dotClass="bg-emerald-500" label="초진" value={counts.n} />
        <span className="text-border">/</span>
        <KindChip dotClass="bg-blue-500" label="재진" value={counts.r} />
        <span className="text-border">/</span>
        <KindChip dotClass="bg-yellow-400" label="힐러" value={counts.h} />
        {counts.o > 0 && (
          <>
            <span className="text-border">/</span>
            <KindChip dotClass="bg-amber-500" label="기타" value={counts.o} />
          </>
        )}
      </span>
      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
        총 {counts.total}
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={baseClass}
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`popup-timeslot-row-${time}`}
        data-selected={selected ? 'true' : 'false'}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={baseClass} data-testid={`popup-timeslot-row-${time}`}>
      {inner}
    </div>
  );
}

function KindChip({ dotClass, label, value }: { dotClass: string; label: string; value: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1', value === 0 && 'opacity-40')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      <span className="text-foreground">
        {label} <span className="tabular-nums font-medium">{value}</span>
      </span>
    </span>
  );
}

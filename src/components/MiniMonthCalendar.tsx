// T-20260611-foot-RESVPOPUP-2ZONE-SEARCH-CALENDAR AC-3: 예약상세 팝업용 미니 월간 캘린더.
//   기존 CalendarNoticePanel 의 month-grid 패턴(date-fns + grid-cols-7 + teal 선택)을 그대로 재사용하되,
//   네비게이션/공지 결합 없이 순수 presentational(onSelect 콜백)로 분리.
//   목적: 팝업을 닫지 않고 일자 선택·확인(예약 가능 일자 확인). 신규 예약 생성 로직 없음(L-002 무관).
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const WEEK_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function MiniMonthCalendar({
  value,
  onSelect,
  markedDates,
}: {
  /** 선택된 날짜 (없으면 미선택) */
  value: Date | null;
  /** 날짜 클릭 콜백 */
  onSelect: (d: Date) => void;
  /** 표시 강조할 날짜(yyyy-MM-dd) — 예: 이 고객의 기존 예약일. 점(dot)으로 표기 */
  markedDates?: string[];
}) {
  const [currentDate, setCurrentDate] = useState<Date>(() => value ?? new Date());

  const calendarDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }),
  });
  const marked = new Set(markedDates ?? []);

  return (
    <div className="select-none" data-testid="popup-mini-calendar">
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          onClick={() => setCurrentDate((d) => subMonths(d, 1))}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label="이전 달"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs font-semibold">
          {format(currentDate, 'yyyy년 M월', { locale: ko })}
        </span>
        <button
          type="button"
          onClick={() => setCurrentDate((d) => addMonths(d, 1))}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label="다음 달"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 mb-0.5">
        {WEEK_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'text-center text-[10px] font-medium py-0.5',
              i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-muted-foreground',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isToday = isSameDay(day, new Date());
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = value ? isSameDay(day, value) : false;
          const isMarked = marked.has(dateKey);
          const dow = day.getDay();

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelect(day)}
              className={cn(
                'relative w-full py-1 text-[11px] font-medium rounded-full transition-colors leading-none aspect-square flex items-center justify-center',
                !isCurrentMonth && 'opacity-25',
                isSelected && 'bg-teal-600 text-white',
                !isSelected && isToday && 'bg-teal-100 text-teal-800 font-bold',
                !isSelected && !isToday && dow === 0 && isCurrentMonth && 'text-red-500',
                !isSelected && !isToday && dow === 6 && isCurrentMonth && 'text-blue-500',
                !isSelected && !isToday && isCurrentMonth && dow > 0 && dow < 6 && 'text-foreground',
                !isSelected && 'hover:bg-muted',
              )}
            >
              {format(day, 'd')}
              {isMarked && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-teal-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

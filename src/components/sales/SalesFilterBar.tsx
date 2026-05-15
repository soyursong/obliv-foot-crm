/**
 * T-20260515-foot-SALES-COMMON-DB
 * 매출집계 공통 글로벌 필터 바
 * - DateRangePicker (기간 선택: 오늘/이번주/이번달/직접입력)
 * - 환자명·차트번호 검색바
 * - 엑셀 다운로드 버튼 (외부 onExport 콜백)
 */

import { useState } from 'react';
import { Download, Search, CalendarDays, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

export interface SalesDateRange {
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD
}

export interface SalesFilterState {
  dateRange: SalesDateRange;
  searchQuery: string;
}

interface Props {
  value: SalesFilterState;
  onChange: (next: SalesFilterState) => void;
  onExport?: () => void;
  exporting?: boolean;
  className?: string;
}

type Preset = 'today' | 'week' | 'month' | 'custom';

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

function getPresetRange(preset: Preset): SalesDateRange | null {
  const now = new Date();
  if (preset === 'today') return { from: fmt(now), to: fmt(now) };
  if (preset === 'week') {
    return {
      from: fmt(startOfWeek(now, { weekStartsOn: 1 })),
      to: fmt(endOfWeek(now, { weekStartsOn: 1 })),
    };
  }
  if (preset === 'month') {
    return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
  }
  return null;
}

function detectPreset(range: SalesDateRange): Preset {
  const now = new Date();
  if (range.from === fmt(now) && range.to === fmt(now)) return 'today';
  if (
    range.from === fmt(startOfWeek(now, { weekStartsOn: 1 })) &&
    range.to === fmt(endOfWeek(now, { weekStartsOn: 1 }))
  )
    return 'week';
  if (range.from === fmt(startOfMonth(now)) && range.to === fmt(endOfMonth(now))) return 'month';
  return 'custom';
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번주' },
  { key: 'month', label: '이번달' },
  { key: 'custom', label: '직접입력' },
];

export function SalesFilterBar({ value, onChange, onExport, exporting, className }: Props) {
  const [showCustom, setShowCustom] = useState(detectPreset(value.dateRange) === 'custom');

  const currentPreset = detectPreset(value.dateRange);

  const handlePreset = (p: Preset) => {
    if (p === 'custom') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    const range = getPresetRange(p);
    if (range) onChange({ ...value, dateRange: range });
  };

  const handleDateFrom = (v: string) => {
    onChange({ ...value, dateRange: { ...value.dateRange, from: v } });
  };

  const handleDateTo = (v: string) => {
    onChange({ ...value, dateRange: { ...value.dateRange, to: v } });
  };

  const handleSearch = (q: string) => {
    onChange({ ...value, searchQuery: q });
  };

  const clearSearch = () => onChange({ ...value, searchQuery: '' });

  return (
    <div
      data-testid="sales-filter-bar"
      className={cn('flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2', className)}
    >
      {/* 기간 프리셋 */}
      <div className="flex items-center gap-1">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            data-testid={`sales-preset-${p.key}`}
            onClick={() => handlePreset(p.key)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              (currentPreset === p.key && !showCustom && p.key !== 'custom') ||
                (showCustom && p.key === 'custom')
                ? 'bg-teal-600 text-white'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 직접입력 날짜 */}
      {(showCustom || currentPreset === 'custom') && (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            data-testid="sales-date-from"
            value={value.dateRange.from}
            onChange={(e) => handleDateFrom(e.target.value)}
            className="h-8 w-36 text-xs"
            max={value.dateRange.to}
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="date"
            data-testid="sales-date-to"
            value={value.dateRange.to}
            onChange={(e) => handleDateTo(e.target.value)}
            className="h-8 w-36 text-xs"
            min={value.dateRange.from}
          />
        </div>
      )}

      {/* 현재 기간 표시 (직접입력 아닐 때) */}
      {!showCustom && currentPreset !== 'custom' && (
        <span className="text-xs text-muted-foreground">
          {value.dateRange.from === value.dateRange.to
            ? value.dateRange.from
            : `${value.dateRange.from} ~ ${value.dateRange.to}`}
        </span>
      )}

      {/* 구분선 */}
      <div className="h-5 w-px bg-border" />

      {/* 검색바 */}
      <div className="relative flex items-center">
        <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          data-testid="sales-search"
          placeholder="환자명·차트번호"
          value={value.searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="h-8 w-44 pl-7 pr-7 text-xs"
        />
        {value.searchQuery && (
          <button
            onClick={clearSearch}
            className="absolute right-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 엑셀 다운로드 */}
      <Button
        data-testid="sales-export-btn"
        variant="outline"
        size="sm"
        className="ml-auto h-8 gap-1.5 text-xs"
        onClick={onExport}
        disabled={exporting || !onExport}
      >
        <Download className="h-3.5 w-3.5" />
        {exporting ? '다운로드 중…' : '엑셀 다운로드'}
      </Button>
    </div>
  );
}

/** 기본 필터 상태 (오늘) */
export function defaultSalesFilter(): SalesFilterState {
  const today = fmt(new Date());
  return { dateRange: { from: today, to: today }, searchQuery: '' };
}

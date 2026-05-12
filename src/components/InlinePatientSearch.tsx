/**
 * 인라인 환자 자동검색 컴포넌트
 * T-20260501-foot-INLINE-SEARCH
 *
 * 이름(2글자↑) 또는 연락처(4자리↑) 입력 시 기존 고객 드롭다운 표시
 * debounce 300ms, 최대 5건
 * Props: value / onChange / onSelect / searchField / clinicId / selectedCustomerId
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PatientMatch {
  id: string;
  name: string;
  phone: string;
  birth_date: string | null;
}

interface InlinePatientSearchProps {
  value: string;
  onChange: (v: string) => void;
  onSelect: (p: PatientMatch) => void;
  onClearSelection?: () => void;
  searchField: 'name' | 'phone';
  clinicId: string | undefined | null;
  /** 고객이 선택된 상태 → 배지 표시 + 재검색 억제 */
  selectedCustomerId?: string | null;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

export function InlinePatientSearch({
  value,
  onChange,
  onSelect,
  onClearSelection,
  searchField,
  clinicId,
  selectedCustomerId,
  placeholder,
  id,
  disabled,
  required,
  autoFocus,
  inputMode,
}: InlinePatientSearchProps) {
  const [results, setResults] = useState<PatientMatch[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim() || !clinicId) {
        setResults([]);
        setShowDropdown(false);
        return;
      }
      const digits = q.replace(/\D/g, '');
      const isPhone = searchField === 'phone';
      const len = isPhone ? digits.length : q.trim().length;
      const minLen = isPhone ? 4 : 2;

      if (len < minLen) {
        setResults([]);
        setShowDropdown(false);
        return;
      }

      // T-20260512-foot-RESV-PHONE-SEARCH: DB phone 컬럼은 '010-1234-5678' 형식(하이픈 포함).
      // 수정 전: toHyphenated가 8~10자리에서 잘못된 패턴 생성 (d.length-4 슬라이싱 버그),
      //          단순 ilike 한 개라 후미 4자리 검색 등 불일치.
      // 수정 후: (1) toHyphenated 슬라이싱 고정 (두 번째 세그먼트 항상 index 3~7),
      //          (2) 원시 숫자 패턴 OR 하이픈 패턴 — 어느 입력 방식도 매칭.
      const toHyphenated = (d: string): string => {
        if (d.length <= 3) return d;                                         // 010 → 010
        if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;        // 01012 → 010-12
        return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;          // 01012345678 → 010-1234-5678
      };

      let baseQuery = supabase
        .from('customers')
        .select('id, name, phone, birth_date')
        .eq('clinic_id', clinicId);

      if (isPhone) {
        const hyphenated = toHyphenated(digits);
        // 후미 숫자 검색(raw)과 앞자리 부분 검색(hyphenated) 둘 다 OR
        baseQuery = baseQuery.or(`phone.ilike.%${digits}%,phone.ilike.%${hyphenated}%`);
      } else {
        baseQuery = baseQuery.ilike('name', `%${q.trim()}%`);
      }

      const { data } = await baseQuery.limit(5);

      const matches = (data ?? []) as PatientMatch[];
      setResults(matches);
      setShowDropdown(matches.length > 0);
      setActiveIndex(-1);
    },
    [clinicId, searchField],
  );

  // debounce — 고객 선택됨이면 검색 건너뜀
  useEffect(() => {
    if (selectedCustomerId) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, selectedCustomerId, search]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (p: PatientMatch) => {
    onSelect(p);
    setShowDropdown(false);
    setResults([]);
    setActiveIndex(-1);
  };

  const phoneTail = (phone: string) => {
    const d = phone.replace(/\D/g, '');
    return d.length >= 4 ? `···${d.slice(-4)}` : phone;
  };

  const formatBirth = (b: string | null): string | null => {
    if (!b) return null;
    if (/^\d{6}$/.test(b)) return `${b.slice(0, 2)}/${b.slice(2, 4)}/${b.slice(4, 6)}`;
    return b;
  };

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        inputMode={inputMode}
        onKeyDown={(e) => {
          if (!showDropdown || results.length === 0) {
            if (e.key === 'Escape') setShowDropdown(false);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
          } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && activeIndex < results.length) {
              e.preventDefault();
              handleSelect(results[activeIndex]);
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setShowDropdown(false);
            setActiveIndex(-1);
          }
        }}
        className={cn(selectedCustomerId && 'border-teal-500 bg-teal-50/40')}
      />

      {/* 기존 고객 선택됨 배지 */}
      {selectedCustomerId && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            기존 고객 선택됨
          </span>
          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
            >
              해제
            </button>
          )}
        </div>
      )}

      {/* 드롭다운 */}
      {showDropdown && results.length > 0 && !selectedCustomerId && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">
              기존 고객 {results.length}건
            </span>
            <button
              type="button"
              onClick={() => setShowDropdown(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              닫기
            </button>
          </div>
          {results.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              // onMouseDown 로 blur 전에 선택 처리
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(p);
              }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={cn(
                'flex w-full items-center justify-between border-b border-muted/30 px-3 py-2.5 text-left text-sm transition last:border-0',
                idx === activeIndex
                  ? 'bg-teal-50 text-teal-800'
                  : 'hover:bg-teal-50 hover:text-teal-800',
              )}
            >
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {phoneTail(p.phone)}
                {p.birth_date && ` · ${formatBirth(p.birth_date)}`}
              </span>
            </button>
          ))}
          <div className="border-t bg-muted/20 px-3 py-2">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setShowDropdown(false);
              }}
              className="text-xs text-muted-foreground transition hover:text-foreground"
            >
              + 새로 등록 (현재 입력값 사용)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

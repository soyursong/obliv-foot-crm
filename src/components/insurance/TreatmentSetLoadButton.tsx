/**
 * TreatmentSetLoadButton — 2번차트/결제화면 [세트 불러오기] 버튼
 * T-20260512-foot-TREATMENT-SET
 *
 * - 활성 진료세트 목록 표시 (다이얼로그)
 * - 세트 선택 → onLoad 콜백으로 { insertionCodes, diseaseCodes } 전달
 * - 호출처(CustomerChartPage)에서 Chart2InsuranceCalcPanel에 필터로 전달
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Layers, Hash, Syringe, ChevronRight, X } from 'lucide-react';
import type { TreatmentSet } from '@/components/admin/TreatmentSetsTab';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreatmentSetSelection {
  setId: string;
  setName: string;
  insertionCodes: string[];
  diseaseCodes: string[];
}

interface Props {
  clinicId: string;
  onLoad: (selection: TreatmentSetSelection) => void;
  /** 현재 선택된 세트 이름 (표시용) */
  currentSetName?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useActiveTreatmentSets(clinicId: string) {
  return useQuery({
    queryKey: ['treatment_sets', 'active', clinicId],
    queryFn: async () => {
      const { data: sets, error: setsError } = await supabase
        .from('treatment_sets')
        .select('id, clinic_id, name, category, memo, is_active, sort_order, created_at, updated_at')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (setsError) throw setsError;
      if (!sets || sets.length === 0) return [] as TreatmentSet[];

      const setIds = sets.map((s) => s.id);
      const { data: items, error: itemsError } = await supabase
        .from('treatment_set_items')
        .select('id, set_id, item_type, code, description, sort_order')
        .in('set_id', setIds)
        .order('sort_order', { ascending: true });
      if (itemsError) throw itemsError;

      return sets.map((s) => ({
        ...s,
        items: (items ?? []).filter((i) => i.set_id === s.id),
      })) as TreatmentSet[];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Category badge colors
// ---------------------------------------------------------------------------

const CAT_COLORS: Record<string, string> = {
  초진: 'bg-teal-100 text-teal-800',
  재진: 'bg-emerald-100 text-emerald-800',
  기타: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TreatmentSetLoadButton({ clinicId, onLoad, currentSetName }: Props) {
  const { data: sets = [], isLoading } = useActiveTreatmentSets(clinicId);
  const [open, setOpen] = useState(false);

  function handleSelect(s: TreatmentSet) {
    const insertionCodes = s.items
      .filter((i) => i.item_type === 'insertion_code')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => i.code);

    const diseaseCodes = s.items
      .filter((i) => i.item_type === 'disease_code')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => i.code);

    onLoad({ setId: s.id, setName: s.name, insertionCodes, diseaseCodes });
    setOpen(false);
  }

  function handleReset() {
    onLoad({ setId: '', setName: '', insertionCodes: [], diseaseCodes: [] });
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5 border-teal-300 text-teal-700 hover:bg-teal-50 max-w-[160px]"
        onClick={() => setOpen(true)}
        data-testid="treatment-set-load-btn"
      >
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {currentSetName ? currentSetName : '세트 불러오기'}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b bg-muted/40">
            <DialogTitle className="text-sm">진료세트 선택</DialogTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              선택 시 삽입코드+상병코드 자동 입력 · 진료비 자동산정
            </p>
          </DialogHeader>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sets.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              활성 진료세트가 없습니다.
              <br />
              진료 도구 → 진료세트에서 추가하세요.
            </div>
          ) : (
            <div className="py-1 max-h-80 overflow-y-auto">
              {sets.map((s) => {
                const insertions = s.items
                  .filter((i) => i.item_type === 'insertion_code')
                  .sort((a, b) => a.sort_order - b.sort_order);
                const diseases = s.items
                  .filter((i) => i.item_type === 'disease_code')
                  .sort((a, b) => a.sort_order - b.sort_order);
                const isActive = currentSetName === s.name;

                return (
                  <button
                    key={s.id}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors group border-b last:border-b-0 ${isActive ? 'bg-teal-50' : ''}`}
                    onClick={() => handleSelect(s)}
                    data-testid={`treatment-set-option-${s.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span
                            className={`inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-semibold ${CAT_COLORS[s.category] ?? CAT_COLORS['기타']}`}
                          >
                            {s.category}
                          </span>
                          <span className={`text-xs font-medium truncate ${isActive ? 'text-teal-700' : ''}`}>
                            {s.name}
                          </span>
                        </div>

                        {insertions.length > 0 && (
                          <div className="flex items-center gap-1 mb-0.5">
                            <Syringe className="h-2.5 w-2.5 text-teal-600 shrink-0" />
                            <span className="text-[10px] font-mono text-teal-700 truncate">
                              {insertions.map((i) => i.code).join(' · ')}
                            </span>
                          </div>
                        )}
                        {diseases.length > 0 && (
                          <div className="flex items-center gap-1">
                            <Hash className="h-2.5 w-2.5 text-purple-500 shrink-0" />
                            <span className="text-[10px] font-mono text-purple-700 truncate">
                              {diseases.map((i) => i.code).join(' · ')}
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0 mt-1" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 초기화 (현재 세트가 있을 때만) */}
          {currentSetName && (
            <div className="border-t px-4 py-2.5 bg-muted/20">
              <button
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                onClick={handleReset}
              >
                <X className="h-3 w-3" />
                세트 초기화 (전체 서비스로 복원)
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

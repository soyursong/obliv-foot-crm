// InsuranceStatusTab — 약품별 급여여부(보험상태) 등록·관리 (admin/manager)
// Ticket: T-20260609-foot-DRUG-INSURANCE-GATE Phase1 (DECISION 1-A)
//
// 데이터 모델: prescription_codes.insurance_status / insurance_status_updated_at / insurance_status_source
//   (20260609140000_prescription_codes_insurance_status 마이그레이션에서 추가)
//   admin/manager-write RLS(prescription_codes_admin_all). Phase1 = 변경 시 전부 source='manual'.
//
// 게이트 소비측(checkRxInsuranceGate, 3진입점)은 이미 동작 — 본 탭이 상태를 채우면 즉시 작동.
//   차단상태(비급여/급여삭제/급여기준변경) 약 처방 시 경고+차단(관리자 해제 가능).
//   covered(급여)/미설정(NULL)은 통과.
//
// ⚠️ 약 검색은 prescription_codes 전체 대상(처방세트 출처 제한 없음) — 게이트는 코드 보유 약 전부 대상.
//    (금기증관리는 처방세트 등록 약으로 제한하지만, 급여여부는 차트 코드검색(전체 마스터)으로 처방되는 약도 포함.)

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import {
  type InsuranceStatus,
  insuranceStatusLabel,
  isInsuranceBlockedStatus,
} from '@/lib/prescriptionGate';
import { Loader2, Search, Pill, ShieldAlert, X, BadgeCheck, BadgeX } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RxCode {
  id: string;
  name_ko: string;
  claim_code: string | null;
  classification: string | null;
  code_source: string | null;
  insurance_status: string | null;
  insurance_status_updated_at: string | null;
  insurance_status_source: string | null;
}

// 상태 선택지 — covered(통과) + 차단 3종. '미설정'은 별도 [해제] 버튼으로(NULL).
const STATUS_OPTIONS: InsuranceStatus[] = ['covered', 'non_covered', 'deleted', 'criteria_changed'];

const STATUS_STYLE: Record<InsuranceStatus, string> = {
  covered: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  non_covered: 'text-amber-700 border-amber-200 bg-amber-50',
  deleted: 'text-red-700 border-red-200 bg-red-50',
  criteria_changed: 'text-orange-700 border-orange-200 bg-orange-50',
};

const STATUS_ACTIVE_STYLE: Record<InsuranceStatus, string> = {
  covered: 'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-500',
  non_covered: 'bg-amber-500 text-white border-amber-500 hover:bg-amber-500',
  deleted: 'bg-red-500 text-white border-red-500 hover:bg-red-500',
  criteria_changed: 'bg-orange-500 text-white border-orange-500 hover:bg-orange-500',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function InsuranceStatusTab() {
  const { profile } = useAuth();
  // 페이지 가드(admin/manager/director)가 1차. 본 탭 write 는 RLS(is_admin_or_manager)와 일치하게 admin/manager.
  const canWrite = profile?.role === 'admin' || profile?.role === 'manager';

  const qc = useQueryClient();

  // 약품 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RxCode[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 선택 약품
  const [selected, setSelected] = useState<RxCode | null>(null);

  // 선택 약품의 최신 상태 재조회(저장 후 즉시 반영)
  const { data: selectedFresh } = useQuery({
    queryKey: ['rx_insurance_status', selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_codes')
        .select('id,name_ko,claim_code,classification,code_source,insurance_status,insurance_status_updated_at,insurance_status_source')
        .eq('id', selected!.id)
        .single();
      if (error) throw error;
      return data as RxCode;
    },
  });
  const current = selectedFresh ?? selected;

  // 급여상태 저장(수동) — source='manual', updated_at=now
  const upsert = useMutation({
    mutationFn: async (status: InsuranceStatus | null) => {
      if (!selected) throw new Error('약품 미선택');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('prescription_codes')
        .update({
          insurance_status: status,
          insurance_status_updated_at: new Date().toISOString(),
          insurance_status_source: 'manual', // DECISION 1-A: 수동 변경은 항상 manual 기록
        })
        .eq('id', selected.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rx_insurance_status', selected?.id] });
      toast.success('급여여부가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });

  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const esc = query.replace(/[%,]/g, ' ');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_codes')
        .select('id,name_ko,claim_code,classification,code_source,insurance_status,insurance_status_updated_at,insurance_status_source')
        .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
        .order('code_source', { ascending: false }) // custom(자체) 우선
        .limit(30);
      if (error) throw error;
      setSearchResults((data ?? []) as RxCode[]);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const scheduleSearch = useCallback((q: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const query = q.trim();
    if (query.length < 1) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 250);
  }, [runSearch]);

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  function handleSelectDrug(code: RxCode) {
    setSelected(code);
    setSearchResults([]);
    setSearchQuery('');
  }

  // 권한 격리 — 탭 미노출이 1차, 이중 가드
  if (!canWrite) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <ShieldAlert className="h-6 w-6 text-muted-foreground/60" />
        <span>급여여부 관리는 관리자(admin/manager) 권한이 필요합니다.</span>
      </div>
    );
  }

  const currentStatus = (current?.insurance_status ?? null) as InsuranceStatus | null;

  return (
    <div className="space-y-4" data-testid="insurance-status-tab">
      {/* 안내 */}
      <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-xs text-teal-800 flex items-start gap-2">
        <BadgeCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          약품별 <strong>급여여부</strong>를 설정하면, 진료차트·빠른처방·진료패널에서 해당 약품 처방 시
          <strong> 비급여·급여삭제·급여기준변경</strong> 약은 경고 후 차단됩니다(관리자 해제 가능).
          <span className="block mt-0.5 text-teal-700/80">
            ※ 미설정(공란)이면 게이트를 통과합니다. 약품을 검색·선택한 뒤 급여여부를 지정하세요.
          </span>
        </div>
      </div>

      {/* 약품 검색 박스 */}
      <div className="rounded-lg border bg-card p-3 space-y-2" data-testid="insurance-drug-search">
        <Label className="text-xs font-semibold">약품 검색 (약품명 / 청구코드)</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              scheduleSearch(e.target.value);
            }}
            placeholder="예) 록소프로펜, 항생제, 청구코드…"
            className="pl-8"
            data-testid="insurance-drug-search-input"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="rounded-md border divide-y divide-border/40 max-h-64 overflow-y-auto" data-testid="insurance-drug-results">
            {searchResults.map((code) => (
              <button
                key={code.id}
                type="button"
                onClick={() => handleSelectDrug(code)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40 transition-colors"
                data-testid="insurance-drug-result-item"
              >
                <Pill className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                <span className="text-sm font-medium truncate">{code.name_ko}</span>
                {code.claim_code && (
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">{code.claim_code}</span>
                )}
                {code.insurance_status && (
                  <Badge
                    variant="outline"
                    className={`ml-auto text-[9px] h-4 px-1 shrink-0 ${STATUS_STYLE[code.insurance_status as InsuranceStatus] ?? ''}`}
                  >
                    {insuranceStatusLabel(code.insurance_status)}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        )}
        {searchQuery.trim().length >= 1 && !searching && searchResults.length === 0 && (
          <div
            className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"
            data-testid="insurance-drug-no-match"
          >
            ‘{searchQuery.trim()}’ 검색 결과가 없어요.
          </div>
        )}
      </div>

      {/* 선택 약품 + 급여여부 설정 */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-1.5 rounded-lg border border-dashed">
          <Pill className="h-5 w-5 text-muted-foreground/50" />
          <span>급여여부를 설정할 약품을 먼저 검색·선택하세요.</span>
        </div>
      ) : (
        <div className="rounded-lg border bg-card" data-testid="insurance-selected-panel">
          {/* 선택 약품 헤더 */}
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 bg-muted/20">
            <div className="flex items-center gap-2 min-w-0">
              <Pill className="h-4 w-4 text-teal-600 shrink-0" />
              <span className="text-sm font-semibold truncate" data-testid="insurance-selected-name">{current?.name_ko}</span>
              {current?.claim_code && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{current.claim_code}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              data-testid="insurance-clear-selected"
              aria-label="선택 해제"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 현재 상태 + 차단상태 경고 배너 */}
          <div className="px-3 py-2.5 border-b flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">현재 급여여부</span>
            <Badge
              variant="outline"
              className={`text-[11px] h-5 px-2 ${currentStatus ? STATUS_STYLE[currentStatus] : 'text-muted-foreground border-border'}`}
              data-testid="insurance-current-badge"
            >
              {currentStatus ? insuranceStatusLabel(currentStatus) : '미설정 (게이트 통과)'}
            </Badge>
            {isInsuranceBlockedStatus(currentStatus) && (
              <span className="ml-auto flex items-center gap-1 text-red-600">
                <BadgeX className="h-3.5 w-3.5" />
                처방 시 경고+차단
              </span>
            )}
          </div>

          {/* 상태 선택 버튼 */}
          <div className="px-3 py-3 space-y-2">
            <Label className="text-xs font-semibold">급여여부 설정</Label>
            <div className="grid grid-cols-2 gap-2" data-testid="insurance-status-toggle">
              {STATUS_OPTIONS.map((s) => {
                const active = currentStatus === s;
                return (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={upsert.isPending}
                    onClick={() => upsert.mutate(s)}
                    aria-pressed={active}
                    className={`justify-start ${active ? STATUS_ACTIVE_STYLE[s] : STATUS_STYLE[s]}`}
                    data-testid={`insurance-status-btn-${s}`}
                  >
                    {insuranceStatusLabel(s)}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-1">
              <p className="text-[10px] text-muted-foreground">
                {current?.insurance_status_updated_at
                  ? `최근 변경: ${new Date(current.insurance_status_updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
                  : '변경 이력 없음'}
                {current?.insurance_status_source ? ` · 출처 ${current.insurance_status_source}` : ''}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={upsert.isPending || !current?.insurance_status}
                onClick={() => upsert.mutate(null)}
                className="text-xs text-muted-foreground"
                data-testid="insurance-status-clear-btn"
              >
                {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                미설정으로 해제
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ContraindicationsTab — 약품별 금기증 등록·관리 (admin 한정)
// Ticket: T-20260603-foot-RX-CONTRAINDICATION-ADMIN (RX-MODULE-8REQ #2 잔여분)
//
// 데이터 모델: prescription_contraindications (RX-CHART-ENHANCE commit 2d135f5에서 생성)
//   prescription_code_id FK(NOT NULL) / contraindication_text(NOT NULL) / severity(nullable)
//   / created_by / created_by_name / created_at. admin-write RLS.
// 게이트 소비측(MedicalChartPanel addRxItems)은 이미 동작 — 본 탭이 데이터를 채우면 즉시 작동.
//
// 정책(RX-CHART-ENHANCE AC-2 계승): 등록단위 = prescription_code_id 기준만.
//   텍스트 약명매칭 금지(오탐 차단·의료안전). 약품 검색→선택 후에만 등록 가능.

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { searchPrescribableDrugs, findSameIngredientRegistered, getPrescribableCodeIds } from '@/lib/prescribableDrugs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, Search, Pill, ShieldAlert, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RxCode {
  id: string;
  name_ko: string;
  claim_code: string | null;
  classification: string | null;
  code_source: string | null;
  ingredient_code: string | null; // AC-2 성분 중복 비교 키
}

interface Contraindication {
  id: string;
  prescription_code_id: string;
  contraindication_text: string;
  severity: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface ContraForm {
  contraindication_text: string;
  severity: string; // '' = 미지정(nullable)
}

const EMPTY_FORM: ContraForm = { contraindication_text: '', severity: '' };

// AC-3 심각도 입력 단순화 — 드롭다운 제거 → 버튼식 토글, '주의' / '금기' 2값만.
//   같은 버튼 재클릭 시 해제(미지정=null, 컬럼 nullable). FE 한정 — 마이그(레거시 '경고' 리매핑)는
//   supervisor dry-run 게이트 후 별도 apply(planner MSG-211523-vwhi §3).
const SEVERITY_LEVELS = ['주의', '금기'] as const;

// 표시 스타일 — 레거시 '경고' 데이터(마이그 전)도 안전 표시되도록 유지.
const SEVERITY_STYLE: Record<string, string> = {
  주의: 'text-amber-700 border-amber-200 bg-amber-50',
  경고: 'text-orange-700 border-orange-200 bg-orange-50',
  금기: 'text-red-700 border-red-200 bg-red-50',
};

// 선택(토글) 버튼 활성 스타일
const SEVERITY_ACTIVE_STYLE: Record<string, string> = {
  주의: 'bg-amber-500 text-white border-amber-500 hover:bg-amber-500',
  금기: 'bg-red-500 text-white border-red-500 hover:bg-red-500',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
// 선택 약품의 금기증 목록
function useContraindications(codeId: string | null) {
  return useQuery({
    queryKey: ['rx_contraindications', codeId],
    enabled: !!codeId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_contraindications')
        .select('id,prescription_code_id,contraindication_text,severity,created_by_name,created_at')
        .eq('prescription_code_id', codeId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Contraindication[];
    },
  });
}

function useUpsertContra(codeId: string | null) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: ContraForm }) => {
      const text = form.contraindication_text.trim();
      const severity = form.severity.trim() || null;
      if (id) {
        // 수정: text/severity 만 갱신 (created_by 보존)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('prescription_contraindications')
          .update({ contraindication_text: text, severity })
          .eq('id', id);
        if (error) throw error;
      } else {
        // 등록: prescription_code_id FK 필수 + 등록자 스냅샷
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('prescription_contraindications')
          .insert({
            prescription_code_id: codeId,
            contraindication_text: text,
            severity,
            created_by: profile?.id ?? null,
            created_by_name: profile?.name ?? null,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rx_contraindications', codeId] });
      toast.success('금기증이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

// AC-2 선택 약과 동일 성분(ingredient_code)이며 이미 금기증이 등록된 '다른' 약 목록.
//   비어있으면 성분 중복 경고 불요. ingredient_code 비교(대체키, exact-match).
function useSameIngredientRegistered(drug: RxCode | null) {
  return useQuery({
    queryKey: ['rx_same_ingredient_contra', drug?.id, drug?.ingredient_code],
    enabled: !!drug && !!(drug.ingredient_code ?? '').trim(),
    queryFn: async () =>
      findSameIngredientRegistered({ id: drug!.id, ingredient_code: drug!.ingredient_code }),
  });
}

function useDeleteContra(codeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('prescription_contraindications')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rx_contraindications', codeId] });
      toast.success('금기증이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ContraindicationsTab() {
  const { profile } = useAuth();
  // 탭은 admin 한정 노출(DoctorTools)이지만 컴포넌트 내부 write-guard 이중화.
  const isAdmin = profile?.role === 'admin';

  // 약품 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RxCode[]>([]);
  const [searching, setSearching] = useState(false);
  // T-20260608-foot-RXSET-MGMT-DRUG-SEARCH AC-5: 처방세트관리 드롭다운 검색과 동일 패턴(250ms 디바운스) 재사용.
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 선택 약품
  const [selected, setSelected] = useState<RxCode | null>(null);

  // 다이얼로그
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contraindication | null>(null);
  const [form, setForm] = useState<ContraForm>(EMPTY_FORM);

  // T-20260608-foot-RXSET-CONTRA-DRUG-LOAD: 약품검색이 처방세트 등록 약으로만 출처 제한되므로,
  //   처방세트에 약이 0건이면 무엇을 검색해도 결과가 비어 "DB연결 안됨"처럼 보임(실제는 출처 빈 상태).
  //   → 검색가능 약 존재 여부를 미리 조회해 빈 결과 시 원인을 명확히 안내(AC-2 빈 상태 정합).
  const { data: prescribableIds } = useQuery({
    queryKey: ['prescribable_code_ids'],
    queryFn: getPrescribableCodeIds,
    staleTime: 60_000,
  });
  const hasPrescribableSource: boolean | null = prescribableIds ? prescribableIds.size > 0 : null;

  const { data: contras = [], isLoading } = useContraindications(selected?.id ?? null);
  const upsert = useUpsertContra(selected?.id ?? null);
  const del = useDeleteContra(selected?.id ?? null);

  // AC-2 성분 중복 — 선택 약과 동일 성분이며 이미 금기증이 등록된 다른 약 목록
  const { data: sameIngredientDrugs = [] } = useSameIngredientRegistered(selected);
  const hasIngredientDup = sameIngredientDrugs.length > 0;
  // 성분 중복 경고 팝업(계속/취소)
  const [dupWarnOpen, setDupWarnOpen] = useState(false);

  // AC-1 약품 검색 — '처방세트 등록 약'으로 출처 제한(prescribableDrugs 단일 캡슐화 경유).
  //   기존 prescription_codes 전체 검색 → 처방세트 등록 약 교집합으로 좁힘(현장 요구: 처방세트 외 약 차단).
  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const rows = await searchPrescribableDrugs(query);
      setSearchResults(rows as RxCode[]);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // T-20260608-foot-RXSET-MGMT-DRUG-SEARCH AC-5: 금기증관리 약품검색도 처방세트관리(PrescriptionSetsTab)와
  //   동일한 드롭다운 검색 패턴/UX를 재사용 — 타이핑 → 250ms 디바운스 → 검색 → 결과 드롭다운.
  //   ⚠️ 검색 '출처'는 그대로 유지: '처방세트 등록 약'(searchPrescribableDrugs)으로 제한.
  //      세트 미등록 약(orphan) 차단은 T-20260607-foot-CONTRAINDICATION-MGMT AC-1(문지은 대표원장)
  //      확정 요구이며 deployed 테스트로 가드됨 → 전체 마스터로 바꾸면 그 요구·테스트를 뒤집으므로 변경 금지.
  //      (AC-5 의 '자연 연결' = 세트관리 약 검색이 살아나 세트에 약이 채워지면 이 제한 검색에도 실데이터가 흐름)
  const scheduleSearch = useCallback((q: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const query = q.trim();
    if (query.length < 1) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true); // 디바운스 대기 중에도 즉시 로더 표시(처방세트관리 패턴 동일)
    searchDebounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 250);
  }, [runSearch]);

  // 언마운트 시 디바운스 타이머 정리
  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  function handleSelectDrug(code: RxCode) {
    setSelected(code);
    setSearchResults([]);
    setSearchQuery('');
  }

  // 실제 등록 폼 진입
  function proceedToAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  // AC-2: 성분 중복이면 경고 팝업 먼저(계속/취소), 아니면 바로 등록 폼.
  function openAdd() {
    if (hasIngredientDup) {
      setDupWarnOpen(true);
      return;
    }
    proceedToAdd();
  }

  function openEdit(c: Contraindication) {
    setEditing(c);
    setForm({ contraindication_text: c.contraindication_text, severity: c.severity ?? '' });
    setOpen(true);
  }

  async function handleSave() {
    if (!selected) return toast.error('먼저 약품을 선택해주세요.');
    if (!form.contraindication_text.trim()) return toast.error('금기증 내용을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(c: Contraindication) {
    if (!confirm(`"${c.contraindication_text.slice(0, 30)}…" 금기증을 삭제하시겠어요?`)) return;
    del.mutate(c.id);
  }

  // 권한 격리: 비-admin 진입 시 안내 (DoctorTools 탭 미노출이 1차, 이중 가드)
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <ShieldAlert className="h-6 w-6 text-muted-foreground/60" />
        <span>금기증 관리는 관리자(admin) 권한이 필요합니다.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="contraindications-tab">
      {/* 안내 */}
      <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-xs text-teal-800 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          약품별 <strong>금기증</strong>을 등록하면, 진료차트에서 해당 약품 처방 시 자동으로
          <strong> 확인 게이트(팝업)</strong>가 발동합니다. 약품을 검색·선택한 뒤 금기증을 등록하세요.
          <span className="block mt-0.5 text-teal-700/80">
            ※ 약품코드 기준으로만 등록됩니다 (약명 텍스트 매칭은 오탐 방지를 위해 사용하지 않습니다).
          </span>
        </div>
      </div>

      {/* 약품 검색 박스 */}
      <div className="rounded-lg border bg-card p-3 space-y-2" data-testid="contra-drug-search">
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
            data-testid="contra-drug-search-input"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        {/* 검색 결과 드롭다운 */}
        {searchResults.length > 0 && (
          <div className="rounded-md border divide-y divide-border/40 max-h-64 overflow-y-auto" data-testid="contra-drug-results">
            {searchResults.map((code) => (
              <button
                key={code.id}
                type="button"
                onClick={() => handleSelectDrug(code)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40 transition-colors"
                data-testid="contra-drug-result-item"
              >
                <Pill className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                <span className="text-sm font-medium truncate">{code.name_ko}</span>
                {code.claim_code && (
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">{code.claim_code}</span>
                )}
                {code.code_source === 'custom' && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 text-purple-600 border-purple-200">자체</Badge>
                )}
              </button>
            ))}
          </div>
        )}
        {/* T-20260608-foot-RXSET-CONTRA-DRUG-LOAD: 빈 결과 원인 구분 안내(무한 빈 드롭다운 방지) */}
        {searchQuery.trim().length >= 1 && !searching && searchResults.length === 0 && (
          hasPrescribableSource === false ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-[11px] text-amber-800 flex items-start gap-1.5"
              data-testid="contra-drug-no-source"
            >
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                처방세트에 등록된 약이 없어 검색할 수 없어요. <strong>진료도구 &gt; 처방세트 관리</strong>에서
                약을 먼저 등록하면 여기서 검색·선택할 수 있습니다.
              </span>
            </div>
          ) : (
            <div
              className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"
              data-testid="contra-drug-no-match"
            >
              ‘{searchQuery.trim()}’ 검색 결과가 없어요. (처방세트에 등록된 약만 검색됩니다)
            </div>
          )
        )}
      </div>

      {/* 선택 약품 + 금기증 목록 */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-1.5 rounded-lg border border-dashed">
          <Pill className="h-5 w-5 text-muted-foreground/50" />
          <span>금기증을 등록할 약품을 먼저 검색·선택하세요.</span>
        </div>
      ) : (
        <div className="rounded-lg border bg-card" data-testid="contra-selected-panel">
          {/* 선택 약품 헤더 */}
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 bg-muted/20">
            <div className="flex items-center gap-2 min-w-0">
              <Pill className="h-4 w-4 text-teal-600 shrink-0" />
              <span className="text-sm font-semibold truncate" data-testid="contra-selected-name">{selected.name_ko}</span>
              {selected.claim_code && (
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{selected.claim_code}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              data-testid="contra-clear-selected"
              aria-label="선택 해제"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* AC-2 성분 중복 경고 배너 — 동일 성분 약에 이미 금기증 등록됨 */}
          {hasIngredientDup && (
            <div
              className="flex items-start gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-800"
              data-testid="contra-ingredient-dup-banner"
            >
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <strong>성분명 중복 안내</strong> — 동일 성분의 다른 약(
                <span className="font-medium">
                  {sameIngredientDrugs.map((d) => d.name_ko).join(', ')}
                </span>
                )에 이미 금기증이 등록돼 있습니다. 중복 등록 전 확인하세요.
              </div>
            </div>
          )}

          {/* 등록 버튼 */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs text-muted-foreground">
              등록된 금기증 <strong className="text-foreground">{contras.length}</strong>건
            </span>
            <Button size="sm" variant="outline" onClick={openAdd} data-testid="contra-add-btn">
              <Plus className="h-3.5 w-3.5 mr-1" />
              금기증 등록
            </Button>
          </div>

          {/* 목록 */}
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : contras.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-1.5">
              <span>등록된 금기증이 없습니다.</span>
              <button type="button" onClick={openAdd} className="text-teal-600 text-xs hover:underline">
                + 금기증 등록하기
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border/40" data-testid="contra-list">
              {contras.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-2 px-3 py-2.5 hover:bg-muted/20 transition-colors"
                  data-testid="contra-item"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.severity && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-4 px-1.5 shrink-0 ${SEVERITY_STYLE[c.severity] ?? ''}`}
                        >
                          {c.severity}
                        </Badge>
                      )}
                      <span className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {c.contraindication_text}
                      </span>
                    </div>
                    {c.created_by_name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        등록: {c.created_by_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => openEdit(c)}
                      data-testid="contra-edit-btn"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(c)}
                      disabled={del.isPending}
                      data-testid="contra-delete-btn"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 등록/수정 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? '금기증 수정' : '금기증 등록'}
              {selected && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">— {selected.name_ko}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                심각도
              </Label>
              {/* AC-3 드롭다운 제거 → 버튼 토글 (주의 / 금기 2값). 같은 버튼 재클릭 = 해제(미지정). */}
              <div className="mt-1 flex gap-2" data-testid="contra-severity-toggle">
                {SEVERITY_LEVELS.map((s) => {
                  const active = form.severity === s;
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForm((f) => ({ ...f, severity: f.severity === s ? '' : s }))
                      }
                      aria-pressed={active}
                      className={`flex-1 ${active ? SEVERITY_ACTIVE_STYLE[s] : ''}`}
                      data-testid={`contra-severity-btn-${s}`}
                    >
                      {s}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label className="text-xs">금기증 내용 *</Label>
              <Textarea
                value={form.contraindication_text}
                onChange={(e) => setForm((f) => ({ ...f, contraindication_text: e.target.value }))}
                placeholder="예) 위장관 출혈 병력 환자 금기 / 신기능 저하 시 용량 조절 필요"
                className="mt-1 min-h-[100px] text-sm resize-none"
                data-testid="contra-text-input"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                처방 시 의료진에게 이 문구로 확인 게이트가 표시됩니다.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="contra-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AC-2 성분 중복 경고 팝업 (계속/취소) */}
      <Dialog open={dupWarnOpen} onOpenChange={setDupWarnOpen}>
        <DialogContent className="max-w-md" data-testid="contra-ingredient-dup-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
              성분명 중복 경고
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-foreground space-y-2">
            <p>
              선택한 <strong>{selected?.name_ko}</strong>와(과) 동일 성분의 다른 약에 이미 금기증이
              등록돼 있습니다.
            </p>
            <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {sameIngredientDrugs.map((d) => d.name_ko).join(', ')}
            </div>
            <p className="text-xs text-muted-foreground">
              중복 등록이 의도된 것이 아니라면 취소하세요. 계속하면 이 약에 금기증을 추가합니다.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDupWarnOpen(false)}
              data-testid="contra-dup-cancel-btn"
            >
              취소
            </Button>
            <Button
              onClick={() => {
                setDupWarnOpen(false);
                proceedToAdd();
              }}
              data-testid="contra-dup-continue-btn"
            >
              계속
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

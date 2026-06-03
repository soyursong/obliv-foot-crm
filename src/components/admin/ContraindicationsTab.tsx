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

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
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

// severity 자유등급 (nullable). SQL 코멘트 컨벤션 계승: '주의'|'경고'|'금기'
const SEVERITY_OPTIONS = ['', '주의', '경고', '금기'] as const;

const SEVERITY_STYLE: Record<string, string> = {
  주의: 'text-amber-700 border-amber-200 bg-amber-50',
  경고: 'text-orange-700 border-orange-200 bg-orange-50',
  금기: 'text-red-700 border-red-200 bg-red-50',
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
  // 선택 약품
  const [selected, setSelected] = useState<RxCode | null>(null);

  // 다이얼로그
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contraindication | null>(null);
  const [form, setForm] = useState<ContraForm>(EMPTY_FORM);

  const { data: contras = [], isLoading } = useContraindications(selected?.id ?? null);
  const upsert = useUpsertContra(selected?.id ?? null);
  const del = useDeleteContra(selected?.id ?? null);

  // 약품 마스터 검색 (prescription_codes) — name_ko / claim_code ilike. custom 우선.
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
      const { data } = await (supabase as any)
        .from('prescription_codes')
        .select('id,name_ko,claim_code,classification,code_source')
        .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
        .order('code_source', { ascending: false }) // custom(카피약) 우선
        .limit(20);
      setSearchResults((data as RxCode[]) ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function handleSelectDrug(code: RxCode) {
    setSelected(code);
    setSearchResults([]);
    setSearchQuery('');
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
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
              void runSearch(e.target.value);
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
                심각도{' '}
                <span className="text-muted-foreground font-normal text-[11px]">— 선택 (미지정 가능)</span>
              </Label>
              {/* Dialog 내부 portal 충돌 방지 — native select */}
              <select
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                data-testid="contra-severity-select"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s || 'none'} value={s}>
                    {s || '미지정'}
                  </option>
                ))}
              </select>
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
    </div>
  );
}

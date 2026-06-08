// DiagnosisSetsTab — 묶음상병(상병 세트) 관리
// Ticket: T-20260608-foot-DX-BUNDLE-SET (AC-1, 문지은 대표원장 C0ATE5P6JTH)
//   "묶음상병 — 여러 상병코드를 한 세트로 묶어 진료차트에서 일괄 적용. 묶음처방(prescription_sets)이랑 동일 개념."
//   처방세트(PrescriptionSetsTab) 패턴 미러. 단, 적용대상이 RELATIONAL(진료차트 상병 행)이라
//   items 는 JSONB 가 아닌 정규화 자식 테이블(diagnosis_set_items, service_id FK → services 상병정본)로 둠.
//   ⚠️ 묶음처방 네이밍(DXTOOL-MENU-REORG human_pending)에는 결합하지 않음 — 구조 패턴만 차용.
//
//   상병 정본 = services.category_label='상병' 단일 SSOT (DiagnosisNamesTab 와 동일 소스).
//   세트 item 은 그 마스터를 service_id FK 로 참조만 함(두번째 상병 마스터 신설 아님).
//   진료차트 단건 상병 입력 경로(DiagnosisFolderPicker)는 무변경 — 세트는 '일괄 적용' additive 동선.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, X, Folder } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DxMasterRow {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder: string | null;
}

interface DiagnosisSetItem {
  service_id: string;
  diagnosis_type: 'primary' | 'secondary';
  sort_order: number;
}

interface DiagnosisSet {
  id: string;
  name: string;
  diagnosis_folder: string | null;
  is_active: boolean;
  sort_order: number;
  items: DiagnosisSetItem[];
}

interface SetForm {
  name: string;
  diagnosis_folder: string; // '' = 미분류
  is_active: boolean;
  sort_order: number;
  items: DiagnosisSetItem[];
}

const EMPTY_FORM: SetForm = {
  name: '',
  diagnosis_folder: '',
  is_active: true,
  sort_order: 0,
  items: [],
};

const NO_FOLDER = '미분류';

// 묶음상병 관리(CRUD) 권한 = 처방세트/상병명 관리와 동일 (의사/총괄/관리자)
const DX_SET_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
// 상병 마스터(services category_label='상병') — DiagnosisNamesTab 와 동일 소스(active만).
function useDxMaster(clinicId: string | null) {
  return useQuery({
    queryKey: ['dx_set_master', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder')
        .eq('clinic_id', clinicId)
        .eq('category_label', '상병')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (withFolder.error) {
        const fb = await sb
          .from('services')
          .select('id, name, service_code')
          .eq('clinic_id', clinicId)
          .eq('category_label', '상병')
          .eq('active', true)
          .order('sort_order', { ascending: true });
        if (fb.error) throw fb.error;
        return ((fb.data ?? []) as DxMasterRow[]).map((r) => ({ ...r, diagnosis_folder: null }));
      }
      return (withFolder.data ?? []) as DxMasterRow[];
    },
  });
}

// 묶음상병 세트 + 항목. 테이블 미적용 환경(마이그 미게이트)에서도 graceful(빈 목록).
function useDiagnosisSets(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_sets', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb
        .from('diagnosis_sets')
        .select(
          'id, name, diagnosis_folder, is_active, sort_order, diagnosis_set_items(service_id, diagnosis_type, sort_order)',
        )
        .eq('clinic_id', clinicId)
        .order('sort_order', { ascending: true });
      if (error) {
        // 마이그 미적용(테이블/관계 부재) → 빈 목록으로 폴백(화면 깨지지 않음)
        return [] as DiagnosisSet[];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((s) => ({
        id: s.id,
        name: s.name,
        diagnosis_folder: s.diagnosis_folder ?? null,
        is_active: s.is_active,
        sort_order: s.sort_order,
        items: ((s.diagnosis_set_items ?? []) as DiagnosisSetItem[])
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      })) as DiagnosisSet[];
    },
  });
}

function useUpsertSet(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: SetForm }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const setPayload = {
        name: form.name.trim(),
        diagnosis_folder: form.diagnosis_folder.trim() === '' ? null : form.diagnosis_folder.trim(),
        is_active: form.is_active,
        sort_order: form.sort_order,
        updated_at: new Date().toISOString(),
      };

      // 1) 세트 행 upsert → setId 확보
      let setId = id;
      if (id) {
        const { error } = await sb.from('diagnosis_sets').update(setPayload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb
          .from('diagnosis_sets')
          .insert({ ...setPayload, clinic_id: clinicId })
          .select('id')
          .single();
        if (error) throw error;
        setId = data.id as string;
      }

      // 2) 항목 정규화 테이블 replace(전체 삭제 후 재삽입). 순서 = 배열 index.
      //    같은 세트 내 동일 상병 중복은 UNIQUE 인덱스로 차단 — 저장 전 dedupe(첫 등장 우선).
      const seen = new Set<string>();
      const rows = form.items
        .filter((it) => {
          if (!it.service_id || seen.has(it.service_id)) return false;
          seen.add(it.service_id);
          return true;
        })
        .map((it, idx) => ({
          diagnosis_set_id: setId,
          service_id: it.service_id,
          diagnosis_type: it.diagnosis_type,
          sort_order: idx,
        }));

      const { error: delErr } = await sb
        .from('diagnosis_set_items')
        .delete()
        .eq('diagnosis_set_id', setId);
      if (delErr) throw delErr;
      if (rows.length > 0) {
        const { error: insErr } = await sb.from('diagnosis_set_items').insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
      toast.success('묶음상병이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // diagnosis_set_items 는 FK ON DELETE CASCADE 로 함께 정리됨.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('diagnosis_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_sets'] });
      toast.success('묶음상병이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosisSetsTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const canEdit = !!profile?.role && (DX_SET_MANAGE_ROLES as readonly string[]).includes(profile.role);

  const { data: master = [] } = useDxMaster(clinicId);
  const { data: sets = [], isLoading } = useDiagnosisSets(clinicId);
  const upsert = useUpsertSet(clinicId);
  const del = useDeleteSet();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DiagnosisSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);

  // 상병 마스터 빠른 조회 맵 (service_id → row)
  const masterById = useMemo(() => {
    const m = new Map<string, DxMasterRow>();
    for (const r of master) m.set(r.id, r);
    return m;
  }, [master]);

  function fmtDx(row: DxMasterRow | undefined, fallbackId: string): string {
    if (!row) return `(삭제된 상병 ${fallbackId.slice(0, 6)})`;
    const code = (row.service_code ?? '').trim();
    return code ? `${code} ${row.name}` : row.name;
  }

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [] });
    setOpen(true);
  }

  function openEdit(s: DiagnosisSet) {
    setEditing(s);
    setForm({
      name: s.name,
      diagnosis_folder: s.diagnosis_folder ?? '',
      is_active: s.is_active,
      sort_order: s.sort_order,
      items: s.items.map((it) => ({ ...it })),
    });
    setOpen(true);
  }

  // 항목 추가 — 첫 항목은 주상병(primary), 이후는 부상병(secondary) 기본.
  function addItem(serviceId: string) {
    if (!serviceId) return;
    setForm((f) => {
      if (f.items.some((it) => it.service_id === serviceId)) {
        toast.error('이미 추가된 상병이에요.');
        return f;
      }
      const type: 'primary' | 'secondary' = f.items.length === 0 ? 'primary' : 'secondary';
      return {
        ...f,
        items: [...f.items, { service_id: serviceId, diagnosis_type: type, sort_order: f.items.length }],
      };
    });
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function setItemType(idx: number, type: 'primary' | 'secondary') {
    setForm((f) => {
      const items = f.items.map((it, i) => ({ ...it, diagnosis_type: i === idx ? type : it.diagnosis_type }));
      return { ...f, items };
    });
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('묶음상병 이름을 입력해주세요.');
    if (form.items.length === 0) return toast.error('상병을 한 개 이상 추가해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 묶음상병을 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // 폴더별 그룹핑 (미분류 맨 끝). 폴더 내부는 기존 sort_order 순서 유지.
  const grouped = useMemo(() => {
    const map = new Map<string, DiagnosisSet[]>();
    for (const s of sets) {
      const key = s.diagnosis_folder?.trim() ? s.diagnosis_folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  }, [sets]);

  const folderNames = useMemo(
    () =>
      Array.from(
        new Set(sets.map((s) => s.diagnosis_folder?.trim()).filter((x): x is string => !!x)),
      ).sort((a, b) => a.localeCompare(b, 'ko')),
    [sets],
  );

  // 마스터 폴더 그룹(다이얼로그 상병 선택 optgroup)
  const masterGrouped = useMemo(() => {
    const map = new Map<string, DxMasterRow[]>();
    for (const r of master) {
      const key = r.diagnosis_folder?.trim() ? r.diagnosis_folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  }, [master]);

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 용어 안내 — 묶음상병 = 여러 상병을 한 세트로 묶어 진료차트에서 일괄 적용 */}
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[11px] text-muted-foreground">
        이 화면은 <span className="font-semibold text-teal-700">묶음상병</span>(여러 상병을 한 세트로 묶어
        진료차트에서 한 번에 적용) 관리입니다. 상병은 <span className="font-medium">상병명 관리</span>에 등록된
        것만 묶을 수 있어요.
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{sets.length}개 묶음상병</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="dx-set-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            묶음상병 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 묶음상병이 없습니다.
        </div>
      ) : (
        <div className="space-y-4" data-testid="dx-set-list">
          {grouped.map((g) => (
            <div key={g.folder} data-testid="dx-set-folder-group">
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Folder className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-semibold text-foreground select-none">{g.folder}</span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{g.items.length}</Badge>
              </div>
              <div className="space-y-2 pl-1">
                {g.items.map((s) => (
                  <div key={s.id} className="rounded-lg border bg-card px-4 py-3" data-testid="dx-set-item">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                          {s.name}
                        </span>
                        {!s.is_active && <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>}
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          상병 {s.items.length}개
                        </Badge>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(s.id, s.name)}
                            disabled={del.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {s.items.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.items.map((it, idx) => {
                          const row = masterById.get(it.service_id);
                          const primary = it.diagnosis_type === 'primary';
                          return (
                            <span
                              key={`${it.service_id}-${idx}`}
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
                                primary ? 'border-teal-300 bg-teal-50' : 'border-input bg-muted/40'
                              }`}
                            >
                              <span
                                className={`rounded px-1 text-[9px] font-semibold ${
                                  primary ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-700'
                                }`}
                              >
                                {primary ? '주' : '부'}
                              </span>
                              {fmtDx(row, it.service_id)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '묶음상병 수정' : '묶음상병 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">묶음상병 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 당뇨 합병증 세트"
                  className="mt-1"
                  data-testid="dx-set-name-input"
                />
              </div>
              <div>
                <Label className="text-xs">폴더 (분류)</Label>
                <Input
                  value={form.diagnosis_folder}
                  onChange={(e) => setForm((f) => ({ ...f, diagnosis_folder: e.target.value }))}
                  placeholder="예) 당뇨"
                  className="mt-1"
                  list="dx-set-folder-suggestions"
                  data-testid="dx-set-folder-input"
                />
                <datalist id="dx-set-folder-suggestions">
                  {folderNames.map((fn) => (
                    <option key={fn} value={fn} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1"
                  min={0}
                />
              </div>
            </div>

            {/* 상병 추가 — 상병 마스터(폴더 optgroup)에서 선택 시 즉시 목록에 추가 */}
            <div>
              <Label className="text-xs">상병 추가</Label>
              <select
                value=""
                onChange={(e) => {
                  addItem(e.target.value);
                  e.currentTarget.value = '';
                }}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="dx-set-add-item-select"
                disabled={master.length === 0}
              >
                <option value="" disabled>
                  {master.length === 0 ? '등록된 상병명이 없습니다 — 상병명 관리에서 먼저 등록' : '상병 선택…'}
                </option>
                {masterGrouped.map((g) => (
                  <optgroup key={g.folder} label={g.folder}>
                    {g.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {fmtDx(r, r.id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* 묶음에 포함된 상병 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">묶음 상병 ({form.items.length}개)</Label>
                <span className="text-[10px] text-muted-foreground">주상병 1 + 부상병 다수</span>
              </div>
              {form.items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  위에서 상병을 추가하세요.
                </div>
              ) : (
                <div className="space-y-1.5" data-testid="dx-set-item-rows">
                  {form.items.map((it, idx) => {
                    const row = masterById.get(it.service_id);
                    return (
                      <div
                        key={`${it.service_id}-${idx}`}
                        className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-muted/30"
                        data-testid="dx-set-item-row"
                      >
                        <span className="text-sm flex-1 min-w-0 truncate">{fmtDx(row, it.service_id)}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setItemType(idx, 'primary')}
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              it.diagnosis_type === 'primary'
                                ? 'bg-teal-600 text-white'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                            data-testid="dx-set-item-type-primary"
                          >
                            주상병
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemType(idx, 'secondary')}
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              it.diagnosis_type === 'secondary'
                                ? 'bg-gray-500 text-white'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                            data-testid="dx-set-item-type-secondary"
                          >
                            부상병
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                          onClick={() => removeItem(idx)}
                          data-testid="dx-set-item-remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="dx-set-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// DiagnosisNamesTab — 상병명(진단명) 관리
// Ticket: T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-1 [A], 문지은 대표원장 C0ATE5P6JTH)
//   처방세트(PrescriptionSetsTab) 동일 구조 — 원내 사용 상병명을 등록·폴더 분류.
//   상병 정본 = services.category_label='상병' 단일 SSOT (두번째 마스터 신설 금지, AC-0 RESOLVED).
//   폴더 = services.diagnosis_folder (additive, supervisor SQL게이트). 진료차트는 이 마스터만 선택.

import { useState } from 'react';
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
import { Loader2, Plus, Pencil, Trash2, Folder } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — 상병 = services 행 (category_label='상병')
// ---------------------------------------------------------------------------
interface Diagnosis {
  id: string;
  name: string;
  service_code: string | null;
  diagnosis_folder: string | null;
  active: boolean;
  sort_order: number;
}

interface DxForm {
  name: string;
  service_code: string;
  diagnosis_folder: string; // '' = 미분류
  active: boolean;
  sort_order: number;
}

const EMPTY_FORM: DxForm = {
  name: '',
  service_code: '',
  diagnosis_folder: '',
  active: true,
  sort_order: 0,
};

// 상병 관리 권한 = 처방세트와 동일 (의사/총괄/관리자)
const DX_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useDiagnoses(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_master', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      // deploy-tolerant: diagnosis_folder 컬럼은 supervisor SQL게이트로 적용 →
      //   미적용 환경(42703)에서도 깨지지 않게 폴백.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      let rows: Diagnosis[] | null = null;
      const withFolder = await sb
        .from('services')
        .select('id, name, service_code, diagnosis_folder, active, sort_order')
        .eq('clinic_id', clinicId)
        .eq('category_label', '상병')
        .order('sort_order', { ascending: true });
      if (withFolder.error) {
        const fallback = await sb
          .from('services')
          .select('id, name, service_code, active, sort_order')
          .eq('clinic_id', clinicId)
          .eq('category_label', '상병')
          .order('sort_order', { ascending: true });
        if (fallback.error) throw fallback.error;
        rows = ((fallback.data ?? []) as Diagnosis[]).map((r) => ({ ...r, diagnosis_folder: null }));
      } else {
        rows = (withFolder.data ?? []) as Diagnosis[];
      }
      return rows;
    },
  });
}

function useUpsertDx(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: string; form: DxForm }) => {
      const payload = {
        name: form.name.trim(),
        service_code: form.service_code.trim() || null,
        diagnosis_folder: form.diagnosis_folder.trim() === '' ? null : form.diagnosis_folder.trim(),
        active: form.active,
        sort_order: form.sort_order,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      if (id) {
        const { error } = await sb.from('services').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        // 신규 상병 = services 행. category/category_label='상병', 단가 0 (진단코드, 비매출).
        const { error } = await sb.from('services').insert({
          ...payload,
          clinic_id: clinicId,
          category: '상병',
          category_label: '상병',
          price: 0,
          vat_type: 'none',
          service_type: 'single',
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
      toast.success('상병명이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteDx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('services').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
      toast.success('상병명이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosisNamesTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const canEdit = !!profile?.role && (DX_MANAGE_ROLES as readonly string[]).includes(profile.role);
  const { data: items = [], isLoading } = useDiagnoses(clinicId);
  const upsert = useUpsertDx(clinicId);
  const del = useDeleteDx();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Diagnosis | null>(null);
  const [form, setForm] = useState<DxForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  }

  function openEdit(d: Diagnosis) {
    setEditing(d);
    setForm({
      name: d.name,
      service_code: d.service_code ?? '',
      diagnosis_folder: d.diagnosis_folder ?? '',
      active: d.active,
      sort_order: d.sort_order,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('상병명을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 상병명을 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // 폴더별 그룹핑 (미분류 맨 끝) — PrescriptionSetsTab 패턴 미러
  const NO_FOLDER = '미분류';
  const grouped = (() => {
    const map = new Map<string, Diagnosis[]>();
    for (const d of items) {
      const key = d.diagnosis_folder?.trim() ? d.diagnosis_folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  })();
  const folderNames = Array.from(
    new Set(items.map((d) => d.diagnosis_folder?.trim()).filter((x): x is string => !!x)),
  ).sort((a, b) => a.localeCompare(b, 'ko'));

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{items.length}개 상병명</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="dx-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            상병명 추가
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        진료차트 진단명은 여기 등록된 상병명만 선택할 수 있습니다. 폴더로 그룹화해 관리하세요.
      </p>

      {/* 목록 */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 상병명이 없습니다.
        </div>
      ) : (
        <div className="space-y-4" data-testid="dx-list">
          {grouped.map((g) => (
            <div key={g.folder} data-testid="dx-folder-group">
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Folder className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-semibold text-foreground" data-testid="dx-folder-name">
                  {g.folder}
                </span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{g.items.length}</Badge>
              </div>
              <div className="space-y-1.5 pl-1">
                {g.items.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border bg-card px-4 py-2.5 flex items-center justify-between"
                    data-testid="dx-item"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-sm font-medium truncate ${!d.active ? 'text-muted-foreground line-through' : ''}`}>
                        {d.name}
                      </span>
                      {d.service_code && (
                        <Badge variant="outline" className="text-[10px] py-0 font-mono">{d.service_code}</Badge>
                      )}
                      {!d.active && (
                        <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(d.id, d.name)}
                          disabled={del.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '상병명 수정' : '상병명 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">상병명 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 족저근막염"
                  className="mt-1"
                  data-testid="dx-name-input"
                />
              </div>
              <div>
                <Label className="text-xs">상병코드</Label>
                <Input
                  value={form.service_code}
                  onChange={(e) => setForm((f) => ({ ...f, service_code: e.target.value }))}
                  placeholder="예) M79.3"
                  className="mt-1 font-mono"
                  data-testid="dx-code-input"
                />
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
            <div>
              <Label className="text-xs">폴더 (분류)</Label>
              <Input
                value={form.diagnosis_folder}
                onChange={(e) => setForm((f) => ({ ...f, diagnosis_folder: e.target.value }))}
                placeholder="예) 족부질환 · 비우면 미분류"
                className="mt-1"
                list="dx-folder-suggestions"
                data-testid="dx-folder-input"
              />
              <datalist id="dx-folder-suggestions">
                {folderNames.map((fn) => (
                  <option key={fn} value={fn} />
                ))}
              </datalist>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
              <Label className="text-xs">활성화</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="dx-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

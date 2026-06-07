// PrescriptionSetsTab — 처방세트 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 3, 포팅: derm → foot)
// 어드민에서 처방세트 CRUD — 의사가 진료 시 처방 목록을 한 번에 불러옴

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
import { Loader2, Plus, Pencil, Trash2, X, Folder, Check } from 'lucide-react';
import RxCountInput from '@/components/admin/RxCountInput';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PrescriptionItem {
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  days: number;
  notes: string;
  // T-20260603-foot-RX-CHART-ENHANCE AC-5: prescription_codes 마스터 연결 (nullable, additive).
  //   자유텍스트 수기입력은 null 유지(레거시 무중단). AC-2 금기증 게이트는 이 id 기준으로만 매칭.
  prescription_code_id?: string | null;
  classification?: string | null; // AC-3 색상매핑 프록시 (prescription_codes.classification 스냅샷)
  // T-20260603-foot-RX-CHART-FOLLOWUP3 C-2-5 (#9-1 현장확정): 처방 횟수 = 숫자만(예: 3).
  //   "회"는 값에 포함하지 않고 필드 배경(suffix)에서만 표기. 기존 frequency('1일 3회' 자유텍스트=용법)는
  //   분해하지 않고 별도 횟수칸 신설(additive·nullable, JSONB라 마이그 불요).
  count?: number | null;
}

// T-20260603-foot-RX-CHART-ENHANCE AC-5: prescription_codes.classification → 투여경로(route) 프록시 매핑.
//   route 는 AC-3 색상 도트의 기존 키이므로, 마스터 선택 시 classification 에서 route 를 파생해 채운다.
export function classificationToRoute(classification: string | null | undefined): string {
  const c = (classification ?? '').trim();
  if (!c) return '';
  if (c.includes('내복') || c.includes('경구')) return '경구';
  if (c.includes('외용') || c.includes('도포')) return '외용';
  if (c.includes('주사') || c.includes('점적') || c.includes('정맥') || c.includes('근육') || c.includes('피하')) return '주사';
  if (c.includes('점안')) return '점안';
  if (c.includes('흡입')) return '흡입';
  return ''; // 처치료 등 미매칭 → 기타(회색)
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder?: string | null; // AC-1 폴더명 (nullable)
}

interface SetForm {
  name: string;
  items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
  folder: string; // AC-1 폴더명 ('' = 미분류)
}

const EMPTY_ITEM: PrescriptionItem = {
  name: '',
  dosage: '',
  route: '경구',
  frequency: '1일 3회',
  days: 3,
  notes: '',
};

const EMPTY_FORM: SetForm = {
  name: '',
  items: [{ ...EMPTY_ITEM }],
  is_active: true,
  sort_order: 0,
  folder: '',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function usePrescriptionSets() {
  return useQuery({
    queryKey: ['prescription_sets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items, is_active, sort_order, folder')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PrescriptionSet[];
    },
  });
}

function useUpsertSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: SetForm }) => {
      const payload = {
        name: form.name,
        items: form.items as unknown as Record<string, unknown>[],
        is_active: form.is_active,
        sort_order: form.sort_order,
        folder: form.folder.trim() === '' ? null : form.folder.trim(), // AC-1
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('prescription_sets').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('prescription_sets').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('prescription_sets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('처방세트가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 묶음처방(처방세트) 폴더명 인라인 변경.
//   폴더 = prescription_sets.folder 문자열값(별도 분류 테이블 없음) → 같은 폴더값 행 일괄 UPDATE.
//   기존 컬럼 UPDATE only(db_change=false). 빈값/중복 검증은 호출부에서 선행. AC-A(상병명)와 동일 UX.
function useRenameSetFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const { error } = await supabase
        .from('prescription_sets')
        .update({ folder: newName, updated_at: new Date().toISOString() })
        .eq('folder', oldName);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_sets'] });
      toast.success('폴더 이름을 바꿨어요.');
    },
    onError: (e: Error) => toast.error(`폴더 이름 변경 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub-component: 처방 항목 편집 행
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: PrescriptionItem;
  idx: number;
  onChange: (idx: number, field: keyof PrescriptionItem, val: string | number | null) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}

function ItemRow({ item, idx, onChange, onRemove, canRemove }: ItemRowProps) {
  return (
    <div className="grid grid-cols-12 gap-1.5 items-end border rounded-lg p-2.5 bg-muted/30">
      <div className="col-span-3">
        <Label className="text-[10px]">약품/시술명 *</Label>
        <Input
          value={item.name}
          onChange={(e) => onChange(idx, 'name', e.target.value)}
          placeholder="항진균제 연고"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">용량</Label>
        <Input
          value={item.dosage}
          onChange={(e) => onChange(idx, 'dosage', e.target.value)}
          placeholder="적정량"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-1">
        <Label className="text-[10px]">투여경로</Label>
        <Input
          value={item.route}
          onChange={(e) => onChange(idx, 'route', e.target.value)}
          placeholder="외용"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px]">용법</Label>
        <Input
          value={item.frequency}
          onChange={(e) => onChange(idx, 'frequency', e.target.value)}
          placeholder="1일 2회"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      {/* T-20260603-foot-RX-CHART-FOLLOWUP3 C-2-5: 횟수 = 숫자만, "회"는 배경 suffix */}
      <div className="col-span-1">
        <Label className="text-[10px]">횟수</Label>
        <RxCountInput
          value={item.count ?? null}
          onChange={(v) => onChange(idx, 'count', v)}
        />
      </div>
      <div className="col-span-1">
        <Label className="text-[10px]">일수</Label>
        <Input
          type="number"
          value={item.days}
          onChange={(e) => onChange(idx, 'days', Number(e.target.value))}
          className="h-7 text-xs mt-0.5"
          min={1}
        />
      </div>
      <div className="col-span-1">
        <Label className="text-[10px]">비고</Label>
        <Input
          value={item.notes}
          onChange={(e) => onChange(idx, 'notes', e.target.value)}
          placeholder=""
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div className="col-span-1 flex items-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => onRemove(idx)}
          disabled={!canRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PrescriptionSetsTab() {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원은 읽기 전용, CRUD는 권한 보유 role만.
  // T-20260603-foot-RX-CHART-FOLLOWUP2 #8-2(문지은 대표원장): 처방세트 관리(등록/수정/삭제)
  //   권한 = 의사(director)/총괄(manager)/관리자(admin)급. director 누락 → 대표원장 본인이
  //   처방세트를 관리하지 못하던 갭 해소. QuickRxBar 의 DOCTOR_ROLES 와 동일 집합.
  const RX_SET_MANAGE_ROLES = ['director', 'manager', 'admin'] as const;
  const { profile } = useAuth();
  const canEdit = !!profile?.role && (RX_SET_MANAGE_ROLES as readonly string[]).includes(profile.role);
  const { data: sets = [], isLoading } = usePrescriptionSets();
  const upsert = useUpsertSet();
  const del = useDeleteSet();
  // T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 폴더명 인라인 변경 (AC-A 상병명과 동일 UX).
  const renameFolder = useRenameSetFolder();
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrescriptionSet | null>(null);
  const [form, setForm] = useState<SetForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setOpen(true);
  }

  function openEdit(s: PrescriptionSet) {
    setEditing(s);
    setForm({
      name: s.name,
      items: s.items.length > 0 ? s.items : [{ ...EMPTY_ITEM }],
      is_active: s.is_active,
      sort_order: s.sort_order,
      folder: s.folder ?? '',
    });
    setOpen(true);
  }

  function handleItemChange(idx: number, field: keyof PrescriptionItem, val: string | number | null) {
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('처방세트 이름을 입력해주세요.');
    if (form.items.some((i) => !i.name.trim())) return toast.error('각 처방 항목에 이름을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 처방세트를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  // T-20260607-foot-FOLDER-RENAME-INLINE (AC-B): 폴더명 인라인 변경 핸들러 (AC-A와 동일 로직)
  function startRenameFolder(folder: string) {
    if (!canEdit || folder === NO_FOLDER) return; // 권한 없음/미분류(합성 폴더)는 변경 불가
    setRenamingFolder(folder);
    setRenameValue(folder);
  }
  function cancelRenameFolder() {
    setRenamingFolder(null);
    setRenameValue('');
  }
  async function submitRenameFolder() {
    if (!renamingFolder) return;
    const oldName = renamingFolder;
    const next = renameValue.trim();
    if (!next) return toast.error('폴더 이름을 입력해주세요.'); // 빈값 검증
    if (next === oldName) return cancelRenameFolder(); // 변경 없음
    if (next === NO_FOLDER) return toast.error(`"${NO_FOLDER}"는 폴더 이름으로 쓸 수 없어요.`);
    // 중복 검증 — 다른 폴더와 동일 이름 금지(미분류/자기자신 제외)
    if (folderNames.some((f) => f !== oldName && f === next)) {
      return toast.error('이미 있는 폴더 이름이에요.');
    }
    await renameFolder.mutateAsync({ oldName, newName: next });
    cancelRenameFolder();
  }

  // AC-1: 폴더별 그룹핑 (미분류는 맨 끝). 폴더 내부는 기존 sort_order 순서 유지.
  const NO_FOLDER = '미분류';
  const grouped = (() => {
    const map = new Map<string, PrescriptionSet[]>();
    for (const s of sets) {
      const key = s.folder?.trim() ? s.folder.trim() : NO_FOLDER;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    // 폴더명 가나다순, 미분류 맨 끝
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_FOLDER) return 1;
      if (b === NO_FOLDER) return -1;
      return a.localeCompare(b, 'ko');
    });
    return keys.map((k) => ({ folder: k, items: map.get(k)! }));
  })();
  const folderNames = Array.from(
    new Set(sets.map((s) => s.folder?.trim()).filter((x): x is string => !!x)),
  ).sort((a, b) => a.localeCompare(b, 'ko'));

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* T-20260606-foot-RX-SET-REDESIGN AC-R6 용어 매핑(코드 식별자 ↔ 현장용어):
            이 화면의 "처방세트"(코드 prescription_sets) = 현장용어 "묶음처방"(이름+약 묶음 프리셋).
            개별 약품을 분류하는 "약품 폴더"(prescription_folders)는 별도 탭(DrugFoldersTab). */}
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[11px] text-muted-foreground">
        이 화면은 <span className="font-semibold text-teal-700">묶음처방</span>(이름 + 약 묶음, 빠른처방 프리셋) 관리입니다.
        개별 약품을 폴더로 분류하려면 <span className="font-medium">약품 폴더</span> 탭을 이용하세요.
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{sets.length}개 처방세트</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="rx-set-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            처방세트 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 처방세트가 없습니다.
        </div>
      ) : (
        <div className="space-y-4" data-testid="rx-set-list">
          {grouped.map((g) => (
            <div key={g.folder} data-testid="rx-set-folder-group">
              {/* AC-1: 폴더 헤더 / T-20260607 AC-B: 더블클릭·우클릭·연필버튼 → 인라인 이름 변경 */}
              {renamingFolder === g.folder ? (
                <div
                  className="flex items-center gap-1 mb-1.5 px-1"
                  data-testid="rx-set-folder-header"
                  data-renaming="true"
                >
                  <Folder className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitRenameFolder();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameFolder();
                      }
                    }}
                    className="h-7 text-xs px-1.5 max-w-[220px]"
                    data-testid="rx-set-folder-rename-input"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-teal-600 hover:text-teal-700"
                    onClick={submitRenameFolder}
                    disabled={renameFolder.isPending}
                    title="저장"
                    data-testid="rx-set-folder-rename-save"
                  >
                    {renameFolder.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={cancelRenameFolder}
                    disabled={renameFolder.isPending}
                    title="취소"
                    data-testid="rx-set-folder-rename-cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div
                  className="group flex items-center gap-1.5 mb-1.5 px-1"
                  data-testid="rx-set-folder-header"
                  onDoubleClick={() => canEdit && g.folder !== NO_FOLDER && startRenameFolder(g.folder)}
                  onContextMenu={(e) => {
                    if (!canEdit || g.folder === NO_FOLDER) return;
                    e.preventDefault();
                    startRenameFolder(g.folder);
                  }}
                >
                  <Folder className="h-3.5 w-3.5 text-teal-600" />
                  <span className="text-xs font-semibold text-foreground select-none" data-testid="rx-set-folder-name">
                    {g.folder}
                  </span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{g.items.length}</Badge>
                  {canEdit && g.folder !== NO_FOLDER && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground/50 hover:text-teal-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => startRenameFolder(g.folder)}
                      title="폴더 이름 바꾸기"
                      data-testid="rx-set-folder-rename-btn"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
              <div className="space-y-2 pl-1">
          {g.items.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border bg-card px-4 py-3"
              data-testid="rx-set-item"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {s.name}
                  </span>
                  {!s.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {s.items.length}개 항목
                  </Badge>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(s)}
                    >
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
                <div className="space-y-1">
                  {s.items.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      {item.dosage && <span>{item.dosage}</span>}
                      <span>{item.route}</span>
                      <span>{item.frequency}</span>
                      {item.count != null && <span>{item.count}회</span>}
                      <span>{item.days}일</span>
                    </div>
                  ))}
                  {s.items.length > 3 && (
                    <p className="text-[11px] text-muted-foreground">+{s.items.length - 3}개 항목 더</p>
                  )}
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '처방세트 수정' : '처방세트 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">처방세트 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 발톱무좀 기본 처방"
                  className="mt-1"
                  data-testid="rx-set-name-input"
                />
              </div>
              {/* AC-1: 폴더(분류) — 같은 이름끼리 묶임. 비우면 미분류. */}
              <div>
                <Label className="text-xs">폴더 (분류)</Label>
                <Input
                  value={form.folder}
                  onChange={(e) => setForm((f) => ({ ...f, folder: e.target.value }))}
                  placeholder="예) 무좀"
                  className="mt-1"
                  list="rx-folder-suggestions"
                  data-testid="rx-set-folder-input"
                />
                <datalist id="rx-folder-suggestions">
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

            {/* 처방 항목 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">처방 항목 ({form.items.length}개)</Label>
                <Button size="sm" variant="ghost" onClick={addItem} className="h-6 text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  항목 추가
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <ItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    onChange={handleItemChange}
                    onRemove={removeItem}
                    canRemove={form.items.length > 1}
                  />
                ))}
              </div>
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
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="rx-set-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

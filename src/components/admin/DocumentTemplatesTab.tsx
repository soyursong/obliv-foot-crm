// DocumentTemplatesTab — 서류 템플릿 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 6, 포팅: derm → foot)
// 어드민에서 서류 템플릿 CRUD — 진료 시 불러와 수정 후 컨펌

import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, FileText } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DocumentTemplate {
  id: number;
  document_type: string;
  name: string;
  content: string;
  is_active: boolean;
  sort_order: number;
  // #2(FOLLOWUP2): 2단계 카테고리(예: 레이저진단서 > 위장장애). nullable, NULL=미분류.
  category: string | null;
  subcategory: string | null;
}

interface DocForm {
  document_type: string;
  name: string;
  content: string;
  is_active: boolean;
  sort_order: number;
  category: string;
  subcategory: string;
}

const EMPTY_FORM: DocForm = {
  document_type: 'general',
  name: '',
  content: '',
  is_active: true,
  sort_order: 0,
  category: '',
  subcategory: '',
};

// #2(FOLLOWUP2): 카테고리 미지정 라벨(spec groupByCategory 계약과 동일)
const UNCATEGORIZED = '미분류';

const DOC_TYPE_LABELS: Record<string, string> = {
  diagnosis: '진단서',
  opinion: '소견서',
  prescription: '처방전',
  visit_confirmation: '진료확인서',
  general: '일반',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useDocumentTemplates() {
  return useQuery({
    queryKey: ['document_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_templates')
        .select('id, document_type, name, content, is_active, sort_order, category, subcategory')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DocumentTemplate[];
    },
  });
}

function useUpsertDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: DocForm }) => {
      const payload = {
        document_type: form.document_type,
        name: form.name,
        content: form.content,
        is_active: form.is_active,
        sort_order: form.sort_order,
        // #2(FOLLOWUP2): 2단계 카테고리. 빈 문자열은 NULL(미분류)로 저장.
        category: form.category.trim() === '' ? null : form.category.trim(),
        subcategory: form.subcategory.trim() === '' ? null : form.subcategory.trim(),
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('document_templates').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('document_templates').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document_templates'] });
      toast.success('서류 템플릿이 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('document_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document_templates'] });
      toast.success('서류 템플릿이 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DocumentTemplatesTab() {
  // T-20260603-foot-RX-PERMMENU-PARITY: 직원은 읽기 전용, CRUD는 admin/manager 전용.
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';
  const { data: templates = [], isLoading } = useDocumentTemplates();
  const upsert = useUpsertDoc();
  const del = useDeleteDoc();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [form, setForm] = useState<DocForm>(EMPTY_FORM);
  const [filterType, setFilterType] = useState<string>('all');

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(t: DocumentTemplate) {
    setEditing(t);
    setForm({
      document_type: t.document_type,
      name: t.name,
      content: t.content,
      is_active: t.is_active,
      sort_order: t.sort_order,
      category: t.category ?? '',
      subcategory: t.subcategory ?? '',
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('서류 이름을 입력해주세요.');
    if (!form.content.trim()) return toast.error('내용을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 서류 템플릿을 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  const displayed =
    filterType === 'all' ? templates : templates.filter((t) => t.document_type === filterType);

  // #2(FOLLOWUP2): category > subcategory 2단계 그룹핑 (미분류는 맨 끝).
  //   spec groupByCategory 계약과 동일 규칙 — null/'' = 미분류.
  const grouped = (() => {
    const map = new Map<string, Map<string, DocumentTemplate[]>>();
    for (const t of displayed) {
      const c = t.category?.trim() ? t.category.trim() : UNCATEGORIZED;
      const s = t.subcategory?.trim() ? t.subcategory.trim() : UNCATEGORIZED;
      if (!map.has(c)) map.set(c, new Map());
      const sub = map.get(c)!;
      if (!sub.has(s)) sub.set(s, []);
      sub.get(s)!.push(t);
    }
    const sortKo = (a: string, b: string) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b, 'ko');
    };
    return Array.from(map.keys())
      .sort(sortKo)
      .map((c) => ({
        category: c,
        subs: Array.from(map.get(c)!.keys())
          .sort(sortKo)
          .map((s) => ({ subcategory: s, items: map.get(c)!.get(s)! })),
      }));
  })();

  // 카테고리/하위 카테고리 입력 자동완성 후보 (기존 라벨 재사용 — 오타 분기 방지)
  const categoryNames = Array.from(
    new Set(templates.map((t) => t.category?.trim()).filter((x): x is string => !!x)),
  ).sort((a, b) => a.localeCompare(b, 'ko'));
  const subcategoryNames = Array.from(
    new Set(templates.map((t) => t.subcategory?.trim()).filter((x): x is string => !!x)),
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
        <div className="flex items-center gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="서류 유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{displayed.length}개</span>
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="doc-template-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            서류 템플릿 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {displayed.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
          등록된 서류 템플릿이 없습니다.
        </div>
      ) : (
        <div className="space-y-4" data-testid="doc-template-list">
          {/* #2(FOLLOWUP2): category > subcategory 2단계 위계 그룹 렌더 */}
          {grouped.map((g) => (
            <div key={g.category} data-testid="doc-template-category-group">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-xs font-semibold text-foreground"
                  data-testid="doc-template-category-name"
                >
                  {g.category}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3 pl-2">
                {g.subs.map((sub) => (
                  <div key={sub.subcategory} data-testid="doc-template-subcategory-group">
                    {sub.subcategory !== UNCATEGORIZED && (
                      <div
                        className="text-[11px] font-medium text-muted-foreground mb-1"
                        data-testid="doc-template-subcategory-name"
                      >
                        └ {sub.subcategory}
                      </div>
                    )}
                    <div className="space-y-2">
                      {sub.items.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-lg border bg-card px-4 py-3"
                          data-testid="doc-template-item"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                  {DOC_TYPE_LABELS[t.document_type] ?? t.document_type}
                                </Badge>
                                <span className={`text-sm font-medium truncate ${!t.is_active ? 'text-muted-foreground line-through' : ''}`}>
                                  {t.name}
                                </span>
                                {!t.is_active && (
                                  <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap font-mono bg-muted/30 rounded px-2 py-1">
                                {t.content.slice(0, 120)}{t.content.length > 120 ? '...' : ''}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                변수: &#123;patient_name&#125;, &#123;birth_date&#125;, &#123;visit_date&#125;, &#123;clinic_name&#125;, &#123;doctor_name&#125;
                              </p>
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => openEdit(t)}
                                  data-testid="doc-template-edit-btn"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(t.id, t.name)}
                                  disabled={del.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '서류 템플릿 수정' : '서류 템플릿 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">서류 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 진료 확인서"
                  className="mt-1"
                  data-testid="doc-template-name-input"
                />
              </div>
              <div>
                <Label className="text-xs">서류 유형</Label>
                <Select
                  value={form.document_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, document_type: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* #2(FOLLOWUP2): 2단계 카테고리 (예: 레이저진단서 > 위장장애). 비우면 미분류. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  카테고리 <span className="text-muted-foreground">(1단계, 선택)</span>
                </Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="예) 레이저진단서"
                  className="mt-1"
                  list="doc-category-suggestions"
                  data-testid="doc-template-category-input"
                />
                <datalist id="doc-category-suggestions">
                  {categoryNames.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label className="text-xs">
                  하위 카테고리 <span className="text-muted-foreground">(2단계, 선택)</span>
                </Label>
                <Input
                  value={form.subcategory}
                  onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                  placeholder="예) 위장장애"
                  className="mt-1"
                  list="doc-subcategory-suggestions"
                  data-testid="doc-template-subcategory-input"
                  disabled={form.category.trim() === ''}
                />
                <datalist id="doc-subcategory-suggestions">
                  {subcategoryNames.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <Label className="text-xs">
                템플릿 내용 * <span className="text-muted-foreground ml-1">(&#123;patient_name&#125; &#123;visit_date&#125; 등 변수 사용 가능)</span>
              </Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="서류 내용을 입력하세요..."
                className="mt-1 min-h-[200px] text-sm font-mono resize-none"
                data-testid="doc-template-content-input"
              />
            </div>
            <div className="flex items-center gap-4">
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1 w-20"
                  min={0}
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                />
                <Label className="text-xs">활성화</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="doc-template-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

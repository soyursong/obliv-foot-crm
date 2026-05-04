// PhrasesTab — 상용구 템플릿 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 2, 포팅: derm → foot)
// 어드민에서 상용구 CRUD — 진료 시 의사가 불러쓰는 문구 관리

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PhraseTemplate {
  id: number;
  category: string;
  name: string;
  content: string;
  is_active: boolean;
  sort_order: number;
}

interface PhraseForm {
  category: string;
  name: string;
  content: string;
  is_active: boolean;
  sort_order: number;
}

const EMPTY_FORM: PhraseForm = {
  category: 'charting',
  name: '',
  content: '',
  is_active: true,
  sort_order: 0,
};

const CATEGORY_LABELS: Record<string, string> = {
  charting: '차팅',
  prescription: '처방',
  document: '서류',
  general: '일반',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function usePhraseTemplates() {
  return useQuery({
    queryKey: ['phrase_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phrase_templates')
        .select('id, category, name, content, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PhraseTemplate[];
    },
  });
}

function useUpsertPhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: PhraseForm }) => {
      const payload = {
        category: form.category,
        name: form.name,
        content: form.content,
        is_active: form.is_active,
        sort_order: form.sort_order,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('phrase_templates').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('phrase_templates').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase_templates'] });
      toast.success('상용구가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeletePhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('phrase_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase_templates'] });
      toast.success('상용구가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PhrasesTab() {
  const { data: phrases = [], isLoading } = usePhraseTemplates();
  const upsert = useUpsertPhrase();
  const del = useDeletePhrase();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PhraseTemplate | null>(null);
  const [form, setForm] = useState<PhraseForm>(EMPTY_FORM);
  const [filterCat, setFilterCat] = useState<string>('all');

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(p: PhraseTemplate) {
    setEditing(p);
    setForm({
      category: p.category,
      name: p.name,
      content: p.content,
      is_active: p.is_active,
      sort_order: p.sort_order,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('상용구 이름을 입력해주세요.');
    if (!form.content.trim()) return toast.error('내용을 입력해주세요.');
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 상용구를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  const displayed =
    filterCat === 'all' ? phrases : phrases.filter((p) => p.category === filterCat);

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
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue placeholder="카테고리" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">{displayed.length}개</span>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd} data-testid="phrase-add-btn">
          <Plus className="h-3.5 w-3.5 mr-1" />
          상용구 추가
        </Button>
      </div>

      {/* 목록 */}
      {displayed.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 상용구가 없습니다.
        </div>
      ) : (
        <div className="space-y-2" data-testid="phrase-list">
          {displayed.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between rounded-lg border bg-card px-4 py-3 gap-3"
              data-testid="phrase-item"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {CATEGORY_LABELS[p.category] ?? p.category}
                  </Badge>
                  <span className={`text-sm font-medium truncate ${!p.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {p.name}
                  </span>
                  {!p.is_active && (
                    <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                  {p.content}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => openEdit(p)}
                  data-testid="phrase-edit-btn"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(p.id, p.name)}
                  disabled={del.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '상용구 수정' : '상용구 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">카테고리</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">정렬 순서</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                  className="mt-1 w-full"
                  min={0}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">상용구 이름 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예) 족부 초진 기본"
                className="mt-1"
                data-testid="phrase-name-input"
              />
            </div>
            <div>
              <Label className="text-xs">내용 *</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="진료 메모에 삽입될 내용을 입력하세요..."
                className="mt-1 min-h-[120px] text-sm resize-none"
                data-testid="phrase-content-input"
              />
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
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="phrase-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

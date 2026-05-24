// PhrasesTab — 상용구 템플릿 관리
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 2, 포팅: derm → foot)
// T-20260522-foot-PHRASE-MENU-UX:
//   AC-1: 드롭다운 → 사이드 메뉴 클릭 형태
//   AC-2: 리스트 행 높이/간격 축소 (컴팩트)
//   AC-3: [서류] → [원장님] 라벨 변경

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
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/toast';
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

// AC-3: document '서류' → '원장님'
const CATEGORY_LABELS: Record<string, string> = {
  charting: '차팅',
  prescription: '처방',
  document: '원장님',
  general: '일반',
};

// AC-1: 사이드 메뉴용 카테고리 목록 (전체 포함)
const SIDE_MENU_CATS = [
  { key: 'all', label: '전체' },
  { key: 'charting', label: '차팅' },
  { key: 'prescription', label: '처방' },
  { key: 'document', label: '원장님' },
  { key: 'general', label: '일반' },
] as const;

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
    <div className="space-y-3">
      {/* 헤더: 추가 버튼만 (카운트는 사이드 메뉴에 표시) */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {filterCat === 'all' ? `전체 ${phrases.length}개` : `${CATEGORY_LABELS[filterCat] ?? filterCat} ${displayed.length}개`}
        </span>
        <Button size="sm" variant="outline" onClick={openAdd} data-testid="phrase-add-btn">
          <Plus className="h-3.5 w-3.5 mr-1" />
          상용구 추가
        </Button>
      </div>

      {/* AC-1: 사이드 메뉴 + 리스트 2-컬럼 레이아웃 */}
      <div className="flex rounded-lg border overflow-hidden min-h-[240px]" data-testid="phrase-side-menu-layout">
        {/* 좌측 사이드 메뉴 — 카테고리 클릭 */}
        <div
          className="w-20 flex-shrink-0 border-r bg-muted/10 flex flex-col"
          data-testid="phrase-category-sidebar"
        >
          {SIDE_MENU_CATS.map(({ key, label }) => {
            const count = key === 'all' ? phrases.length : phrases.filter((p) => p.category === key).length;
            const isActive = filterCat === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterCat(key)}
                className={`w-full flex flex-col items-center gap-0.5 px-1 py-2.5 text-center transition-colors border-b border-border/30 last:border-0 ${
                  isActive
                    ? 'bg-teal-50 text-teal-700 font-semibold border-l-2 border-l-teal-500'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                }`}
                data-testid={`phrase-cat-btn-${key}`}
              >
                <span className="text-[11px] leading-tight break-keep">{label}</span>
                <span className={`text-[10px] tabular-nums ${isActive ? 'text-teal-500' : 'text-muted-foreground/60'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 우측 리스트 영역 */}
        <div className="flex-1 min-w-0 overflow-y-auto max-h-[600px]">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-sm text-muted-foreground gap-1.5">
              <span>등록된 상용구가 없습니다.</span>
              <button
                type="button"
                onClick={openAdd}
                className="text-teal-600 text-xs hover:underline"
              >
                + 상용구 추가하기
              </button>
            </div>
          ) : (
            // AC-2: 컴팩트 리스트 — py-3→py-1.5, space-y-2→divide-y
            <div data-testid="phrase-list" className="divide-y divide-border/40">
              {displayed.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-1.5 gap-2 hover:bg-muted/20 transition-colors"
                  data-testid="phrase-item"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                        {CATEGORY_LABELS[p.category] ?? p.category}
                      </Badge>
                      <span
                        className={`text-xs font-medium truncate ${
                          !p.is_active ? 'text-muted-foreground line-through' : ''
                        }`}
                      >
                        {p.name}
                      </span>
                      {!p.is_active && (
                        <Badge variant="outline" className="text-[10px] py-0 shrink-0">비활성</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-1 whitespace-pre-wrap mt-0.5 pl-0.5">
                      {p.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => openEdit(p)}
                      data-testid="phrase-edit-btn"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(p.id, p.name)}
                      disabled={del.isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
                {/* Dialog 내부 portal 충돌 방지 — native select 사용 */}
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
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

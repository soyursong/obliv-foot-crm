/**
 * 공지사항 페이지 — /admin/notices
 * T-20260510-foot-CALENDAR-NOTICE
 *
 * 원내 공지 등록/조회/수정/삭제 (CRUD).
 * notices 테이블 (migration: 20260511000010_notices.sql)
 */
import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Bell, Pencil, Pin, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Notice {
  id: string;
  clinic_id: string;
  title: string;
  content: string | null;
  is_pinned: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export default function Notices() {
  const clinic = useClinic();
  const { profile } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  // 편집 폼 상태
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchNotices = useCallback(async () => {
    if (!clinic) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('notices')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('공지사항 불러오기 실패: ' + error.message);
    } else {
      setNotices((data ?? []) as Notice[]);
    }
    setLoading(false);
  }, [clinic]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  const openNew = () => {
    setEditingId('new');
    setFormTitle('');
    setFormContent('');
    setFormPinned(false);
  };

  const openEdit = (n: Notice) => {
    setEditingId(n.id);
    setFormTitle(n.title);
    setFormContent(n.content ?? '');
    setFormPinned(n.is_pinned);
  };

  const closeForm = () => {
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) { toast.error('제목을 입력해주세요'); return; }
    if (!clinic) { toast.error('클리닉 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); return; }
    setSaving(true);
    if (editingId === 'new') {
      // T-20260516-foot-NOTICE-SAVE-FAIL: INSERT 후 반환값 사용해 로컬 state 즉시 업데이트
      // (SELECT RLS 정책 수정 전 임시 우회 — DB 마이그레이션 20260519000030 적용 후 완전 해결)
      const { data: inserted, error } = await supabase.from('notices').insert({
        clinic_id: clinic.id,
        title: formTitle.trim(),
        content: formContent.trim() || null,
        is_pinned: formPinned,
        created_by: profile?.id ?? null,
      }).select().single();
      if (error) { toast.error('저장 실패: ' + error.message); }
      else {
        toast.success('공지사항이 등록되었습니다');
        closeForm();
        // 로컬 state 즉시 반영 (SELECT RLS 우회)
        if (inserted) {
          setNotices(prev => {
            const updated = [inserted as Notice, ...prev];
            return updated.sort((a, b) =>
              (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) ||
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
          });
        }
        fetchNotices(); // DB RLS 정상화 후 실제 목록 동기화 (실패해도 UI 유지)
      }
    } else if (editingId) {
      const { error } = await supabase.from('notices').update({
        title: formTitle.trim(),
        content: formContent.trim() || null,
        is_pinned: formPinned,
      }).eq('id', editingId);
      if (error) { toast.error('수정 실패: ' + error.message); }
      else {
        toast.success('공지사항이 수정되었습니다');
        closeForm();
        // 로컬 state 즉시 반영
        setNotices(prev =>
          prev.map(n => n.id === editingId
            ? { ...n, title: formTitle.trim(), content: formContent.trim() || null, is_pinned: formPinned }
            : n
          ).sort((a, b) =>
            (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        );
        fetchNotices();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('notices').delete().eq('id', id);
    if (error) { toast.error('삭제 실패: ' + error.message); }
    else {
      toast.success('삭제되었습니다');
      setNotices(prev => prev.filter(n => n.id !== id));
      fetchNotices();
    }
  };

  const handleTogglePin = async (n: Notice) => {
    const newPinned = !n.is_pinned;
    const { error } = await supabase.from('notices').update({ is_pinned: newPinned }).eq('id', n.id);
    if (error) { toast.error('핀 변경 실패'); }
    else {
      setNotices(prev =>
        prev.map(item => item.id === n.id ? { ...item, is_pinned: newPinned } : item)
          .sort((a, b) =>
            (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
      );
      fetchNotices();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b bg-white/80">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-teal-600" />
          <h1 className="text-base font-semibold">공지사항</h1>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> 새 공지
        </Button>
      </div>

      {/* 등록/수정 폼 */}
      {editingId !== null && (
        <div className="shrink-0 border-b bg-teal-50/60 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-teal-800">{editingId === 'new' ? '새 공지 작성' : '공지 수정'}</span>
            <button onClick={closeForm} className="p-1 rounded hover:bg-muted text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">제목 <span className="text-red-500">*</span></Label>
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="공지 제목"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">내용</Label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="공지 내용을 입력하세요"
                rows={4}
                className="mt-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pin-check"
                checked={formPinned}
                onChange={(e) => setFormPinned(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal-600"
              />
              <label htmlFor="pin-check" className="text-xs text-muted-foreground cursor-pointer">상단 고정</label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? '저장 중…' : '저장'}
              </Button>
              <Button size="sm" variant="outline" onClick={closeForm}>취소</Button>
            </div>
          </div>
        </div>
      )}

      {/* 공지 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">불러오는 중…</div>
        ) : notices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
            <Bell className="h-8 w-8 opacity-30" />
            <span>등록된 공지가 없습니다</span>
            <Button size="sm" variant="outline" onClick={openNew} className="mt-2 gap-1">
              <Plus className="h-3.5 w-3.5" /> 첫 공지 작성
            </Button>
          </div>
        ) : (
          notices.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg border bg-white p-3 space-y-1.5 shadow-sm ${n.is_pinned ? 'border-teal-300 bg-teal-50/30' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {n.is_pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-teal-600 fill-teal-600" />}
                  <span className="font-semibold text-sm truncate">{n.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleTogglePin(n)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-teal-700"
                    title={n.is_pinned ? '핀 해제' : '상단 고정'}
                  >
                    <Pin className={`h-3.5 w-3.5 ${n.is_pinned ? 'fill-teal-600 text-teal-600' : ''}`} />
                  </button>
                  <button onClick={() => openEdit(n)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-teal-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(n.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {n.content && (
                <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-4">{n.content}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(n.created_at), 'yyyy-MM-dd HH:mm')}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

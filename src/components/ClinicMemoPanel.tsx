/**
 * ClinicMemoPanel — 원내 공지 메모란
 * T-20260504-foot-CLINIC-MEMO
 *
 * 대시보드 좌측 타임라인 아래에 배치.
 * 선택된 날짜의 메모를 표시/편집 (admin/manager 전용).
 */
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Pencil, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { ClinicMemo, UserRole } from '@/lib/types';

interface ClinicMemoPanelProps {
  date: Date;
  clinicId: string | null | undefined;
  userRole: UserRole | null | undefined;
}

export function ClinicMemoPanel({ date, clinicId, userRole }: ClinicMemoPanelProps) {
  const [memo, setMemo] = useState<ClinicMemo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canEdit = userRole === 'admin' || userRole === 'manager';
  const dateStr = format(date, 'yyyy-MM-dd');

  // 날짜 변경 시 메모 로드
  useEffect(() => {
    if (!clinicId) return;
    setLoading(true);
    setEditing(false);
    supabase
      .from('clinic_memos')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('date', dateStr)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error) setMemo((data as ClinicMemo) ?? null);
        setLoading(false);
      });
  }, [clinicId, dateStr]);

  const handleEdit = () => {
    setDraft(memo?.content ?? '');
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    if (!clinicId) return;
    const content = draft.trim();
    if (!content) {
      // 빈 내용이면 삭제 처리
      if (memo) {
        await handleDelete();
      } else {
        setEditing(false);
      }
      return;
    }
    setSaving(true);
    try {
      if (memo) {
        // 기존 메모 업데이트
        const { data, error } = await supabase
          .from('clinic_memos')
          .update({ content, updated_at: new Date().toISOString() })
          .eq('id', memo.id)
          .select()
          .single();
        if (error) throw error;
        setMemo(data as ClinicMemo);
      } else {
        // 신규 메모 생성
        const { data, error } = await supabase
          .from('clinic_memos')
          .insert({ clinic_id: clinicId, date: dateStr, content })
          .select()
          .single();
        if (error) throw error;
        setMemo(data as ClinicMemo);
      }
      setEditing(false);
      toast.success('메모 저장 완료');
    } catch (err) {
      console.error('[ClinicMemoPanel] save error:', err);
      toast.error('메모 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!memo) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clinic_memos')
        .delete()
        .eq('id', memo.id);
      if (error) throw error;
      setMemo(null);
      setEditing(false);
      toast.success('메모 삭제 완료');
    } catch (err) {
      console.error('[ClinicMemoPanel] delete error:', err);
      toast.error('메모 삭제 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-white flex flex-col shrink-0">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-100 bg-muted/20 sticky bottom-0">
        <div className="flex items-center gap-1 text-xs font-semibold text-gray-600">
          <FileText className="h-3 w-3" />
          원내 메모
        </div>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="p-0.5 rounded hover:bg-teal-50 text-teal-600 transition disabled:opacity-40"
                  title="저장 (Ctrl+Enter)"
                >
                  <Save className="h-3 w-3" />
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="p-0.5 rounded hover:bg-gray-100 text-gray-500 transition disabled:opacity-40"
                  title="취소 (Esc)"
                >
                  <X className="h-3 w-3" />
                </button>
                {memo && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="p-0.5 rounded hover:bg-red-50 text-red-400 transition disabled:opacity-40"
                    title="메모 삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleEdit}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
                title="메모 편집"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 메모 내용 */}
      <div className="p-2 min-h-[40px] max-h-[160px] overflow-y-auto">
        {loading ? (
          <p className="text-[10px] text-gray-300 animate-pulse">불러오는 중…</p>
        ) : editing ? (
          <>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault();
                  handleSave();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancel();
                }
              }}
              rows={4}
              placeholder="원장님 스케줄, 원내 공지 등…"
              className="w-full text-[10px] leading-relaxed border border-gray-200 rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-gray-300"
            />
            <p className="text-[9px] text-gray-300 mt-0.5">Ctrl+Enter 저장 · Esc 취소</p>
          </>
        ) : memo ? (
          <p
            className={cn(
              'text-[10px] leading-relaxed text-gray-700 whitespace-pre-wrap break-words',
              canEdit && 'cursor-text hover:bg-gray-50/60 rounded transition',
            )}
            onClick={canEdit ? handleEdit : undefined}
            title={canEdit ? '클릭하여 편집' : undefined}
          >
            {memo.content}
          </p>
        ) : (
          <p
            className={cn(
              'text-[10px] italic',
              canEdit
                ? 'text-gray-300 cursor-text hover:text-teal-500 transition'
                : 'text-gray-300',
            )}
            onClick={canEdit ? handleEdit : undefined}
          >
            {canEdit ? '+ 메모 추가' : '메모 없음'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * ReservationRegistrarTab — 예약등록자 편집형 마스터 CRUD
 * T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS AC-4b
 *
 * 예약상세 팝업 '예약등록자' 드롭다운의 SSOT 명단(원내/TM)을 관리자가 직접 편집.
 *  - 추가 / 이름수정 / 비활성(toggle) / 정렬(위·아래) / 삭제
 *  - clinic 스코프 + RLS(admin/manager write). 비admin은 read-only.
 * ⚠ staff 계정과 분리된 풋 내부 운영 명단 — STAFF-ROLE-TM-ADD(staff role)와 별개 모델.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Power, PowerOff, Check, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Clinic, ReservationRegistrar } from '@/lib/types';
import { REGISTRAR_GROUPS } from '@/lib/types';

export function ReservationRegistrarTab({ clinic }: { clinic: Clinic }) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';

  const [rows, setRows] = useState<ReservationRegistrar[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 추가 폼
  const [newGroup, setNewGroup] = useState<'원내' | 'TM'>('원내');
  const [newName, setNewName] = useState('');

  // 인라인 이름 수정
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('reservation_registrars')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('group_name', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) {
      toast.error(`예약등록자 명단 로딩 실패: ${error.message}`);
      setRows([]);
    } else {
      setRows((data as ReservationRegistrar[]) ?? []);
    }
    setLoading(false);
  }, [clinic.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── 추가 ──
  const addRegistrar = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('이름을 입력하세요');
      return;
    }
    setBusy(true);
    // 같은 그룹 내 max sort_order + 1
    const groupRows = rows.filter((r) => r.group_name === newGroup);
    const nextSort = groupRows.length > 0
      ? Math.max(...groupRows.map((r) => r.sort_order)) + 1
      : (newGroup === '원내' ? 1 : 100);
    const { error } = await supabase.from('reservation_registrars').insert({
      clinic_id: clinic.id,
      group_name: newGroup,
      name,
      sort_order: nextSort,
      active: true,
      created_by: profile?.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error(`추가 실패: ${error.message}`);
      return;
    }
    toast.success(`${newGroup} - ${name} 추가됨`);
    setNewName('');
    await load();
  };

  // ── 이름 수정 ──
  const startEdit = (r: ReservationRegistrar) => {
    setEditId(r.id);
    setEditName(r.name);
  };
  const saveEdit = async (r: ReservationRegistrar) => {
    const name = editName.trim();
    if (!name) {
      toast.error('이름을 입력하세요');
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from('reservation_registrars')
      .update({ name })
      .eq('id', r.id);
    setBusy(false);
    if (error) {
      toast.error(`수정 실패: ${error.message}`);
      return;
    }
    toast.success('수정됨');
    setEditId(null);
    setEditName('');
    await load();
  };

  // ── 비활성 토글 ──
  const toggleActive = async (r: ReservationRegistrar) => {
    setBusy(true);
    const { error } = await supabase
      .from('reservation_registrars')
      .update({ active: !r.active })
      .eq('id', r.id);
    setBusy(false);
    if (error) {
      toast.error(`상태 변경 실패: ${error.message}`);
      return;
    }
    toast.success(r.active ? '비활성됨 (드롭다운에서 숨김)' : '활성됨');
    await load();
  };

  // ── 정렬 (그룹 내 위·아래 swap) ──
  const move = async (r: ReservationRegistrar, dir: 'up' | 'down') => {
    const groupRows = rows
      .filter((x) => x.group_name === r.group_name)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = groupRows.findIndex((x) => x.id === r.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= groupRows.length) return;
    const other = groupRows[swapIdx];
    setBusy(true);
    // sort_order swap (두 행 교차 업데이트)
    const { error: e1 } = await supabase
      .from('reservation_registrars')
      .update({ sort_order: other.sort_order })
      .eq('id', r.id);
    const { error: e2 } = await supabase
      .from('reservation_registrars')
      .update({ sort_order: r.sort_order })
      .eq('id', other.id);
    setBusy(false);
    if (e1 || e2) {
      toast.error('정렬 변경 실패');
      return;
    }
    await load();
  };

  // ── 삭제 ──
  const remove = async (r: ReservationRegistrar) => {
    if (!window.confirm(`'${r.group_name} - ${r.name}'을(를) 삭제하시겠습니까?\n이미 사용된 예약의 등록자 표시(스냅샷)는 유지됩니다.`)) return;
    setBusy(true);
    const { error } = await supabase
      .from('reservation_registrars')
      .delete()
      .eq('id', r.id);
    setBusy(false);
    if (error) {
      toast.error(`삭제 실패: ${error.message}`);
      return;
    }
    toast.success('삭제됨');
    await load();
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">불러오는 중…</div>;
  }

  return (
    <div className="space-y-5" data-testid="registrar-tab">
      <div>
        <h2 className="text-base font-semibold text-teal-700">예약등록자 명단</h2>
      </div>

      {/* 추가 폼 (admin/manager 전용) */}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">구분</label>
            <Select value={newGroup} onValueChange={(v) => setNewGroup(v as '원내' | 'TM')}>
              <SelectTrigger className="h-9 w-28 text-sm" data-testid="registrar-new-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGISTRAR_GROUPS.map((g) => (
                  <SelectItem key={g} value={g} className="text-sm">{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[160px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">이름</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addRegistrar(); }}
              placeholder="예: 홍길동"
              className="h-9 text-sm"
              data-testid="registrar-new-name"
            />
          </div>
          <Button
            size="sm"
            onClick={addRegistrar}
            disabled={busy || !newName.trim()}
            data-testid="registrar-add-btn"
            className="h-9"
          >
            <Plus className="mr-1 h-4 w-4" /> 추가
          </Button>
        </div>
      )}

      {/* 그룹별 명단 */}
      {REGISTRAR_GROUPS.map((group) => {
        const groupRows = rows
          .filter((r) => r.group_name === group)
          .sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div key={group} className="space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground">{group}</div>
            {groupRows.length === 0 ? (
              <div className="rounded border border-dashed px-3 py-2 text-xs italic text-muted-foreground">
                등록된 인원 없음
              </div>
            ) : (
              <ul className="space-y-1">
                {groupRows.map((r, i) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm"
                    data-testid={`registrar-row-${r.id}`}
                  >
                    {editId === r.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(r); }}
                          className="h-8 flex-1 text-sm"
                          autoFocus
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(r)} disabled={busy} title="저장">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(null); setEditName(''); }} title="취소">
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 ${r.active ? '' : 'text-muted-foreground line-through'}`}>
                          {r.name}
                        </span>
                        {!r.active && <Badge variant="outline" className="text-[10px]">비활성</Badge>}
                        {canEdit && (
                          <div className="flex items-center gap-0.5">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(r, 'up')} disabled={busy || i === 0} title="위로">
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(r, 'down')} disabled={busy || i === groupRows.length - 1} title="아래로">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)} disabled={busy} title="이름 수정">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive(r)} disabled={busy} title={r.active ? '비활성' : '활성'}>
                              {r.active ? <PowerOff className="h-4 w-4 text-amber-600" /> : <Power className="h-4 w-4 text-emerald-600" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(r)} disabled={busy} title="삭제">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

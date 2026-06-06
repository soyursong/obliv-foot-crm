// SuperPhrasesTab — 슈퍼상용구 관리
// Ticket: T-20260603-foot-RX-SUPER-PHRASE
// 진단명 + 임상경과 + 처방내역(rx_items) 3슬롯을 하나의 "슈퍼상용구"로 묶어 CRUD.
//   적용은 MedicalChartPanel 우측 패널 '슈퍼상용구' 진입점에서 각 영역 일괄 라우팅.
//   - Q2: 3슬롯 중 일부만 등록 허용 (빈 슬롯은 적용 시 스킵). 단 최소 1슬롯은 채워야 함.
//   - rx_items 는 prescription_sets.items 와 동일 shape (PrescriptionItem 재사용).
//   - write-guard: 직원 읽기전용, CRUD 는 admin/manager 전용 (admin_write_super_phrases RLS 와 일치).

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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/lib/toast';
import { Loader2, Plus, Pencil, Trash2, X, Sparkles, Stethoscope, FileText, FlaskConical } from 'lucide-react';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import RxCountInput from '@/components/admin/RxCountInput';
// T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-5: 진료차트와 동일 진단명 선택기 재사용
//   (a) 필드 기준 앵커 드롭다운(native datalist 위치 이상 해소) (b) 상병명+코드 항상 동반.
import DiagnosisFolderPicker from '@/components/medical/DiagnosisFolderPicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SuperPhrase {
  id: number;
  name: string;
  diagnosis: string | null;          // 진단명 슬롯 (nullable)
  clinical_progress: string | null;  // 임상경과 슬롯 (nullable)
  rx_items: PrescriptionItem[];       // 처방내역 슬롯 (빈 배열 = 미등록)
  is_active: boolean;
  sort_order: number;
}

interface SuperForm {
  name: string;
  diagnosis: string;
  clinical_progress: string;
  rx_items: PrescriptionItem[];
  is_active: boolean;
  sort_order: number;
}

const EMPTY_ITEM: PrescriptionItem = {
  name: '',
  dosage: '',
  route: '경구',
  frequency: '1일 3회', // 용법(free-text)
  count: null,          // 횟수(숫자만) — FOLLOWUP3 C-2-5
  days: 3,
  notes: '',
};

const EMPTY_FORM: SuperForm = {
  name: '',
  diagnosis: '',
  clinical_progress: '',
  rx_items: [],
  is_active: true,
  sort_order: 0,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useSuperPhrases() {
  return useQuery({
    queryKey: ['super_phrases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('super_phrases')
        .select('id, name, diagnosis, clinical_progress, rx_items, is_active, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        ...d,
        rx_items: (d.rx_items ?? []) as PrescriptionItem[],
      })) as SuperPhrase[];
    },
  });
}

function useUpsertSuper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: SuperForm }) => {
      const payload = {
        name: form.name.trim(),
        // Q2: 빈 슬롯은 null 로 저장 (적용 시 스킵 판정 일관성)
        diagnosis: form.diagnosis.trim() === '' ? null : form.diagnosis.trim(),
        clinical_progress: form.clinical_progress.trim() === '' ? null : form.clinical_progress.trim(),
        rx_items: form.rx_items.filter((i) => i.name.trim() !== '') as unknown as Record<string, unknown>[],
        is_active: form.is_active,
        sort_order: form.sort_order,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const { error } = await supabase.from('super_phrases').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('super_phrases').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super_phrases'] });
      toast.success('슈퍼상용구가 저장됐어요.');
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

function useDeleteSuper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('super_phrases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super_phrases'] });
      toast.success('슈퍼상용구가 삭제됐어요.');
    },
    onError: (e: Error) => toast.error(`삭제 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// C-2 연동 소스 (FOLLOWUP3): 진단명 마스터 / 임상경과 상용구 / 처방세트
// ---------------------------------------------------------------------------

// T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-5: 진단명 자동완성(datalist) 소스(useRegisteredDiagnoses) 폐지.
//   진료차트와 동일한 DiagnosisFolderPicker(services category_label='상병' 자체조회 + 코드 동반)로 일원화.

interface MedicalPhrase {
  id: number;
  name: string;
  content: string;
  phrase_type: 'pen_chart' | 'medical_chart';
}

// AC-2-2: 상용구(phrase_templates) → 임상경과 슬롯 채우기.
// 회귀수정 T-20260605-foot-SUPER-PHRASE-LOAD-FIX (AC-1):
//   기존엔 phrase_type='medical_chart' 단일 필터라, 현장 상용구 대부분(pen_chart 33/34)이 0건 노출 →
//   드롭다운이 미렌더되어 "불러오기 안먹음"으로 보였다. 필터를 완화해 활성 상용구 전체를 노출하고,
//   유형(진료차트/펜차트)은 항목 옆 배지로 구분한다. 임상경과 맥락에 가까운 진료차트를 위로 정렬.
function useMedicalPhrases() {
  return useQuery({
    queryKey: ['super_clinical_phrases_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phrase_templates')
        .select('id, name, content, is_active, phrase_type, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        content: d.content,
        phrase_type: (d.phrase_type ?? 'pen_chart') as 'pen_chart' | 'medical_chart',
      })) as MedicalPhrase[];
      // 안정 정렬: 진료차트 우선, 동일 유형 내에서는 sort_order 순서 유지
      rows.sort((a, b) =>
        a.phrase_type === b.phrase_type ? 0 : a.phrase_type === 'medical_chart' ? -1 : 1,
      );
      return rows;
    },
  });
}

interface RxSetLite {
  id: number;
  name: string;
  items: PrescriptionItem[];
}

// AC-2-3: 처방세트(prescription_sets) → 처방내역 슬롯으로 항목 불러오기.
function useRxSetsLite() {
  return useQuery({
    queryKey: ['rx_sets_lite'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items, is_active, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        items: (d.items ?? []) as PrescriptionItem[],
      })) as RxSetLite[];
    },
  });
}

// ---------------------------------------------------------------------------
// Sub-component: 처방 항목 편집 행 (PrescriptionSetsTab.ItemRow 동형)
// ---------------------------------------------------------------------------
interface ItemRowProps {
  item: PrescriptionItem;
  idx: number;
  onChange: (idx: number, field: keyof PrescriptionItem, val: string | number | null) => void;
  onRemove: (idx: number) => void;
}

function ItemRow({ item, idx, onChange, onRemove }: ItemRowProps) {
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
export default function SuperPhrasesTab() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager';
  const clinicId = (profile as { clinic_id?: string } | null)?.clinic_id ?? null;
  const { data: phrases = [], isLoading, isError } = useSuperPhrases();
  const upsert = useUpsertSuper();
  const del = useDeleteSuper();

  // C-2 연동 소스 (FOLLOWUP3)
  const { data: medicalPhrases = [] } = useMedicalPhrases();           // AC-2-2
  const { data: rxSets = [] } = useRxSetsLite();                       // AC-2-3

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SuperPhrase | null>(null);
  const [form, setForm] = useState<SuperForm>(EMPTY_FORM);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, rx_items: [] });
    setOpen(true);
  }

  function openEdit(s: SuperPhrase) {
    setEditing(s);
    setForm({
      name: s.name,
      diagnosis: s.diagnosis ?? '',
      clinical_progress: s.clinical_progress ?? '',
      rx_items: s.rx_items.length > 0 ? s.rx_items.map((i) => ({ ...i })) : [],
      is_active: s.is_active,
      sort_order: s.sort_order,
    });
    setOpen(true);
  }

  function handleItemChange(idx: number, field: keyof PrescriptionItem, val: string | number | null) {
    setForm((f) => {
      const items = [...f.rx_items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, rx_items: items };
    });
  }

  // T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX AC-5: 슈퍼상용구에서 '처방 항목 추가'(addItem) 기능 제거.
  //   정책 — 처방 항목은 '처방세트'에서만 관리. 슈퍼상용구의 처방내역은 '처방세트 불러오기'(loadRxSet)로만 채운다.
  //   (ad-hoc 빈 처방행 추가 경로 폐지 → addItem 삭제)

  // AC-2-2: 진료차트 상용구(phrase_templates) 적용 — 선택 시 임상경과에 내용 채움(기존 텍스트 있으면 줄바꿈 후 append).
  function applyMedicalPhrase(id: string) {
    const p = medicalPhrases.find((m) => String(m.id) === id);
    if (!p) return;
    setForm((f) => {
      const prev = (f.clinical_progress ?? '').trim();
      const next = prev ? `${prev}\n${p.content}` : p.content;
      return { ...f, clinical_progress: next };
    });
  }

  // AC-2-3: 처방세트(prescription_sets) 불러오기 — 선택 시 세트 항목을 처방내역에 추가(빈 행 제거 후 append).
  function loadRxSet(id: string) {
    const s = rxSets.find((r) => String(r.id) === id);
    if (!s) return;
    const incoming = (s.items ?? []).map((i) => ({ ...EMPTY_ITEM, ...i }));
    if (incoming.length === 0) {
      toast.error('선택한 처방세트에 항목이 없습니다.');
      return;
    }
    setForm((f) => {
      // 사용자가 추가했지만 약품명이 빈 행은 정리하고 세트 항목을 이어붙임
      const kept = f.rx_items.filter((i) => (i.name ?? '').trim() !== '');
      return { ...f, rx_items: [...kept, ...incoming] };
    });
    toast.success(`"${s.name}" 처방세트 ${incoming.length}개 항목을 불러왔습니다.`);
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, rx_items: f.rx_items.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('슈퍼상용구 이름을 입력해주세요.');
    const hasRx = form.rx_items.some((i) => i.name.trim() !== '');
    // Q2: 최소 1슬롯은 채워야 함 (전부 비면 의미 없는 빈 상용구)
    if (!form.diagnosis.trim() && !form.clinical_progress.trim() && !hasRx) {
      return toast.error('진단명·임상경과·처방내역 중 최소 하나는 입력해주세요.');
    }
    // 처방 슬롯에 행이 있으면 각 행에 이름 필수 (빈 행은 저장 시 자동 제거되지만 사용자에게 알림)
    if (form.rx_items.length > 0 && form.rx_items.some((i) => !i.name.trim())) {
      return toast.error('처방 항목에 약품/시술명을 입력하거나 빈 행을 삭제해주세요.');
    }
    await upsert.mutateAsync({ id: editing?.id, form });
    setOpen(false);
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" 슈퍼상용구를 삭제하시겠어요?`)) return;
    del.mutate(id);
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  if (isError)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        슈퍼상용구를 불러오지 못했습니다.<br />
        <span className="text-[11px]">잠시 후 다시 시도하거나 관리자에게 문의하세요.</span>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 안내 */}
      <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 text-[11px] text-teal-800 flex items-start gap-1.5">
        <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          진단명·임상경과·처방내역을 묶어 등록하면, 진료차트에서 한 번에 각 영역으로 일괄 적용됩니다.
          세 항목 중 일부만 등록해도 됩니다 (빈 항목은 적용 시 건너뜁니다).
        </span>
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{phrases.length}개 슈퍼상용구</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={openAdd} data-testid="super-phrase-add-btn">
            <Plus className="h-3.5 w-3.5 mr-1" />
            슈퍼상용구 추가
          </Button>
        )}
      </div>

      {/* 목록 */}
      {phrases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          등록된 슈퍼상용구가 없습니다.
        </div>
      ) : (
        <div className="space-y-2" data-testid="super-phrase-list">
          {phrases.map((s) => (
            <div key={s.id} className="rounded-lg border bg-card px-4 py-3" data-testid="super-phrase-item">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                  <span className={`text-sm font-medium ${!s.is_active ? 'text-muted-foreground line-through' : ''}`}>
                    {s.name}
                  </span>
                  {!s.is_active && <Badge variant="outline" className="text-[10px] py-0">비활성</Badge>}
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
              <div className="space-y-1 text-xs">
                {s.diagnosis && (
                  <div className="flex items-start gap-1.5">
                    <Stethoscope className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground"><span className="font-medium text-foreground">진단명</span> {s.diagnosis}</span>
                  </div>
                )}
                {s.clinical_progress && (
                  <div className="flex items-start gap-1.5">
                    <FileText className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground line-clamp-2"><span className="font-medium text-foreground">임상경과</span> {s.clinical_progress}</span>
                  </div>
                )}
                {s.rx_items.length > 0 && (
                  <div className="flex items-start gap-1.5">
                    <FlaskConical className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">처방 {s.rx_items.length}개</span>{' '}
                      {s.rx_items.slice(0, 3).map((i) => i.name).join(', ')}
                      {s.rx_items.length > 3 ? ` 외 ${s.rx_items.length - 3}개` : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가/편집 다이얼로그 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '슈퍼상용구 수정' : '슈퍼상용구 추가'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-3">
                <Label className="text-xs">슈퍼상용구 이름 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예) 발톱무좀 초진 세트"
                  className="mt-1"
                  data-testid="super-phrase-name-input"
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

            {/* 진단명 슬롯 — T-20260606-foot-MEDCHART-NIGHT-REFEEDBACK AC-5 (a)+(b):
                native datalist(위치 이상) → 진료차트와 동일한 DiagnosisFolderPicker(필드 앵커 드롭다운).
                선택값은 "코드 상병명"으로 동반 저장(상병명+코드 항상 세트). */}
            <div>
              <Label className="text-xs flex items-center gap-1">
                <Stethoscope className="h-3 w-3" /> 진단명 <span className="text-muted-foreground font-normal">(선택)</span>
                <span className="text-[10px] text-teal-600 font-normal">· 등록 상병명 폴더 선택(코드 동반)</span>
              </Label>
              <div className="mt-1">
                <DiagnosisFolderPicker
                  value={form.diagnosis}
                  onChange={(v) => setForm((f) => ({ ...f, diagnosis: v }))}
                  clinicId={clinicId}
                  data-testid="super-phrase-diagnosis-input"
                />
              </div>
            </div>

            {/* 임상경과 슬롯 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 임상경과 <span className="text-muted-foreground font-normal">(선택)</span>
                </Label>
                {/* AC-2-2 (+LOAD-FIX AC-1/AC-2): 상용구 불러오기 — 활성 상용구 전체 노출.
                    0건이어도 드롭다운을 숨기지 않고 비활성 안내로 유지(미사라짐). */}
                {medicalPhrases.length > 0 ? (
                  <Select value="" onValueChange={applyMedicalPhrase}>
                    <SelectTrigger className="h-7 w-[180px] text-[11px]" data-testid="super-phrase-clinical-template-trigger">
                      <SelectValue placeholder="상용구 불러오기" />
                    </SelectTrigger>
                    <SelectContent>
                      {medicalPhrases.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)} className="text-xs">
                          <span className="flex items-center gap-1.5">
                            <span>{m.name}</span>
                            <span
                              className={`text-[9px] px-1 rounded shrink-0 ${
                                m.phrase_type === 'medical_chart'
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-blue-600 bg-blue-50'
                              }`}
                            >
                              {m.phrase_type === 'medical_chart' ? '진료차트' : '펜차트'}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span
                    className="h-7 inline-flex items-center rounded-md border border-dashed px-2 text-[11px] text-muted-foreground"
                    data-testid="super-phrase-clinical-template-empty"
                  >
                    불러올 상용구 없음
                  </span>
                )}
              </div>
              <Textarea
                value={form.clinical_progress}
                onChange={(e) => setForm((f) => ({ ...f, clinical_progress: e.target.value }))}
                placeholder="예) 초진 내원. 발톱 상태 확인. 보행 패턴 점검 완료. 처방 전 동의 완료."
                rows={8}
                className="mt-1 min-h-[180px] text-sm resize-y"
                data-testid="super-phrase-clinical-input"
              />
            </div>

            {/* 처방내역 슬롯 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1">
                  <FlaskConical className="h-3 w-3" /> 처방내역 ({form.rx_items.length}개) <span className="text-muted-foreground font-normal">(선택)</span>
                </Label>
                <div className="flex items-center gap-1.5">
                  {/* AC-2-3: 처방세트(처방리스트) 불러오기 — 선택 시 세트 항목을 처방내역에 추가 */}
                  {rxSets.length > 0 && (
                    <Select value="" onValueChange={loadRxSet}>
                      <SelectTrigger className="h-6 w-[150px] text-[11px]" data-testid="super-phrase-rxset-trigger">
                        <SelectValue placeholder="처방세트 불러오기" />
                      </SelectTrigger>
                      <SelectContent>
                        {rxSets.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                            {r.name} ({(r.items ?? []).length})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {/* AC-5: 'ad-hoc 처방 항목 추가' 버튼 제거 — 처방내역은 위 '처방세트 불러오기'로만 채움(처방항목은 처방세트에서만 관리) */}
                </div>
              </div>
              {form.rx_items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground text-center">
                  처방내역 없음 — 필요 시 위 "처방세트 불러오기"로 추가
                </div>
              ) : (
                <div className="space-y-2">
                  {form.rx_items.map((item, idx) => (
                    <ItemRow key={idx} item={item} idx={idx} onChange={handleItemChange} onRemove={removeItem} />
                  ))}
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
            <Button onClick={handleSave} disabled={upsert.isPending} data-testid="super-phrase-save-btn">
              {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

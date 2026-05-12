// DoctorTreatmentPanel — 의사 진료 패널 (풋센터)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Sub 4, 5, 포팅: derm → foot)
// 진료메모 + 상용구 불러오기 + 처방세트 불러오기 + 의사 컨펌 3단계 (차팅/처방/서류)
// foot-crm 특화: consultation_notes 대신 check_ins 테이블 직접 사용
// 초진/재진 분기(visit_type 기반), 힐러레이저 컨펌 분기 포함

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Loader2,
  CheckCircle2,
  BookOpen,
  Pill,
  FileText,
  ChevronDown,
  ChevronUp,
  Search,
  Zap,
  AlertCircle,
} from 'lucide-react';
import type { PrescriptionItem } from '@/components/admin/PrescriptionSetsTab';
import type { VisitType } from '@/lib/types';
import QuickRxBar, { isDoctor } from './QuickRxBar';
import { useAuth } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PhraseTemplate {
  id: number;
  category: string;
  name: string;
  content: string;
}

interface PrescriptionSet {
  id: number;
  name: string;
  items: PrescriptionItem[];
}

interface DocumentTemplate {
  id: number;
  document_type: string;
  name: string;
  content: string;
}

interface DoctorCheckInFields {
  id: string;
  doctor_note: string | null;
  prescription_items: PrescriptionItem[];
  document_content: string | null;
  doctor_confirm_charting: boolean;
  doctor_confirm_prescription: boolean;
  doctor_confirm_document: boolean;
  doctor_confirmed_at: string | null;
  healer_laser_confirm: boolean;
  prescription_status: 'none' | 'pending' | 'confirmed';
}

// foot-crm visit_type 라벨 (초진/재진)
const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  new: '초진',
  returning: '재진',
};

// ---------------------------------------------------------------------------
// Hooks — 데이터 조회
// ---------------------------------------------------------------------------
function useAllPhrases() {
  return useQuery({
    queryKey: ['phrase_templates', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phrase_templates')
        .select('id, category, name, content')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as PhraseTemplate[];
    },
  });
}

function usePrescriptionSets() {
  return useQuery({
    queryKey: ['prescription_sets', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_sets')
        .select('id, name, items')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as PrescriptionSet[];
    },
  });
}

function useDocumentTemplates() {
  return useQuery({
    queryKey: ['document_templates', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_templates')
        .select('id, document_type, name, content')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as DocumentTemplate[];
    },
  });
}

function useDoctorFields(checkInId: string | null) {
  return useQuery({
    queryKey: ['doctor_fields', checkInId],
    enabled: !!checkInId,
    queryFn: async () => {
      if (!checkInId) return null;
      const { data, error } = await supabase
        .from('check_ins')
        .select(
          'id, doctor_note, prescription_items, document_content, doctor_confirm_charting, doctor_confirm_prescription, doctor_confirm_document, doctor_confirmed_at, healer_laser_confirm, prescription_status',
        )
        .eq('id', checkInId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        prescription_items: (data.prescription_items as unknown as PrescriptionItem[]) ?? [],
        prescription_status: (data.prescription_status as 'none' | 'pending' | 'confirmed') ?? 'none',
      } as DoctorCheckInFields;
    },
    staleTime: 10_000,
  });
}

function useSaveDoctorFields(checkInId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<DoctorCheckInFields>) => {
      if (!checkInId) throw new Error('No check-in ID');
      const payload: Record<string, unknown> = { ...patch };
      // 컨펌 시 confirmed_at 자동 설정
      if (
        patch.doctor_confirm_charting ||
        patch.doctor_confirm_prescription ||
        patch.doctor_confirm_document
      ) {
        if (!payload.doctor_confirmed_at) {
          payload.doctor_confirmed_at = new Date().toISOString();
        }
      }
      const { error } = await supabase
        .from('check_ins')
        .update(payload)
        .eq('id', checkInId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor_fields', checkInId] });
    },
    onError: (e: Error) => toast.error(`저장 실패: ${e.message}`),
  });
}

// ---------------------------------------------------------------------------
// Sub: 상용구 선택 피커
// ---------------------------------------------------------------------------
interface PhrasePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  mode: 'append' | 'replace';
}

function PhrasePicker({ open, onClose, onSelect, mode }: PhrasePickerProps) {
  const { data: phrases = [], isLoading } = useAllPhrases();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<string>('all');

  const filtered = phrases.filter((p) => {
    const matchCat = cat === 'all' || p.category === cat;
    const matchSearch = !search || p.name.includes(search) || p.content.includes(search);
    return matchCat && matchSearch;
  });

  const CAT_LABELS: Record<string, string> = {
    all: '전체',
    charting: '차팅',
    prescription: '처방',
    document: '서류',
    general: '일반',
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            상용구 불러오기
            {mode === 'append' && <Badge variant="outline" className="text-[10px]">추가</Badge>}
            {mode === 'replace' && <Badge variant="outline" className="text-[10px]">교체</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CAT_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground h-5 w-5" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-8">상용구가 없습니다.</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid="phrase-picker-item"
                className="w-full text-left rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors"
                onClick={() => {
                  onSelect(p.content);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {CAT_LABELS[p.category] ?? p.category}
                  </Badge>
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                  {p.content}
                </p>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub: 처방세트 선택 피커
// ---------------------------------------------------------------------------
interface RxSetPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (items: PrescriptionItem[]) => void;
}

function RxSetPicker({ open, onClose, onSelect }: RxSetPickerProps) {
  const { data: sets = [], isLoading } = usePrescriptionSets();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-4 w-4" />
            처방세트 불러오기
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground h-5 w-5" />
            </div>
          ) : sets.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-8">처방세트가 없습니다.</p>
          ) : (
            sets.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid="rx-set-picker-item"
                className="w-full text-left rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors"
                onClick={() => {
                  onSelect(s.items);
                  onClose();
                }}
              >
                <p className="text-sm font-medium mb-1">{s.name}</p>
                {s.items.slice(0, 2).map((item, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground">
                    {item.name} {item.dosage && `— ${item.dosage}`} {item.frequency} {item.days}일
                  </p>
                ))}
                {s.items.length > 2 && (
                  <p className="text-[11px] text-muted-foreground">+{s.items.length - 2}개 더</p>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub: 서류 템플릿 피커
// ---------------------------------------------------------------------------
interface DocTemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
}

function DocTemplatePicker({ open, onClose, onSelect }: DocTemplatePickerProps) {
  const { data: templates = [], isLoading } = useDocumentTemplates();

  const DOC_LABELS: Record<string, string> = {
    diagnosis: '진단서', opinion: '소견서', prescription: '처방전',
    visit_confirmation: '진료확인서', general: '일반',
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            서류 템플릿 불러오기
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground h-5 w-5" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-8">서류 템플릿이 없습니다.</p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid="doc-template-picker-item"
                className="w-full text-left rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors"
                onClick={() => {
                  onSelect(t.content);
                  onClose();
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {DOC_LABELS[t.document_type] ?? t.document_type}
                  </Badge>
                  <span className="text-sm font-medium">{t.name}</span>
                </div>
                <p className="text-xs text-muted-foreground font-mono line-clamp-2">
                  {t.content.slice(0, 80)}...
                </p>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub: 처방 목록 뷰
// ---------------------------------------------------------------------------
function PrescriptionView({
  items,
  onItemsChange,
  confirmed,
}: {
  items: PrescriptionItem[];
  onItemsChange: (items: PrescriptionItem[]) => void;
  confirmed: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        처방 항목이 없습니다. 처방세트를 불러오세요.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 rounded border px-3 py-2 text-xs bg-muted/30"
          data-testid="prescription-item-row"
        >
          <span className="font-medium min-w-[100px]">{item.name}</span>
          {item.dosage && <span className="text-muted-foreground">{item.dosage}</span>}
          <span>{item.route}</span>
          <span>{item.frequency}</span>
          <span>{item.days}일</span>
          {item.notes && (
            <span className="text-muted-foreground text-[10px] ml-auto">{item.notes}</span>
          )}
          {!confirmed && (
            <button
              type="button"
              className="ml-auto text-destructive hover:text-destructive/80 text-[10px]"
              onClick={() => onItemsChange(items.filter((_, i) => i !== idx))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub: ConfirmButton — 컨펌 버튼 (완료 시 초록 체크)
// ---------------------------------------------------------------------------
interface ConfirmButtonProps {
  label: string;
  confirmed: boolean;
  isPending: boolean;
  onConfirm: () => void;
  testId?: string;
}

function ConfirmButton({ label, confirmed, isPending, onConfirm, testId }: ConfirmButtonProps) {
  if (confirmed) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5"
        data-testid={testId}
      >
        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-sm font-medium text-green-700">{label} 컨펌 완료</span>
      </div>
    );
  }

  return (
    <Button
      onClick={onConfirm}
      disabled={isPending}
      className="w-full"
      data-testid={testId}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <CheckCircle2 className="h-4 w-4 mr-2" />
      )}
      {label} 컨펌
    </Button>
  );
}

// ---------------------------------------------------------------------------
// DoctorTreatmentPanel — Main Export (풋센터 버전)
// ---------------------------------------------------------------------------
export interface DoctorTreatmentPanelProps {
  checkInId: string;
  visitType: VisitType;
  /** 힐러레이저 포함 여부 (외부에서 주입 — 기본 false) */
  hasHealerLaser?: boolean;
  /** 저장 완료 후 부모 컴포넌트 갱신 콜백 */
  onUpdated?: () => void;
}

export default function DoctorTreatmentPanel({
  checkInId,
  visitType,
  hasHealerLaser = false,
  onUpdated,
}: DoctorTreatmentPanelProps) {
  const { profile } = useAuth();
  const doctorMode = isDoctor(profile?.role ?? '');
  const { data: fields, isLoading } = useDoctorFields(checkInId);
  const save = useSaveDoctorFields(checkInId);

  // 로컬 편집 상태
  const [doctorNote, setDoctorNote] = useState<string>('');
  const [rxItems, setRxItems] = useState<PrescriptionItem[]>([]);
  const [docContent, setDocContent] = useState<string>('');
  const [fieldsSynced, setFieldsSynced] = useState(false);

  // 피커 오픈 상태
  const [phrasePicker, setPhrasePicker] = useState<{ open: boolean; target: 'note' | 'doc' }>({
    open: false,
    target: 'note',
  });
  const [rxPicker, setRxPicker] = useState(false);
  const [docPicker, setDocPicker] = useState(false);
  const [rxExpanded, setRxExpanded] = useState(true);
  const [docExpanded, setDocExpanded] = useState(false);

  // DB → 로컬 상태 동기화 (최초 1회)
  if (fields && !fieldsSynced) {
    setDoctorNote(fields.doctor_note ?? '');
    setRxItems(fields.prescription_items ?? []);
    setDocContent(fields.document_content ?? '');
    setFieldsSynced(true);
  }

  // 상용구 삽입
  const handlePhraseSelect = useCallback(
    (content: string) => {
      if (phrasePicker.target === 'note') {
        setDoctorNote((prev) => (prev ? `${prev}\n${content}` : content));
      } else {
        setDocContent((prev) => (prev ? `${prev}\n${content}` : content));
      }
    },
    [phrasePicker.target],
  );

  // 처방세트 불러오기
  const handleRxSetSelect = useCallback((items: PrescriptionItem[]) => {
    setRxItems((prev) => {
      const existingNames = new Set(prev.map((i) => i.name));
      const newItems = items.filter((i) => !existingNames.has(i.name));
      return [...prev, ...newItems];
    });
    toast.success('처방세트가 추가됐어요.');
  }, []);

  // 서류 템플릿 불러오기
  const handleDocTemplateSelect = useCallback((content: string) => {
    setDocContent(content);
    setDocExpanded(true);
    toast.success('서류 템플릿이 불러와졌어요. 내용을 확인하고 수정하세요.');
  }, []);

  // 진료 메모 저장
  async function handleSaveNote() {
    await save.mutateAsync({ doctor_note: doctorNote });
    onUpdated?.();
    toast.success('진료 메모가 저장됐어요.');
  }

  // 처방 저장
  async function handleSaveRx() {
    await save.mutateAsync({ prescription_items: rxItems });
    toast.success('처방이 저장됐어요.');
  }

  // 서류 저장
  async function handleSaveDoc() {
    await save.mutateAsync({ document_content: docContent });
    toast.success('서류 내용이 저장됐어요.');
  }

  // 컨펌 핸들러
  async function handleConfirm(type: 'charting' | 'prescription' | 'document') {
    const now = new Date().toISOString();
    if (type === 'charting') {
      await save.mutateAsync({
        doctor_note: doctorNote,
        doctor_confirm_charting: true,
        doctor_confirmed_at: now,
      });
    } else if (type === 'prescription') {
      // T-20260512-foot-QUICK-RX-BUTTON: prescription_status도 'confirmed'로 동기화
      await save.mutateAsync({
        prescription_items: rxItems,
        doctor_confirm_prescription: true,
        doctor_confirmed_at: now,
        prescription_status: 'confirmed',
      });
    } else {
      await save.mutateAsync({
        document_content: docContent,
        doctor_confirm_document: true,
        doctor_confirmed_at: now,
      });
    }
    onUpdated?.();
    toast.success(`${type === 'charting' ? '차팅' : type === 'prescription' ? '처방' : '서류'} 컨펌 완료`);
  }

  // 힐러레이저 컨펌
  async function handleHealerLaserConfirm() {
    await save.mutateAsync({ healer_laser_confirm: true });
    onUpdated?.();
    toast.success('힐러레이저 컨펌 완료');
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const confirmed = fields ?? {
    doctor_confirm_charting: false,
    doctor_confirm_prescription: false,
    doctor_confirm_document: false,
    healer_laser_confirm: false,
    prescription_status: 'none' as const,
  };

  return (
    <div className="space-y-4" data-testid="doctor-treatment-panel">
      {/* ── 방문 유형 배지 (foot에서는 check_ins.visit_type 기반, 읽기 전용) ── */}
      <div className="flex items-center gap-3">
        <Label className="text-xs font-medium shrink-0">방문 유형</Label>
        <Badge
          className={
            visitType === 'new'
              ? 'bg-blue-100 text-blue-700 border-0 text-[10px]'
              : visitType === 'returning'
              ? 'bg-violet-100 text-violet-700 border-0 text-[10px]'
              : 'bg-amber-100 text-amber-700 border-0 text-[10px]'
          }
        >
          {VISIT_TYPE_LABELS[visitType]}
          {visitType === 'new' && ' — 예진차트 확인 필요'}
          {visitType === 'returning' && ' — 기존 차트 조회'}
        </Badge>
      </div>

      <Tabs defaultValue="charting" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="charting" className="text-xs" data-testid="doctor-tab-charting">
            차팅
            {confirmed.doctor_confirm_charting && (
              <CheckCircle2 className="h-3 w-3 ml-1 text-green-600" />
            )}
          </TabsTrigger>
          <TabsTrigger value="prescription" className="text-xs" data-testid="doctor-tab-prescription">
            처방
            {confirmed.doctor_confirm_prescription && (
              <CheckCircle2 className="h-3 w-3 ml-1 text-green-600" />
            )}
          </TabsTrigger>
          <TabsTrigger value="document" className="text-xs" data-testid="doctor-tab-document">
            서류
            {confirmed.doctor_confirm_document && (
              <CheckCircle2 className="h-3 w-3 ml-1 text-green-600" />
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: 차팅 (진료 메모) ── */}
        <TabsContent value="charting" className="space-y-3 pt-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">진료 메모</Label>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs gap-1"
              onClick={() => setPhrasePicker({ open: true, target: 'note' })}
              data-testid="charting-phrase-btn"
            >
              <BookOpen className="h-3 w-3" />
              상용구
            </Button>
          </div>
          <Textarea
            value={doctorNote}
            onChange={(e) => setDoctorNote(e.target.value)}
            placeholder={
              visitType === 'new'
                ? '초진 내원. 주증상: 발톱 __. 기저질환: 없음...'
                : visitType === 'returning'
                ? '재진 내원. 이전 시술 경과 확인...'
                : '체험 내원. 시술 설명 및 체험 진행...'
            }
            className="text-sm min-h-[140px] resize-none"
            disabled={confirmed.doctor_confirm_charting}
            data-testid="doctor-note-textarea"
          />
          {!confirmed.doctor_confirm_charting && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveNote}
                disabled={save.isPending}
                className="flex-1"
              >
                {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                임시 저장
              </Button>
              <ConfirmButton
                label="차팅"
                confirmed={confirmed.doctor_confirm_charting}
                isPending={save.isPending}
                onConfirm={() => handleConfirm('charting')}
                testId="charting-confirm-btn"
              />
            </div>
          )}
          {confirmed.doctor_confirm_charting && (
            <ConfirmButton
              label="차팅"
              confirmed={true}
              isPending={false}
              onConfirm={() => {}}
              testId="charting-confirm-done"
            />
          )}
        </TabsContent>

        {/* ── Tab 2: 처방 ── */}
        <TabsContent value="prescription" className="space-y-3 pt-3">

          {/* ── T-20260512-foot-QUICK-RX-BUTTON: 빠른처방 버튼 바 ── */}
          {!confirmed.doctor_confirm_prescription && (
            <QuickRxBar
              doctorMode={doctorMode}
              onSelectItems={(items) => {
                // 콜백 모드: 처방 목록에 추가 (DB는 부모가 저장)
                setRxItems((prev) => {
                  const existingNames = new Set(prev.map((i) => i.name));
                  const newItems = items.filter((i) => !existingNames.has(i.name));
                  return [...prev, ...newItems];
                });
                // 필드 재동기화를 위해 fieldsSynced 리셋
                setFieldsSynced(false);
              }}
              className="rounded-lg border border-dashed border-teal-200 bg-teal-50/30 p-2"
            />
          )}

          {/* ── 임시처방 대기 배너 (의사에게 확인 요청) ── */}
          {confirmed.prescription_status === 'pending' && !confirmed.doctor_confirm_prescription && (
            <div
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
              data-testid="prescription-pending-banner"
            >
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-xs font-medium text-amber-800 flex-1">
                임시 처방이 입력됨 — 원장 확인 후 확정하세요
              </span>
              {doctorMode && (
                <Button
                  size="sm"
                  className="h-6 text-[11px] bg-teal-600 hover:bg-teal-700 shrink-0"
                  onClick={() => handleConfirm('prescription')}
                  disabled={save.isPending}
                  data-testid="quick-rx-confirm-btn"
                >
                  {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                  확정
                </Button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium"
              onClick={() => setRxExpanded((e) => !e)}
            >
              처방 목록 ({rxItems.length}개)
              {rxExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs gap-1"
              onClick={() => setRxPicker(true)}
              disabled={confirmed.doctor_confirm_prescription}
              data-testid="rx-set-load-btn"
            >
              <Pill className="h-3 w-3" />
              처방세트
            </Button>
          </div>

          {rxExpanded && (
            <PrescriptionView
              items={rxItems}
              onItemsChange={setRxItems}
              confirmed={confirmed.doctor_confirm_prescription}
            />
          )}

          {!confirmed.doctor_confirm_prescription && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveRx}
                disabled={save.isPending}
                className="flex-1"
              >
                {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                임시 저장
              </Button>
              <ConfirmButton
                label="처방"
                confirmed={false}
                isPending={save.isPending}
                onConfirm={() => handleConfirm('prescription')}
                testId="prescription-confirm-btn"
              />
            </div>
          )}
          {confirmed.doctor_confirm_prescription && (
            <ConfirmButton
              label="처방"
              confirmed={true}
              isPending={false}
              onConfirm={() => {}}
              testId="prescription-confirm-done"
            />
          )}
        </TabsContent>

        {/* ── Tab 3: 서류 ── */}
        <TabsContent value="document" className="space-y-3 pt-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium"
              onClick={() => setDocExpanded((e) => !e)}
            >
              서류 내용
              {docExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs gap-1"
                onClick={() => setDocPicker(true)}
                disabled={confirmed.doctor_confirm_document}
                data-testid="doc-template-load-btn"
              >
                <FileText className="h-3 w-3" />
                템플릿
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs gap-1"
                onClick={() => setPhrasePicker({ open: true, target: 'doc' })}
                disabled={confirmed.doctor_confirm_document}
                data-testid="doc-phrase-btn"
              >
                <BookOpen className="h-3 w-3" />
                상용구
              </Button>
            </div>
          </div>

          {docExpanded && (
            <Textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="서류 내용 — 템플릿을 불러오거나 직접 입력하세요..."
              className="text-xs min-h-[180px] resize-none font-mono"
              disabled={confirmed.doctor_confirm_document}
              data-testid="doc-content-textarea"
            />
          )}

          {!confirmed.doctor_confirm_document && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveDoc}
                disabled={save.isPending}
                className="flex-1"
              >
                {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                임시 저장
              </Button>
              <ConfirmButton
                label="서류"
                confirmed={false}
                isPending={save.isPending}
                onConfirm={() => handleConfirm('document')}
                testId="document-confirm-btn"
              />
            </div>
          )}
          {confirmed.doctor_confirm_document && (
            <ConfirmButton
              label="서류"
              confirmed={true}
              isPending={false}
              onConfirm={() => {}}
              testId="document-confirm-done"
            />
          )}
        </TabsContent>
      </Tabs>

      {/* ── 힐러레이저 컨펌 (조건부) ── */}
      {hasHealerLaser && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-800">힐러레이저 컨펌</span>
              <Badge className="bg-orange-100 text-orange-700 border-0 text-[10px]">필수</Badge>
            </div>
            {confirmed.healer_laser_confirm ? (
              <div className="flex items-center gap-1.5 text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium">컨펌 완료</span>
              </div>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                onClick={handleHealerLaserConfirm}
                disabled={save.isPending}
                data-testid="healer-laser-confirm-btn"
              >
                힐러레이저 컨펌
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── 컨펌 진행 상태 요약 ── */}
      <div
        className="rounded-lg border bg-muted/20 px-3 py-2.5"
        data-testid="confirm-status-summary"
      >
        <p className="text-[11px] font-medium text-muted-foreground mb-1.5">컨펌 현황</p>
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: '차팅', done: confirmed.doctor_confirm_charting, id: 'charting-status' },
            { label: '처방', done: confirmed.doctor_confirm_prescription, id: 'prescription-status' },
            { label: '서류', done: confirmed.doctor_confirm_document, id: 'document-status' },
            ...(hasHealerLaser
              ? [{ label: '힐러레이저', done: confirmed.healer_laser_confirm, id: 'healer-status' }]
              : []),
          ].map(({ label, done, id }) => (
            <div key={id} className="flex items-center gap-1" data-testid={id}>
              <span
                className={`inline-block w-2 h-2 rounded-full ${done ? 'bg-green-500' : 'bg-gray-300'}`}
              />
              <span className={`text-[11px] ${done ? 'text-green-700 font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 피커 다이얼로그들 ── */}
      <PhrasePicker
        open={phrasePicker.open}
        onClose={() => setPhrasePicker((p) => ({ ...p, open: false }))}
        onSelect={handlePhraseSelect}
        mode="append"
      />

      <RxSetPicker
        open={rxPicker}
        onClose={() => setRxPicker(false)}
        onSelect={handleRxSetSelect}
      />

      <DocTemplatePicker
        open={docPicker}
        onClose={() => setDocPicker(false)}
        onSelect={handleDocTemplateSelect}
      />
    </div>
  );
}

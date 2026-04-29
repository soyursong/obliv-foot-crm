import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, ArrowRight, ChevronDown, Clock, CreditCard, Phone, FileText, Camera, Package, Plus, Stethoscope, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { STATUS_KO, VISIT_TYPE_KO, stagesFor } from '@/lib/status';
import { formatAmount, parseAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConsentFormButtons } from '@/components/ConsentFormDialog';
import { PreChecklist } from '@/components/PreChecklist';
import { PhotoUpload } from '@/components/PhotoUpload';
import { InsuranceDocPanel } from '@/components/InsuranceDocPanel';
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
import { PACKAGE_PRESETS } from '@/lib/packagePresets';
import type { CheckIn, CheckInStatus, Package as PackageType, PackageRemaining, Service } from '@/lib/types';

// ─── 시술 항목 / 회차 차감 타입 ──────────────────────────────────────────────

type SessionType = 'heated_laser' | 'unheated_laser' | 'iv' | 'preconditioning';

interface TreatmentItem {
  /** 로컬 식별자 */
  _id: string;
  service: Service;
  /** 서비스→패키지 세션 타입 추론 결과 (null이면 단건 결제만 가능) */
  sessionType: SessionType | null;
  /** 패키지 회차 사용 완료 여부 */
  settled: boolean;
}

const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  heated_laser: '가열',
  unheated_laser: '비가열',
  iv: '수액',
  preconditioning: '사전처치',
};

const SESSION_TYPE_FULL: Record<SessionType, string> = {
  heated_laser: '가열레이저',
  unheated_laser: '비가열레이저',
  iv: '수액',
  preconditioning: '사전처치',
};

/** SessionType → PackageRemaining 키 매핑
 *  heated_laser → heated, unheated_laser → unheated (나머지는 동일)
 */
const SESSION_TYPE_TO_REM_KEY: Record<SessionType, keyof PackageRemaining> = {
  heated_laser: 'heated',
  unheated_laser: 'unheated',
  iv: 'iv',
  preconditioning: 'preconditioning',
};

/** 서비스 category·name 텍스트에서 패키지 세션 타입 추론 */
function sessionTypeFromService(svc: Service): SessionType | null {
  const hay = ((svc.category ?? '') + ' ' + (svc.name ?? '')).toLowerCase();
  if (hay.includes('비가열')) return 'unheated_laser';
  if (hay.includes('가열')) return 'heated_laser';
  if (hay.includes('수액') || hay.includes(' iv')) return 'iv';
  if (hay.includes('사전처치') || hay.includes('preconditioning')) return 'preconditioning';
  return null;
}

// ─── 기존 인터페이스 ──────────────────────────────────────────────────────────

interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  installment: number | null;
  payment_type: string;
  created_at: string;
}

interface VisitHistory {
  id: string;
  checked_in_at: string;
  status: string;
  visit_type: string;
  doctor_note: string | null;
  treatment_memo: { details?: string; [key: string]: unknown } | null;
  notes: { text?: string; [key: string]: unknown } | null;
}

interface Props {
  checkIn: CheckIn | null;
  onClose: () => void;
  onUpdated: () => void;
  onPayment: (ci: CheckIn) => void;
}

const METHOD_LABEL: Record<string, string> = {
  card: '카드',
  cash: '현금',
  transfer: '이체',
  membership: '멤버십',
};

// ─── 서브 컴포넌트: 방문 이력 아코디언 ──────────────────────────────────────

function VisitHistoryAccordion({ history }: { history: VisitHistory[] }) {
  const grouped = history.reduce<Record<string, VisitHistory[]>>((acc, h) => {
    const date = format(new Date(h.checked_in_at), 'yyyy-MM-dd');
    (acc[date] ??= []).push(h);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort().reverse();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(dates.slice(0, 1)));

  const toggle = (d: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  return (
    <div className="space-y-1">
      <span className="text-sm font-semibold text-muted-foreground">방문 이력 ({history.length})</span>
      {dates.map((date) => {
        const items = grouped[date];
        const isOpen = expanded.has(date);
        return (
          <div key={date} className="rounded-lg border overflow-hidden">
            <button
              onClick={() => toggle(date)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-muted/50 transition"
            >
              <span className="font-semibold">{date}</span>
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="text-xs">{items.length}건</span>
                <ChevronDown className={cn('h-3 w-3 transition-transform', !isOpen && '-rotate-90')} />
              </div>
            </button>
            {isOpen && (
              <div className="px-2.5 pb-2 space-y-1.5">
                {items.map((h) => (
                  <div key={h.id} className="rounded border px-2 py-1.5 text-xs space-y-1 bg-muted/20">
                    <div className="flex justify-between text-muted-foreground">
                      <span>{format(new Date(h.checked_in_at), 'HH:mm')}</span>
                      <span>{STATUS_KO[h.status as keyof typeof STATUS_KO] ?? h.status}</span>
                    </div>
                    {h.doctor_note && (
                      <div className="text-violet-700">
                        <span className="font-semibold">소견:</span> {h.doctor_note}
                      </div>
                    )}
                    {h.treatment_memo?.details && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">시술:</span> {h.treatment_memo.details}
                      </div>
                    )}
                    {h.notes?.text && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">메모:</span> {h.notes.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 서브 컴포넌트: 단계 이동 버튼 ──────────────────────────────────────────

function StageNavButtons({ checkIn, onUpdated }: { checkIn: CheckIn; onUpdated: () => void }) {
  const stages = stagesFor(checkIn.visit_type);
  const idx = stages.indexOf(checkIn.status);
  const prev = idx > 0 ? stages[idx - 1] : null;
  const next = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;

  const move = async (toStatus: CheckInStatus) => {
    const updates: Record<string, unknown> = { status: toStatus };
    if (toStatus === 'done') updates.completed_at = new Date().toISOString();
    const { error } = await supabase
      .from('check_ins')
      .update(updates)
      .eq('id', checkIn.id);
    if (error) {
      toast.error(`이동 실패: ${error.message}`);
      return;
    }
    await supabase.from('status_transitions').insert({
      check_in_id: checkIn.id,
      clinic_id: checkIn.clinic_id,
      from_status: checkIn.status,
      to_status: toStatus,
    });
    toast.success(`${STATUS_KO[toStatus]}(으)로 이동`);
    onUpdated();
  };

  if (!prev && !next) return null;

  return (
    <div className="flex gap-2">
      {prev && (
        <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={() => move(prev)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {STATUS_KO[prev]}
        </Button>
      )}
      {next && (
        <Button variant="default" size="sm" className="flex-1 gap-1 text-xs" onClick={() => move(next)}>
          {STATUS_KO[next]}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ─── 서브 컴포넌트: 활성 패키지 잔여회차 요약 카드 ──────────────────────────

function ActivePackageSummary({
  packages,
  pkgRemaining,
}: {
  packages: PackageType[];
  pkgRemaining: Map<string, PackageRemaining>;
}) {
  if (packages.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-semibold text-teal-700 flex items-center gap-1">
        <Package className="h-3.5 w-3.5" /> 패키지 잔여회차
      </span>
      {packages.map((pkg) => {
        const rem = pkgRemaining.get(pkg.id);
        const hasAny = rem && rem.total_remaining > 0;
        return (
          <div
            key={pkg.id}
            className={cn(
              'rounded-lg border px-2.5 py-2 space-y-1.5',
              hasAny ? 'border-teal-300 bg-teal-50/60' : 'border-gray-200 bg-gray-50/60',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-teal-900">{pkg.package_name}</span>
              {rem && (
                <span className="text-xs text-muted-foreground">
                  잔여 {rem.total_remaining}/{pkg.total_sessions}회
                </span>
              )}
            </div>
            {rem ? (
              <div className="flex gap-1.5 flex-wrap">
                {rem.heated > 0 && (
                  <span className="inline-flex items-center text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 font-medium">
                    가열 {rem.heated}
                  </span>
                )}
                {rem.unheated > 0 && (
                  <span className="inline-flex items-center text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">
                    비가열 {rem.unheated}
                  </span>
                )}
                {rem.iv > 0 && (
                  <span className="inline-flex items-center text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-medium">
                    수액 {rem.iv}
                  </span>
                )}
                {rem.preconditioning > 0 && (
                  <span className="inline-flex items-center text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-medium">
                    사전처치 {rem.preconditioning}
                  </span>
                )}
                {rem.total_remaining === 0 && (
                  <span className="text-xs text-muted-foreground">잔여 없음</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">로딩 중…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function CheckInDetailSheet({ checkIn, onClose, onUpdated, onPayment }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [services, setServices] = useState<Service[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [history, setHistory] = useState<VisitHistory[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [pkgRemaining, setPkgRemaining] = useState<Map<string, PackageRemaining>>(new Map());
  const [notes, setNotes] = useState('');
  const [treatmentMemo, setTreatmentMemo] = useState('');
  const [doctorNote, setDoctorNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  // ── 시술 항목 상태 ──
  const [treatmentItems, setTreatmentItems] = useState<TreatmentItem[]>([]);
  const [svcModalOpen, setSvcModalOpen] = useState(false);
  const [sessionUseOpen, setSessionUseOpen] = useState(false);
  const [sessionUsePkg, setSessionUsePkg] = useState<PackageType | null>(null);
  const [sessionUseRemaining, setSessionUseRemaining] = useState<PackageRemaining | null>(null);
  const [sessionUseType, setSessionUseType] = useState<SessionType>('unheated_laser');
  const [sessionUseTreatmentIdx, setSessionUseTreatmentIdx] = useState<number>(-1);

  // 체크인 변경 시 시술 항목 초기화
  useEffect(() => {
    setTreatmentItems([]);
  }, [checkIn?.id]);

  const load = useCallback(async () => {
    if (!checkIn) return;

    const [svcRes, payRes, histRes, pkgRes] = await Promise.all([
      supabase
        .from('services')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('payments')
        .select('id, amount, method, installment, payment_type, created_at')
        .eq('check_in_id', checkIn.id),
      checkIn.customer_id
        ? supabase
            .from('check_ins')
            .select('id, checked_in_at, status, visit_type, doctor_note, treatment_memo, notes')
            .eq('customer_id', checkIn.customer_id)
            .neq('id', checkIn.id)
            .order('checked_in_at', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      checkIn.customer_id
        ? supabase
            .from('packages')
            .select('*')
            .eq('customer_id', checkIn.customer_id)
            .eq('status', 'active')
            .order('contract_date', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    setServices((svcRes.data ?? []) as Service[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);
    setHistory((histRes.data ?? []) as VisitHistory[]);
    const pkgs = (pkgRes.data ?? []) as PackageType[];
    setPackages(pkgs);

    const remMap = new Map<string, PackageRemaining>();
    await Promise.all(
      pkgs.map(async (p) => {
        const { data } = await supabase.rpc('get_package_remaining', { p_package_id: p.id });
        if (data) remMap.set(p.id, data as PackageRemaining);
      }),
    );
    setPkgRemaining(remMap);

    const noteObj = checkIn.notes as Record<string, string> | null;
    setNotes(noteObj?.text ?? '');
    setTreatmentMemo(checkIn.treatment_memo?.details ?? '');
    setDoctorNote(checkIn.doctor_note ?? '');
  }, [checkIn]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteCheckIn = async () => {
    if (!checkIn) return;
    if (!window.confirm('체크인을 삭제하시겠습니까?\n결제 데이터가 없을 때만 삭제됩니다.')) return;
    const { count } = await supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('check_in_id', checkIn.id);
    if ((count ?? 0) > 0) {
      toast.error(`결제 데이터가 있어 삭제할 수 없습니다 (${count}건). 결제를 먼저 취소하세요.`);
      return;
    }
    const { error } = await supabase.from('check_ins').delete().eq('id', checkIn.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('체크인 삭제됨');
    onClose();
    onUpdated();
  };

  const saveNotes = async () => {
    if (!checkIn) return;
    setSaving(true);
    const notesObj = { ...(checkIn.notes as Record<string, unknown> ?? {}), text: notes };
    const memoObj = { ...(checkIn.treatment_memo ?? {}), details: treatmentMemo };
    const { error } = await supabase
      .from('check_ins')
      .update({ notes: notesObj, treatment_memo: memoObj, doctor_note: doctorNote || null })
      .eq('id', checkIn.id);
    setSaving(false);
    if (error) {
      toast.error('저장 실패');
      return;
    }
    toast.success('메모 저장됨');
    onUpdated();
  };

  const moveToPaymentWaiting = async () => {
    if (!checkIn) return;
    const { error } = await supabase
      .from('check_ins')
      .update({ status: 'payment_waiting' })
      .eq('id', checkIn.id);
    if (error) { toast.error(`이동 실패: ${error.message}`); return; }
    await supabase.from('status_transitions').insert({
      check_in_id: checkIn.id,
      clinic_id: checkIn.clinic_id,
      from_status: checkIn.status,
      to_status: 'payment_waiting',
    });
    toast.success('수납대기로 이동');
    onUpdated();
  };

  const totalPaid = payments
    .filter((p) => p.payment_type === 'payment')
    .reduce((s, p) => s + p.amount, 0);

  if (!checkIn) return null;

  const mins = Math.floor((Date.now() - new Date(checkIn.checked_in_at).getTime()) / 60000);

  // ── 시술 항목 헬퍼 ──
  const addTreatmentItem = (svc: Service) => {
    const item: TreatmentItem = {
      _id: `${svc.id}-${Date.now()}`,
      service: svc,
      sessionType: sessionTypeFromService(svc),
      settled: false,
    };
    setTreatmentItems((prev) => [...prev, item]);
  };

  const removeTreatmentItem = (idx: number) => {
    setTreatmentItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const markSettled = (idx: number) => {
    setTreatmentItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, settled: true } : item)),
    );
  };

  /** idx 번째 시술 항목에 연결되는 첫 번째 유효 패키지 반환 */
  const findPkgForItem = (item: TreatmentItem): PackageType | null => {
    if (!item.sessionType) return null;
    return (
      packages.find((pkg) => {
        const rem = pkgRemaining.get(pkg.id);
        if (!rem) return false;
        // SESSION_TYPE_TO_REM_KEY로 올바르게 변환:
        // 'heated_laser' → 'heated', 'unheated_laser' → 'unheated'
        const field = SESSION_TYPE_TO_REM_KEY[item.sessionType!];
        const val = rem[field];
        return typeof val === 'number' && val > 0;
      }) ?? null
    );
  };

  const hasSettledItem = treatmentItems.some((i) => i.settled);
  const canMoveToPaymentWaiting =
    hasSettledItem &&
    checkIn.status !== 'payment_waiting' &&
    checkIn.status !== 'treatment_waiting' &&
    checkIn.status !== 'done' &&
    checkIn.status !== 'cancelled';

  return (
    <Sheet open={!!checkIn} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 flex-1">
              {checkIn.queue_number != null && (
                <span className="text-teal-700">#{checkIn.queue_number}</span>
              )}
              {checkIn.customer_name}
            </SheetTitle>
            {isAdmin && (
              <button
                onClick={deleteCheckIn}
                className="rounded p-1.5 hover:bg-red-50 transition shrink-0"
                title="체크인 삭제 (관리자)"
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 기본 정보 */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={checkIn.visit_type === 'new' ? 'teal' : 'secondary'}>
              {VISIT_TYPE_KO[checkIn.visit_type]}
            </Badge>
            <Badge variant="outline">{STATUS_KO[checkIn.status]}</Badge>
            {checkIn.priority_flag && (
              <Badge variant="destructive">{checkIn.priority_flag}</Badge>
            )}
            {checkIn.notes?.id_check_required && (
              <button
                title="클릭하면 신분증 확인 완료 처리"
                onClick={async () => {
                  const newNotes = {
                    ...(checkIn.notes as Record<string, unknown> ?? {}),
                    id_check_required: false,
                  };
                  const { error } = await supabase
                    .from('check_ins')
                    .update({ notes: newNotes })
                    .eq('id', checkIn.id);
                  if (!error) {
                    toast.success('신분증 확인 완료');
                    onUpdated();
                  } else {
                    toast.error('업데이트 실패');
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:opacity-80 active:scale-95 cursor-pointer"
                style={{
                  backgroundColor: '#FEE2E2',
                  color: '#B91C1C',
                  border: '1.5px solid #FECACA',
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block animate-pulse" />
                신분증 확인 필요 · 탭하여 해제
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {checkIn.customer_phone && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" />
                {checkIn.customer_phone}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {format(new Date(checkIn.checked_in_at), 'HH:mm')} 접수
              <span className={cn(mins >= 30 && 'text-red-600 font-semibold')}>
                ({mins}분)
              </span>
            </div>
          </div>

          {/* 단계 이동 */}
          <StageNavButtons checkIn={checkIn} onUpdated={onUpdated} />

          {/* ── [NEW] 활성 패키지 잔여회차 요약 (재진/초진 모두, 패키지 있을 때만) ── */}
          {packages.length > 0 && (
            <>
              <Separator />
              <ActivePackageSummary packages={packages} pkgRemaining={pkgRemaining} />
            </>
          )}

          {/* 공간 배정 */}
          {(checkIn.examination_room || checkIn.consultation_room || checkIn.treatment_room || checkIn.laser_room) && (
            <>
              <Separator />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-muted-foreground">공간 배정</span>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {checkIn.examination_room && <Badge variant="outline">원장실: {checkIn.examination_room}</Badge>}
                  {checkIn.consultation_room && <Badge variant="outline">상담실: {checkIn.consultation_room}</Badge>}
                  {checkIn.treatment_room && <Badge variant="outline">치료실: {checkIn.treatment_room}</Badge>}
                  {checkIn.laser_room && <Badge variant="outline">레이저실: {checkIn.laser_room}</Badge>}
                </div>
              </div>
            </>
          )}

          {/* 체크리스트 + 동의서 */}
          <Separator />
          <div className="space-y-2">
            <span className="text-sm font-semibold text-muted-foreground">체크리스트 / 동의서</span>
            <div className="flex flex-wrap gap-1.5">
              {checkIn.visit_type === 'new' && (
                <Button
                  variant={checkIn.notes?.checklist ? 'default' : 'outline'}
                  size="sm"
                  className={cn('text-xs gap-1', checkIn.notes?.checklist && 'bg-emerald-600 hover:bg-emerald-700')}
                  onClick={() => {
                    if (!checkIn.notes?.checklist) setChecklistOpen(true);
                  }}
                >
                  {checkIn.notes?.checklist ? '✓ 체크리스트' : '📋 체크리스트'}
                </Button>
              )}
            </div>
            <ConsentFormButtons checkIn={checkIn} onSigned={onUpdated} />
          </div>

          {/* 패키지 구성 (초진 + 미결제 + 패키지 없음) */}
          {checkIn.visit_type === 'new' && !checkIn.package_id && packages.length === 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" /> 패키지 선택
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(PACKAGE_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      className="rounded-lg border border-input px-2.5 py-2 text-left text-xs hover:border-teal-400 hover:bg-teal-50/50 transition space-y-0.5"
                      onClick={async () => {
                        if (!checkIn.customer_id) {
                          toast.error('고객 정보가 없어 패키지를 생성할 수 없습니다');
                          return;
                        }
                        if (!window.confirm(`${preset.label} 패키지를 생성하시겠습니까?`)) return;
                        const { data: pkg, error } = await supabase
                          .from('packages')
                          .insert({
                            clinic_id: checkIn.clinic_id,
                            customer_id: checkIn.customer_id,
                            package_name: preset.label,
                            package_type: key,
                            total_sessions: preset.total,
                            heated_sessions: preset.heated,
                            unheated_sessions: preset.unheated,
                            iv_sessions: preset.iv,
                            preconditioning_sessions: preset.preconditioning,
                            total_amount: preset.suggestedPrice,
                            paid_amount: 0,
                            status: 'active',
                            contract_date: new Date().toISOString().slice(0, 10),
                          })
                          .select('id')
                          .single();
                        if (error) {
                          toast.error(`패키지 생성 실패: ${error.message}`);
                          return;
                        }
                        await supabase
                          .from('check_ins')
                          .update({ package_id: pkg.id })
                          .eq('id', checkIn.id);
                        toast.success(`${preset.label} 패키지 생성 + 연결 완료`);
                        onUpdated();
                      }}
                    >
                      <div className="font-semibold">{preset.label}</div>
                      <div className="text-muted-foreground">{formatAmount(preset.suggestedPrice)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── [NEW] 시술 항목 선택 + 회차 차감 분기 ── */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                <Stethoscope className="h-3.5 w-3.5" /> 시술 항목
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setSvcModalOpen(true)}
              >
                <Plus className="h-3 w-3" /> 추가
              </Button>
            </div>

            {treatmentItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">선택된 시술 없음 — 위 [추가] 버튼으로 시술을 선택하세요</p>
            ) : (
              <div className="space-y-1.5">
                {treatmentItems.map((item, idx) => {
                  const targetPkg = findPkgForItem(item);
                  const canUsePackage = !!targetPkg;

                  return (
                    <div
                      key={item._id}
                      data-testid="treatment-item-row"
                      className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{item.service.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatAmount(item.service.price)}
                          {item.sessionType && (
                            <span className="ml-1 text-teal-600">· {SESSION_TYPE_LABELS[item.sessionType]}</span>
                          )}
                        </div>
                      </div>

                      {item.settled ? (
                        <Badge variant="success" className="text-xs shrink-0">✓ 완료</Badge>
                      ) : canUsePackage ? (
                        <Button
                          size="sm"
                          data-testid="btn-use-package-session"
                          className="text-xs h-8 bg-teal-600 hover:bg-teal-700 shrink-0"
                          onClick={() => {
                            setSessionUsePkg(targetPkg);
                            setSessionUseRemaining(pkgRemaining.get(targetPkg.id) ?? null);
                            setSessionUseType(item.sessionType!);
                            setSessionUseTreatmentIdx(idx);
                            setSessionUseOpen(true);
                          }}
                        >
                          패키지 회차 사용
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="btn-single-payment"
                          className="text-xs h-8 shrink-0"
                          onClick={() => onPayment(checkIn)}
                        >
                          단건 결제
                        </Button>
                      )}

                      <button
                        onClick={() => removeTreatmentItem(idx)}
                        className="rounded p-1 hover:bg-muted shrink-0"
                        title="시술 항목 삭제"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 수납대기 전환 버튼 — 회차 소진 완료 항목 있고, 아직 수납대기 전 단계일 때 */}
            {canMoveToPaymentWaiting && (
              <Button
                size="sm"
                data-testid="btn-move-payment-waiting"
                className="w-full gap-1 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={moveToPaymentWaiting}
              >
                수납대기로 이동
              </Button>
            )}
          </div>

          {/* 결제 */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">결제</span>
              {totalPaid > 0 ? (
                <Badge variant="success" className="text-xs">
                  결제완료 {formatAmount(totalPaid)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-orange-600">미결제</Badge>
              )}
            </div>
            {payments.length > 0 ? (
              <div className="space-y-1">
                {payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span>
                      {METHOD_LABEL[p.method] ?? p.method}
                      {p.installment && p.installment > 0 ? ` ${p.installment}개월` : ''}
                    </span>
                    <span className={cn('tabular-nums', p.payment_type === 'refund' && 'text-red-600')}>
                      {p.payment_type === 'refund' ? '-' : ''}
                      {formatAmount(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                onClick={() => onPayment(checkIn)}
              >
                <CreditCard className="h-3.5 w-3.5" /> 결제 등록
              </Button>
            )}
          </div>

          {/* 패키지 상세 목록 (연결 + 잔여 세부 표시) */}
          {checkIn.customer_id && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" /> 패키지
                  </span>
                  {checkIn.package_id && (
                    <Badge variant="teal" className="text-xs">연결됨</Badge>
                  )}
                </div>
                {packages.length > 0 ? (
                  <div className="space-y-1.5">
                    {packages.map((pkg) => {
                      const isLinked = checkIn.package_id === pkg.id;
                      const rem = pkgRemaining.get(pkg.id);
                      const usedPct = rem && pkg.total_sessions > 0
                        ? Math.round((rem.total_used / pkg.total_sessions) * 100)
                        : 0;
                      return (
                        <div
                          key={pkg.id}
                          className={cn(
                            'rounded-lg border p-2 text-xs space-y-1',
                            isLinked ? 'border-teal-300 bg-teal-50/50' : 'border-input',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{pkg.package_name}</span>
                            <Badge variant={isLinked ? 'teal' : 'outline'} className="text-xs">
                              {formatAmount(pkg.total_amount)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>가열 {rem?.heated ?? pkg.heated_sessions}</span>
                            <span>비가열 {rem?.unheated ?? pkg.unheated_sessions}</span>
                            <span>수액 {rem?.iv ?? pkg.iv_sessions}</span>
                            <span>사전처치 {rem?.preconditioning ?? pkg.preconditioning_sessions}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className="h-full bg-teal-500 rounded-full"
                                style={{ width: `${Math.min(usedPct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{usedPct}%</span>
                          </div>
                          {!isLinked && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-xs h-9 mt-1"
                              onClick={async () => {
                                if (!window.confirm('이 패키지를 시술에 연결하시겠습니까?')) return;
                                const { error } = await supabase
                                  .from('check_ins')
                                  .update({ package_id: pkg.id })
                                  .eq('id', checkIn.id);
                                if (error) {
                                  toast.error('패키지 연결 실패');
                                  return;
                                }
                                toast.success('패키지 연결 완료');
                                onUpdated();
                              }}
                            >
                              이 시술에 연결
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">활성 패키지 없음</p>
                )}
              </div>
            </>
          )}

          {/* 상담 메모 */}
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> 상담 메모
              <span className="ml-auto text-xs font-normal text-muted-foreground">상담 단계</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="상담 내용을 기록하세요"
              rows={3}
              className="text-sm"
            />
          </div>

          {/* 원장 소견 */}
          {(() => {
            const isExaminationStage = checkIn.status === 'examination' || checkIn.status === 'exam_waiting';
            return (
              <div className={cn(
                'space-y-2 rounded-md p-3 transition',
                isExaminationStage
                  ? 'bg-violet-50 ring-2 ring-violet-300'
                  : 'bg-violet-50/40 ring-1 ring-violet-100',
              )}>
                <Label className="text-sm font-semibold text-violet-900 flex items-center gap-1">
                  <Stethoscope className="h-3 w-3" /> 원장 소견
                  <span className="ml-auto text-xs font-normal text-violet-700/80">
                    {isExaminationStage ? '진료 중' : '선택 입력 (원장 미진료 시도 메모 가능)'}
                  </span>
                </Label>
                <Textarea
                  value={doctorNote}
                  onChange={(e) => setDoctorNote(e.target.value)}
                  placeholder="원장 소견을 자유롭게 입력하세요 (원장 미참여 시 상담실장이 대리 메모 가능)"
                  rows={3}
                  className="text-sm bg-white border-violet-200 focus-visible:ring-violet-400"
                />
              </div>
            );
          })()}

          {/* 시술 기록 */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <Camera className="h-3 w-3" /> 시술 기록
              <span className="ml-auto text-xs font-normal text-muted-foreground">시술 완료 후</span>
            </Label>
            <Textarea
              value={treatmentMemo}
              onChange={(e) => setTreatmentMemo(e.target.value)}
              placeholder="시술 기록, 사용 장비, 특이사항"
              rows={3}
              className="text-sm"
            />
          </div>

          <Button size="sm" onClick={saveNotes} disabled={saving} className="w-full">
            {saving ? '저장 중…' : '메모 저장'}
          </Button>

          {/* 비포/애프터 사진 */}
          <Separator />
          <PhotoUpload
            checkInId={checkIn.id}
            photos={checkIn.treatment_photos ?? []}
            onUpdated={onUpdated}
          />

          {/* 보험 영수증 / 처방전 */}
          <Separator />
          <InsuranceDocPanel checkIn={checkIn} onUpdated={onUpdated} />

          {/* 서류 발행 */}
          <Separator />
          <DocumentPrintPanel checkIn={checkIn} onUpdated={onUpdated} />

          {/* 방문 이력 */}
          {history.length > 0 && (
            <>
              <Separator />
              <VisitHistoryAccordion history={history} />
            </>
          )}
        </div>

        <PreChecklist
          checkIn={checkIn}
          open={checklistOpen}
          onOpenChange={setChecklistOpen}
          onCompleted={() => {
            setChecklistOpen(false);
            onUpdated();
          }}
        />

        {/* 시술 선택 모달 */}
        <ServiceSelectModal
          open={svcModalOpen}
          services={services}
          onClose={() => setSvcModalOpen(false)}
          onSelect={addTreatmentItem}
        />

        {/* 패키지 회차 사용 다이얼로그 */}
        <SessionUseInSheetDialog
          open={sessionUseOpen}
          pkg={sessionUsePkg}
          remaining={sessionUseRemaining}
          defaultSessionType={sessionUseType}
          onOpenChange={setSessionUseOpen}
          onDone={() => {
            setSessionUseOpen(false);
            if (sessionUseTreatmentIdx >= 0) {
              markSettled(sessionUseTreatmentIdx);
            }
            load(); // 잔여회차 갱신
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

// ─── 서브 컴포넌트: 시술 선택 모달 ──────────────────────────────────────────

function ServiceSelectModal({
  open,
  services,
  onClose,
  onSelect,
}: {
  open: boolean;
  services: Service[];
  onClose: () => void;
  onSelect: (svc: Service) => void;
}) {
  // 카테고리별 그루핑
  const grouped = services.reduce<Record<string, Service[]>>((acc, s) => {
    const cat = s.category || '기타';
    (acc[cat] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" /> 시술 선택
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {Object.keys(grouped).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              등록된 시술 없음 — 관리자에게 문의
            </p>
          ) : (
            Object.entries(grouped).map(([cat, svcs]) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5 sticky top-0 bg-background py-0.5">
                  {cat}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {svcs.map((s) => {
                    const sType = sessionTypeFromService(s);
                    return (
                      <button
                        key={s.id}
                        data-testid={`svc-option-${s.id}`}
                        onClick={() => {
                          onSelect(s);
                          onClose();
                        }}
                        className="rounded-lg border border-input px-2.5 py-2.5 text-left text-xs hover:border-teal-400 hover:bg-teal-50/50 active:scale-[0.98] transition space-y-0.5"
                      >
                        <div className="font-medium">{s.name}</div>
                        <div className="text-muted-foreground">{formatAmount(s.price)}</div>
                        {sType && (
                          <div className="text-teal-600 font-medium">
                            {SESSION_TYPE_FULL[sType]}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 서브 컴포넌트: 시트 내 패키지 회차 사용 다이얼로그 ──────────────────────

function SessionUseInSheetDialog({
  open,
  pkg,
  remaining,
  defaultSessionType,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  pkg: PackageType | null;
  remaining: PackageRemaining | null;
  defaultSessionType: SessionType;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType);
  const [surcharge, setSurcharge] = useState(0);
  const [surchargeMemo, setSurchargeMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // defaultSessionType 변경 시 반영
  useEffect(() => {
    setSessionType(defaultSessionType);
    setSurcharge(0);
    setSurchargeMemo('');
  }, [defaultSessionType, open]);

  const available: Record<SessionType, number> = {
    heated_laser: remaining?.heated ?? 0,
    unheated_laser: remaining?.unheated ?? 0,
    iv: remaining?.iv ?? 0,
    preconditioning: remaining?.preconditioning ?? 0,
  };

  const save = async () => {
    if (!pkg) return;
    if ((available[sessionType] ?? 0) <= 0) {
      toast.error('남은 회차가 없습니다');
      return;
    }
    setSubmitting(true);

    const { count } = await supabase
      .from('package_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', pkg.id);
    const nextNumber = (count ?? 0) + 1;

    const { error } = await supabase.from('package_sessions').insert({
      package_id: pkg.id,
      session_number: nextNumber,
      session_type: sessionType,
      surcharge: surcharge || 0,
      surcharge_memo: surchargeMemo.trim() || null,
      status: 'used',
    });

    setSubmitting(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    toast.success('패키지 회차 소진 완료');
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-teal-600" />
            패키지 회차 사용
          </DialogTitle>
        </DialogHeader>

        {pkg && (
          <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2 text-xs space-y-0.5">
            <div className="font-semibold text-teal-900">{pkg.package_name}</div>
            <div className="flex gap-2 text-teal-700">
              <span>가열 {remaining?.heated ?? 0}</span>
              <span>비가열 {remaining?.unheated ?? 0}</span>
              <span>수액 {remaining?.iv ?? 0}</span>
              <span>사전처치 {remaining?.preconditioning ?? 0}</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>시술 종류</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['unheated_laser', 'heated_laser', 'iv', 'preconditioning'] as const).map((t) => (
                <button
                  key={t}
                  data-testid={`session-type-btn-${t}`}
                  onClick={() => setSessionType(t)}
                  disabled={available[t] <= 0}
                  className={cn(
                    'h-11 rounded-md border text-sm font-medium transition',
                    available[t] <= 0 && 'opacity-40 cursor-not-allowed',
                    sessionType === t
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {SESSION_TYPE_FULL[t]}
                  <span className="ml-1 text-xs text-muted-foreground">({available[t]})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>당일 추가금 (옵션)</Label>
            <Input
              value={formatAmount(surcharge)}
              onChange={(e) => setSurcharge(parseAmount(e.target.value))}
              inputMode="numeric"
              placeholder="0"
            />
          </div>

          {surcharge > 0 && (
            <div className="space-y-1.5">
              <Label>추가금 메모</Label>
              <Input
                value={surchargeMemo}
                onChange={(e) => setSurchargeMemo(e.target.value)}
                placeholder="추가금 사유"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            data-testid="btn-confirm-session-use"
            disabled={submitting || !pkg || available[sessionType] <= 0}
            onClick={save}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {submitting ? '처리 중…' : '회차 소진 기록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

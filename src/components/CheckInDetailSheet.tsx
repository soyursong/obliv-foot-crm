import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, ArrowRight, ChevronDown, Clock, CreditCard, Phone, FileText, Camera, Package, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { STATUS_KO, VISIT_TYPE_KO, stagesFor } from '@/lib/status';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConsentFormButtons } from '@/components/ConsentFormDialog';
import { PreChecklist } from '@/components/PreChecklist';
import { PhotoUpload } from '@/components/PhotoUpload';
import { InsuranceDocPanel } from '@/components/InsuranceDocPanel';
import { PACKAGE_PRESETS } from '@/lib/packagePresets';
import type { CheckIn, CheckInStatus, Package as PackageType, PackageRemaining, Service } from '@/lib/types';

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
                    {(h.notes as any)?.text && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold">메모:</span> {(h.notes as any).text}
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

export function CheckInDetailSheet({ checkIn, onClose, onUpdated, onPayment }: Props) {
  const [, setServices] = useState<Service[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [history, setHistory] = useState<VisitHistory[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [pkgRemaining, setPkgRemaining] = useState<Map<string, PackageRemaining>>(new Map());
  const [notes, setNotes] = useState('');
  const [treatmentMemo, setTreatmentMemo] = useState('');
  const [doctorNote, setDoctorNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

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

  const totalPaid = payments
    .filter((p) => p.payment_type === 'payment')
    .reduce((s, p) => s + p.amount, 0);

  if (!checkIn) return null;

  const mins = Math.floor((Date.now() - new Date(checkIn.checked_in_at).getTime()) / 60000);

  return (
    <Sheet open={!!checkIn} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[440px] max-h-screen overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {checkIn.queue_number != null && (
              <span className="text-teal-700">#{checkIn.queue_number}</span>
            )}
            {checkIn.customer_name}
          </SheetTitle>
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
                  variant={(checkIn.notes as any)?.checklist ? 'default' : 'outline'}
                  size="sm"
                  className={cn('text-xs gap-1', (checkIn.notes as any)?.checklist && 'bg-emerald-600 hover:bg-emerald-700')}
                  onClick={() => {
                    if (!(checkIn.notes as any)?.checklist) setChecklistOpen(true);
                  }}
                >
                  {(checkIn.notes as any)?.checklist ? '✓ 체크리스트' : '📋 체크리스트'}
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

          {/* 패키지 */}
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

          {/* 진료 소견 (의사) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <Stethoscope className="h-3 w-3" /> 진료 소견
              <span className="ml-auto text-xs font-normal text-muted-foreground">진료 단계</span>
            </Label>
            <Textarea
              value={doctorNote}
              onChange={(e) => setDoctorNote(e.target.value)}
              placeholder="의사 진료 소견을 입력하세요"
              rows={3}
              className="text-sm border-violet-200 focus-visible:ring-violet-400"
            />
          </div>

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

          {/* 방문 이력 (날짜별 아코디언) */}
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
      </SheetContent>
    </Sheet>
  );
}

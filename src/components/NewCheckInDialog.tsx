import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Reservation, VisitType } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string | undefined;
  onCreated?: () => void;
}

const VISIT_CHOICES: { value: VisitType; label: string }[] = [
  { value: 'new', label: '신규' },
  { value: 'returning', label: '재진' },
  { value: 'experience', label: '체험' },
];

export function NewCheckInDialog({ open, onOpenChange, clinicId, onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('new');
  const [submitting, setSubmitting] = useState(false);
  const [todayReservations, setTodayReservations] = useState<Reservation[]>([]);
  const [linkedReservation, setLinkedReservation] = useState<Reservation | null>(null);

  useEffect(() => {
    if (!open || !clinicId) return;
    setName('');
    setPhone('');
    setVisitType('new');
    setLinkedReservation(null);

    (async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase
        .from('reservations')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('reservation_date', today)
        .eq('status', 'confirmed')
        .order('reservation_time', { ascending: true });
      setTodayReservations((data ?? []) as Reservation[]);
    })();
  }, [open, clinicId]);

  const selectReservation = (r: Reservation) => {
    setLinkedReservation(r);
    setName(r.customer_name ?? '');
    setPhone(r.customer_phone ?? '');
    setVisitType(r.visit_type);
  };

  const handlePhoneBlur = async () => {
    if (!phone.trim() || !clinicId) return;
    const { data } = await supabase
      .from('customers')
      .select('id, name, visit_type')
      .eq('clinic_id', clinicId)
      .eq('phone', phone.trim())
      .maybeSingle();
    if (data) {
      if (!name.trim()) setName(data.name as string);
      if (visitType === 'new') setVisitType('returning');
      toast.info(`${data.name}님 — 기존 고객`);
    }
  };

  const autoAssignConsultant = async (clinicId: string): Promise<string | null> => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase.rpc('assign_consultant_atomic', {
      p_clinic_id: clinicId,
      p_date: today,
    });
    return (data as string | null) ?? null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicId) return;
    setSubmitting(true);

    let customerId: string | null = linkedReservation?.customer_id ?? null;
    if (!customerId && phone.trim()) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', phone.trim())
        .maybeSingle();
      if (existing) {
        customerId = existing.id as string;
      } else {
        const { data: created, error: cErr } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: name.trim(),
            phone: phone.trim(),
            visit_type: visitType === 'new' ? 'new' : 'returning',
          })
          .select('id')
          .single();
        if (cErr) {
          toast.error(`고객 생성 실패: ${cErr.message}`);
          setSubmitting(false);
          return;
        }
        customerId = (created as { id: string }).id;
      }
    }

    const { data: queueData, error: queueErr } = await supabase.rpc('next_queue_number', {
      p_clinic_id: clinicId,
      p_date: new Date().toISOString().slice(0, 10),
    });
    if (queueErr) {
      toast.error(`대기번호 생성 실패: ${queueErr.message}`);
      setSubmitting(false);
      return;
    }

    let consultantId: string | null = null;
    if (visitType === 'new') {
      consultantId = await autoAssignConsultant(clinicId);
    }

    const { error } = await supabase.from('check_ins').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      reservation_id: linkedReservation?.id ?? null,
      customer_name: name.trim(),
      customer_phone: phone.trim() || null,
      visit_type: visitType,
      status: 'registered',
      queue_number: queueData as number,
      consultant_id: consultantId,
    });

    if (error) {
      toast.error(`체크인 실패: ${error.message}`);
      setSubmitting(false);
      return;
    }

    if (linkedReservation) {
      await supabase
        .from('reservations')
        .update({ status: 'checked_in' })
        .eq('id', linkedReservation.id);
    }

    toast.success(`${name.trim()} 체크인 완료 (#${queueData})`);
    setSubmitting(false);
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>체크인 추가</DialogTitle>
        </DialogHeader>

        {/* 오늘 예약 목록 */}
        {todayReservations.length > 0 && !linkedReservation && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">오늘 예약 ({todayReservations.length}건)</Label>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {todayReservations.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectReservation(r)}
                  className="flex w-full items-center justify-between rounded border px-3 py-1.5 text-sm hover:bg-muted/40 transition"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{r.customer_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.reservation_time?.slice(0, 5)}
                    </span>
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {r.visit_type === 'new' ? '신규' : '재진'}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {linkedReservation && (
          <div className="flex items-center justify-between rounded border bg-teal-50 px-3 py-2 text-sm">
            <span>
              예약 연결: <strong>{linkedReservation.customer_name}</strong>{' '}
              {linkedReservation.reservation_time?.slice(0, 5)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => {
              setLinkedReservation(null);
              setName('');
              setPhone('');
            }}>
              해제
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ci-name">이름</Label>
            <Input
              id="ci-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus={!linkedReservation}
              placeholder="홍길동"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-phone">전화번호</Label>
            <Input
              id="ci-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={handlePhoneBlur}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="grid grid-cols-3 gap-2">
              {VISIT_CHOICES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setVisitType(c.value)}
                  className={cn(
                    'h-10 rounded-md border text-sm font-medium transition',
                    visitType === c.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !phone.trim()}>
              {submitting ? '처리 중…' : '체크인'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

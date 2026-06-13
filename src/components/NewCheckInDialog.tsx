import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { normalizeToE164 } from '@/lib/phone';
import { formatPhone, chartNoBadge } from '@/lib/format';
import { Button } from '@/components/ui/button';
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
import { InlinePatientSearch, type PatientMatch } from '@/components/InlinePatientSearch';
import type { Reservation, VisitType } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string | undefined;
  onCreated?: () => void;
}

const VISIT_CHOICES: { value: VisitType; label: string }[] = [
  { value: 'new', label: '초진' },
  { value: 'returning', label: '재진' },
  { value: 'experience', label: '선체험' },
];

export function NewCheckInDialog({ open, onOpenChange, clinicId, onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('new');
  const [submitting, setSubmitting] = useState(false);
  const [todayReservations, setTodayReservations] = useState<Reservation[]>([]);
  // T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 예약 고객(customer_id) → 차트번호 맵
  const [resvChartMap, setResvChartMap] = useState<Map<string, string>>(new Map());
  const [linkedReservation, setLinkedReservation] = useState<Reservation | null>(null);
  /** 인라인 검색으로 선택된 기존 고객 */
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  /** 폼 전체 초기화 — 제출 완료 후 또는 다이얼로그 닫힐 때 호출 */
  const resetDialog = () => {
    setName('');
    setPhone('');
    setVisitType('new');
    setLinkedReservation(null);
    setSelectedCustomerId(null);
    setTodayReservations([]);
  };

  useEffect(() => {
    // open 변경 시 항상 초기화 (닫힐 때도 포함)
    resetDialog();

    if (!open || !clinicId) return;

    // 열릴 때만 오늘 예약 목록 패치
    (async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase
        .from('reservations')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('reservation_date', today)
        .eq('status', 'confirmed')
        .order('reservation_time', { ascending: true });
      const resvs = (data ?? []) as Reservation[];
      setTodayReservations(resvs);
      // 예약 고객들의 차트번호 일괄 조회 → 동명이인 구분(미발번도 명시)
      const custIds = Array.from(new Set(resvs.map((r) => r.customer_id).filter(Boolean))) as string[];
      if (custIds.length > 0) {
        const { data: chartData } = await supabase
          .from('customers')
          .select('id, chart_number')
          .in('id', custIds);
        const m = new Map<string, string>();
        for (const c of (chartData ?? []) as { id: string; chart_number: string | null }[]) {
          if (c.chart_number) m.set(c.id, c.chart_number);
        }
        setResvChartMap(m);
      } else {
        setResvChartMap(new Map());
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clinicId]);

  const selectReservation = (r: Reservation) => {
    setLinkedReservation(r);
    setName(r.customer_name ?? '');
    setPhone(formatPhone(r.customer_phone) || '');
    setVisitType(r.visit_type);
    // 예약 연결 시 고객 ID도 설정
    if (r.customer_id) setSelectedCustomerId(r.customer_id);
  };

  /** 인라인 검색 드롭다운에서 기존 고객 선택 */
  const handlePatientSelect = (p: PatientMatch) => {
    setName(p.name);
    setPhone(formatPhone(p.phone) || '');
    setSelectedCustomerId(p.id);
    setVisitType('returning');
    toast.info(`${p.name}님 — 기존 고객 선택`);
  };

  const handleClearSelection = () => {
    setSelectedCustomerId(null);
  };

  const autoAssignConsultant = async (cid: string): Promise<string | null> => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase.rpc('assign_consultant_atomic', {
      p_clinic_id: cid,
      p_date: today,
    });
    return (data as string | null) ?? null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicId) return;
    setSubmitting(true);

    // AC1: 수동 선택 없으면 todayReservations에서 자동 매칭
    // 동일 날짜(이미 필터됨) + 전화번호 OR 성함 일치 → 1건만 자동 연결
    let effectiveLinkedReservation: Reservation | null = linkedReservation;
    if (!effectiveLinkedReservation && todayReservations.length > 0) {
      const normalizedInputPhone = phone.trim()
        ? (normalizeToE164(phone) ?? phone.trim())
        : null;
      const trimmedName = name.trim();

      const matches = todayReservations.filter((r) => {
        if (normalizedInputPhone && r.customer_phone) {
          const rPhone = normalizeToE164(r.customer_phone) ?? r.customer_phone;
          if (rPhone === normalizedInputPhone) return true;
        }
        if (trimmedName && r.customer_name && r.customer_name === trimmedName) return true;
        return false;
      });

      if (matches.length === 1) {
        effectiveLinkedReservation = matches[0];
        toast.info(
          `예약 자동 연결: ${matches[0].customer_name} ${matches[0].reservation_time?.slice(0, 5)}`,
        );
      }
      // 0건 → null 유지 (walk-in), 2건 이상 → null 유지 (모호)
    }

    // selectedCustomerId가 있으면 우선 사용 (인라인 검색으로 선택된 고객)
    let customerId: string | null =
      selectedCustomerId ?? effectiveLinkedReservation?.customer_id ?? null;

    if (!customerId && phone.trim()) {
      // Fix-1 (T-20260517-foot-CHECKIN-E164): E.164 정규화 후 조회
      const phoneE164 = normalizeToE164(phone) ?? phone.trim();
      const phoneDigits = phone.replace(/\D/g, '');

      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('phone', phoneE164)
        .maybeSingle();

      // Fix-3: 2차 fallback — E.164 매칭 실패 시 digits-only ilike (SelfCheckIn.tsx 패턴)
      let resolvedExisting = existing as { id: string } | null;
      if (!resolvedExisting && phoneDigits.length >= 8) {
        const { data: fallback } = await supabase
          .from('customers')
          .select('id')
          .eq('clinic_id', clinicId)
          .ilike('phone', `%${phoneDigits.slice(-8)}%`)
          .maybeSingle();
        resolvedExisting = fallback as { id: string } | null;
      }

      if (resolvedExisting) {
        customerId = resolvedExisting.id as string;
      } else {
        const { data: created, error: cErr } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: name.trim(),
            // Fix-2 (T-20260517-foot-CHECKIN-E164): 신규 생성 시 E.164 저장
            phone: phoneE164,
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
    } else if (visitType === 'returning' && customerId) {
      // T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL
      // AC-1: 재진 체크인 시 customers.assigned_staff_id → consultant_id 자동 세팅
      // AC-2: assigned_staff_id NULL → consultantId null 유지 (기존 동작)
      // AC-3: INSERT 시점에만 세팅 — UPDATE 이후 수동 변경은 덮어쓰지 않음
      const { data: cust } = await supabase
        .from('customers')
        .select('assigned_staff_id')
        .eq('id', customerId)
        .maybeSingle();
      consultantId = (cust?.assigned_staff_id as string | null) ?? null;
    }

    const { error } = await supabase.from('check_ins').insert({
      clinic_id: clinicId,
      customer_id: customerId,
      reservation_id: effectiveLinkedReservation?.id ?? null,
      customer_name: name.trim(),
      customer_phone: phone.trim() ? (normalizeToE164(phone) ?? phone.trim()) : null,
      visit_type: visitType,
      // AC-1/AC-2: 재진 → 치료대기, 체험(예약없이방문) → 상담대기 (T-20260514-foot-CHECKIN-AUTO-STAGE)
      // T-20260613-foot-FIELDBATCH item2: 초진(new) → [접수중](receiving). 셀프접수 초진 동선(SelfCheckIn receiving)과 통일.
      //   receiving은 기존 CheckInStatus enum 값(types.ts)·기존 칸반 컬럼(receiving_col) — 신규 상태값 아님(CHECK constraint 갱신 불요).
      status: visitType === 'returning'
        ? 'treatment_waiting'
        : visitType === 'new'
          ? 'receiving'
          : 'consult_waiting',
      queue_number: queueData as number,
      consultant_id: consultantId,
    });

    if (error) {
      toast.error(`체크인 실패: ${error.message}`);
      setSubmitting(false);
      return;
    }

    if (effectiveLinkedReservation) {
      await supabase
        .from('reservations')
        .update({ status: 'checked_in' })
        .eq('id', effectiveLinkedReservation.id);
    }

    toast.success(`${name.trim()} 체크인 완료 (#${queueData})`);
    setSubmitting(false);
    resetDialog();   // 제출 성공 직후 폼 초기화 (다이얼로그 닫히기 전)
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
                    {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 등록환자면 차트번호 항상 표시 */}
                    {r.customer_id && (
                      <span className={cn('font-mono text-[11px]', resvChartMap.get(r.customer_id) ? 'text-teal-600' : 'text-muted-foreground')}>
                        {chartNoBadge(resvChartMap.get(r.customer_id))}
                      </span>
                    )}
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
              {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
              예약 연결: <strong>{linkedReservation.customer_name}</strong>{' '}
              {linkedReservation.customer_id && (
                <span className="font-mono text-[11px] text-teal-600">{chartNoBadge(resvChartMap.get(linkedReservation.customer_id))}</span>
              )}{' '}
              {linkedReservation.reservation_time?.slice(0, 5)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLinkedReservation(null);
                setSelectedCustomerId(null);
                setName('');
                setPhone('');
              }}
            >
              해제
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 이름 — 인라인 자동검색 */}
          <div className="space-y-1.5">
            <Label htmlFor="ci-name">이름</Label>
            <InlinePatientSearch
              id="ci-name"
              value={name}
              onChange={(v) => {
                setName(v);
                // 수동 입력 시 선택 해제
                if (selectedCustomerId) setSelectedCustomerId(null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={handleClearSelection}
              searchField="name"
              clinicId={clinicId}
              selectedCustomerId={selectedCustomerId}
              placeholder="홍길동"
              required
              autoFocus={!linkedReservation}
            />
          </div>

          {/* 전화번호 — 인라인 자동검색 */}
          <div className="space-y-1.5">
            <Label htmlFor="ci-phone">전화번호</Label>
            <InlinePatientSearch
              id="ci-phone"
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (selectedCustomerId) setSelectedCustomerId(null);
              }}
              onSelect={handlePatientSelect}
              onClearSelection={handleClearSelection}
              searchField="phone"
              clinicId={clinicId}
              selectedCustomerId={selectedCustomerId}
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

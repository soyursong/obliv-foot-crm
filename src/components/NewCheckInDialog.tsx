import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { normalizeToE164, phoneCanonDigits } from '@/lib/phone';
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
// T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 재방 미수금 배너/뱃지 (자동 문자 발송 없음 — 화면 표기만)
import { loadCustomerOutstanding, type CustomerOutstanding } from '@/lib/footBilling';
import { PkgOutstandingBadge } from '@/components/PkgOutstandingBadge';
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
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 예약 고객 미수금 맵(row 뱃지) + 선택 고객 미수금(배너)
  const [outstandingMap, setOutstandingMap] = useState<Map<string, CustomerOutstanding>>(new Map());
  const [selectedOutstanding, setSelectedOutstanding] = useState<CustomerOutstanding | null>(null);
  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 체크인 시 미수금>0이면 [수납]/[그냥 진행] 확인 팝업.
  const [confirmOutstanding, setConfirmOutstanding] = useState(false);

  /** 폼 전체 초기화 — 제출 완료 후 또는 다이얼로그 닫힐 때 호출 */
  const resetDialog = () => {
    setName('');
    setPhone('');
    setVisitType('new');
    setLinkedReservation(null);
    setSelectedCustomerId(null);
    setTodayReservations([]);
    setSelectedOutstanding(null);
    setConfirmOutstanding(false);
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
      // T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 예약 고객 활성 패키지 미수금 일괄 조회(row 뱃지용).
      setOutstandingMap(custIds.length > 0 ? await loadCustomerOutstanding(custIds, clinicId) : new Map());
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clinicId]);

  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 고객 식별(검색/예약 연결) 시 미수금 조회 → 배너.
  useEffect(() => {
    if (!open || !clinicId || !selectedCustomerId) { setSelectedOutstanding(null); return; }
    const cached = outstandingMap.get(selectedCustomerId);
    if (cached) { setSelectedOutstanding(cached); return; }
    let cancelled = false;
    (async () => {
      const m = await loadCustomerOutstanding([selectedCustomerId], clinicId);
      if (!cancelled) setSelectedOutstanding(m.get(selectedCustomerId) ?? null);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId, open, clinicId]);

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

  // T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 선택 고객 미수금(패키지/진료비 잔금) 존재 여부.
  const hasOutstanding =
    !!selectedOutstanding &&
    (selectedOutstanding.packageDue > 0 || selectedOutstanding.consultationDue > 0);

  // 체크인 버튼 클릭 → 미수금>0이면 [수납]/[그냥 진행] 확인 팝업으로 가로채고(§8 ③), 잔금 0이면 바로 진행.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicId || submitting) return;
    if (hasOutstanding && !confirmOutstanding) {
      setConfirmOutstanding(true);
      return;
    }
    void proceedCheckIn();
  };

  const proceedCheckIn = async () => {
    if (!clinicId) return;
    setConfirmOutstanding(false);
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
      // ── 고객 해소: 복합키(성함 AND 연락처) — T-20260617-foot-CHECKIN-CHART-LINK-3KEY AC-1 ② ──
      //   스태프 수동 체크인(예약/인라인검색 미선택 walk-in)에서 기존엔 phone 단독(.eq + ilike fallback)
      //   으로 조회 → 연락처 중복 시 동명이인/타 고객('문자테스트') 임의 연결(6/17 김사비 오배정 클래스).
      //   성함=eq 정확매칭 + 연락처 canonical(포맷 무관) 비교. 차트번호로 정확히 찍으려면 인라인검색
      //   (InlinePatientSearch)으로 선택 → selectedCustomerId 직결(이 fallback 자체를 안 탐).
      //   · 정확히 1건 → 연결 / 0건 → 신규 INSERT / 2건+ → 임의연결 금지(미연결, 대시보드 재해소).
      const phoneE164 = normalizeToE164(phone) ?? phone.trim();
      const inputPhoneCanon = phoneCanonDigits(phone);
      const trimmedName = name.trim();

      let resolvedExisting: { id: string } | null = null;
      let ambiguousLink = false;
      if (trimmedName && inputPhoneCanon) {
        const { data: nameMatches } = await supabase
          .from('customers')
          .select('id, phone')
          .eq('clinic_id', clinicId)
          .eq('name', trimmedName)
          .limit(10);
        const matched = ((nameMatches ?? []) as Array<{ id: string; phone: string | null }>)
          .filter((c) => phoneCanonDigits(c.phone) === inputPhoneCanon);
        if (matched.length === 1) {
          resolvedExisting = { id: matched[0].id };
        } else if (matched.length > 1) {
          ambiguousLink = true; // 성함+연락처 동시중복 → 임의연결·신규생성 보류(미연결)
        }
      }

      if (resolvedExisting) {
        customerId = resolvedExisting.id as string;
      } else if (!ambiguousLink) {
        const { data: created, error: cErr } = await supabase
          .from('customers')
          .insert({
            clinic_id: clinicId,
            name: trimmedName,
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
      } else {
        // 성함+연락처 동시중복: 어느 고객이 본인인지 단정 불가 → customer_id 미연결로 체크인 진행.
        // 대시보드에서 차트번호/인라인검색으로 정확 연결하도록 안내(임의 오배정 방지).
        toast.warning('동일 성함·연락처 고객이 둘 이상입니다 — 미연결로 접수합니다. 대시보드에서 차트번호로 연결하세요.');
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
    <>
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
                    {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 예약 row 잔금 뱃지(잔금>0만) */}
                    <PkgOutstandingBadge data={r.customer_id ? outstandingMap.get(r.customer_id) : undefined} />
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

        {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ④: 재방 미수금 배너 — 미수금>0 데스크 경고.
            §4-A: 패키지/진료비 잔금 별도 표기. 자동 SMS/알림톡 독촉 없음(화면 표기만). */}
        {selectedOutstanding && (selectedOutstanding.packageDue > 0 || selectedOutstanding.consultationDue > 0) && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2" data-testid="checkin-outstanding-banner">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <span>⚠ 미수금 있음</span>
              <PkgOutstandingBadge data={selectedOutstanding} />
            </div>
            <div className="mt-0.5 text-[11px] text-red-600">결제 화면에서 잔금을 안내·수납하세요.</div>
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

    {/* T-20260616-foot-PKG-OUTSTANDING-BALANCE ③: 미수금 있는 고객 체크인 확인 팝업.
        체크인 버튼 클릭 → 잔금>0이면 이 팝업으로 [수납]/[그냥 진행] 확인(잔금 0이면 미노출, 바로 체크인).
        §4-A: 패키지/진료비 잔금을 합산 단일표기하지 않고 별도 칩(PkgOutstandingBadge)으로 병기. 자동 SMS 없음. */}
    <Dialog open={confirmOutstanding} onOpenChange={(o) => { if (!o) setConfirmOutstanding(false); }}>
      <DialogContent className="max-w-sm" data-testid="checkin-outstanding-confirm">
        <DialogHeader>
          <DialogTitle>미납금 안내</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            미납금이 있어요. 수납 후 진행하시겠어요?
          </p>
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <PkgOutstandingBadge data={selectedOutstanding ?? undefined} />
          </div>
        </div>
        <DialogFooter>
          {/* [수납]: 체크인하지 않고 팝업만 닫음 → 데스크가 결제 화면에서 수납 후 다시 진행. */}
          <Button
            type="button"
            variant="outline"
            data-testid="checkin-outstanding-settle"
            onClick={() => setConfirmOutstanding(false)}
          >
            수납
          </Button>
          {/* [그냥 진행]: 미수금 있어도 체크인 진행. */}
          <Button
            type="button"
            data-testid="checkin-outstanding-proceed"
            disabled={submitting}
            onClick={() => { void proceedCheckIn(); }}
          >
            {submitting ? '처리 중…' : '그냥 진행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

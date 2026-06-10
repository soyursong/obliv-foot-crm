// T-20260516-foot-RESV-DETAIL-POPUP: 예약 상세 팝업 4분할 레이아웃
// 환자 클릭 시 2열 × 2행 = 4분할 모달
// 좌상: 환자정보 8필드 | 우상: 선택 예약 상세
// 좌하: 전체 예약 히스토리 | 우하: 메모 2종
// T-20260522-foot-CHECKIN-FIRST-INFO: 초진 접수 시 정보입력 폼 분기

import { useEffect, useState } from 'react';
import { CheckinFirstInfoDialog } from '@/components/CheckinFirstInfoDialog';
import { toast } from '@/lib/toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import { VISIT_TYPE_KO } from '@/lib/status';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReservationMemoTimeline } from '@/components/ReservationMemoTimeline';
// T-20260522-foot-RESV-HISTORY-SYNC AC-2/3: 예약 변경 이력 공유 패널
import { ReservationAuditLogPanel } from '@/components/ReservationAuditLogPanel';
import type { Customer, Package, Reservation, Staff } from '@/lib/types';

const STATUS_LABEL: Record<Reservation['status'], string> = {
  confirmed: '예약',
  checked_in: '체크인',
  cancelled: '취소',
  noshow: '노쇼',
};

const VISIT_TYPE_BADGE_CLASS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  returning: 'bg-emerald-100 text-emerald-700',
  experience: 'bg-amber-100 text-amber-700',
};

const GENDER_KO: Record<string, string> = { M: '남', F: '여' };

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────

export function ReservationDetailPopup({
  reservation,
  noshowCount,
  changedBy,
  authorName,
  isAdmin,
  onClose,
  onEdit,
  onChanged,
}: {
  reservation: Reservation | null;
  noshowCount: number;
  changedBy: string | null;
  authorName: string;
  isAdmin?: boolean;
  onClose: () => void;
  onEdit: (r: Reservation) => void;
  onChanged: () => void;
}) {
  // ── 액션 상태
  const [busy, setBusy] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // T-20260522-foot-CHECKIN-FIRST-INFO: 초진 정보입력 폼 다이얼로그
  const [showFirstInfoDialog, setShowFirstInfoDialog] = useState(false);

  // ── 4분할 데이터
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [allResvs, setAllResvs] = useState<Reservation[]>([]);
  const [consultants, setConsultants] = useState<Staff[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);

  // ── 우상 선택 상태: 좌하에서 클릭 → selectedResvId 변경
  const [selectedResvId, setSelectedResvId] = useState<string | null>(null);

  // ── 우하 메모 상태
  const [customerMemo, setCustomerMemo] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  // ── 우상 상담사 상태
  const [selectedConsultantId, setSelectedConsultantId] = useState<string>('');
  const [consultantSaving, setConsultantSaving] = useState(false);

  // 현재 우상에 표시할 예약 (좌하 클릭 선택, 기본값 = 원본 예약)
  const selectedResv: Reservation | undefined =
    allResvs.find((r) => r.id === selectedResvId) ?? reservation ?? undefined;

  // ── 데이터 로드
  useEffect(() => {
    if (!reservation) {
      setCustomer(null);
      setAllResvs([]);
      setPackages([]);
      setConsultants([]);
      setSelectedResvId(null);
      setCustomerMemo('');
      setSelectedConsultantId('');
      setCancelDialog(false);
      setCancelReason('');
      return;
    }

    setSelectedResvId(reservation.id);
    setBusy(false);

    const customerId = reservation.customer_id;
    const clinicId = reservation.clinic_id;

    if (customerId) {
      // 1) 고객 정보
      supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          const c = data as Customer;
          setCustomer(c);
          setCustomerMemo(c.customer_memo ?? c.memo ?? '');
          setSelectedConsultantId(c.assigned_staff_id ?? '');
        });

      // 2) 전체 예약 히스토리 (최신순)
      supabase
        .from('reservations')
        .select('*')
        .eq('customer_id', customerId)
        .order('reservation_date', { ascending: false })
        .order('reservation_time', { ascending: false })
        .then(({ data }) => {
          if (data) setAllResvs(data as Reservation[]);
        });

      // 4) 보유 패키지 (활성)
      supabase
        .from('packages')
        .select('id, package_name, status, total_sessions, contract_date')
        .eq('customer_id', customerId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (data) setPackages(data as Package[]);
        });
    }

    // 3) 상담사 목록 (해당 클리닉 + role=consultant)
    supabase
      .from('staff')
      .select('id, name, role, clinic_id, active, created_at')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .eq('role', 'consultant')
      .order('name')
      .then(({ data }) => {
        if (data) setConsultants(data as Staff[]);
      });
  // reservation.id 변경 시에만 재로드
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation?.id, reservation?.customer_id, reservation?.clinic_id]);

  if (!reservation) return null;

  // ── 소요 시간 계산
  const getDuration = (resv: Reservation) => {
    if (!resv.end_time) return '—';
    const [sh, sm] = resv.reservation_time.split(':').map(Number);
    const [eh, em] = resv.end_time.split(':').map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    return mins > 0 ? `${mins}분` : '—';
  };

  // ── 액션: 취소 (사유 포함)
  const cancelWithReason = async () => {
    if (!cancelReason.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason.trim(),
      })
      .eq('id', reservation.id);
    if (error) { toast.error(`취소 실패: ${error.message}`); setBusy(false); return; }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'cancel',
      old_data: { status: reservation.status },
      new_data: { status: 'cancelled', cancel_reason: cancelReason.trim() },
      changed_by: changedBy,
    });
    setBusy(false);
    setCancelDialog(false);
    setCancelReason('');
    toast.success('예약 취소됨');
    onChanged();
  };

  // ── 액션: 완전 삭제
  const deleteReservation = async () => {
    if (!window.confirm(`${reservation.customer_name}님 예약을 완전 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    const { count } = await supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('reservation_id', reservation.id);
    if ((count ?? 0) > 0) {
      toast.error('체크인이 연결된 예약은 삭제할 수 없습니다');
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('reservations').delete().eq('id', reservation.id);
    setBusy(false);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success('예약 삭제됨');
    onChanged();
  };

  // ── 액션: 상태 변경 (노쇼/복원)
  const setStatus = async (status: Reservation['status'], action?: string) => {
    setBusy(true);
    if (action === 'restore' || (status === 'confirmed' && reservation.status === 'cancelled')) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', reservation.clinic_id)
        .eq('reservation_date', reservation.reservation_date)
        .eq('reservation_time', reservation.reservation_time)
        .neq('status', 'cancelled');
      if ((count ?? 0) >= 12) {
        toast.error(`이 시간대는 마감입니다 (${count}/12). 다른 시간으로 옮긴 뒤 복원하세요.`);
        setBusy(false);
        return;
      }
    }
    const resolvedAction = action
      ?? (status === 'cancelled' ? 'cancel'
        : status === 'confirmed' && reservation.status === 'cancelled' ? 'restore'
        : 'status_change');
    // T-20260610-foot-RESV-CTXMENU-POPUP-SYNC AC-7: 복원 시 취소 메타(cancelled_at/cancel_reason/cancelled_by) 초기화.
    //   기존 latent 버그 — status='confirmed'만 세팅하고 취소 메타가 stale로 남던 문제 수정.
    //   handleEditorRestore(Reservations.tsx)와 동일 비파괴 상태전이 정책 통일.
    const updatePayload =
      resolvedAction === 'restore'
        ? { status, cancelled_at: null, cancel_reason: null, cancelled_by: null }
        : { status };
    const { error } = await supabase.from('reservations').update(updatePayload).eq('id', reservation.id);
    if (error) { toast.error(`업데이트 실패: ${error.message}`); setBusy(false); return; }
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: resolvedAction,
      old_data: { status: reservation.status },
      new_data: { status },
      changed_by: changedBy,
    });
    setBusy(false);
    toast.success(resolvedAction === 'restore' ? '예약 복원됨' : `상태 변경: ${STATUS_LABEL[status]}`);
    onChanged();
  };

  // ── 액션: 체크인 전환 (실제 DB INSERT)
  // T-20260522-foot-CHECKIN-FIRST-INFO: 분리된 DB 로직 — 초진/재진 모두 consult_waiting
  // ※ 기존: returning → treatment_waiting. 이 경로(예약팝업 접수)만 consult_waiting으로 변경.
  //   NewCheckInDialog / batchCheckIn / SelfCheckIn 은 AC-4 회귀 방지로 변경 없음.
  const doCheckIn = async () => {
    setBusy(true);
    const { data: existing } = await supabase
      .from('check_ins')
      .select('id')
      .eq('reservation_id', reservation.id)
      .maybeSingle();
    if (existing) {
      toast.info('이미 이 예약으로 체크인이 생성되어 있습니다');
      setBusy(false);
      return;
    }
    const { data: queueData, error: qErr } = await supabase.rpc('next_queue_number', {
      p_clinic_id: reservation.clinic_id,
      p_date: reservation.reservation_date,
    });
    if (qErr) { toast.error(`대기번호 생성 실패: ${qErr.message}`); setBusy(false); return; }
    const { error } = await supabase.from('check_ins').insert({
      clinic_id: reservation.clinic_id,
      customer_id: reservation.customer_id,
      reservation_id: reservation.id,
      customer_name: reservation.customer_name ?? '',
      customer_phone: reservation.customer_phone,
      visit_type: reservation.visit_type,
      // AC-2/AC-3: 초진·재진 모두 → 상담대기(consult_waiting) (예약팝업 접수 경로)
      status: 'consult_waiting',
      queue_number: queueData as number,
    });
    if (error) { toast.error(`체크인 실패: ${error.message}`); setBusy(false); return; }
    await supabase.from('reservations').update({ status: 'checked_in' }).eq('id', reservation.id);
    await supabase.from('reservation_logs').insert({
      reservation_id: reservation.id,
      clinic_id: reservation.clinic_id,
      action: 'checkin_convert',
      old_data: { status: reservation.status },
      new_data: { status: 'checked_in', queue_number: queueData },
      changed_by: changedBy,
    });
    toast.success('체크인 완료');
    setBusy(false);
    onChanged();
  };

  // ── 액션: 체크인 전환 (진입점 — 초진/재진 분기)
  // T-20260522-foot-CHECKIN-FIRST-INFO
  // - 초진(new): 정보입력 폼 다이얼로그 → 완료 후 doCheckIn 호출
  // - 재진/선체험: 폼 없이 바로 doCheckIn
  const convertToCheckIn = async () => {
    if (reservation.visit_type === 'new') {
      setShowFirstInfoDialog(true);
    } else {
      await doCheckIn();
    }
  };

  // ── 고객메모 저장
  const saveCustomerMemo = async () => {
    if (!reservation.customer_id) return;
    setMemoSaving(true);
    const { error } = await supabase
      .from('customers')
      .update({ customer_memo: customerMemo })
      .eq('id', reservation.customer_id);
    setMemoSaving(false);
    if (error) { toast.error(`고객메모 저장 실패: ${error.message}`); return; }
    toast.success('고객메모 저장됨');
  };

  // ── 상담사 저장 (customers.assigned_staff_id)
  const saveConsultant = async (val: string) => {
    if (!reservation.customer_id) return;
    const staffId = val === '__none__' ? null : val;
    setConsultantSaving(true);
    setSelectedConsultantId(val === '__none__' ? '' : val);
    const { error } = await supabase
      .from('customers')
      .update({ assigned_staff_id: staffId })
      .eq('id', reservation.customer_id);
    setConsultantSaving(false);
    if (error) { toast.error(`상담사 저장 실패: ${error.message}`); return; }
    toast.success('담당 상담사 저장됨');
  };

  // ─── 렌더 ─────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-[1100px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">

          {/* 헤더 */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>{reservation.customer_name}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  VISIT_TYPE_BADGE_CLASS[reservation.visit_type],
                )}
              >
                {VISIT_TYPE_KO[reservation.visit_type]}
              </span>
              <Badge variant="outline" className="text-xs">{STATUS_LABEL[reservation.status]}</Badge>
              {noshowCount > 0 && (
                <Badge variant="destructive" className="text-xs">노쇼 {noshowCount}회</Badge>
              )}
              <span className="text-sm font-normal text-muted-foreground">
                {reservation.reservation_date} {reservation.reservation_time.slice(0, 5)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* 4분할 본문 */}
          <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden min-h-0">

            {/* ── 좌측 컬럼 ── */}
            <div className="flex flex-col gap-3 min-h-0">

              {/* 좌상: 환자 정보 */}
              <div className="border rounded-lg p-3 flex-shrink-0">
                <div className="text-xs font-semibold text-teal-700 mb-2">환자 정보</div>
                <div className="space-y-1 text-xs">
                  <FieldRow label="이름" value={customer?.name ?? reservation.customer_name ?? '—'} />
                  <FieldRow label="고객번호" value={customer?.chart_number ?? '—'} />
                  <FieldRow
                    label="주민번호"
                    value={
                      customer?.birth_date
                        ? `${customer.birth_date.slice(0, 6)}-*******`
                        : '—'
                    }
                  />
                  <FieldRow
                    label="성별"
                    value={customer?.gender ? (GENDER_KO[customer.gender] ?? '—') : '—'}
                  />
                  <FieldRow
                    label="휴대폰"
                    value={
                      customer?.phone
                        ? formatPhone(customer.phone)
                        : reservation.customer_phone
                          ? formatPhone(reservation.customer_phone)
                          : '—'
                    }
                  />
                  <FieldRow
                    label="주소"
                    value={
                      [customer?.address, customer?.address_detail].filter(Boolean).join(' ') || '—'
                    }
                  />
                  <FieldRow label="고객등급" value={customer?.customer_grade ?? '일반'} />
                </div>
                {/* 예약메모 (compact 타임라인) */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-amber-700 mb-1">예약메모</div>
                  <ReservationMemoTimeline
                    reservationId={reservation.id}
                    clinicId={reservation.clinic_id}
                    authorName={authorName}
                    compact
                  />
                </div>
              </div>

              {/* 좌하: 전체 예약 히스토리 */}
              <div className="border rounded-lg p-3 flex-1 flex flex-col min-h-0">
                <div className="text-xs font-semibold text-teal-700 mb-2">
                  전체 예약 히스토리{allResvs.length > 0 && ` (${allResvs.length}건)`}
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
                  {allResvs.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-2">예약 없음</div>
                  ) : (
                    allResvs.map((r) => {
                      const isFocused = r.id === selectedResvId;
                      const isOriginal = r.id === reservation.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedResvId(r.id)}
                          className={cn(
                            'w-full text-left px-2 py-1.5 rounded border text-xs transition-colors',
                            isFocused
                              ? 'bg-teal-50 border-teal-400'
                              : isOriginal
                                ? 'bg-blue-50 border-blue-200'
                                : 'border-transparent hover:bg-muted',
                            r.status === 'cancelled' && 'opacity-50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium tabular-nums">
                              {r.reservation_date} {r.reservation_time.slice(0, 5)}
                            </span>
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                                VISIT_TYPE_BADGE_CLASS[r.visit_type],
                              )}
                            >
                              {VISIT_TYPE_KO[r.visit_type]}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {STATUS_LABEL[r.status]}
                            {isOriginal && (
                              <span className="ml-1 text-blue-500 font-medium">← 현재</span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ── 우측 컬럼 ── */}
            <div className="flex flex-col gap-3 min-h-0">

              {/* 우상: 선택 예약 상세 */}
              <div className="border rounded-lg p-3 flex-shrink-0">
                <div className="text-xs font-semibold text-teal-700 mb-2">
                  예약 상세
                  {selectedResv && selectedResv.id !== reservation.id && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      (다른 예약 보기 중)
                    </span>
                  )}
                </div>
                {selectedResv ? (
                  <div className="space-y-1 text-xs">
                    <FieldRow label="예약 일자" value={selectedResv.reservation_date} />
                    <FieldRow label="시작 시간" value={selectedResv.reservation_time.slice(0, 5)} />
                    <FieldRow label="소요 시간" value={getDuration(selectedResv)} />
                    <FieldRow
                      label="초·재진"
                      value={VISIT_TYPE_KO[selectedResv.visit_type]}
                    />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">예약 선택 없음</div>
                )}

                {/* 보유 패키지 */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    적용 가능 패키지 (활성)
                  </div>
                  {packages.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">보유 패키지 없음</div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {packages.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 py-0.5">
                          {p.package_name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* 담당 상담사 */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    담당 상담사
                  </div>
                  {consultants.length > 0 ? (
                    <Select
                      value={selectedConsultantId || '__none__'}
                      onValueChange={saveConsultant}
                      disabled={consultantSaving || !reservation.customer_id}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="상담사 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs">— 미배정 —</SelectItem>
                        {consultants.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">
                      상담사 없음 (role=consultant 미등록)
                    </div>
                  )}
                </div>

                {/* T-20260522-foot-RESV-HISTORY-SYNC AC-1/2/3: 예약시간 변경 이력 */}
                {/* AC-2: 예약관리 화면 이력 표시 강조 — 우상(예약 상세) 영역에 통합 */}
                {/* AC-3: ReservationAuditLogPanel 단일 컴포넌트 import (화면별 분리 금지) */}
                <div className="mt-2 pt-2 border-t">
                  <div className="text-[11px] font-medium text-teal-700 mb-1">
                    예약 변경 이력
                  </div>
                  <ReservationAuditLogPanel
                    reservationId={selectedResv?.id ?? null}
                    compact
                  />
                </div>
              </div>

              {/* 우하: 메모 2종 */}
              <div className="border rounded-lg p-3 flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="text-xs font-semibold text-teal-700 mb-2">메모</div>
                <div className="flex-1 flex flex-col gap-3 overflow-y-auto">

                  {/* 예약메모 히스토리 */}
                  <div>
                    <div className="text-[11px] font-medium text-amber-700 mb-1.5">예약메모</div>
                    {selectedResv ? (
                      <ReservationMemoTimeline
                        key={selectedResv.id}
                        reservationId={selectedResv.id}
                        clinicId={selectedResv.clinic_id}
                        authorName={authorName}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground italic">예약 선택 필요</div>
                    )}
                  </div>

                  <Separator />

                  {/* 고객메모 */}
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <div className="text-[11px] font-medium text-blue-700">고객메모</div>
                    <Textarea
                      value={customerMemo}
                      onChange={(e) => setCustomerMemo(e.target.value)}
                      rows={3}
                      placeholder="고객 특이사항·성향·주차 등"
                      className="text-xs resize-none"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-end h-7 text-xs"
                      onClick={saveCustomerMemo}
                      disabled={memoSaving || !reservation.customer_id}
                    >
                      {memoSaving ? '저장 중…' : '고객메모 저장'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 액션 푸터 */}
          <DialogFooter className="px-6 py-3 border-t shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onEdit(reservation)}>
              수정
            </Button>
            {isAdmin && (
              <Button variant="destructive" size="sm" disabled={busy} onClick={deleteReservation}>
                완전 삭제
              </Button>
            )}
            {reservation.status === 'confirmed' && (
              <>
                <Button size="sm" disabled={busy} onClick={convertToCheckIn}>
                  체크인 전환
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`${reservation.customer_name}님을 노쇼 처리하시겠습니까?`))
                      setStatus('noshow');
                  }}
                >
                  노쇼
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  data-testid="btn-reservation-cancel"
                  onClick={() => { setCancelReason(''); setCancelDialog(true); }}
                >
                  취소
                </Button>
              </>
            )}
            {(reservation.status === 'cancelled' || reservation.status === 'noshow') && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${reservation.customer_name}님 예약을 복원하시겠습니까?`))
                    setStatus('confirmed');
                }}
              >
                복원
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 취소 사유 입력 다이얼로그 */}
      {cancelDialog && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o && !busy) { setCancelDialog(false); setCancelReason(''); }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>예약 취소 — {reservation.customer_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {reservation.reservation_date} {reservation.reservation_time.slice(0, 5)} 예약을
                취소합니다. 취소된 예약은 목록에 기록으로 남습니다.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="cancel-reason-popup">
                  취소 사유 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="cancel-reason-popup"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="취소 사유를 입력하세요"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setCancelDialog(false); setCancelReason(''); }}
                disabled={busy}
              >
                뒤로
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !cancelReason.trim()}
                onClick={cancelWithReason}
              >
                {busy ? '처리 중…' : '취소 확정'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* T-20260522-foot-CHECKIN-FIRST-INFO: 초진 접수 정보입력 폼 */}
      <CheckinFirstInfoDialog
        reservation={reservation}
        open={showFirstInfoDialog}
        onOpenChange={(o) => { if (!o) setShowFirstInfoDialog(false); }}
        onCompleted={doCheckIn}
      />
    </>
  );
}

// ─── 보조: 필드 한 줄 표시 ───────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 min-w-0 items-baseline">
      <span className="text-muted-foreground shrink-0 w-[4.5rem]">{label}</span>
      <span className="font-medium break-words min-w-0">{value}</span>
    </div>
  );
}

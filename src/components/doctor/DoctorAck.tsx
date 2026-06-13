/**
 * DoctorAck — 진료호출 의사 ✋확인(손 들기) 신호 UI
 *   T-20260609-foot-DOCCALL-DOCTOR-ACK
 *
 * 진료호출 식별 단위 = check_ins.doctor_ack_at (additive timestamptz). 별도 doctor_calls 테이블 없음
 *   → DOCTOR-CALL-LIST(doctor_call_memo)와 동일 테이블 정합.
 *
 * - DoctorAckButton  : 의사 전용 ✋"확인" 버튼(대기 중 pulse-hand 애니) → doctor_ack_at = now() (idempotent).
 *                      비의사(직원)에겐 렌더 안 함(권한 게이트). ack 후엔 파란 배지로 대체 렌더.
 * - DoctorAckBadge   : 표시 전용 — 확인됨이면 파란색(primary-blue) "🖐 의사 확인됨" 고정·무애니,
 *                      대기(showPending) 시 pulse ✋"확인 대기". 직원 화면/환자차트 공용.
 *
 * 색/애니(현장 확정 2026-06-09): AC2 파란색 고정, AC8 대기 중 pulse-hand(opacity 0.4→1, 1.5s).
 * 권한: 확인 버튼은 DOCTOR_ROLES(isDoctor)만. 직원은 조회만(badge). — 기존 역할 상수 재사용(신규 정의 금지).
 * 비즈로직 guard(AC6): doctor_ack_at 은 진료완료(completed_at) 상태머신과 별개 신호 — 본 UI는 ack 컬럼만 write.
 */
import { useState } from 'react';
import { Hand, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** ack 여부 — doctor_ack_at 값 존재 시 '의사 확인됨'. */
export function isDoctorAcked(ackAt: string | null | undefined): boolean {
  return !!ackAt;
}

/**
 * 의사 ✋확인 기록 (idempotent).
 *   `.is('doctor_ack_at', null)` 가드로 이미 ack 된 호출 재클릭은 0행 update → 예외 없이 동일 상태(AC4).
 *   T-20260613-foot-DOCDASH-MONOTONE-RELAYOUT: 진료대시보드 상태셀 ✋ 토글(HandToggle)이 ack write SSOT로 재사용 → export.
 */
export async function recordAck(checkInId: string): Promise<void> {
  const { error } = await supabase
    .from('check_ins')
    .update({ doctor_ack_at: new Date().toISOString() })
    .eq('id', checkInId)
    .is('doctor_ack_at', null);
  if (error) throw error;
}

// ─── 표시 전용 배지 ──────────────────────────────────────────────────────────
export function DoctorAckBadge({
  ackAt,
  showPending = false,
  className,
}: {
  ackAt: string | null | undefined;
  /** 미확인(대기) 상태에서 pulse ✋"확인 대기"를 노출할지 (환자차트 등). 기본 false=확인됨일 때만 표시. */
  showPending?: boolean;
  className?: string;
}) {
  if (isDoctorAcked(ackAt)) {
    // AC2/AC8: 파란색(primary-blue) 고정, 애니메이션 없음.
    return (
      <span
        data-testid="doctor-ack-badge"
        data-ack="confirmed"
        className={cn(
          'inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold text-blue-700 bg-blue-100 border border-blue-300 whitespace-nowrap',
          className,
        )}
        title="의사가 진료호출을 확인했어요"
      >
        <Hand className="h-3 w-3" />
        의사 확인됨
      </span>
    );
  }
  if (showPending) {
    // AC8 대기 중: pulse-hand(opacity 0.4→1→0.4, 1.5s ease-in-out).
    return (
      <span
        data-testid="doctor-ack-badge"
        data-ack="pending"
        className={cn(
          'inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 whitespace-nowrap',
          className,
        )}
        title="의사 확인 대기 중"
      >
        <Hand className="h-3 w-3 animate-pulse-hand" />
        확인 대기
      </span>
    );
  }
  return null;
}

// ─── 의사 전용 ✋확인 버튼 (+ ack 후 배지) ─────────────────────────────────────
export function DoctorAckButton({
  checkInId,
  ackAt,
  doctorMode,
  onAcked,
  className,
  label = '확인',
}: {
  checkInId: string;
  ackAt: string | null | undefined;
  /** DOCTOR_ROLES 여부(isDoctor). false면 버튼 미노출 — 단, 이미 ack 된 건은 배지로 조회 가능. */
  doctorMode: boolean;
  onAcked?: () => void;
  className?: string;
  /** 버튼 텍스트. T-20260612-foot-DOCDASH-11FIX AC-8: 진료대시보드 1단계는 '손들기'로 노출. 기본 '확인'(무회귀). */
  label?: string;
}) {
  const [pending, setPending] = useState(false);

  // 이미 확인됨 → 파란 배지(의사/직원 공통 조회).
  if (isDoctorAcked(ackAt)) {
    return <DoctorAckBadge ackAt={ackAt} className={className} />;
  }
  // 미확인 + 비의사(직원) → 아무것도 안 보임(조회만 권한, AC1/시나리오2).
  if (!doctorMode) return null;

  const handleAck = async () => {
    if (pending) return;
    setPending(true);
    try {
      await recordAck(checkInId);
      onAcked?.();
      toast.confirm('환자에게 손을 들었어요. 호출 직원 화면에 바로 표시돼요.');
    } catch (e) {
      toast.error(`확인 표시 실패: ${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  // 미확인 + 의사 → ✋"확인" 버튼 (대기 중 pulse-hand 아이콘, AC8).
  return (
    <button
      type="button"
      onClick={handleAck}
      disabled={pending}
      data-testid="doctor-ack-btn"
      aria-label="진료호출 확인 (손 들기)"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-95 disabled:opacity-50',
        className,
      )}
      title="환자에게 '확인했다'고 손 들기 — 호출 직원 화면에 즉시 반영"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Hand className="h-3.5 w-3.5 animate-pulse-hand" />
      )}
      {label}
    </button>
  );
}

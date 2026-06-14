/**
 * DoctorStageStepper — 진료 단계 노선도(지하철형) 4단계 stepper
 *   T-20260614-foot-DOCCALL-PURPLE-STEPPER 이슈2 (현장 김주연 총괄 §DECISION CONFIRMED)
 *
 * 요청 형태(현장 확정): "웅웅 손 아이콘 대신 위 지하철 노선도처럼 + 원 표시 위에 ▼ 현위치 표기"
 *
 *        ▼
 *   ●────○────○────○
 *  대기  원장확인  진료중  진료완료
 *
 * - 4단계 가로 노선도: 대기 ─ 원장확인 ─ 진료중 ─ 진료완료
 * - 현재 단계 = 채워진 원(●, purple) + 원 위 ▼ 현위치 마커. 도달=채움(purple), 미도달=빈 원(○ gray).
 * - 각 노드 클릭 → 해당 단계로 전환. 원장·직원 공용(권한 구분 없음 — 요청 그대로).
 *   순차 강제 아닌 직접 단계 선택(되돌리기=이전 단계 클릭으로 자연 처리).
 * - 기존 ✋ 손 아이콘(DoctorAck) **완전 대체** — 진료콜 명단 각 행 인라인.
 * - 영속화 + 실시간 동기: check_ins UPDATE → Dashboard postgres_changes 구독이 타 직원 화면 자동 갱신
 *   (T-20260609 DOCCALL-DOCTOR-ACK 실시간 동기 패턴 재사용).
 *
 * 상태 매핑(스키마 최소화 — 기존/architect 승인 컬럼 재사용, 신규 컬럼 0):
 *   대기      = doctor_ack_at NULL  & doctor_status NULL
 *   원장확인  = doctor_ack_at 값존재 & doctor_status NULL   (T-20260609 DOCCALL-DOCTOR-ACK 흡수=1→2단계)
 *   진료중    = doctor_status 'in_treatment'                 (T-20260612 doctor_status, architect CONSULT 완료)
 *   진료완료  = doctor_status 'done'
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

/** 4단계 라벨(노선도 순서). index 0~3. */
export const DOCTOR_STAGES = ['대기', '원장확인', '진료중', '진료완료'] as const;
export type DoctorStageIndex = 0 | 1 | 2 | 3;

/**
 * 진료 단계 파생 — check_ins 컬럼 → 노선도 현재 단계(0~3).
 *   done > in_treatment > ack(원장확인) > 대기 순 우선.
 */
export function deriveDoctorStage(
  ci: Pick<CheckIn, 'doctor_ack_at' | 'doctor_status'>,
): DoctorStageIndex {
  if (ci.doctor_status === 'done') return 3;
  if (ci.doctor_status === 'in_treatment') return 2;
  if (ci.doctor_ack_at) return 1;
  return 0;
}

/**
 * 단계 전환 DB write — 클릭한 단계로 영속. idempotent(같은 단계 재클릭=동일 결과).
 *   doctor_ack_at 은 stage>=1 에서 기존값 보존(없을 때만 now) → 되돌리기 시 최초 확인시각 유지.
 *   되돌리기(예: 진료중→원장확인)는 상위 단계 컬럼(doctor_status 등)을 명시적으로 null 로 내려 일관성 유지.
 */
export async function setDoctorStage(ci: CheckIn, stage: DoctorStageIndex): Promise<void> {
  const now = new Date().toISOString();
  const ackAt = ci.doctor_ack_at ?? now;
  const startedAt = ci.doctor_started_at ?? now;
  let patch: Record<string, string | null>;
  switch (stage) {
    case 0: // 대기 — 전부 초기화
      patch = { doctor_ack_at: null, doctor_status: null, doctor_started_at: null, doctor_ended_at: null };
      break;
    case 1: // 원장확인 — ack만, 진료세션 컬럼 해제
      patch = { doctor_ack_at: ackAt, doctor_status: null, doctor_started_at: null, doctor_ended_at: null };
      break;
    case 2: // 진료중
      patch = { doctor_ack_at: ackAt, doctor_status: 'in_treatment', doctor_started_at: startedAt, doctor_ended_at: null };
      break;
    case 3: // 진료완료
      patch = { doctor_ack_at: ackAt, doctor_status: 'done', doctor_started_at: startedAt, doctor_ended_at: now };
      break;
    default:
      return;
  }
  const { error } = await supabase.from('check_ins').update(patch).eq('id', ci.id);
  if (error) throw error;
}

interface DoctorStageStepperProps {
  checkIn: CheckIn;
  /** 전환 성공 후 부모 rows 갱신(realtime 보강) */
  onChanged?: () => void;
  className?: string;
}

/**
 * 인라인 노선도 stepper. 각 노드 = 클릭 가능한 버튼(min 28px 터치 타깃, 태블릿 UX).
 * 도달 단계(index <= current)=purple 채움, 미도달=gray 빈 원. 현재 노드 위 ▼ 마커.
 */
export default function DoctorStageStepper({ checkIn, onChanged, className }: DoctorStageStepperProps) {
  const current = deriveDoctorStage(checkIn);
  const [pending, setPending] = useState<DoctorStageIndex | null>(null);

  const handleClick = async (stage: DoctorStageIndex) => {
    if (pending !== null) return;
    if (stage === current) return; // 동일 단계 재클릭 무시(불필요 write 방지)
    setPending(stage);
    try {
      await setDoctorStage(checkIn, stage);
      onChanged?.();
    } catch (e) {
      toast.error(`진료 단계 변경 실패: ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      data-testid="doctor-stage-stepper"
      data-current-stage={current}
      className={cn('flex items-end gap-0 select-none', className)}
      role="group"
      aria-label="진료 단계"
    >
      {DOCTOR_STAGES.map((label, idx) => {
        const i = idx as DoctorStageIndex;
        const reached = i <= current; // 도달(채움)
        const isCurrent = i === current;
        const busy = pending === i;
        return (
          <div key={label} className="flex items-end">
            {/* 연결선(첫 노드 앞에는 없음). 양끝이 모두 도달이면 purple, 아니면 gray. */}
            {idx > 0 && (
              <span
                data-testid="doctor-stage-connector"
                className={cn(
                  'h-0.5 w-4 mb-[13px] shrink-0',
                  i <= current ? 'bg-purple-500' : 'bg-gray-300',
                )}
              />
            )}
            <button
              type="button"
              data-testid="doctor-stage-node"
              data-stage={i}
              data-reached={String(reached)}
              data-current={String(isCurrent)}
              onClick={() => handleClick(i)}
              disabled={pending !== null}
              className="flex flex-col items-center gap-0.5 px-0.5 disabled:opacity-70"
              title={`진료 단계: ${label}${isCurrent ? ' (현재)' : ''} — 클릭 시 이 단계로 변경`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {/* ▼ 현위치 마커 — 현재 단계 노드 위에만 표시 */}
              <span
                data-testid={isCurrent ? 'doctor-stage-here' : undefined}
                className={cn(
                  'text-[9px] leading-none text-purple-600 h-[9px]',
                  isCurrent ? 'opacity-100' : 'opacity-0',
                )}
                aria-hidden={!isCurrent}
              >
                ▼
              </span>
              {/* 원(●/○) — 도달=purple 채움, 미도달=gray 빈 원. 진행 중이면 spinner. */}
              <span
                className={cn(
                  'flex items-center justify-center h-4 w-4 rounded-full border-2 transition-colors',
                  reached
                    ? 'bg-purple-500 border-purple-500'
                    : 'bg-white border-gray-300',
                  isCurrent && 'ring-2 ring-purple-200',
                )}
              >
                {busy && <Loader2 className="h-2.5 w-2.5 animate-spin text-white" />}
              </span>
              {/* 라벨 */}
              <span
                className={cn(
                  'text-[9px] leading-none whitespace-nowrap mt-0.5',
                  isCurrent ? 'font-bold text-purple-700' : reached ? 'text-purple-600' : 'text-gray-400',
                )}
              >
                {label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

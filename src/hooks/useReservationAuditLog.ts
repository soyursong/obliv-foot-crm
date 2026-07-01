// T-20260522-foot-RESV-HISTORY-SYNC AC-3: 공유 훅 1개로 통일
// 대시보드(2번차트 2구역 예약내역) + 예약관리 양쪽에서 동일 import 사용
// 화면별 분리 구현 절대 금지 (김주연 총괄 명시 지시)
// T-20260525-foot-RESV-CHANGE-REASON: change_reason 필드 추가 (AC-2/3)

import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/supabase';

export interface ReservationAuditEntry {
  id: string;
  action: 'create' | 'reschedule' | string;
  /** AC-1 확정 포맷: "5/22 10:00 예약 → 5/22 14:00 변경 (5/22 09:38)" or "5/22 14:00 신규 예약 (5/22 09:38)" */
  label: string;
  created_at: string;
  /** T-20260525-foot-RESV-CHANGE-REASON: 변경 사유 (optional, NULL 가능) */
  change_reason: string | null;
}

interface RawLog {
  id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  change_reason: string | null;
}

/**
 * M/DD HH:mm 형식 포맷 (AC-1 확정)
 * 예: "5/22 10:00" (월/일 시:분, 날짜 포함)
 */
function fmtMD(dateStr: string, timeStr: string): string {
  try {
    const iso = `${dateStr}T${timeStr.slice(0, 5)}:00`;
    const d = parseISO(iso);
    return `${format(d, 'M.dd')} ${format(d, 'HH:mm')}`;
  } catch {
    return `${dateStr} ${timeStr.slice(0, 5)}`;
  }
}

function buildLabel(log: RawLog): string {
  // "변경 처리 시각" — created_at 기준
  const processedAt = format(parseISO(log.created_at), 'M.dd HH:mm');

  if (log.action === 'create') {
    // AC-1: "5/22 14:00 신규 예약 (5/22 09:38)"
    const date = log.new_data?.date as string | undefined;
    const time = log.new_data?.time as string | undefined;
    if (date && time) {
      return `${fmtMD(date, time)} 신규 예약 (${processedAt})`;
    }
    return `신규 예약 (${processedAt})`;
  }

  if (log.action === 'reschedule') {
    // AC-1: "5/22 10:00 예약 → 5/22 14:00 변경 (5/22 09:38)"
    const oldDate = log.old_data?.date as string | undefined;
    const oldTime = log.old_data?.time as string | undefined;
    const newDate = log.new_data?.date as string | undefined;
    const newTime = log.new_data?.time as string | undefined;
    if (oldDate && oldTime && newDate && newTime) {
      return `${fmtMD(oldDate, oldTime)} 예약 → ${fmtMD(newDate, newTime)} 변경 (${processedAt})`;
    }
    // old/new 데이터 일부 누락 시 시간 단독 표시
    if (newDate && newTime) {
      return `${fmtMD(newDate, newTime)} 변경 (${processedAt})`;
    }
  }

  // fallback (cancel 등 non-time 이벤트 — 필터링되어 실제로 도달하지 않음)
  return `(${log.action}) ${processedAt}`;
}

/**
 * 예약 변경·추가 이력 훅 (AC-3: 공유 훅 단일 소스)
 *
 * reservation_logs 테이블에서 'create' | 'reschedule' 이벤트만 조회.
 * 대시보드(2번차트 2구역 예약내역) + 예약관리 양쪽에서 import하여 동일 훅 사용.
 * T-20260525-foot-RESV-CHANGE-REASON: change_reason 컬럼 포함 조회
 */
export function useReservationAuditLog(reservationId: string | null | undefined) {
  const [logs, setLogs] = useState<ReservationAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reservationId) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    supabase
      .from('reservation_logs')
      .select('id, action, old_data, new_data, created_at, change_reason')
      .eq('reservation_id', reservationId)
      .in('action', ['create', 'reschedule'])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) {
          setLogs((data as RawLog[]).map((log) => ({
            id: log.id,
            action: log.action,
            label: buildLabel(log),
            created_at: log.created_at,
            change_reason: log.change_reason ?? null,
          })));
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reservationId]);

  return { logs, loading };
}

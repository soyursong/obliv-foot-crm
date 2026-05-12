/**
 * CustomerHoverCard — 대시보드 고객 카드 성함 hover 시 간단정보 팝업
 * T-20260502-foot-CARD-HOVER-INFO
 *
 * 표시: 예약시간 · 차트번호/성함(성별/나이) · 초진/재진 아이콘 · 핸드폰번호 · 고객메모 · 치료메모
 */

import { useCallback, useRef, useState } from 'react';
import { Clock, FileText, Phone, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CheckIn } from '@/lib/types';

interface CustomerDetails {
  chart_number: string | null;
  gender: 'M' | 'F' | null;
  birth_date: string | null;
  memo: string | null;
}

/** 생년월일(YYMMDD) → 나이(한국식 만 나이) */
function calcAge(birthDate: string | null): number | null {
  if (!birthDate || birthDate.length < 6) return null;
  const yy = parseInt(birthDate.slice(0, 2), 10);
  const mm = parseInt(birthDate.slice(2, 4), 10);
  const dd = parseInt(birthDate.slice(4, 6), 10);
  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return null;
  const currentYear = new Date().getFullYear();
  const century = yy <= currentYear % 100 ? 2000 : 1900;
  const fullYear = century + yy;
  const today = new Date();
  let age = currentYear - fullYear;
  if (new Date(currentYear, mm - 1, dd) > today) age--;
  return age >= 0 ? age : null;
}

interface Props {
  checkIn: CheckIn;
  /** 예약 시간 (HH:MM:SS 또는 HH:MM) — reservation.reservation_time */
  reservationTime?: string | null;
  /** compact 카드용 스타일 */
  compact?: boolean;
  /** 우클릭 핸들러 (부모에서 주입) */
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function CustomerHoverCard({ checkIn, reservationTime, compact, onContextMenu }: Props) {
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [cardPos, setCardPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);

  const fetchDetails = useCallback(async () => {
    if (fetchedRef.current || !checkIn.customer_id) return;
    fetchedRef.current = true;
    setLoading(true);
    const { data } = await supabase
      .from('customers')
      .select('chart_number, gender, birth_date, memo')
      .eq('id', checkIn.customer_id)
      .single();
    if (data) setDetails(data as CustomerDetails);
    setLoading(false);
  }, [checkIn.customer_id]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      // 카드 위치: 커서 기준 약간 우하단 (viewport 고정)
      const x = e.clientX + 12;
      const y = e.clientY + 8;
      setCardPos({ x, y });
      timerRef.current = setTimeout(() => {
        setVisible(true);
        fetchDetails();
      }, 280);
    },
    [fetchDetails],
  );

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const keepVisible = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  }, []);

  // 표시 정보 계산 — 초진(파란) / 재진(초록) 2종
  const visitType = checkIn.visit_type;
  const visitLabel = visitType === 'new' ? '초진' : '재진';
  const visitColor =
    visitType === 'new' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800';

  const age = calcAge(details?.birth_date ?? null);
  const genderLabel =
    details?.gender === 'M' ? '남' : details?.gender === 'F' ? '여' : null;

  // 치료메모: treatment_memo.details
  const treatmentMemoText =
    checkIn.treatment_memo &&
    typeof checkIn.treatment_memo === 'object' &&
    typeof (checkIn.treatment_memo as { details?: string }).details === 'string'
      ? (checkIn.treatment_memo as { details: string }).details
      : null;

  // 예약시간 표시 (HH:MM만 사용)
  const displayTime = reservationTime
    ? reservationTime.slice(0, 5)
    : format(new Date(checkIn.checked_in_at), 'HH:mm');
  const timeLabel = reservationTime ? '예약' : '체크인';

  return (
    <span
      className="relative"
      style={{ display: 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 성함 텍스트 */}
      <span
        className={cn(
          'cursor-context-menu hover:underline decoration-dotted underline-offset-2',
          compact ? 'font-bold text-sm truncate' : 'text-base font-bold',
        )}
        title="우클릭/롱프레스 → 고객차트·예약 · 호버 → 간단정보"
        onContextMenu={onContextMenu}
      >
        {checkIn.customer_name?.trim() || '이름없음'}
      </span>

      {/* 호버 팝업 — position:fixed 로 overflow 클리핑 우회 */}
      {visible && (
        <div
          role="tooltip"
          data-testid="customer-hover-card"
          style={{
            position: 'fixed',
            left: Math.min(cardPos.x, window.innerWidth - 280),
            top: Math.min(cardPos.y, window.innerHeight - 260),
            zIndex: 9999,
          }}
          className="w-64 rounded-xl border border-gray-200 bg-white shadow-2xl p-3.5 space-y-2 text-xs"
          onMouseEnter={keepVisible}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* ── 헤더: 차트번호 + 성함(성별/나이) + 초진/재진 ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            {details?.chart_number && (
              <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-teal-700 border border-teal-100">
                #{details.chart_number}
              </span>
            )}
            <span className="font-bold text-gray-900 text-sm">{checkIn.customer_name}</span>
            {(genderLabel || age != null) && (
              <span className="text-gray-500 text-[11px]">
                ({[genderLabel, age != null ? `${age}세` : null].filter(Boolean).join('/')})
              </span>
            )}
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', visitColor)}>
              {visitLabel}
            </span>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── 예약시간 ── */}
          <div className="flex items-center gap-1.5 text-gray-600">
            <Clock className="h-3.5 w-3.5 shrink-0 text-teal-500" />
            <span className="tabular-nums font-medium">{displayTime}</span>
            <span className="text-gray-400 text-[10px]">({timeLabel})</span>
          </div>

          {/* ── 핸드폰번호 ── */}
          {checkIn.customer_phone ? (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Phone className="h-3.5 w-3.5 shrink-0 text-teal-500" />
              <span className="tabular-nums">{formatPhone(checkIn.customer_phone)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-gray-400">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>번호 없음</span>
            </div>
          )}

          <div className="border-t border-gray-100" />

          {/* ── 고객메모 ── */}
          <div className="flex items-start gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-teal-500" />
            <div className="flex-1">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                고객메모
              </div>
              {loading && !details ? (
                <span className="text-gray-400">불러오는 중…</span>
              ) : details?.memo ? (
                <p className="text-gray-700 leading-relaxed line-clamp-4">{details.memo}</p>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </div>
          </div>

          {/* ── 치료메모 ── */}
          <div className="flex items-start gap-1.5">
            <Stethoscope className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-500" />
            <div className="flex-1">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                치료메모
              </div>
              {treatmentMemoText ? (
                <p className="text-gray-700 leading-relaxed line-clamp-4">{treatmentMemoText}</p>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

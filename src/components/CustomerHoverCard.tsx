/**
 * CustomerHoverCard — 대시보드 고객 카드 성함 hover 시 간단정보 팝업
 * T-20260502-foot-CARD-HOVER-INFO
 *
 * 표시: 예약시간 · 차트번호/성함(성별/나이) · 초진/재진 아이콘 · 핸드폰번호 · 고객메모 · 치료메모
 */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, FileText, Phone, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { formatPhone, chartNoBadge } from '@/lib/format';
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

/**
 * T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [4]: 예약 hover 간략정보 구성.
 * 이 prop이 주어지면(예약관리 캘린더 카드) 새 spec 레이아웃을 렌더:
 *   제목줄 `등록자: 예약일시` / 고객성함 | 방문경로 / 연락처(풀번호) / 간략메모 / 예약메모.
 * 미지정 surface(대시보드 등)는 기존 레거시 레이아웃(차트#·예약시간·고객메모·치료메모) 유지 → 회귀 0.
 */
interface HoverReservationInfo {
  /** 등록자 = 예약 잡은 계정명(resvBookerMap, 예: 'admin'). 없으면 제목줄에서 생략. */
  registrarLabel?: string | null;
  /** 예약일 (YYYY-MM-DD) */
  reservationDate?: string | null;
  /** 방문경로(예약경로 대분류) — reservations.visit_route */
  visitRoute?: string | null;
  /** 예약메모 — reservations.booking_memo */
  bookingMemo?: string | null;
  /** 간략메모 — brief_note. WAVE 2 컬럼 추가 예정 → 그 전까지 undefined/null이면 해당 줄 생략(에러/공백행 금지). */
  briefNote?: string | null;
}

interface Props {
  checkIn: CheckIn;
  /** 예약 시간 (HH:MM:SS 또는 HH:MM) — reservation.reservation_time */
  reservationTime?: string | null;
  /** T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [4]: 주어지면 예약 hover 새 레이아웃. */
  reservationInfo?: HoverReservationInfo;
  /** compact 카드용 스타일 */
  compact?: boolean;
  /** T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN: 예약관리 캘린더 2단(2열) 전용 고밀도 성함.
   *  compact && compactDense → 성함 폰트 text-sm(14px)→text-xs(12px) 축소 + 실제 ellipsis(block+min-w-0).
   *  Dashboard 등 compactDense 미지정 카드는 기존 text-sm 유지(영향 없음). */
  compactDense?: boolean;
  /** 우클릭 핸들러 (부모에서 주입) */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** T-20260525-foot-RSVMGMT-CHART-OPEN: 클릭 → 1·2번 차트 열림 (예약관리 진입점) */
  onClick?: () => void;
}

export function CustomerHoverCard({ checkIn, reservationTime, reservationInfo, compact, compactDense, onContextMenu, onClick }: Props) {
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
      // T-20260515-foot-HOVER-POPUP-POS: 커서 기준 우하단 초기 위치
      const x = e.clientX + 14;
      const y = e.clientY + 10;
      setCardPos({ x, y });
      timerRef.current = setTimeout(() => {
        setVisible(true);
        fetchDetails();
      }, 280);
    },
    [fetchDetails],
  );

  // T-20260515-foot-HOVER-POPUP-POS: 마우스 이동 시 팝업이 커서 바로 옆으로 추적
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!visible) return;
    setCardPos({ x: e.clientX + 14, y: e.clientY + 10 });
  }, [visible]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const keepVisible = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
  }, []);

  // 표시 정보 계산 — 초진(파란) / 재진(세이지) 2종 / 체험 배지 미표시 (AC-4)
  // T-20260622-foot-GREEN-COLOR-SAGE-RECOLOR: 재진 emerald → sage (초진 파랑 유지 → 의미구분 보존)
  const visitType = checkIn.visit_type;
  const visitLabel = visitType === 'new' ? '초진' : visitType === 'returning' ? '재진' : null;
  const visitColor =
    visitType === 'new' ? 'bg-blue-100 text-blue-800' : 'bg-sage-100 text-sage-800';

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
      // T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN: compactDense일 때 트리거를 block+min-w-0로 →
      //   flex row 안에서 가용폭까지 수축, 내부 성함 span의 truncate(ellipsis)가 실제 동작.
      className={cn('relative', compactDense && 'block min-w-0 max-w-full')}
      style={{ display: compactDense ? 'block' : 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 성함 텍스트 */}
      {/* T-20260525-foot-RSVMGMT-CHART-OPEN: onClick 연결 시 클릭 가능 스타일 적용 */}
      <span
        data-testid={onClick ? 'customer-hover-card-name-clickable' : 'customer-hover-card-name'}
        className={cn(
          'hover:underline decoration-dotted underline-offset-2',
          onClick ? 'cursor-pointer' : 'cursor-context-menu',
          // T-20260615-foot-RESVMGMT-REFIX-8 AC7: 성함 검정 통일(예약카드 상태별 텍스트색 상속 차단). compact=예약/대시보드 카드 트리거.
          // T-20260622-foot-RESVCAL-CARD-OVERFLOW-FONTDOWN AC-1/AC-2: 예약 캘린더 2단 카드(compactDense)는
          //   성함 text-sm(14px)→text-xs(12px) 한 단계 축소 + block(min-w-0 트리거 폭 안에서 truncate ellipsis 실동작).
          // T-20260622-foot-RESVCAL-TYPE-2COL-2TIER(A안): 슬롯 셀이 좌우 2열 그리드가 되며 카드 폭이 더 좁아짐(성함 축소 허용)
          //   → 성함 한 단계 더 축소 text-xs(12px)→text-[11px]. 본문(11px)과 동일, ping-pong 바닥(≥11px) 유지.
          //   Dashboard 등 compact-only 카드는 기존 text-sm 유지.
          compact
            ? cn('font-bold truncate text-gray-900', compactDense ? 'block min-w-0 text-[11px]' : 'text-sm')
            : 'text-base font-bold',
        )}
        // T-20260629-foot-RESVHOVER-HINT-PHRASE-REMOVE: 성함 hover 시 네이티브 title 툴팁이
        //   간단정보 카드(포털)와 겹쳐 고객번호/메모를 가림 → 도움말 한 줄(title 속성)만 제거.
        //   동작 무변경: onClick=고객차트, onContextMenu=메뉴, hover=간단정보 카드 모두 유지.
        onContextMenu={onContextMenu}
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          onClick();
        }}
      >
        {checkIn.customer_name?.trim() || '이름없음'}
        {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 트리거에도 차트번호 인접(hover 전 embed, hover 후 fetch 우선)
            T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY: 예약관리 고객박스(reservationInfo 주어진 surface)는 차트번호를
            박스에서 제거 → 간략정보(hover) 이관(아래 reservationInfo 분기 헤더에 차트번호 표기). 단독노출 0은 hover로 보장.
            대시보드 등 reservationInfo 미지정 surface는 기존대로 트리거 인접 차트번호 유지(회귀 0). */}
        {!reservationInfo && (
          <span className="ml-1 font-mono text-[11px] font-normal text-teal-600">
            {chartNoBadge(details?.chart_number ?? checkIn.customers?.chart_number ?? null)}
          </span>
        )}
      </span>

      {/* 호버 팝업 — position:fixed + document.body 포털.
          T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER §D(AC-5): 팝업 헤더의 차트번호 배지(font-mono #)가
          트리거와 같은 카드 row DOM 서브트리 안에 렌더되어, hover 시 row 내 차트번호 배지가 1→2로 증가하던 버그.
          이미 position:fixed(뷰포트 좌표)이므로 document.body 포털로 빼내 row 서브트리에서 분리 → 시각 동일,
          카드 row 내 차트번호 배지는 hover 전·후 모두 트리거 인라인 1개로 고정(중복 0). React 이벤트 버블링은 포털에서도 트리 기준 유지. */}
      {visible && createPortal(
        <div
          role="tooltip"
          data-testid="customer-hover-card"
          style={{
            position: 'fixed',
            // T-20260625-foot-RESV-HOVERCARD-CLIP-EDGEGUARD: 4변 경계가드.
            //   기존엔 우/하 상한(Math.min)만 있어 커서가 좌상단(헤더/사이드바 인접)일 때 팝업이 가려짐.
            //   상/좌 하한 8px 마진 추가 → clamp(v, 8, max). createPortal(document.body)+zIndex:9999로
            //   stacking context는 이미 무력화돼 있어 위치 클램프만으로 가림 0 달성.
            left: Math.max(8, Math.min(cardPos.x, window.innerWidth - 280)),
            top: Math.max(8, Math.min(cardPos.y, window.innerHeight - 260)),
            zIndex: 9999,
          }}
          className="w-64 rounded-xl border border-gray-200 bg-white shadow-2xl p-3.5 space-y-2 text-xs"
          onMouseEnter={keepVisible}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {reservationInfo ? (
            // ══ T-20260623-foot-RESVMGMT-OVERHAUL2-W1-NODB [4]: 예약 hover 새 레이아웃 ══
            //   제목줄 `등록자: 예약일시` / 고객성함 | 방문경로 / 연락처(풀번호) / 간략메모 / 예약메모.
            <>
              {/* ── 제목줄: 등록자: 예약일시 (등록자 없으면 일시만) ── */}
              <div className="flex items-center gap-1.5 text-gray-800">
                <Clock className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                <span className="font-semibold tabular-nums">
                  {reservationInfo.registrarLabel
                    ? `${reservationInfo.registrarLabel}: `
                    : ''}
                  {reservationInfo.reservationDate ?? ''}
                  {reservationTime ? ` ${reservationTime.slice(0, 5)}` : ''}
                </span>
              </div>

              <div className="border-t border-gray-100" />

              {/* ── 차트번호 + 고객성함 | 방문경로 ──
                  T-20260625-foot-RESV-CUSTBOX-3FIELDS-ONLY: 차트번호를 고객박스에서 제거하고 간략정보(hover)로 이관.
                  미발번도 명시(레거시 분기와 동일 배지 스타일) → 환자명 단독노출 0 보장. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold border ${(details?.chart_number ?? checkIn.customers?.chart_number) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-muted text-muted-foreground border-border'}`}>
                  {chartNoBadge(details?.chart_number ?? checkIn.customers?.chart_number ?? null)}
                </span>
                <span className="font-bold text-gray-900 text-sm">{checkIn.customer_name}</span>
                {reservationInfo.visitRoute && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span className="text-gray-600">{reservationInfo.visitRoute}</span>
                  </>
                )}
              </div>

              {/* ── 연락처 (풀번호 — 마스킹 없음) ── */}
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

              {/* ── 간략메모(brief_note) — WAVE2 컬럼 추가 전까지 값 없으면 줄 자체 생략(에러/공백행 금지) ── */}
              {reservationInfo.briefNote?.trim() && (
                <>
                  <div className="border-t border-gray-100" />
                  <div className="flex items-start gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-teal-500" />
                    <div className="flex-1">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                        간략메모
                      </div>
                      <p className="text-gray-700 leading-relaxed line-clamp-4">{reservationInfo.briefNote.trim()}</p>
                    </div>
                  </div>
                </>
              )}

              {/* ── 예약메모 ── */}
              <div className="border-t border-gray-100" />
              <div className="flex items-start gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-500" />
                <div className="flex-1">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                    예약메모
                  </div>
                  {reservationInfo.bookingMemo?.trim() ? (
                    <p className="text-gray-700 leading-relaxed line-clamp-4">{reservationInfo.bookingMemo.trim()}</p>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </div>
              </div>
            </>
          ) : (
          <>
          {/* ── 헤더: 차트번호 + 성함(성별/나이) + 초진/재진 ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT: 차트번호 항상 표시(미발번도 명시) */}
            <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold border ${details?.chart_number ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-muted text-muted-foreground border-border'}`}>
              {chartNoBadge(details?.chart_number)}
            </span>
            <span className="font-bold text-gray-900 text-sm">{checkIn.customer_name}</span>
            {(genderLabel || age != null) && (
              <span className="text-gray-500 text-[11px]">
                ({[genderLabel, age != null ? `${age}세` : null].filter(Boolean).join('/')})
              </span>
            )}
            {visitLabel && (
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', visitColor)}>
                {visitLabel}
              </span>
            )}
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
          </>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

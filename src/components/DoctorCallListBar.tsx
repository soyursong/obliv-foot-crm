/**
 * T-20260601-foot-DOCTOR-CALL-LIST — '원장님 진료콜 명단' 위젯
 *
 * 요구사항 6개:
 *  1) status_flag='purple'(진료필요/보라) 당일 check_ins 자동 리스트업 (수기 명단 제거)
 *  2) 초진/재진 배지 + 재진이면 N회차 표기 (누적 내원 횟수)
 *  3) 진료 전달사항 메모 입력·저장 (check_ins.doctor_call_memo — 방문동선 메모와 용도 분리)
 *  4) 원장님 전체콜/지정콜 (OPEN-Q 기본 구현안 A: 표시/선택형 — 행 선택 시 "호출 중" 하이라이트)
 *
 * AC-7: 당일·해당 지점(clinic) 범위. checkIns는 이미 Dashboard.fetchCheckIns에서
 *       clinic_id + 당일로 필터된 rows이므로 추가 지점/날짜 필터 불필요.
 *
 * T-20260601-foot-CALLLIST-DONE-INACTIVE — DOCTOR-CALL-LIST AC-2 보정(대체):
 *  - 핑크(pink/진료완료) 전환 행을 명단에서 *삭제하지 않고* 비활성(완료/dimmed)으로 잔존.
 *  - 활성(purple/진료필요)은 상단, 비활성(pink/진료완료)은 하단 정렬.
 *  - 비활성 행은 흐림 + "진료완료" 배지로 활성 콜대상과 시각 구분. 전체콜/지정콜 대상에서 제외.
 *  - 다시 보라(purple)로 되돌리면 활성으로 복귀(상단 이동) — 필터 재계산으로 자동 처리.
 *
 * T-20260601-foot-DOCTOR-CALL-POPUP-RELOC — 하단 고정 → 슬롯 빈공간 팝업 전환:
 *  - 기존: 대시보드 하단 sticky bottom bar (viewport 하단 항상 가림 → 현장 불편).
 *  - 변경: 칸반 슬롯 빈공간(스크린샷 빨간박스)에 떠있는 플로팅 팝업 패널.
 *    · OPEN-Q (A) 빈공간 인라인 팝업으로 구현 — 칸반 스크롤 컨테이너 내부 absolute 배치 →
 *      칸반과 함께 스크롤(빈공간 종속), 가로 sticky 해제.
 *    · 데이터·집계·메모·초재진 회차·전체/지정콜 로직은 그대로 보존(위치/표현만 변경).
 *    · 접기/펼치기(닫기/열기) 토글로 칸반 작업 시야 방해 제어(빈공간 점유 최소화).
 *
 * T-20260601-foot-DASH-HSCROLL-CHART-LOC — 대시보드 UX 3종:
 *  #1 위치/스크롤 (REOPEN 정정): 진료콜 명단을 우측 칸반(슬롯) 스크롤 컨테이너 내부 *우측 하단*에 배치.
 *     → position:fixed(뷰포트 고정) 폐기. absolute로 슬롯 칸에 종속 → 가로스크롤 시 슬롯과 함께 이동.
 *     (현장 김주연 총괄: "우측! 슬롯 있는 칸 하단에. 가로스크롤 이동하면 같이 따라가게")
 *     · 72314ef의 fixed 좌하단 거동 폐기, POPUP-RELOC의 "칸반과 함께 스크롤" AC로 복귀(좌→우 하단).
 *     · 세로스크롤 거동(sticky 항상 보임 vs 칸 맨 하단)은 현장 확인 중 → 추후 TICKET-UPDATE 반영(현재 보류).
 *  #2 고객 이름 클릭 → 진료차트: 행의 고객 이름 클릭 시 onOpenChart(CHART-OPEN-SINGLE 패턴) 호출.
 *     기존 행 클릭=지정콜 토글과 충돌 없게 클릭영역 분리(이름=차트, 별도 지정콜 버튼=호출). [정상 배포 유지]
 *  #3 성함 옆 현재 위치: 배정 슬롯 이름(getAssignedSlotName)을 성함 옆 배지로 표시. [정상 배포 유지]
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stethoscope, Phone, Check, X, Pencil, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CheckIn } from '@/lib/types';
import { getAssignedSlotName } from '@/lib/checkin-slot';

interface DoctorCallListBarProps {
  /** Dashboard의 당일·해당지점 check_ins rows */
  checkIns: CheckIn[];
  /** 메모 저장 후 부모 rows 갱신 트리거 */
  onRefresh?: () => void;
  /** T-20260601-foot-DASH-HSCROLL-CHART-LOC #2: 고객 이름 클릭 → 진료차트 (CHART-OPEN-SINGLE 패턴) */
  onOpenChart?: (ci: CheckIn) => void;
}

export default function DoctorCallListBar({ checkIns, onRefresh, onOpenChart }: DoctorCallListBarProps) {
  // 1) 활성(보라/진료필요) — 콜 대상. 접수순(checked_in_at) 정렬.
  const activeList = useMemo(
    () =>
      checkIns
        .filter((ci) => ci.status_flag === 'purple')
        .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)),
    [checkIns],
  );

  // CALLLIST-DONE-INACTIVE) 비활성(핑크/진료완료) — 삭제 대신 잔존. 접수순 정렬.
  const doneList = useMemo(
    () =>
      checkIns
        .filter((ci) => ci.status_flag === 'pink')
        .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)),
    [checkIns],
  );

  // AC-3) 표시 순서: 활성(진료필요) 상단 → 비활성(진료완료) 하단
  const displayList = useMemo(() => [...activeList, ...doneList], [activeList, doneList]);

  // 4) 지정콜 — 선택된 행 (호출 중 하이라이트). 활성 명단에서 빠지면 자동 해제.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && !activeList.some((ci) => ci.id === selectedId)) {
      setSelectedId(null);
    }
  }, [activeList, selectedId]);

  // 4) 전체콜 — 활성 명단 전체 호출 모드 (활성 행만 강조)
  const [allCall, setAllCall] = useState(false);
  useEffect(() => {
    if (activeList.length === 0) setAllCall(false);
  }, [activeList.length]);

  // POPUP-RELOC AC-4) 접기/펼치기 토글 — 빈공간 점유로 칸반 작업 방해 방지.
  //   접힘: 헤더 바만 표시(명단 본문 숨김) → 칸반 빈공간 확보.
  const [collapsed, setCollapsed] = useState(false);

  // 2) 재진 N회차 — 누적 내원(진료) 횟수 산출 (활성·비활성 모두 표기)
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const custIds = Array.from(
      new Set(
        displayList
          .filter((ci) => ci.visit_type === 'returning' && ci.customer_id)
          .map((ci) => ci.customer_id as string),
      ),
    );
    if (custIds.length === 0) {
      setVisitCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      // 누적 내원 = 해당 고객의 전체 check_ins 건수 (오늘 포함). N회차 표기용.
      const { data, error } = await supabase
        .from('check_ins')
        .select('customer_id')
        .in('customer_id', custIds);
      if (cancelled || error || !data) return;
      const counts: Record<string, number> = {};
      for (const row of data as { customer_id: string | null }[]) {
        if (!row.customer_id) continue;
        counts[row.customer_id] = (counts[row.customer_id] ?? 0) + 1;
      }
      setVisitCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [displayList]);

  if (displayList.length === 0) return null;

  return (
    // T-20260601-foot-DASH-HSCROLL-CHART-LOC #1 (REOPEN 정정) 진료콜 명단 팝업 —
    //   우측 칸반(슬롯) 스크롤 컨테이너 내부 *우측 하단* absolute 배치 (fixed 폐기).
    //   부모(Dashboard 칸반 컬럼)가 position:relative + overflow-auto → 이 absolute 자식은
    //   슬롯 칸에 종속되어 가로스크롤 시 콘텐츠와 함께 이동(뷰포트 고정 아님).
    //   right-4: 현장 요청대로 우측 정렬. z-30: 칸반 카드와 동급(DOM 후순위 → 카드 위에 페인트).
    <div
      data-testid="doctor-call-list"
      data-collapsed={String(collapsed)}
      data-position-mode="scroll-bound"
      className="absolute bottom-4 right-4 z-30 w-[min(30rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-red-300 bg-white/95 shadow-2xl backdrop-blur-sm"
    >
      {/* 헤더 + 접기/펼치기 + 전체콜/지정콜 액션 */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-red-200 bg-red-50/80">
        <div className="flex items-center gap-1.5">
          <Stethoscope className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-red-800">원장님 진료콜 명단</span>
          <span className="text-xs text-red-600 bg-red-100 rounded-full px-1.5 py-px font-medium">
            {activeList.length}명
          </span>
          {doneList.length > 0 && (
            <span
              className="text-xs text-gray-500 bg-gray-100 rounded-full px-1.5 py-px font-medium"
              data-testid="doctor-call-done-count"
              title="진료완료(비활성)"
            >
              완료 {doneList.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!collapsed && (
            <button
              data-testid="doctor-call-all"
              disabled={activeList.length === 0}
              onClick={() => {
                setAllCall((v) => !v);
                setSelectedId(null);
              }}
              className={cn(
                'flex items-center gap-1 text-xs font-medium rounded-md px-2.5 py-1 min-h-[36px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                allCall
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-red-700 border-red-300 hover:bg-red-100',
              )}
            >
              <Phone className="h-3.5 w-3.5" />
              전체콜
            </button>
          )}
          {!collapsed && (allCall || selectedId) && (
            <button
              data-testid="doctor-call-clear"
              onClick={() => {
                setAllCall(false);
                setSelectedId(null);
              }}
              className="flex items-center gap-1 text-xs text-gray-500 rounded-md px-2 py-1 min-h-[36px] border border-gray-200 bg-white hover:bg-gray-50"
              title="호출 해제"
            >
              <X className="h-3.5 w-3.5" />
              해제
            </button>
          )}
          {/* POPUP-RELOC AC-4) 접기/펼치기 토글 */}
          <button
            data-testid="doctor-call-toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center justify-center text-red-700 rounded-md px-1.5 py-1 min-h-[36px] min-w-[36px] border border-red-300 bg-white hover:bg-red-100"
            title={collapsed ? '명단 펼치기' : '명단 접기'}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 명단 — 가로로 카드 나열 (팝업 내부 가로 스크롤). 접힘 시 숨김(빈공간 확보).
          활성(진료필요) 상단 → 비활성(진료완료) 하단 정렬 (displayList). */}
      {!collapsed && (
      <div className="flex gap-2 overflow-x-auto px-3 py-2 max-h-[42vh]" data-testid="doctor-call-rows">
        {displayList.map((ci) => {
          const inactive = ci.status_flag === 'pink'; // 진료완료 = 비활성
          return (
            <DoctorCallRow
              key={ci.id}
              checkIn={ci}
              inactive={inactive}
              visitCount={ci.customer_id ? visitCounts[ci.customer_id] : undefined}
              // 비활성(완료) 행은 콜 대상 아님 → 하이라이트·선택 비활성
              highlighted={!inactive && (allCall || selectedId === ci.id)}
              onSelect={() => {
                if (inactive) return; // 완료 행은 지정콜 불가
                setAllCall(false);
                setSelectedId((cur) => (cur === ci.id ? null : ci.id));
              }}
              onOpenChart={onOpenChart}
              onRefresh={onRefresh}
            />
          );
        })}
      </div>
      )}
    </div>
  );
}

interface DoctorCallRowProps {
  checkIn: CheckIn;
  visitCount?: number;
  highlighted: boolean;
  /** 진료완료(핑크) = 비활성 — dimmed + "진료완료" 배지, 콜 대상 제외 */
  inactive?: boolean;
  onSelect: () => void;
  /** T-20260601-foot-DASH-HSCROLL-CHART-LOC #2: 고객 이름 클릭 → 진료차트 */
  onOpenChart?: (ci: CheckIn) => void;
  onRefresh?: () => void;
}

function DoctorCallRow({ checkIn, visitCount, highlighted, inactive = false, onSelect, onOpenChart, onRefresh }: DoctorCallRowProps) {
  const isReturning = checkIn.visit_type === 'returning';
  const isExperience = checkIn.visit_type === 'experience';
  // T-20260601-foot-DASH-HSCROLL-CHART-LOC #3: 성함 옆 현재 배정 슬롯 이름
  const slotName = getAssignedSlotName(checkIn);

  // 3) 진료 전달사항 메모
  const [editing, setEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState(checkIn.doctor_call_memo ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // DB값이 외부에서 갱신되면 (편집 중이 아닐 때) draft 동기화
  useEffect(() => {
    if (!editing) setMemoDraft(checkIn.doctor_call_memo ?? '');
  }, [checkIn.doctor_call_memo, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const saveMemo = useCallback(async () => {
    const next = memoDraft.trim() === '' ? null : memoDraft.trim();
    if (next === (checkIn.doctor_call_memo ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('check_ins')
      .update({ doctor_call_memo: next })
      .eq('id', checkIn.id);
    setSaving(false);
    if (error) {
      toast.error('진료 전달사항 저장 실패');
      return;
    }
    setEditing(false);
    toast.success('진료 전달사항 저장됨');
    onRefresh?.();
  }, [memoDraft, checkIn.doctor_call_memo, checkIn.id, onRefresh]);

  const visitBadge = isReturning ? (
    <span className="bg-green-100 text-green-800 text-[10px] px-1 py-px rounded font-medium whitespace-nowrap">
      재진{typeof visitCount === 'number' && visitCount > 0 ? ` ${visitCount}회차` : ''}
    </span>
  ) : isExperience ? (
    <span className="bg-purple-100 text-purple-800 text-[10px] px-1 py-px rounded font-medium whitespace-nowrap">
      체험
    </span>
  ) : (
    <span className="bg-blue-100 text-blue-800 text-[10px] px-1 py-px rounded font-medium whitespace-nowrap">
      초진
    </span>
  );

  return (
    <div
      data-testid="doctor-call-row"
      data-checkin-id={checkIn.id}
      data-highlighted={String(highlighted)}
      data-inactive={String(inactive)}
      className={cn(
        'shrink-0 w-56 rounded-lg border p-2 transition-all',
        // CALLLIST-DONE-INACTIVE) 진료완료 = 비활성 (흐림 + 회색조), 콜 대상 활성과 시각 구분
        inactive
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : highlighted
            ? 'border-red-500 ring-2 ring-red-400 shadow-md bg-red-50'
            : 'border-red-200 bg-white hover:border-red-300',
      )}
    >
      {/* 헤더: 고객명(클릭→진료차트) + 위치배지 + 배지 + 지정콜/호출표시 */}
      {/* T-20260601-foot-DASH-HSCROLL-CHART-LOC #2: 이름=차트, 지정콜=별도 버튼(클릭영역 분리) */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            onClick={() => onOpenChart?.(checkIn)}
            disabled={!onOpenChart}
            data-testid="doctor-call-name"
            className={cn(
              'font-semibold text-sm truncate text-left',
              inactive ? 'text-gray-500' : 'text-gray-900',
              onOpenChart ? 'hover:underline decoration-dotted underline-offset-2 cursor-pointer' : 'cursor-default',
            )}
            title={onOpenChart ? '클릭 → 진료차트 열기' : undefined}
          >
            {checkIn.customer_name}
          </button>
          {/* #3 현재 배정 슬롯 이름 */}
          {slotName && (
            <span
              data-testid="doctor-call-location"
              className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-px whitespace-nowrap"
              title={`현재 위치: ${slotName}`}
            >
              <MapPin className="h-2.5 w-2.5" />
              {slotName}
            </span>
          )}
          {visitBadge}
          {/* 지정콜 토글 — 이름 클릭(차트)과 분리된 별도 버튼 */}
          {!inactive && (
            <button
              onClick={onSelect}
              data-testid="doctor-call-select"
              className={cn(
                'shrink-0 inline-flex items-center justify-center rounded min-w-[28px] min-h-[28px] border transition-colors',
                highlighted
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-red-600 border-red-200 hover:bg-red-50',
              )}
              title="지정콜 — 클릭하여 호출 중 표시"
            >
              <Phone className="h-3 w-3" />
            </button>
          )}
        </div>
        {inactive ? (
          <span
            className="flex items-center gap-0.5 text-[10px] font-bold text-gray-500 bg-gray-200 rounded px-1 py-px whitespace-nowrap"
            data-testid="doctor-call-done-badge"
          >
            <Check className="h-3 w-3" />
            진료완료
          </span>
        ) : highlighted ? (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 whitespace-nowrap" data-testid="doctor-call-calling">
            <Phone className="h-3 w-3 animate-pulse" />
            호출 중
          </span>
        ) : null}
      </div>

      {/* 진료 전달사항 메모 */}
      <div className="mt-1.5">
        {editing ? (
          <div className="flex flex-col gap-1">
            <textarea
              ref={inputRef}
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="진료 전달사항 입력"
              data-testid="doctor-call-memo-input"
              className="w-full rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
            <div className="flex justify-end gap-1">
              <button
                onClick={() => {
                  setMemoDraft(checkIn.doctor_call_memo ?? '');
                  setEditing(false);
                }}
                className="text-[11px] text-gray-500 px-1.5 py-0.5 rounded hover:bg-gray-100"
              >
                취소
              </button>
              <button
                onClick={saveMemo}
                disabled={saving}
                data-testid="doctor-call-memo-save"
                className="flex items-center gap-0.5 text-[11px] text-white bg-red-600 px-1.5 py-0.5 rounded hover:bg-red-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                저장
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            data-testid="doctor-call-memo-display"
            className="w-full text-left flex items-start gap-1 group"
            title="진료 전달사항 입력/수정"
          >
            <span
              className={cn(
                'text-xs flex-1 break-words',
                checkIn.doctor_call_memo ? 'text-gray-700' : 'text-gray-400 italic',
              )}
            >
              {checkIn.doctor_call_memo || '진료 전달사항 +'}
            </span>
            <Pencil className="h-3 w-3 text-gray-300 group-hover:text-red-500 shrink-0 mt-0.5" />
          </button>
        )}
      </div>
    </div>
  );
}

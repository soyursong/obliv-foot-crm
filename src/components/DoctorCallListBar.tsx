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
 *
 * T-20260601-foot-DASH-POPUP-RIGHT-FIX — 위치 재정정 (db62b1a scroll-bound 대체):
 *  - 현장 재요청(김주연 총괄): "아니 우측! 대시보드 슬롯 칸 하단에 넣어달라고, 가로스크롤 이동하면 같이 따라가게."
 *  - db62b1a의 absolute scroll-bound(슬롯과 함께 이동 → 스크롤 시 화면에서 사라짐) 해석을 폐기하고,
 *    "가로스크롤해도 항상 보이게 따라온다" 의도로 재해석 → position:fixed 뷰포트 우하단 고정으로 정정.
 *  - absolute bottom-4 right-4 z-30 (슬롯 종속) → fixed bottom-4 right-4 z-40 (뷰포트 우하단 고정).
 *    · AC-1 우측(우하단) fixed 고정(좌하단 아님). AC-2 가로스크롤해도 우측 유지·안 사라짐.
 *    · z-40: 칸반 카드(z-30)보다 위, 모달(z-50+)보다 아래. width calc 기준 100% → 100vw(fixed=뷰포트 기준).
 *  - AC-3 무파괴: 이름클릭→차트, 슬롯 위치배지, 지정콜/전체콜, 메모 등 기능 로직 일체 불변(위치만 변경).
 *
 * T-20260609-foot-CALLLIST-HEALER-POSITION — 힐러 포함 + 현재 위치 실시간/오표시 수정:
 *  item1) inclusion 조건 확장: 보라(purple/진료필요) 단독 → 보라 OR 힐러(yellow). 힐러도 원장 시술
 *         대상이므로 콜 명단에 표시. 행에 [힐러] 노랑 배지로 진료필요와 시각 구분.
 *  item2) 현재 위치 실시간 반영: 위치 배지를 getAssignedSlotName(방 이름) → getCurrentLocationLabel
 *         (status 단계 인식)로 교체. status는 realtime fetchCheckIns로 갱신되므로 stale 제거.
 *  item3) 치료대기↔방배정 오표시 수정: 대기 단계(치료대기 등)는 단계 라벨만 표시(방 미표시).
 *         ※ dedup: SLOT-CHART-MISMAP(카드클릭→customer_id 차트오픈)과 다른 축 → 본 티켓에서 수정.
 *
 * T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT — 명단 레이아웃 개선 3건 (현장 김주연 총괄):
 *  req1) 성함 잘림 제거: 이름 표시 요소 truncate → whitespace-normal + break-words.
 *        긴 이름도 전체 표시(잘림/말줄임 금지). 세로 카드(w-full)로 가로 여유 ↑ → 대개 한 줄.
 *  req2) 가로 스크롤 → 세로 나열: 행 컨테이너 flex(가로 overflow-x-auto) → flex flex-col(위→아래 스택).
 *  req3) 고정/제한 높이 제거: max-h-[42vh] + overflow 제거 → height auto. 인원 늘수록 컨테이너가
 *        아래로 자연 확장(내부 스크롤 없이 한눈에). 이를 위해 팝업 앵커를 우하단(bottom-4) →
 *        우상단(top-4)으로 변경: bottom 앵커는 height 증가 시 위로 자라 뷰포트 상단서 잘림 →
 *        top 앵커여야 "아래로 자연 확장"(현장 문구) 그대로 동작. 가로 위치(우측 right-4)는 보존
 *        (DASH-POPUP-RIGHT-FIX의 '우측 고정' AC 유지, 세로 앵커만 정정).
 *  ※ HEALER-POSITION fix(힐러 inclusion·위치배지)는 레이아웃 변경 후에도 회귀 없이 유지(AC-4).
 *
 * T-20260609-foot-CALLLIST-VERTICAL-FULLNAME — 세로 나열 + 성함 전체 + max-h 세로 스크롤 (NAME-VERTICAL-LAYOUT 보정):
 *  현장 김주연 총괄: "성함 절대 잘리면 안 됨 + 가로 말고 세로 나열, 인원 늘면 세로로 자연 확장, 한눈에."
 *  NAME-VERTICAL-LAYOUT은 max-h를 완전히 제거(height auto, 내부 스크롤 X)했으나, 패널이 fixed top-4라
 *  인원이 많으면 컨테이너가 뷰포트 하단 밖으로 밀려 *잘리고 스크롤도 불가*한 잠재 결함이 있었다.
 *  AC-1) 행 컨테이너에 max-h(뷰포트 잔여) + overflow-y-auto 재도입 → max-h 초과 시 내부 세로 스크롤
 *        (가로 스크롤 없음·flex-col 세로 스택 유지). NAME-VERTICAL-LAYOUT의 "no max-h/no scroll" 결정을 대체.
 *  AC-2) 성함 전체 표시(truncate 부재·whitespace-normal·break-words) + 카드 풀폭(w-full) 유지(회귀 없음).
 *  AC-3) 4명 정도는 max-h 안에 들어가 스크롤 없이 한눈에. 그 이상이면 내부 세로 스크롤(off-screen 잘림 방지).
 *  AC-4) 지정/전체콜·이름클릭→차트·힐러/위치/재진 배지·pink 비활성·메모 저장/조회 전부 불변(레이아웃 클래스 외 미접촉).
 *
 * T-20260610-foot-CALLLIST-DRAGGABLE-POSITION — 위치 정책 canonical 소유 티켓(현장 김주연 총괄, 긴급):
 *  "위치 고정 폐기 → 개인이 헤더를 잡고 드래그로 자유 배치 + 위치 영속."
 *  구현체는 본 파일의 TOP-COVERS-BUTTONS Phase 2(헤더 onPointer* 드래그 + setPointerCapture + clampPos +
 *  localStorage 'foot.doctorCallList.pos.v1' + reset-pos)와 동일 — 코드 추가 없이 그 구현을 위치 정책의
 *  canonical로 격상하고, 시나리오 3종(드래그+영속 / 본문 무간섭 / 클램프+초기화)을 전용 spec로 고정한다
 *  (tests/e2e/T-20260610-foot-CALLLIST-DRAGGABLE-POSITION.spec.ts). 위치=fixed 앵커 폐기·드래그 좌표 제어,
 *  버튼/토글/이름→차트/메모는 헤더 드래그핸들 밖 또는 stopPropagation으로 본문 무간섭, clamp로 화면밖 유실 방지.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stethoscope, Phone, Check, X, Pencil, ChevronDown, ChevronUp, MapPin, RotateCcw, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { CheckIn } from '@/lib/types';
import { getCurrentLocationLabel } from '@/lib/checkin-slot';
import { DoctorAckBadge } from '@/components/doctor/DoctorAck';

/** T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS Phase 2: 드래그 위치 저장 키(사용자/브라우저 단위 개인설정). */
const CALLLIST_POS_KEY = 'foot.doctorCallList.pos.v1';
/** T-20260610-foot-CALLLIST-HIDE-TOGGLE AC-3: 숨김/표시 상태 저장 키. 위치 키와 별도 네임스페이스(충돌 금지). */
const CALLLIST_HIDDEN_KEY = 'foot.doctorCallList.hidden.v1';

interface DoctorCallListBarProps {
  /** Dashboard의 당일·해당지점 check_ins rows */
  checkIns: CheckIn[];
  /** 메모 저장 후 부모 rows 갱신 트리거 */
  onRefresh?: () => void;
  /** T-20260601-foot-DASH-HSCROLL-CHART-LOC #2: 고객 이름 클릭 → 진료차트 (CHART-OPEN-SINGLE 패턴) */
  onOpenChart?: (ci: CheckIn) => void;
}

export default function DoctorCallListBar({ checkIns, onRefresh, onOpenChart }: DoctorCallListBarProps) {
  // 1) 활성(콜 대상) — 보라(purple/진료필요) + 노랑(yellow/HL) + 힐러대기 단계(status='healer_waiting').
  //    T-20260609-foot-CALLLIST-HEALER-POSITION item1 + REOPEN(11:42) FIX-SPEC:
  //    힐러(원장 시술)도 콜 대상이므로 포함. 단, 힐러 신호는 두 갈래다 —
  //      (a) status_flag='yellow' (HL 플래그 / 힐러예약 자동 HL, foot_logic_sync_registry G-002)
  //      (b) status='healer_waiting' (힐러대기 컬럼으로 카드 이동 — 현장 주 동선. status_flag는 미변경)
  //    eb7142f는 (a)만 봐서 (b) 힐러대기 환자(status_flag≠yellow)를 전혀 못 잡아 명단 누락 →
  //    현장 "힐러대기 이동해도 안뜸"의 근본원인. status==='healer_waiting' OR 조건 추가로 해소.
  //    (라이브 DB 실측: yellow는 정확히 'yellow' 문자열 저장 확인 — (a) 경로는 기존에도 정상.)
  //    힐러→다른 상태/단계 전환 시 필터 재계산으로 자동 제거(AC-2 보존).
  const activeList = useMemo(
    () =>
      checkIns
        .filter(
          (ci) =>
            ci.status_flag === 'purple' ||
            ci.status_flag === 'yellow' ||
            ci.status === 'healer_waiting',
        )
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

  // T-20260610-foot-CALLLIST-HIDE-TOGGLE — 전체 숨기기(collapse보다 강함: 헤더까지 사라지고 최소 탭만 잔존).
  //   AC-3) localStorage 영구(per-browser). 위치 키와 별도 네임스페이스라 드래그 위치 영속과 직교(충돌 X).
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CALLLIST_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CALLLIST_HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
      /* localStorage 접근 불가 → 영속 생략(세션 상태로 동작) */
    }
  }, [hidden]);

  // AC-4·AC-5) 숨김 중 신규 리스트업 unseen 카운트 — *강제 펼침 없이* 배지로만 알림(P0 버튼가림 회귀 방지).
  //   seenIdsRef = 사용자가 이미 본 활성 콜대상 id 집합. 패널이 보이는 동안은 전부 seen(unseen=0).
  //   숨김 중에는 seen 집합을 자동 갱신하지 않음 → 새로 들어온 활성 id가 unseen으로 누적.
  //   펼치면(hidden=false) 효과가 다시 전체를 seen 처리 → 배지 리셋.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [unseenCount, setUnseenCount] = useState(0);

  // T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS Phase 2 — 드래그 자유이동(현장 "개인마다 자유롭게").
  //   AC-5 헤더(드래그 핸들)를 잡아 화면 어디든 이동. AC-6 localStorage 위치저장 + boundary clamp +
  //   기본=Phase1 버튼비가림(bottom-4 right-4). AC-7 새 드래그 라이브러리 도입 금지 → 네이티브 pointer events.
  //   pos=null 이면 CSS 앵커(기본 우하단), 좌표가 있으면 fixed left/top 인라인으로 전환.
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(CALLLIST_POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p?.x === 'number' && typeof p?.y === 'number') return { x: p.x, y: p.y };
    } catch {
      /* localStorage 접근 불가/파싱 실패 → 기본 앵커 */
    }
    return null;
  });
  // 드래그 진행 상태 — 리렌더 없이 보관(pointer offset).
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });

  // boundary clamp — 헤더가 항상 화면 안에 잡히도록(완전 이탈 방지). 위젯 폭은 실측, 헤더 높이는 상수.
  const clampPos = useCallback((x: number, y: number) => {
    const w = panelRef.current?.offsetWidth ?? 480;
    const headerH = 44; // 헤더(드래그 핸들) 최소 가시 높이
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - headerH);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, []);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 헤더 내 버튼(전체콜/해제/접기)·인터랙티브 요소 위에서는 드래그 시작 안 함(오발동 방지).
    if ((e.target as HTMLElement).closest('button')) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      active: true,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture 미지원 환경 무시 */
    }
  }, []);

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current.active) return;
      e.preventDefault();
      setPos(clampPos(e.clientX - dragRef.current.offsetX, e.clientY - dragRef.current.offsetY));
    },
    [clampPos],
  );

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    setPos((cur) => {
      if (cur) {
        try {
          localStorage.setItem(CALLLIST_POS_KEY, JSON.stringify(cur));
        } catch {
          /* 저장 실패는 무시(다음 드래그 시 재시도) */
        }
      }
      return cur;
    });
  }, []);

  // 리사이즈 시 화면 밖 이탈 방지 — 저장 좌표를 다시 clamp.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((cur) => (cur ? clampPos(cur.x, cur.y) : cur));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clampPos]);

  // 컨버전스 흡수(DRAGGABLE-POSITION 이관): 위치 초기화 — 저장 좌표 삭제 + 기본(버튼비가림 우하단) 복귀.
  //   드래그로 위젯을 화면 밖에 박았을 때 복구용. pos!=null(이동/저장됨)일 때만 헤더에 노출.
  const resetPos = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      localStorage.removeItem(CALLLIST_POS_KEY);
    } catch {
      /* noop */
    }
    setPos(null);
  }, []);

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

  // AC-4) unseen 신규 카운트 산출 — activeList(콜 대상) 또는 hidden 변동 시 재계산.
  //   보이는 상태: 전체를 seen으로 마킹 → unseen 0(배지 없음).
  //   숨김 상태: seen 집합에 없는 활성 id 수 = unseen(누적). seen 집합은 숨김 중 갱신하지 않음.
  useEffect(() => {
    const activeIds = activeList.map((ci) => ci.id);
    if (!hidden) {
      seenIdsRef.current = new Set(activeIds);
      setUnseenCount(0);
      return;
    }
    let count = 0;
    for (const id of activeIds) {
      if (!seenIdsRef.current.has(id)) count++;
    }
    setUnseenCount(count);
  }, [activeList, hidden]);

  if (displayList.length === 0) return null;

  // AC-1·AC-2) 숨김 상태: 전체 패널 대신 최소 탭만 렌더(완전소멸 금지 — 재접근 가능).
  //   위치(pos/anchor)는 그대로 적용 → 드래그해둔 자리에 최소 탭이 남음(AC-7 위치 보존).
  //   AC-4 빨간 배지(unseen)는 최소 탭 우상단. 클릭 시 펼침(setHidden(false)) → 위 효과가 배지 리셋.
  if (hidden) {
    return (
      <div
        ref={panelRef}
        data-testid="doctor-call-list"
        data-hidden="true"
        data-position-mode={pos ? 'dragged' : 'fixed'}
        className={cn(
          'fixed z-40 rounded-xl border border-red-300 bg-white/95 shadow-2xl backdrop-blur-sm',
          pos ? '' : 'bottom-4 right-4',
        )}
        style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      >
        <button
          data-testid="doctor-call-show"
          onClick={() => setHidden(false)}
          className="relative flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl hover:bg-red-50"
          title="원장님 진료콜 명단 펼치기"
        >
          <Stethoscope className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-red-800">진료콜</span>
          <span className="text-xs text-red-600 bg-red-100 rounded-full px-1.5 py-px font-medium">
            {activeList.length}
          </span>
          {unseenCount > 0 && (
            <span
              data-testid="doctor-call-unseen-badge"
              className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-bold rounded-full ring-2 ring-white"
              title={`미확인 신규 ${unseenCount}명`}
            >
              {unseenCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    // T-20260601-foot-DASH-POPUP-RIGHT-FIX 진료콜 명단 팝업 — 뷰포트 우측 position:fixed 고정.
    //   가로스크롤해도 화면 우측에 항상 붙어 따라옴(안 사라짐). right-4: 현장 요청대로 우측.
    //   z-40: 칸반 카드(z-30) 위, 모달(z-50+) 아래.
    // T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS Phase 1 (P0 회귀 핫픽스):
    //   현장(김주연 총괄): "진료콜 명단이 상위 노출로 변경돼서 버튼들 다 가림".
    //   RC = VERTICAL-FULLNAME 직전 NAME-VERTICAL-LAYOUT에서 세로 앵커를 bottom-4 → top-4(우상단)로 바꿔
    //   상단 동작버튼을 덮은 것(추정 아님, L193 실측). 앵커를 우하단(bottom-4)으로 복귀 → 상단 버튼 비가림(AC-1).
    //   L267 행 컨테이너 max-h-[calc(100vh-6rem)]+overflow-y-auto가 이미 있어 bottom 앵커여도 상단 잘림 재발 없음
    //   (VERTICAL-FULLNAME가 top-4 채택한 사유가 해소됨). 세로나열+성함 전체표시(AC-2)·콜/차트/배지(AC-4) 불변.
    //   임시 z-index 봉합 금지 — 앵커가 본질.
    <div
      ref={panelRef}
      data-testid="doctor-call-list"
      data-collapsed={String(collapsed)}
      data-hidden="false"
      data-position-mode={pos ? 'dragged' : 'fixed'}
      className={cn(
        'fixed z-40 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-red-300 bg-white/95 shadow-2xl backdrop-blur-sm',
        // Phase 2: 저장된/드래그 좌표가 없을 때만 기본 앵커(Phase 1 버튼비가림 우하단). 좌표가 있으면 인라인 left/top.
        pos ? '' : 'bottom-4 right-4',
      )}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      {/* 헤더 + 접기/펼치기 + 전체콜/지정콜 액션
          T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS Phase 2: 헤더 = 드래그 핸들(AC-5).
          cursor-move + touch-none(터치 스크롤이 드래그 방해 방지) + select-none(드래그 중 텍스트선택 방지).
          헤더 내 버튼 위에서는 onHeaderPointerDown이 드래그를 시작하지 않음(콜/접기 오발동 방지). */}
      <div
        data-testid="doctor-call-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-red-200 bg-red-50/80 cursor-move touch-none select-none"
      >
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
          {/* Phase 2(컨버전스 흡수) 위치 초기화 — 드래그/저장된 좌표가 있을 때만. 기본 위치 복귀(화면 밖 박힘 복구).
              onPointerDown stopPropagation: 헤더 드래그 핸들로 오발동 방지(버튼 위에서 드래그 미시작과 이중 가드). */}
          {pos && (
            <button
              data-testid="doctor-call-reset-pos"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={resetPos}
              className="flex items-center justify-center text-gray-500 rounded-md px-1.5 py-1 min-h-[36px] min-w-[36px] border border-gray-200 bg-white hover:bg-gray-50"
              title="위치 초기화 — 기본(우하단) 위치로 복귀"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {/* T-20260610-foot-CALLLIST-HIDE-TOGGLE AC-1) 숨기기 토글 — 클릭 시 전체 패널 → 최소 탭.
              onPointerDown stopPropagation: 헤더 드래그 핸들 오발동 방지(콜/접기 토글과 동일 가드). */}
          <button
            data-testid="doctor-call-hide"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setHidden(true)}
            className="flex items-center justify-center text-red-700 rounded-md px-1.5 py-1 min-h-[36px] min-w-[36px] border border-red-300 bg-white hover:bg-red-100"
            title="명단 숨기기 — 최소 탭만 남김"
          >
            <EyeOff className="h-4 w-4" />
          </button>
          {/* POPUP-RELOC AC-4) 접기/펼치기 토글 */}
          <button
            data-testid="doctor-call-toggle"
            aria-expanded={!collapsed}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center justify-center text-red-700 rounded-md px-1.5 py-1 min-h-[36px] min-w-[36px] border border-red-300 bg-white hover:bg-red-100"
            title={collapsed ? '명단 펼치기' : '명단 접기'}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 명단 — T-20260609-foot-CALLLIST-VERTICAL-FULLNAME AC-1 (NAME-VERTICAL-LAYOUT 보정):
          세로 나열(flex-col, 위→아래 스택). 가로 스크롤(overflow-x-auto) 없음 — 가로 잘림 X.
          max-h-[calc(100vh-6rem)] + overflow-y-auto 재도입: 인원이 적으면(≈4명) 한도 안에 들어가
          스크롤 없이 한눈에(AC-3), 한도 초과 시 내부 세로 스크롤 → fixed top-4 패널이 뷰포트 하단
          밖으로 밀려 잘리는 결함 차단. 접힘 시 숨김.
          활성(진료필요) 상단 → 비활성(진료완료) 하단 정렬 (displayList) 보존. */}
      {!collapsed && (
      <div className="flex flex-col gap-2 px-3 py-2 max-h-[calc(100vh-6rem)] overflow-y-auto" data-testid="doctor-call-rows">
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
  // T-20260609-foot-CALLLIST-HEALER-POSITION item1 + REOPEN FIX-SPEC: 힐러 구분 배지.
  //   힐러 신호 두 갈래 모두 [힐러] 배지: status_flag='yellow'(HL) OR status='healer_waiting'(힐러대기 단계).
  const isHealer = checkIn.status_flag === 'yellow' || checkIn.status === 'healer_waiting';
  // T-20260609-foot-CALLLIST-HEALER-POSITION item2·3: 성함 옆 현재 위치(단계 인식).
  //   기존 getAssignedSlotName(방 이름) → getCurrentLocationLabel(단계 라벨, 대기 단계는 방 미표시).
  //   치료대기 환자가 '방배정'으로 잘못 표시되던 오표시 제거 + status 파생으로 실시간 갱신.
  const locationLabel = getCurrentLocationLabel(checkIn);

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
        // VERTICAL-LAYOUT req2: 세로 나열 → 카드는 패널 폭 가득(w-full). (구 가로배치 shrink-0 w-56 폐기)
        'w-full rounded-lg border p-2 transition-all',
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
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-start flex-wrap gap-1.5 min-w-0 flex-1">
          <button
            onClick={() => onOpenChart?.(checkIn)}
            disabled={!onOpenChart}
            data-testid="doctor-call-name"
            className={cn(
              // VERTICAL-LAYOUT req1: 성함 잘림 제거 — truncate → whitespace-normal + break-words.
              //   긴 이름도 전체 표시(말줄임 금지). min-w-0 로 flex 내 줄바꿈 허용.
              'font-semibold text-sm whitespace-normal break-words text-left min-w-0',
              inactive ? 'text-gray-500' : 'text-gray-900',
              onOpenChart ? 'hover:underline decoration-dotted underline-offset-2 cursor-pointer' : 'cursor-default',
            )}
            title={onOpenChart ? '클릭 → 진료차트 열기' : undefined}
          >
            {checkIn.customer_name}
          </button>
          {/* item2·3 현재 위치(단계 인식). 항상 표시 — status 변경 시 실시간 갱신.
              치료대기 등 대기 단계는 단계 라벨만(방배정 오표시 없음). */}
          <span
            data-testid="doctor-call-location"
            data-checkin-status={checkIn.status}
            className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-px whitespace-nowrap"
            title={`현재 위치: ${locationLabel}`}
          >
            <MapPin className="h-2.5 w-2.5" />
            {locationLabel}
          </span>
          {/* item1 힐러(yellow) 구분 배지 — 진료필요(보라)와 시각 구분 */}
          {isHealer && (
            <span
              data-testid="doctor-call-healer-badge"
              className="shrink-0 bg-yellow-100 text-yellow-800 border border-yellow-300 text-[10px] px-1 py-px rounded font-medium whitespace-nowrap"
              title="힐러 — 원장님 시술 대상"
            >
              힐러
            </span>
          )}
          {visitBadge}
          {/* T-20260609-foot-DOCCALL-DOCTOR-ACK AC3: 호출 직원 화면에 '의사 확인됨' 상태 조회(표시 전용).
              checkIns는 Dashboard fetchCheckIns(check_ins Realtime 구독)에서 갱신 → 새로고침 없이 즉시 반영.
              직원은 조회만(확인 버튼 없음 — 시나리오2 권한 게이트는 ack 버튼이 DoctorCallDashboard에만 존재). */}
          <DoctorAckBadge ackAt={checkIn.doctor_ack_at} className="shrink-0" />
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

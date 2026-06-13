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
 *
 * T-20260611-foot-CALLLIST-ROOM-LABEL — 콜 행에 배정 방이름 배지 가산 (현장 김주연 총괄):
 *  "진료콜 명단에 방 번호가 명확히 떠야 원장님이 어느 방(예: 치료실 C1)으로 갈지 찾아간다."
 *  surface = 진료콜 명단 위젯(call list bar). 진료환자목록(DoctorPatientList 6FIX AC-3, 5e55c13 deployed)과
 *  다른 surface지만 *동일한 read-only 파생 규칙* 재사용: getAssignedSlotName(checkin-slot.ts SSOT) +
 *  check_ins.*_room(consultation/examination/treatment/laser). 신규 파생함수·스키마·DB변경 없음
 *  (Dashboard.fetchCheckIns select '*' → *_room 4종이 이미 row에 포함, STEP1 확인).
 *  AC-1) 각 콜 행에 'doctor-call-room' 방이름 배지(getAssignedSlotName 결과 = 'C2'/'L3'/'상담실1' 등).
 *  AC-2) 미배정/대기(getAssignedSlotName=null)면 '—'(undefined·"undefined"·크래시 금지).
 *  AC-0) 기존 doctor-call-location(getCurrentLocationLabel) 배지·세로풀네임·숨기기·행자동표시·드래그 위치
 *        전부 불변 — 방배지만 *가산*. 위치배지(단계 인식)와 방배지(방 코드 직접)는 다른 facet으로 공존:
 *        위치배지 teal MapPin = "어느 단계", 방배지 indigo DoorOpen = "어느 방으로 갈지"(원장 네비게이션).
 *
 * T-20260614-foot-CALLLIST-DOCCALL-3FIX — 진료콜 명단 현장 피드백 3건(현장 김주연 총괄):
 *  #1 위치 배지 중복 제거: ROOM-LABEL이 추가한 standalone 방 배지(doctor-call-room, indigo DoorOpen)는
 *     위치 배지(doctor-call-location)가 입실 단계에서 '치료실 · C1'로 방번호를 이미 포함하면서 'C1'을
 *     이중 표기하는 중복이 됐다(현장 실증: "📍 치료실 · C1" + "🏛 C1"). standalone 방 배지 제거 →
 *     행당 위치 배지 1개로 통일(치료실명+방번호 유지). getAssignedSlotName 직접 사용처 소멸(getCurrentLocationLabel
 *     내부에서만 호출).
 *  #2 행 우측 전화기(지정콜, doctor-call-select) 버튼 완전 제거 + 핸들러 dead code 정리.
 *  #3 상단 우측 '전체콜'(doctor-call-all) 버튼 완전 제거(+ 무용해진 '해제' doctor-call-clear 동반 제거).
 *     숨기기(EyeOff)·접기/펼치기(chevron)는 유지.
 *  ⇒ #2·#3로 콜 하이라이트 메커니즘(allCall/selectedId state·highlighted prop·"호출 중" doctor-call-calling)이
 *     모든 진입점을 잃어 dead code화 → 일괄 정리. 명단 자동표시·메모·위치/힐러/재진 배지·행숨김·드래그 위치 불변.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Stethoscope, Check, Pencil, ChevronDown, ChevronUp, MapPin, RotateCcw, EyeOff } from 'lucide-react';
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
/** T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW AC-2: 개별 행 숨김 시그니처 집합 저장 키.
 *  위치(pos.v1)·전체숨김(hidden.v1)과 별도 네임스페이스(직교 facet). 값=listup 시그니처 문자열 배열. */
const CALLLIST_ROW_HIDDEN_KEY = 'foot.doctorCallList.rowHidden.v1';

/**
 * T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW ★핵심 설계 — "신규 리스트업(listup)" 시그니처 키.
 *  단순 환자ID/check_in.id 영구숨김 금지(planner AC-0). 키 = `${check_in.id}::${최근 active 진입시각}`.
 *    - check_in.id: 방문(체크인) 단위 고유 → 새 환자/새 방문은 항상 새 시그니처 → 자동 재노출.
 *    - 최근 active(purple/yellow) 진입시각: 동일 check_in이 진료완료(pink) 후 재차 진료필요(purple)로
 *      재등장(re-listup)하면 status_flag_history에 새 changed_at이 쌓여 시그니처가 바뀜 → 숨김 무시·자동 재노출.
 *      = "리스트업 시점 기반" 키여야 AC-3이 성립(이벤트 시점 미반영 키면 같은 사람 재진료를 영구히 가려 의료 누락).
 *  status_flag_history가 없거나(healer_waiting status 경로 등) purple/yellow 진입기록이 없으면 checked_in_at로 폴백
 *  (방문 단위 안정값 — 새 방문은 새 check_in.id라 어차피 재노출됨).
 */
export function listupSignature(ci: CheckIn): string {
  let activationAt = ci.checked_in_at; // 폴백: 방문(체크인) 시각 — 방문 단위 안정.
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    // 뒤에서부터 가장 최근 active(purple/yellow) 진입 엔트리를 찾음 = 최신 리스트업 모먼트.
    for (let i = hist.length - 1; i >= 0; i--) {
      const f = hist[i]?.flag;
      if ((f === 'purple' || f === 'yellow') && hist[i]?.changed_at) {
        activationAt = hist[i].changed_at;
        break;
      }
    }
  }
  return `${ci.id}::${activationAt}`;
}

/**
 * T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE WS-1 — 진료콜 명단 정렬 키 = "진료콜 진입 시각".
 *   접수시각(checked_in_at)이 아니라, 환자가 진료콜 상태(보라/노랑)로 *전환된 시각* 기준으로 정렬해야
 *   원장 호출 우선순위가 맞다(접수만 먼저였고 콜은 늦게 뜬 환자가 위로 오던 오정렬 제거 — 현장 김주연 총괄).
 *   = status_flag_history(이미 존재하는 "상태 변경 시각" 감사 컬럼, 신규 컬럼 추가 없음 — responder 확인)의
 *     가장 최근 active(purple/yellow) 전환 changed_at. 이력이 없으면(순수 healer_waiting status 경로 등)
 *     checked_in_at 폴백(방문 단위 안정값).
 *   ※ listupSignature의 activationAt 파생과 의도적으로 동일 규칙(콜 진입 모먼트). 다만 listupSignature는
 *     형제 티켓(ROW-HIDE-AUTOSHOW)이 본문을 정적 가드로 락하고 있어 그 함수를 건드리지 않고 별도 헬퍼로 둔다.
 */
export function callEntryTime(
  ci: Pick<CheckIn, 'checked_in_at' | 'status_flag_history'>,
): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    // 뒤에서부터 가장 최근 active(purple/yellow) 진입 엔트리를 찾음 = 최신 진료콜 진입 모먼트.
    for (let i = hist.length - 1; i >= 0; i--) {
      const entry = hist[i];
      if (entry && (entry.flag === 'purple' || entry.flag === 'yellow') && entry.changed_at) {
        return entry.changed_at;
      }
    }
  }
  return ci.checked_in_at; // 폴백: 방문(체크인) 시각 — 방문 단위 안정.
}

/** rowHidden localStorage 로드(array→Set). 파싱 실패/접근 불가 시 빈 집합. */
function loadRowHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(CALLLIST_ROW_HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((s) => typeof s === 'string'));
  } catch {
    /* noop */
  }
  return new Set();
}

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
        // T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE WS-1: 정렬 키 checked_in_at(접수순) →
        //   callEntryTime(진료콜 진입 시각, status_flag_history 파생). 오름차순 = 콜 진입이 빠른 환자 상단
        //   (가장 오래 기다린 콜대상부터 호출). 대상 상태 보라/노랑/힐러대기 모두 동일 키 적용.
        .sort((a, b) => callEntryTime(a).localeCompare(callEntryTime(b))),
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

  // ── T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW ─────────────────────────────────────────────
  //   개별 행 숨기기(표시 필터 레이어) + 신규 listup 시그니처 재등장 시 자동 재노출.
  //   AC-1) 행 단위 숨김은 *렌더 필터만* — activeList/doneList/displayList(콜동작·정렬·집계)는 전부 풀데이터로 보존.
  //   AC-2) 숨김 집합 per-browser localStorage 영구(rowHidden.v1, 위치/전체숨김 키와 직교).
  //   AC-3) 키=listupSignature(이벤트/리스트업 시점 기반) → 새 환자/새 방문/재진료(re-listup)는 새 시그니처라
  //         숨김 집합에 없어 자동 노출. 같은 listup이 유지되는 동안만 숨김 지속.
  const [hiddenSigs, setHiddenSigs] = useState<Set<string>>(loadRowHidden);

  // AC-2) hiddenSigs 변동 시 localStorage 영속(array 직렬화). 접근 불가 시 세션 상태로만 동작.
  useEffect(() => {
    try {
      localStorage.setItem(CALLLIST_ROW_HIDDEN_KEY, JSON.stringify([...hiddenSigs]));
    } catch {
      /* noop */
    }
  }, [hiddenSigs]);

  // 시그니처 prune — 현재 명단에 더는 존재하지 않는 시그니처 제거(localStorage 무한증식 방지 + fail-safe).
  //   명단을 떠난 환자가 다시 active로 돌아오면 status_flag_history에 새 진입기록이 쌓여 *새 시그니처*가 되므로
  //   prune로 옛 시그니처를 지워도 숨김이 잘못 유지될 위험 없음(불확실하면 '노출' 쪽으로 안전).
  useEffect(() => {
    const currentSigs = new Set(displayList.map(listupSignature));
    setHiddenSigs((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const s of prev) {
        if (currentSigs.has(s)) next.add(s);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [displayList]);

  const hideRow = useCallback((ci: CheckIn) => {
    const sig = listupSignature(ci);
    setHiddenSigs((prev) => {
      if (prev.has(sig)) return prev;
      const next = new Set(prev);
      next.add(sig);
      return next;
    });
  }, []);

  const unhideAll = useCallback(() => setHiddenSigs(new Set()), []);

  // AC-1) 렌더 전용 가시 목록 — 숨김 시그니처 제외. 콜/선택/집계는 displayList(풀)로 계속 동작.
  const visibleList = useMemo(
    () => displayList.filter((ci) => !hiddenSigs.has(listupSignature(ci))),
    [displayList, hiddenSigs],
  );
  // 현재 명단에서 실제로 숨겨진 행 수(= 사용자에게 보여줄 '숨김 N · 표시' 카운트).
  const hiddenInViewCount = displayList.length - visibleList.length;

  // T-20260614-foot-CALLLIST-DOCCALL-3FIX (#2·#3): 전체콜/지정콜(호출 하이라이트) 기능 폐기.
  //   현장 김주연 총괄 — 행 우측 전화기(지정콜)·상단 전체콜 버튼 모두 제거. 두 진입점이 사라져
  //   allCall/selectedId 상태·highlighted·"호출 중" 표시·"해제" 버튼이 전부 dead code가 되어 함께 정리.
  //   숨기기(EyeOff)·접기/펼치기(chevron)·행숨김·메모·이름→차트·위치배지는 불변.

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

  // T-20260611-foot-CALLLIST-ROOM-LABEL (FIX phase2) — 빈 명단 완전소멸(return null) 금지.
  //   기존엔 콜 대상(purple/yellow/healer_waiting/pink)이 한 명도 없으면 위젯이 DOM에서 사라져
  //     (a) 원장님이 "진료콜 명단" 자체를 화면에서 못 찾고,
  //     (b) 기본 로그인(데이터 없는) 환경의 브라우저 QA에서 안정 selector([data-testid=doctor-call-list])가 깨졌다.
  //   → 빈 상태에서도 최소 헤더 탭을 항상 렌더해 위젯의 존재/위치를 보장한다(우하단, 버튼 비가림).
  //   data-empty="true": 회귀 가드 마커 — 행(rows) 존재를 전제로 단언하는 형제 스펙들은 이 마커로
  //     '데이터 없음'을 식별해 기존처럼 스킵한다(빈 탭을 콜 데이터로 오인 금지).
  //   위치(pos)·헤더 testid는 일반 패널과 동일 규칙으로 보존(드래그 저장 좌표가 있으면 그 자리에 최소 탭).
  //   T-20260611-foot-CALLLIST-ROOM-LABEL (FIX phase2-b) — createPortal(document.body):
  //     위젯은 position:fixed지만 AdminLayout의 page-content-area(overflow-hidden) + 칸반 transform(zoom scale)
  //     조상 cage 안에 마운트되면 fixed가 조상 기준으로 트랩·클리핑돼 뷰포트에서 사라진다(prod 미표시 RC).
  //     QuickRxBar(같은 원장 플로팅 바)가 이미 채택한 portal 패턴과 통일 — body 직속 마운트로 트랩 회피.
  if (displayList.length === 0) {
    return createPortal(
      <div
        ref={panelRef}
        data-testid="doctor-call-list"
        data-empty="true"
        data-hidden="false"
        data-position-mode={pos ? 'dragged' : 'fixed'}
        className={cn(
          'fixed z-40 rounded-xl border border-gray-300 bg-white/95 shadow-2xl backdrop-blur-sm',
          pos ? '' : 'bottom-4 right-4',
        )}
        style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      >
        <div className="flex items-center gap-1.5 px-3 py-2 min-h-[44px]">
          <Stethoscope className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-500">원장님 진료콜 명단</span>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-px font-medium">
            0명
          </span>
          <span className="text-xs text-gray-400">대기 없음</span>
        </div>
      </div>,
      document.body,
    );
  }

  // AC-1·AC-2) 숨김 상태: 전체 패널 대신 최소 탭만 렌더(완전소멸 금지 — 재접근 가능).
  //   위치(pos/anchor)는 그대로 적용 → 드래그해둔 자리에 최소 탭이 남음(AC-7 위치 보존).
  //   AC-4 빨간 배지(unseen)는 최소 탭 우상단. 클릭 시 펼침(setHidden(false)) → 위 효과가 배지 리셋.
  if (hidden) {
    return createPortal(
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
      </div>,
      document.body,
    );
  }

  return createPortal(
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
          {/* ROW-HIDE-AUTOSHOW AC-1) 숨긴 행이 있으면 '숨김 N · 표시'로 한 번에 복원(escape hatch — 행 유실 방지).
              드래그 핸들(헤더) 오발동 방지 위해 onPointerDown stopPropagation. */}
          {hiddenInViewCount > 0 && (
            <button
              data-testid="doctor-call-row-unhide-all"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={unhideAll}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-full px-2 py-px min-h-[28px] border border-gray-200 hover:bg-gray-200"
              title="숨긴 행 모두 다시 표시"
            >
              <EyeOff className="h-3 w-3" />
              숨김 {hiddenInViewCount} · 표시
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* T-20260614-foot-CALLLIST-DOCCALL-3FIX #3: 상단 '전체콜' 버튼 + (이제 무용한) '해제' 버튼 제거.
              숨기기/펼침 토글·위치초기화는 유지. */}
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
        {/* ROW-HIDE-AUTOSHOW AC-1) visibleList(숨김 필터 적용) 렌더. displayList(콜/집계/정렬)는 불변.
            전부 숨겨 비면 안내 + 헤더의 '숨김 N · 표시'로 복원 가능(행 유실 방지). */}
        {visibleList.length === 0 ? (
          <div
            data-testid="doctor-call-all-hidden"
            className="text-xs text-gray-400 italic text-center py-2"
          >
            모든 행을 숨겼습니다 — 상단 ‘표시’로 복원
          </div>
        ) : (
          visibleList.map((ci) => {
            const inactive = ci.status_flag === 'pink'; // 진료완료 = 비활성
            return (
              <DoctorCallRow
                key={ci.id}
                checkIn={ci}
                inactive={inactive}
                visitCount={ci.customer_id ? visitCounts[ci.customer_id] : undefined}
                onHide={() => hideRow(ci)}
                onOpenChart={onOpenChart}
                onRefresh={onRefresh}
              />
            );
          })
        )}
      </div>
      )}
    </div>,
    document.body,
  );
}

interface DoctorCallRowProps {
  checkIn: CheckIn;
  visitCount?: number;
  /** 진료완료(핑크) = 비활성 — dimmed + "진료완료" 배지, 콜 대상 제외 */
  inactive?: boolean;
  /** T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW AC-1: 이 행 숨기기(표시 필터에서 제외) */
  onHide?: () => void;
  /** T-20260601-foot-DASH-HSCROLL-CHART-LOC #2: 고객 이름 클릭 → 진료차트 */
  onOpenChart?: (ci: CheckIn) => void;
  onRefresh?: () => void;
}

function DoctorCallRow({ checkIn, visitCount, inactive = false, onHide, onOpenChart, onRefresh }: DoctorCallRowProps) {
  const isReturning = checkIn.visit_type === 'returning';
  const isExperience = checkIn.visit_type === 'experience';
  // T-20260609-foot-CALLLIST-HEALER-POSITION item1 + REOPEN FIX-SPEC: 힐러 구분 배지.
  //   힐러 신호 두 갈래 모두 [힐러] 배지: status_flag='yellow'(HL) OR status='healer_waiting'(힐러대기 단계).
  const isHealer = checkIn.status_flag === 'yellow' || checkIn.status === 'healer_waiting';
  // T-20260609-foot-CALLLIST-HEALER-POSITION item2·3 + T-20260614-foot-CALLLIST-DOCCALL-3FIX #1: 현재 위치(단계 인식).
  //   getCurrentLocationLabel은 입실 단계(상담/원장실/치료실/레이저)에서 '단계 · 방번호'(예: '치료실 · C1')로
  //   방번호를 이미 포함한다. 별도 standalone 방 배지(ROOM-LABEL)는 같은 'C1'을 한 번 더 띄워 중복 →
  //   현장 김주연 총괄 지적. 위치 배지(치료실명+방번호) 단일로 통일하고 standalone 방 배지는 제거.
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
      data-inactive={String(inactive)}
      className={cn(
        // VERTICAL-LAYOUT req2: 세로 나열 → 카드는 패널 폭 가득(w-full). (구 가로배치 shrink-0 w-56 폐기)
        'w-full rounded-lg border p-2 transition-all',
        // CALLLIST-DONE-INACTIVE) 진료완료 = 비활성 (흐림 + 회색조), 콜 대상 활성과 시각 구분
        inactive
          ? 'border-gray-200 bg-gray-50 opacity-60'
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
          {/* T-20260614-foot-CALLLIST-DOCCALL-3FIX #1: standalone 방 배지(doctor-call-room) 제거.
              방번호는 위 위치 배지(doctor-call-location)가 '치료실 · C1'로 이미 포함 → 중복 'C1' 박멸. */}
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
          {/* T-20260614-foot-CALLLIST-DOCCALL-3FIX #2: 행 우측 전화기(지정콜) 버튼 제거 — 핸들러 dead code 동반 정리. */}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {inactive && (
            <span
              className="flex items-center gap-0.5 text-[10px] font-bold text-gray-500 bg-gray-200 rounded px-1 py-px whitespace-nowrap"
              data-testid="doctor-call-done-badge"
            >
              <Check className="h-3 w-3" />
              진료완료
            </span>
          )}
          {/* T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW AC-1) 이 행 숨기기 — 표시 필터에서 제외.
              신규 listup 시그니처로 재등장하면 자동 재노출(부모 hiddenSigs/listupSignature가 보장).
              이름클릭→차트와 클릭영역 분리된 별도 버튼. */}
          {onHide && (
            <button
              onClick={onHide}
              data-testid="doctor-call-row-hide"
              className="inline-flex items-center justify-center rounded min-w-[28px] min-h-[28px] border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
              title="이 행 숨기기 — 신규로 다시 리스트업되면 자동으로 다시 표시"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          )}
        </div>
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

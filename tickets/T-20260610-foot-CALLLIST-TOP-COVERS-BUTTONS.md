---
id: T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS
domain: foot
priority: P0
status: deploy-ready
title: 원장님 진료콜 명단 — 상단 버튼 가림 해소(앵커 복귀) + 드래그 자유이동
created: 2026-06-10
assignee: dev-foot
reporter: 김주연 총괄
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS.spec.ts
spec_file: tests/e2e/T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS.spec.ts
commit_sha: 4ae026d
supersedes: [T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT]
absorbs: [드래그 자유이동(별도 DRAGGABLE 티켓 없이 본 티켓 내 Phase 2)]
---

# T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS — 진료콜 명단 버튼 가림 해소 + 드래그 자유이동

## 배경 / 현장 요청 (김주연 총괄, C0ATE5P6JTH, "긴급으로 빨리")
대시보드 '원장님 진료콜 명단' 위젯(`src/components/DoctorCallListBar.tsx`)이 상위(상단) 노출로
바뀌어 **대시보드 상단 동작버튼을 전부 가림** → 운영 즉시 지장. P1 → **P0 격상**.
현장 요청: "위치 고정 말고 개인마다 자유롭게 이동 형태로."

## RC (planner+dev 실측, 추정 아님)
- `DoctorCallListBar.tsx` 외곽 패널 앵커가 직전 NAME-VERTICAL-LAYOUT에서 세로 앵커를
  `bottom-4` → **`top-4`(우상단)**로 변경되며 상단 버튼을 덮음.
- height/overflow 문제 아님 — 행 컨테이너는 이미 `max-h-[calc(100vh-6rem)]` + `overflow-y-auto` 보유.
- 임시 z-index 봉합 금지 — 앵커가 본질.

## 처방 = 2-Phase
### Phase 1 (P0, 즉시 단독 핫픽스 배포) — AC-1~4
- 세로 앵커 `top-4` → **`bottom-4`(우하단)** 복귀 → 상단 버튼 비가림(AC-1).
- 세로 나열(flex-col) + 성함 전체표시(whitespace-normal/break-words, truncate 부재) 유지(AC-2).
- 행 컨테이너 `max-h-[calc(100vh-6rem)] overflow-y-auto` 유지 → 인원 많아도 외부 버튼 영역 불침범(AC-1).
- z-40 유지(임시봉합 z-50+ 금지). 콜/차트/힐러·위치·재진 배지 무회귀(AC-4).

### Phase 2 (Phase1 배포 후) — AC-5~7
- 헤더(드래그 핸들)를 잡아 화면 어디든 이동(AC-5). 헤더 내 버튼 위에서는 드래그 미시작(오발동 방지).
- `localStorage('foot.doctorCallList.pos.v1')` 위치 저장 + boundary clamp + 리사이즈 재clamp(AC-6).
  기본 위치 = Phase 1 버튼비가림 좌하단(좌표 없을 때만 CSS 앵커).
- **네이티브 pointer events 강제(setPointerCapture/onPointer*) — 드래그 npm 라이브러리 도입 금지(AC-7).**
- 컨버전스 흡수: 위치 초기화 버튼(reset-pos) — 드래그/저장 좌표 있을 때만 노출, 기본 위치 복귀(화면밖 박힘 복구).

## AC
- AC-1: 위젯 앵커 `bottom-4 right-4`(top-4 회귀 금지) + 행 컨테이너 max-h/overflow-y 유지 → 상단 버튼 비가림.
- AC-2: 세로 스택(flex-col, overflow-x-auto 부재) + 성함 전체표시(truncate 부재, break-words).
- AC-3: z-40 유지(임시 z-index 봉합 아님).
- AC-4: 콜(전체/지정)·이름클릭→차트·힐러/위치/재진 배지·pink 비활성·메모 무회귀.
- AC-5: 헤더 드래그 핸들(cursor-move + touch-none) — 화면 자유 이동.
- AC-6: 드래그 위치 localStorage 저장 + boundary clamp + reset-pos 초기화 + 리사이즈 재clamp.
- AC-7: 네이티브 pointer events만 사용 — 새 드래그 npm 라이브러리 도입 금지.

## 구현 (DoctorCallListBar.tsx, DB 무변경)
- a5dc2d1 Phase 1: `top-4` → `bottom-4` 앵커 복귀.
- 7454e3e Phase 2: 헤더 onPointerDown/Move/Up + setPointerCapture + clampPos + localStorage + data-position-mode.
- 4ae026d Phase 2(흡수): 위치 초기화 버튼(doctor-call-reset-pos).

## 흡수/대체 처리
- **supersedes** `T-20260609-foot-CALLLIST-NAME-VERTICAL-LAYOUT`: 동 위젯의 top-4 앵커 결정이 본 티켓
  Phase 1으로 정정·대체됨(세로나열·성함 전체표시 AC는 본 티켓이 승계 보존). → NAME-VERTICAL 티켓 superseded.
- 드래그 자유이동은 **별도 DRAGGABLE 티켓 없이 본 티켓 Phase 2로 흡수** — 같은 파일 동시 2-티켓 금지 준수.

## 시나리오 (E2E) — tests/e2e/T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS.spec.ts
- AC-1 앵커 bottom-4 + max-h/overflow-y(버튼 비가림) / AC-2 세로나열·성함 전체 / AC-4 무회귀(testid)
- AC-5/7 헤더 드래그 핸들(cursor-move·touch-none) / AC-5/6 드래그→dragged 모드·인라인 left/top
- AC-6 localStorage 저장 / AC-6 위치 초기화(fixed 앵커 복귀 + localStorage 제거)

## 배포 전파 (⚠️ 06-09 Vercel auto-deploy stall 이력)
- Phase별 배포 후 라이브 Dashboard 청크 번들 해시 교체 + 마커(pos.v1·reset-pos·setPointerCapture) 포함 확인 후 현장 회신.

## 결과
- build OK (vite ✓). E2E spec 8 케이스(데이터/인증 없으면 graceful skip).

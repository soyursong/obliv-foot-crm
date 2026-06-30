---
id: T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 017679cf
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "풋 대시보드 상단 카운트박스(전체/신규/재진 3개)의 박스 크기+폰트 크기를 우측 치료실 룸카드(C1~C10=RoomSlot)와 동일 사이즈로 정렬(김주연 총괄, C0ATE5P6JTH). 구현=순수 presentation(Tailwind 클래스만)·SSOT 재사용: 룸카드 박스/폰트를 모듈 상수로 추출 — ROOM_CARD_BOX_CLASS='rounded-lg border bg-white/60 p-1.5 min-h-[70px]', ROOM_CARD_LABEL_FONT_CLASS='text-xs font-semibold'. RoomSlot 본체 + 카운트박스(TabsTrigger ×3)가 같은 상수 재사용 → 하드코딩 중복 0(AC-1), 룸카드 자체 레이아웃 불변(AC-4·동시 참조). TabsList: bg-transparent p-0 + items-stretch gap-1.5(룸카드 grid 갭 동일), TabsTrigger ×3 동일 적용(AC-3)·twMerge로 trigger 기본값(px-3 py-1.5 text-sm font-medium rounded-md) 덮어씀. 카운트 값·쿼리·집계 미접촉(AC-4), DB 무변경. 직전 BTN-match(STATBAR) spec은 본 티켓이 대체 → 제거. build OK(5.15s). spec 7/7 PASS(S1 결정론4: SSOT 상수 정의·RoomSlot/카운트박스 양쪽 재사용·카운트 배선 불변 / S2 live2: 카운트박스 높이 룸카드와 ±4px 실측·폰트 동일px·3박스 균등). 실브라우저 렌더+스크린샷 비교(evidence 3장: full/countbox/roomcard)로 카운트박스↔룸카드 동일 사이즈 확정."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD.spec.ts
medical_confirm_gate: n/a (접수/칸반 대시보드 헤더 화면 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장 — 김주연 총괄, C0ATE5P6JTH)
대시보드 상단 카운트박스(전체/신규/재진 3개 — 빨간박스)의 박스 크기 + 폰트 크기를
우측 치료실 룸카드(C1~C10 — 우측 박스)와 동일 사이즈로 정렬.

## 구현 (commit 017679cf, src/pages/Dashboard.tsx)
룸카드(우측 치료실 C1~C10 = RoomSlot)의 박스/폰트를 SSOT 상수로 추출 → 카운트박스가 재사용.

- **SSOT 상수**(모듈 레벨, RoomSlot 직전):
  - `ROOM_CARD_BOX_CLASS = 'rounded-lg border bg-white/60 p-1.5 min-h-[70px]'` — 룸카드 박스 크기
  - `ROOM_CARD_LABEL_FONT_CLASS = 'text-xs font-semibold'` — 룸카드 라벨(C1~C10) 폰트
- **RoomSlot(룸카드 본체)**: 기존 하드코딩 박스/폰트 문자열 → 위 상수 참조(레이아웃 불변, AC-4).
  한 곳을 바꾸면 룸카드·카운트박스가 함께 움직임 = 중복 0(AC-1).
- **카운트박스(TabsTrigger ×3, 전체/신규/재진 — AC-3 동일 적용)**: `cn(ROOM_CARD_BOX_CLASS, ROOM_CARD_LABEL_FONT_CLASS, 'whitespace-nowrap')`.
  twMerge로 trigger 기본값(`px-3 py-1.5 text-sm font-medium rounded-md`) 덮어씀. 선택 하이라이트(data-[selected]) 유지.
- **TabsList**: `h-auto items-stretch gap-1.5 bg-transparent p-0` — 트레이 시각 제거 + 3박스 균등 높이 + 룸카드 grid 갭(1.5) 동일.
- 카운트 값·쿼리·집계(statusNewCount/statusReturningCount) 미접촉(AC-4). DB 무변경.

## 검증
- build OK(5.15s).
- E2E spec 7/7 PASS (`tests/e2e/T-20260630-foot-DASH-COUNTBOX-SIZE-MATCH-ROOMCARD.spec.ts`):
  - S1(결정론 4): SSOT 상수 정의 / RoomSlot 재사용(룸카드 불변) / 카운트박스 ×3 SSOT 재사용(AC-3) / 카운트 배선 불변(AC-4).
  - S2(live 2): 카운트박스 높이 룸카드와 ±4px·폰트 동일px(SSOT 동일) / 3박스 높이 균등.
- 실브라우저 렌더 + 스크린샷 비교(evidence 3장): countbox(전체/신규/재진)와 roomcard(C1) 박스·높이·폰트 동일 확인.

## 게이트
스키마 0 · DA 불요 · 대표(의료) 컨펌 게이트 비대상(접수/칸반 대시보드 헤더). supervisor QA + 현장 confirm 대기.

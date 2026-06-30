---
id: T-20260630-foot-DASH-STATBAR-SIZE-MATCH-BTN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: e07f7de4 (충돌수렴 재확정 — 룸카드안 017679cf revert로 버튼안 복원, 내용=b9306654 byte-identical)
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "풋 대시보드 상단 통계바(전체/신규/재진 카운트 박스)의 높이+폰트를 같은 행 우측 '슬롯편집'/'배치 편집' 버튼 사이즈에 맞춰 통일 + 세로중앙 정렬(김주연 총괄, C0ATE5P6JTH). 기준 버튼(px-2 py-1 text-xs font-medium border ≈26px)은 무수정. 구현=순수 presentation(Tailwind 클래스만): TabsList h-11(44px)→h-[26px]+p-0.5(트레이 박스 축소), TabsTrigger ×3 min-h-[44px] 제거→h-full min-h-0 py-0(컨테이너 높이로 fill)·px-2.5→px-2(버튼 동일 가로패딩)·font-medium 명시. 폰트는 기존에도 text-xs였고 font-medium 명시로 버튼과 완전 통일. 행(flex items-center)이라 세로중앙 정렬 자동. 카운트 값·쿼리·RPC·집계 로직 미접촉, DB 무변경. 인접 헤더 티켓(LIVESLOT/SILVER-PULSE) 스타일링 미접촉(크기/정렬 축만). build OK(4.93s). spec 8/8 PASS(S1 결정론5: 사이즈 클래스 통일·카운트 배선 불변·기준 버튼 사이즈 불변 / S2 live3: 통계바 박스 높이 ≈ 슬롯편집 버튼 높이 ±4px 실측·모바일/태블릿 1줄 유지·pageerror 0)."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-DASH-STATBAR-SIZE-MATCH-BTN.spec.ts
medical_confirm_gate: n/a (접수/칸반 대시보드 헤더 화면 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장 — 김주연 총괄, C0ATE5P6JTH)
대시보드 상단 통계바(전체/신규/재진 카운트 박스 — 빨간박스) 높이+폰트를 같은 행 우측
'슬롯편집'·'배치 편집' 버튼 사이즈에 맞춰 통일.

## 구현 (HEAD b9306654c9, src/pages/Dashboard.tsx)
기준 버튼(무수정): `px-2 py-1 rounded-md text-xs font-medium border` → 렌더 높이 ≈ 26px.

- **TabsList(통계 트레이)**: `h-11`(44px) → `h-[26px] p-0.5`. 버튼 높이에 맞춰 트레이 박스 축소.
- **TabsTrigger ×3(전체/신규/재진)**: `text-xs px-2.5 min-h-[44px] whitespace-nowrap`
  → `text-xs font-medium px-2 py-0 h-full min-h-0 whitespace-nowrap`.
  - `min-h-[44px]` 제거 + `h-full min-h-0`로 컨테이너(26px) 높이를 fill.
  - `px-2.5`→`px-2`로 버튼과 동일 가로 패딩.
  - `font-medium` 명시(폰트 통일) — 기존에도 text-xs였으므로 폰트 크기는 이미 일치.
- **세로중앙 정렬**: 헤더 행이 `flex items-center gap-3`라 자동 보장(추가 클래스 불필요).
- **presentation-only**: 카운트 표현식(`전체 {statusNewCount + statusReturningCount}건` 등)·집계
  변수(`statusNewCount`/`statusReturningCount`)·쿼리·RPC 전부 미접촉. DB 무변경.
- **인접 티켓 격리**: LIVESLOT-GLASS-SILVER-MOCKUP / SILVER-PULSE-CLIPFIX의 스타일링은 미접촉
  (본 티켓은 크기/정렬 축만). 충돌 없음.

## 검증
- `npm run build` OK (4.93s).
- E2E `tests/e2e/T-20260630-foot-DASH-STATBAR-SIZE-MATCH-BTN.spec.ts` — **8/8 PASS**.
  - **S1 source-integrity(결정론) 5**: TabsList h-[26px] p-0.5 / TabsTrigger ×3 사이즈·폰트 통일(min-h-[44px] 제거·h-full·py-0·px-2·font-medium) / 카운트 배선 불변 / 기준 버튼(슬롯편집·배치편집) 사이즈 불변.
  - **S2 live(실브라우저) 3**: 통계바 박스 높이 ≈ 슬롯편집 버튼 높이 **±4px 실측 일치** + 카운트 표기 정상(NaN 0) / 모바일(390)·태블릿(768) 폭 라벨 1줄 유지(행 파손 0) / pageerror 0.
- 가드 충족: 가독성(잘림·겹침 0) / 반응형(헤더 행 파손 0) / 카운트·버튼 동작 회귀 0.

## 비고
- 실 갤탭 현장 렌더 최종 확인은 supervisor field-soak에서.
- (2026-07-01 충돌수렴) 경쟁안 ROOMCARD(017679cf)가 본 BTN안(b9306654)을 덮어쓴 상태였음 →
  김주연 총괄 확정대로 017679cf 전량 revert(e07f7de4)하여 버튼안 복원. 결과 Dashboard.tsx는
  b9306654와 byte-identical. 룸카드 상수·RoomSlot 리팩터·ROOMCARD spec·evidence 3장 제거.
  build OK / spec 7/7 PASS. 룸카드 기준은 더 이상 코드에 없음.

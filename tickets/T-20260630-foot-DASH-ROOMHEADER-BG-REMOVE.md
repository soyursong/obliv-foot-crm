---
id: T-20260630-foot-DASH-ROOMHEADER-BG-REMOVE
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 84e2817c0a (BG-REMOVE) + a4176597f6 (BORDER-RESTORE 회귀수정)
deployed_at: n/a (코드 이미 main 반영 — supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
summary: "풋 대시보드 좌측 룸별 섹션 헤더 4개(상담실·진료·치료실·레이저실) 컬러 배경 박스 제거. bg-blue-100/bg-violet-100/bg-amber-100/bg-rose-100 → bg-muted/30 text-foreground(무색 중립 톤) 통일. 텍스트·'(N실)'·정렬·폰트·레이아웃 유지(색 토큰만 변경, 레이아웃 시프트 0). 무색 헤더(진료대기/치료대기/힐러대기/레이저대기) 현행 유지. carve-out(AC3) 보존: 섹션 타이틀바 배경 4곳에 한정 — 칸반 상태색·visit-type·활성/비활성 슬롯·미수/완료 배지·대기 하이라이트(text-violet-700/text-blue-700/text-purple-700/bg-teal-500/bg-amber-50) 미접촉. ⚠ dev 확인의무 충족: 제거된 4색(blue/violet/amber/rose -100 틴트)은 룸 영역별 라벨 장식 — 상태 인코딩 아님(슬롯 활성/비활성은 슬롯 자체 dashed border·inactiveRooms, visit-type/상태색은 카드에 별도 존재). 레이저실 rose 틴트는 경고/활성 의미 아님 → 제거 안전, FOLLOWUP flag 불요. ★코드는 이미 작업 완료·main 반영(84e2817c@10:46, BORDER-RESTORE a4176597@11:26) — 본 티켓은 누락된 전용 E2E spec 추가 + 티켓 클로저. 현장 스크린샷(10:37)은 BG-REMOVE 커밋(10:46) 9분 전 캡처라 구 컬러가 보였음. FE-only·DB 무변경."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-DASH-ROOMHEADER-BG-REMOVE.spec.ts
medical_confirm_gate: n/a (대시보드 칸반 섹션 헤더 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장)
풋 대시보드 좌측 룸별 섹션 헤더 4개(상담실·진료·치료실·레이저실)의 배경색·테두리 컬러 박스(빨강/주황/분홍) 제거 → 무색 기본 배경.
- 텍스트·"(N실)"·레이아웃·폰트 유지(색만 제거, 레이아웃 시프트 금지)
- 무색 헤더(진료대기/치료대기/힐러대기/레이저대기 등)는 현행 유지
- carve-out(AC3): 섹션 헤더 外 상태/단계 의미색은 미접촉
- 스크린샷: ~/file_inbox/20260630/20260630_103737.png (F0BDV524Y1Z)

## dev 확인의무 결과 (AC: 의미색 인코딩 여부)
제거된 4개 헤더 틴트 = `상담실 bg-blue-100` / `진료 bg-violet-100` / `치료실 bg-amber-100` / `레이저실 bg-rose-100`.
모두 **룸 영역별 라벨 장식**으로, 상태를 인코딩하지 않음:
- 슬롯 활성/비활성 상태 → 슬롯 자체의 dashed border·`inactiveRooms` Set로 별도 표현
- visit-type(초진/재진/힐러)·칸반 상태색 → 카드(DraggableCard)에 별도 존재
- 레이저실 rose 틴트는 경고/활성 의미가 아님 (단순 섹션 라벨)
→ 배경 제거는 순수 cosmetic. planner FOLLOWUP flag 불요.

## 구현 (이미 main 반영)
RoomSection color prop + 상담실 인라인 헤더의 컬러 배경 토큰을 무색으로 통일:
- 상담실: `bg-blue-100 text-blue-800` → `bg-muted/30 text-foreground` (인라인 헤더)
- 진료: `bg-violet-100 text-violet-800` → `bg-muted/30 text-foreground` (RoomSection color + 빈슬롯 fallback)
- 치료실: `bg-amber-100 text-amber-800` → `bg-muted/30 text-foreground`
- 레이저실: `bg-rose-100 text-rose-800` → `bg-muted/30 text-foreground`

**커밋 이력**:
- `84e2817c` (2026-06-30 10:46) — style: 대시보드 섹션 헤더 컬러 제거 (BG-REMOVE 본체)
- `a4176597` (2026-06-30 11:26) — T-20260630-foot-DASH-ROOMHEADER-BORDER-RESTORE: 배경 무색 유지 + 무색(뉴트럴 회색) border만 재추가(섹션 구분선 복원). 컬러 배경/컬러 테두리 미복원(MONOCHROME).

현장 스크린샷(10:37)은 BG-REMOVE 커밋(10:46)보다 9분 앞서 캡처된 것으로, 당시 구 컬러가 남아 있던 화면.
본 티켓 처리에서는 **누락돼 있던 전용 E2E spec 신설 + 티켓 클로저**를 수행(코드 추가 변경 없음, 회귀 가드 고정).

## 검증
- `npm run build` OK
- E2E: `tests/e2e/T-20260630-foot-DASH-ROOMHEADER-BG-REMOVE.spec.ts` 6/6 PASS
  (소스 불변식 4: 무색 color prop·상담실 무색+N실 라벨·구 컬러토큰 제거·carve-out 의미색 잔존 / 실렌더 스모크 2: 4헤더 무채색 배경 — auth 주입 live 통과)
- 인접 회귀: BORDER-RESTORE spec 7건 기존 PASS 유지

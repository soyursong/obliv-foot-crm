---
id: T-20260601-foot-DASH-POPUP-RIGHT-FIX
domain: foot
priority: P1
hotfix: true
status: deploy-ready
deploy-ready: true
created: 2026-06-01
updated: 2026-06-01 (정밀 스펙 = HEAD 기구현 검증 — db62b1a)
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260601-foot-DASH-HSCROLL-CHART-LOC.spec.ts (AC-1)
commit: db62b1a (already in origin/main; no new code change required)
repo-path: ~/Documents/GitHub/obliv-foot-crm (github.com/soyursong/obliv-foot-crm, branch main)
---

# T-20260601-foot-DASH-POPUP-RIGHT-FIX
## '원장님 진료콜 명단' 팝업 — 우측 슬롯 칸 내부 하단 + 가로스크롤 종속

**요청자**: 김주연 총괄 (planner 경유, responder juoo / thread 1780295627.865329)

### 정밀 스펙 (TICKET-UPDATE P1·hotfix)
- 단순 좌→우 fixed 이동이 **아님**.
- 팝업을 **우측 슬롯 칸 내부 하단**에 배치 → `position:fixed` **제거**.
- **가로스크롤 시 슬롯 칸과 함께 이동** → scrollable container 내부 relative/absolute 종속(뷰포트 고정 아님).
- 즉 72314ef의 `fixed bottom-4 left-4`를 fixed 제거 + 우측 슬롯 칸 내부 종속 배치로 변경.
- 세로스크롤 거동(sticky 항상 vs 칸 맨 하단)은 **현장 확인 중 → 보류**. 가로 동선 먼저.

### 처리 결과 — 기구현(db62b1a) 검증으로 충족
이 정밀 스펙은 동일 현장 피드백(DASH-HSCROLL-CHART-LOC #1 REOPEN)으로 이미 구현되어
origin/main에 머지·배포됨. TICKET-UPDATE 발행(15:46) 직후 커밋(db62b1a, 15:49).

- **코드** `src/components/DoctorCallListBar.tsx` L136-141:
  - `fixed bottom-4 left-4 z-40` → `absolute bottom-4 right-4 z-30` (fixed 폐기, 우측 정렬).
  - `data-position-mode="scroll-bound"`, 폭 `100vw` → `min(30rem, 100%-2rem)` (컨테이너 기준).
- **부모** `src/pages/Dashboard.tsx` L5928 `kanban-scroll`:
  - `relative + overflow-auto` → 팝업 positioning 기준 & 가로스크롤 컨테이너. absolute 자식이
    슬롯 칸에 종속 → 가로스크롤 시 콘텐츠와 함께 이동.
- **세로 거동**: 코드 주석·spec 모두 "현장 확인 중 → 보류" 반영(추후 TICKET-UPDATE).

### E2E 검증 (정밀 스펙 그대로)
`tests/e2e/T-20260601-foot-DASH-HSCROLL-CHART-LOC.spec.ts` AC-1:
- `getComputedStyle(el).position === 'absolute'` (fixed 폐기 확인)
- `data-position-mode === 'scroll-bound'`
- 가로스크롤 delta 후 `before.x - after.x > delta - 12` → 콘텐츠와 함께 좌측 이동(종속 증거)

### 검증
- build: `npm run build` PASS (✓ built in 3.37s)
- 무파괴: 스키마·비즈로직 무변경 (db-change: false)
- #2(이름→차트)/#3(슬롯 배지)는 손대지 않음(정상 배포 유지)

→ **신규 코드 변경 불필요**. HEAD(origin/main)가 정밀 스펙을 이미 충족. supervisor QA 요청.

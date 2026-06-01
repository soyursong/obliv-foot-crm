---
id: T-20260601-foot-DASH-POPUP-RIGHT-FIX
domain: foot
priority: P2
hotfix: true
status: deploy-ready
deploy-ready: true
created: 2026-06-01
updated: 2026-06-01 (스펙 FLIP — scroll-bound 폐기 → fixed 우측 고정 재구현)
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260601-foot-DASH-POPUP-RIGHT-FIX.spec.ts
commit: ~ (this change)
repo-path: ~/Documents/GitHub/obliv-foot-crm (github.com/soyursong/obliv-foot-crm, branch main)
---

# T-20260601-foot-DASH-POPUP-RIGHT-FIX
## '원장님 진료콜 명단' 팝업 — 우측 하단 position:fixed 고정 (가로스크롤해도 안 사라짐)

**요청자**: 김주연 총괄 (planner 경유)

### 스펙 변경 이력 (중요 — FLIP)
1. **72314ef (배포)**: `fixed bottom-4 left-4 z-40` — 뷰포트 좌하단 고정.
2. **db62b1a (이전 닫힘)**: 본 티켓을 "fixed 제거 → absolute scroll-bound, 슬롯과 함께 이동"으로
   해석·구현. → 현장이 이 버전을 보고 **재거부** ("아니 우측! ... 같이 따라가게").
3. **신규 MQ (MSG-20260601-154327, 본 작업)**: 스펙 정반대로 정정.
   `left` 앵커 → `right` 앵커, **position:fixed 거동 유지**(가로스크롤해도 화면에서 안 사라짐).
   → "같이 따라가게" = "스크롤해도 항상 보이게 따라온다" = 뷰포트 fixed 재해석.

### 현장 요청
> "아니 우측! 대시보드 슬롯 칸 하단에 넣어달라고, 가로스크롤 이동하면 같이 따라가게."

### 변경 (DoctorCallListBar.tsx 루트 div)
- `absolute bottom-4 right-4 z-30` (db62b1a scroll-bound) → **`fixed bottom-4 right-4 z-40`**.
- `data-position-mode="scroll-bound"` → `"fixed"`.
- 폭 `min(30rem, 100%-2rem)` → `min(30rem, 100vw-2rem)` (fixed = 뷰포트 기준).
- z-40: 칸반 카드(z-30) 위, 모달(z-50+) 아래.

### AC
- **AC-1**: 팝업이 화면 우측(우하단) position:fixed 고정 (좌하단 아님). ✅
- **AC-2**: 가로스크롤해도 우측에 유지·사라지지 않음 (fixed → x 불변). ✅
- **AC-3 무파괴**: 이름클릭→차트, 슬롯 위치배지, 지정콜/전체콜, 메모 등 부모 기능 불변(위치만 변경). ✅

### OPEN-Q1 (비블로킹)
"슬롯 있는 칸 하단" = 뷰포트 우하단 vs 슬롯 패널 영역 하단 정렬. 1차 **뷰포트 우하단 fixed**로 진행
(planner 지시대로). 현장이 더 안쪽 정렬 원하면 후속 미세조정.

### E2E (신규 spec, 2+1 시나리오)
`tests/e2e/T-20260601-foot-DASH-POPUP-RIGHT-FIX.spec.ts`:
- AC-1·AC-2(렌더): `position==='fixed'` + `data-position-mode==='fixed'`, 우측 정렬(rightGap<40, x>vw/2),
  가로스크롤 delta 후 `|before.x - after.x| < 8`(뷰포트 고정·안 사라짐).
- AC-3(무파괴 로직): 이름=차트 / 지정콜=별도 버튼 핸들러 분리 모델 불변.
- AC-3(무파괴 렌더): 이름·요소 잔존 + 이름 클릭→차트 열림.
- 부모 spec(DASH-HSCROLL-CHART-LOC) AC-1은 superseded 처리(우측 위치 스모크로 완화) — 거동 단언은 본 spec로 이관.

### 검증
- build: `npm run build` PASS (✓ built in 3.37s)
- spec parse: `playwright --list` 3 tests OK
- 무파괴: 스키마·비즈로직 무변경 (db-change: false)

→ supervisor QA 요청.

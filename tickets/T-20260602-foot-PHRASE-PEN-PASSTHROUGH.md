---
id: T-20260602-foot-PHRASE-PEN-PASSTHROUGH
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 4375652
deployed_at: 2026-06-02T19:05:00+09:00
bundle_hash: pending-vercel
hotfix: false
implemented-by: dev-foot
reviewed-by: ~
build-ok: true
db-change: false
spec-file: tests/e2e/T-20260602-foot-PHRASE-PEN-PASSTHROUGH.spec.ts
parent: T-20260525-foot-PENCHART-FORM-BLACKSCR (검정화면 RESOLVED, 증상③ 분리)
repo-path: ~/Documents/GitHub/obliv-foot-crm (github.com/soyursong/obliv-foot-crm, branch main)
---

# T-20260602-foot-PHRASE-PEN-PASSTHROUGH
## 펜차트 상용구(placedItem) 위에서 펜/형광펜 기입 불가 — FE-only

**요청자**: planner (NEW-TASK MSG-20260602-184337-k1m1)
**영상**: F0B7KQK8F45 (IMG_8155.MOV)

### 근본원인 (코드증거)
`src/components/PenChartTab.tsx` `PlacedItemOverlay` wrapper div가
`position:absolute / zIndex:20 / touchAction:none` + `onPointerDown/Move/Up`(드래그·선택)으로
상용구 bbox 위 pointerdown을 먼저 소비 → 아래 드로잉 canvas에 미도달.
내부 텍스트 div만 `pointerEvents:none`, wrapper는 interactive였음.
현장 우회동선("바깥부터 써야 위에 기입됨")과 정확히 일치(canvas pointer-capture).

### 수정
`ActiveTool`에 `'select'`(선택/이동) 추가 + `PlacedItemOverlay`에 `interactive` prop 도입.
- 드로잉 도구(pen/eraser/white/highlight) 활성 → `interactive=false` → wrapper `pointerEvents:'none'`
  → pointerdown이 canvas로 통과 → **상용구 위 직접 필기**.
- 선택/이동(select) 도구 활성 → `interactive=true` → wrapper `pointerEvents:'auto'`
  → 드래그·선택·삭제 정상.
- `onPointerDown` + native pointermove에 `select` early-return (캔버스 드로잉 방지).
- 툴바에 "선택/이동"(Move 아이콘, emerald) 버튼 추가. 재클릭 시 pen 복귀.
- 다중선택 액션바·×버튼·grip은 `interactive && isSelected`로 게이팅 (드로잉 모드에서 비표시).
- ⚠️ `pointerEvents:none` 영구화 아님 — 도구 게이팅으로 AC-2 회귀 방지.

### AC 검증
- **AC-1** 상용구 위 직접 펜 시작 정상 기입(passthrough): 실제 Chromium `elementFromPoint` hit-test — 드로잉 모드 → canvas 히트, select 모드 → overlay 히트. PASS
- **AC-2** 드래그·선택·삭제 회귀 방지: select 모드 onMove/onDelete/Set 토글 + select↔pen 토글 PASS
- **AC-3** 5개(+선택/이동) 도구 전환 무영향: ActiveTool 7종 유효 + DEFAULT_THICKNESS 기존값 무변경 + switchTool 굵기 적용 PASS
- **AC-4** export 상용구 텍스트 무손상: placedItem 래스터화 경로 비접촉, 멀티라인 텍스트 픽셀 보존 + 저장 파일명 패턴 무변경 PASS

### 결과
- E2E: `tests/e2e/T-20260602-foot-PHRASE-PEN-PASSTHROUGH.spec.ts` 16 case 全 PASS
- `npm run build` PASS (✓ 3.53s)
- DB 변경: 없음
- commit: **4375652** push (b3d2205..4375652 origin/main, pre-push 차트심볼 PASS)
- Vercel 자동 배포 트리거됨 (bundle_hash는 supervisor QA 시 운영 검증)

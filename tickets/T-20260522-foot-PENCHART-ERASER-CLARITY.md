---
id: T-20260522-foot-PENCHART-ERASER-CLARITY
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: fea5644
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260522-foot-PENCHART-ERASER-CLARITY.spec.ts
risk: GO
created_at: 2026-05-22
completed_at: 2026-05-22
priority: P0
deadline: 2026-05-22
---

# T-20260522-foot-PENCHART-ERASER-CLARITY (P0 FIX)

iPad/태블릿(dpr=2)에서 드로잉 좌표가 CSS 픽셀 아닌 물리 픽셀 기준으로 동작해
터치 위치와 드로잉 위치가 불일치(좌상단 1/4 집중)되던 버그 수정.

## 경위

1. `3c04482` — 1차 ERASER-CLARITY 구현 (2-layer canvas, deploy-ready → supervisor QA **NO_GO**)
   - 원인: `initDrawCanvas`에서 `ctx.scale(dpr, dpr)` 누락
2. `fea5644` — `initDrawCanvas` ctx.scale(dpr,dpr) 1줄 추가 수정
   - Ref FIX-REQUEST: MSG-20260522-112401-n03o (supervisor) / MSG-20260522-131823-9kfr (planner P0 escalation)
3. 현재 commit `fea5644`가 origin/main에 포함 → Vercel 자동 배포 완료

## 수정 내용

`src/components/PenChartTab.tsx` — `initDrawCanvas` 함수:
```ts
// canvas.style.height 설정 직후
ctx.scale(dpr, dpr); // T-20260522-foot-PENCHART-ERASER-CLARITY: dpr=2(iPad/Retina) 드로잉 좌표 오프셋 수정
```

## 관련 티켓 (동일 dpr 계열)

- `T-20260522-foot-PENCHART-PEN-OFFSET` (b9cd022, deploy-ready):
  `getPos()` 내 logicalW/H = canvas.width/dpr — 스케일 연산 독립. ERASER-CLARITY ctx.scale과 함께 완전 수정.
  두 티켓이 함께 적용되면 dpr=2 환경에서 펜·지우개 모두 정확한 위치에 동작.

## AC 검증

- [x] AC-1: iPad/태블릿(dpr=2) 터치 위치 ↔ 드로잉 위치 정확히 일치
- [x] AC-2: 데스크톱(dpr=1) 기존 동작 유지
- [x] AC-3: 지우개 동작 정상 (bgCanvas 배경 양식 보호)
- [x] AC-4 (원래 ERASER-CLARITY AC): 2-layer canvas — 지우개 clearRect → bgCanvas 노출 (드로잉 레이어만 삭제)
- [x] AC-5: 빌드 OK 3.30s + E2E spec 전건 pass (T-20260522-foot-PENCHART-ERASER-CLARITY.spec.ts)

## 빌드 정보

- build: `npm run build` → ✓ built in 3.30s (2026-05-22)
- commit: `fea5644` (origin/main 포함)
- DB 변경: 없음

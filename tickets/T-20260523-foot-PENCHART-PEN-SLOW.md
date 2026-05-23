---
id: T-20260523-foot-PENCHART-PEN-SLOW
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: ""
commit_sha: "0380287"
qa_result: ""
qa_grade: ""
deployed_at: ""
deploy_commit: ""
bundle_hash: ""
field_soak_until: ""
created: 2026-05-23 23:00
completed: 2026-05-23 23:30
deadline: 2026-05-27
assignee: dev-foot
reporter_slack_id: null
slack_channel: C0ATE5P6JTH
related_tickets:
  - T-20260523-foot-PENCHART-FORM-AUTOFILL
  - T-20260522-foot-PENCHART-TOOLS-V2
risk_verdict: GO
---

# T-20260523-foot-PENCHART-PEN-SLOW

펜차트 3양식(발건강 질문지 일반/어르신, 환불동의서) 펜 반응 느림 → 50ms 이하 최적화

## 배경

PUSH MSG-20260523-225253-2zj9 (planner, P2→P1, 김주연 총괄 직접 보고).
펜 입력 지연 50ms 이하 AC. 빈 캔버스 대비 차이 없어야.

## 근본원인

1. `setHasDrawing(true)` → `onPointerMove` 매 이벤트마다 호출 → React 재렌더 16ms+ 유발
2. `canvas.getContext('2d')` desynchronized 미적용 → compositor와 동기화 대기
3. `will-change` 미적용 → GPU 레이어 미승격

## 변경 내역

### PenChartTab.tsx
- `hasDrawingRef = useRef(false)` 추가
- `initDrawCanvas`: `canvas.getContext('2d', { desynchronized: true })` 적용
- `initCanvas`: `hasDrawingRef.current = false` 리셋 추가
- `handleUndo`: undo 스택 empty 시 `hasDrawingRef.current = false` 동기화
- `onPointerDown` (white/highlight/pen): `setHasDrawing(true)` → ref guard 적용
- `onPointerMove` (white/highlight/pen): `setHasDrawing(true)` → ref guard 적용 (3곳)
- 드로잉 canvas style: `willChange: 'transform'` 추가

## AC

- AC-1: 펜 입력 지연 50ms 이하 (React 재렌더 억제 + desynchronized + GPU 레이어)
- AC-2: `desynchronized: true` 컨텍스트 적용
- AC-3: `will-change: transform` canvas style 추가
- AC-4: `setHasDrawing` 재렌더 hot path에서 1회만 발화
- AC-5: 기존 도구(eraser/white/highlight/pen) 분기 호환 유지
- AC-6: 초기화 시 `hasDrawingRef=false` 리셋 (빈 캔버스 대비 차이 없음)
- AC-7: 빌드 OK

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
commit_sha: "e317ad5"
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

**1차 (Fix-1~4, 커밋 0380287):**
1. `setHasDrawing(true)` → `onPointerMove` 매 이벤트마다 호출 → React 재렌더 16ms+ 유발
2. `canvas.getContext('2d')` desynchronized 미적용 → compositor와 동기화 대기
3. `will-change` 미적용 → GPU 레이어 미승격
4. initBgCanvas img.onload에서 canvas.width 재설정 → 강제 레이아웃 재계산

**2차 (Fix-5~6, 커밋 e317ad5, PUSH MSG-20260524-111505-2nb0):**
5. `saveUndoState()` → `onPointerDown` 동기 `getImageData(full canvas)` → GPU readback blocking
   - 3페이지 refund_consent: 1588×6738×4 ≈ 42.8MB/획, 매 stroke 시작점 latency
6. `onPointerDown`에서 `getBoundingClientRect()` 중복 호출 (getPos + strokeRectRef 각 1회)

## 변경 내역

### Fix-1~4 (PenChartTab.tsx, 커밋 0380287)
- `hasDrawingRef = useRef(false)` 추가
- `initDrawCanvas`: `canvas.getContext('2d', { desynchronized: true })` 적용
- `initCanvas`: `hasDrawingRef.current = false` 리셋 추가
- `handleUndo`: undo 스택 empty 시 `hasDrawingRef.current = false` 동기화
- `onPointerDown/Move` (white/highlight/pen): `setHasDrawing(true)` → ref guard 적용
- 드로잉 canvas style: `willChange: 'transform'` 추가
- initBgCanvas Fix-1: img.onload 안 canvas.width 재설정 제거
- drawCtxRef(Fix-2) + strokeRectRef(Fix-3) + whiteStrokePath(Fix-4) 캐싱

### Fix-5~6 (PenChartTab.tsx, 커밋 e317ad5)
- `captureUndoAsync`: rAF에서 getImageData 실행 (onPointerUp 후 ~16ms, hot path 밖)
- `flushPendingUndo`: onPointerDown에서 pre-captured ImageData stack 적재 (getImageData 없음)
- rAF 미발화 시 sync 폴백 (연속 빠른 획 edge case)
- initCanvas: pending 초기화 + blank 상태 async 사전 캡처
- handleUndo 후 captureUndoAsync 추가 (복원 상태 다음 획 undo 준비)
- getPos: strokeRectRef 우선 사용 → getBoundingClientRect 중복 제거 (Fix-6)
- onPointerDown: strokeRectRef를 getPos 호출 전에 먼저 캐싱 (Fix-6)

## AC

- AC-1: 펜 입력 지연 50ms 이하 (React 재렌더 억제 + desynchronized + GPU 레이어)
- AC-2: `desynchronized: true` 컨텍스트 적용
- AC-3: `will-change: transform` canvas style 추가
- AC-4: `setHasDrawing` 재렌더 hot path에서 1회만 발화
- AC-5: 기존 도구(eraser/white/highlight/pen) 분기 호환 유지
- AC-6: 초기화 시 `hasDrawingRef=false` 리셋 (빈 캔버스 대비 차이 없음)
- AC-7: 빌드 OK
- AC-8: onPointerDown에서 getImageData 완전 제거 (captureUndoAsync rAF 패턴)
- AC-9: onPointerDown getBoundingClientRect 1회로 감소 (Fix-6)

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
commit_sha: "pending-Fix-8"
qa_result: ""
qa_grade: ""
deployed_at: ""
deploy_commit: ""
bundle_hash: ""
field_soak_until: ""
created: 2026-05-23 23:00
completed: 2026-05-26 00:00
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

**3차 (Fix-7, 커밋 ccba516, PUSH MSG-20260524-111505-2nb0 후속):**
7. `onPointerMove` coalesced events 루프 내 ctx 프로퍼티 반복 설정
   - 100 coalesced events = strokeStyle/lineWidth/lineCap/lineJoin/globalAlpha 500회/획 재설정
   - white 툴: ctx.save()/restore()를 루프 내 100이벤트×2=200회 호출
   - highlight 툴: globalAlpha reset 루프 내 100회 호출

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

### Fix-7 (PenChartTab.tsx, 커밋 ccba516)
- onPointerMove: activeTool별 ctx 프로퍼티(strokeStyle/lineWidth/lineCap/lineJoin/globalAlpha) 루프 전 1회 설정
- white 툴: ctx.save()/restore() 루프 내 제거 (globalCompositeOperation 기본값 source-over 이용)
- highlight 툴: globalAlpha = 0.20 루프 전 1회, globalAlpha = 1 루프 후 1회
- eraser 툴: eraserSz = penSize*4 루프 전 1회 사전 계산
- E2E spec: AC-10 4개 테스트 추가 (총 22 테스트)

### Fix-8 (PenChartTab.tsx, 2026-05-26, PUSH MSG-20260524-111505-2nb0 재기동)
**근본원인**: React 18 concurrent mode는 `pointermove`를 "continuous" 이벤트로 분류 →
MessageChannel(scheduler)을 통해 비동기 처리. 획당 4-16ms 추가 지연. Fix-1~7 이후에도
현장에서 느림 계속 보고됨 = 이 레이어가 남아있던 것.

**변경:**
- `activeToolRef`, `penColorRef`, `penSizeRef`, `highlightColorRef` mirror refs 추가
- `strokeScaleRef`: scaleX/scaleY를 onPointerDown에서 1회 계산 → native handler 재사용
- `handleNativePointerMove`: React synthetic → native PointerEvent 기반 useCallback(deps=[])
  - 모든 state를 *Ref.current 경유 접근 (deps 없는 stable 함수)
  - `(e as any).getCoalescedEvents?.() ?? [e]` (nativeEvent 래퍼 불필요)
- `initDrawCanvas` 말미에 `removeEventListener` + `addEventListener` 등록
  (initCanvas 재호출 시 중복 방지)
- onPointerDown에 `strokeScaleRef.current = {x, y}` 캐싱 추가
- 구 React synthetic `onPointerMove` 함수 삭제 + JSX prop 제거

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
- AC-10: onPointerMove coalesced 루프 내 ctx 프로퍼티 설정 루프 외부로 이동 (Fix-7)
  - pen: strokeStyle/lineWidth/lineCap/lineJoin/globalAlpha → 루프 전 1회
  - white: ctx.save()/restore() 루프 내 제거 (100이벤트×2=200회 → 0회)
  - highlight: globalAlpha reset → 루프 후 1회
  - eraser: penSize*4 계산(eraserSz) → 루프 전 1회
- AC-11: native addEventListener 전환으로 React 18 MessageChannel 지연 제거 (Fix-8)
  - `handleNativePointerMove` stable useCallback(deps=[]) — *Ref.current 경유 state 접근
  - `initDrawCanvas`에서 canvas에 직접 등록 (remove+add 패턴, 중복 방지)
  - `strokeScaleRef` 캐싱 → onPointerMove 내 scaleX/scaleY 재계산 제거

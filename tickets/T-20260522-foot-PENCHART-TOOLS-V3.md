---
id: T-20260522-foot-PENCHART-TOOLS-V3
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: false
rollback-sql: ""
created: 2026-05-22
updated: 2026-05-22
commit: c0735cc
---

# T-20260522-foot-PENCHART-TOOLS-V3 — 펜차트 도구 전면 개선 V3

## 배경

김주연 총괄 현장 실무 테스트 중 종합 피드백. P1 승인(GO_WARN 1/5).

## 구현 내용

### 공통
- **C-1**: 굵기 슬라이더 max 8→5 (AC-C1)
- **C-2**: 토스트 에러 시에만. 저장 성공/상용구 삽입/undo 없음 silent (AC-C2)

### 도구별 초기 굵기 (DEFAULT_THICKNESS map)
- 펜 1.5, 지우개 3, 화이트 3, 텍스트 2, 형광펜 2, 상용구 1.5
- `switchTool()` 헬퍼 — 도구 전환 시 자동 적용

### 1. 펜 (AC-1)
- 초기 굵기 1.5

### 2. 지우개 (AC-2, AC-3)
- 초기 굵기 3
- clearRect on draw canvas only → bg(상용구 템플릿) 보존 (기존 동작 유지+명시)

### 3. 화이트 — 신규 도구 (AC-4~6)
- 초기 굵기 3
- globalCompositeOperation = 'source-over', fillStyle = '#ffffff'
- 배경 포함 전 레이어 덮어쓰기. 지우개(clearRect)와 명확히 구분
- Paintbrush 아이콘

### 4. 텍스트 (AC-7~9)
- 초기 폰트 크기 2 (fontSize = penSize * 4 + 6)
- 저장 후 드래그 이동 + 삭제: PlacedItemOverlay DOM 오버레이로 구현
  - pointer drag로 x,y 업데이트
  - × 버튼으로 삭제
  - Shift+클릭 다중선택 (후술 상용구와 공유)

### 5. 형광펜 (AC-10~11)
- 초기 굵기 2
- globalAlpha 0.35→0.20 (onPointerDown + onPointerMove 양쪽 수정)

### 6. T상용구 (AC-12~16)
- 초기 굵기 1.5
- 중복 메뉴 제거: 정적 BOILERPLATE_ITEMS 버튼 제거, phrase_templates(DB) 단일 '상용구' 메뉴 통합
- showBoilerplatePanel state 제거
- 드래그 이동 + 삭제 + 다중선택: PlacedItemOverlay 공유

### PlacedItem 시스템 (공통)
- `PlacedItem` interface: id, type, x, y, text, fontSize, color
- `PlacedItemOverlay` 컴포넌트: draggable, deletable, multi-selectable
- 저장 시 canvas에 래스터화 후 bg+draw 합성 (기존 handleDrawSave 플로우 유지)
- initCanvas / 저장 후 placedItems/selectedIds 리셋

### AC-17~18 (회귀방지·하위호환)
- 빌드 통과 (tsc + vite): 0 errors
- 기존 V2 기능(DPR 2.0, getCoalescedEvents, 텍스트 입력 오버레이) 유지

## 선행 의존
- PENCHART-ERASER-CLARITY (P0, deploy-ready): dpr fix 배포 후 펜 인식 확인
- PENCHART-TOOLS-V2 (reopened): 기배포 위에 V3 추가 구현

## 미구현 (명시적 제외)
- AC-1 펜 인식 근본 fix: ERASER-CLARITY P0 배포 후 현장 재확인 예정
- E2E spec(spec-added: false): V3 UX 안정화 후 spec 추가 예정

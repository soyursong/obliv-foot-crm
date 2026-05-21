---
id: T-20260522-foot-SLOT-SNAP-FIX
title: "대시보드 슬롯 드래그 ghost ↔ 실제 터치 포인트 정렬 보정 (S Pen 태블릿)"
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
deploy_ready: true
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.19s"
commit_sha: 5caa0646014a41464935063fdc65225dabf1f7ab
e2e_spec: tests/e2e/T-20260522-foot-SLOT-SNAP-FIX.spec.ts
related: T-20260520-foot-SLOT-MOVE-REVERT (14f3727, 별개)
---

## 개요

S Pen 태블릿 가로 모드에서 대시보드 칸반 슬롯 드래그 시,
DragOverlay(ghost)가 실제 터치 포인트와 동떨어진 위치에 표시되는 UX 문제 수정.

## 근본 원인

`@dnd-kit/core`의 `DragOverlay`는 드래그 노드의 원래 top-left 좌표에 transform delta를
더해 렌더링한다. 터치/S Pen 입력에서는 activatorEvent 좌표(실제 터치 위치)가
노드 top-left와 달라 ghost가 손가락에서 멀어 보이는 현상 발생.

## 해결책

`snapToCursorModifier` (module-level 함수, `@dnd-kit/utilities.getEventCoordinates` 활용)를
`DragOverlay modifiers={[snapToCursorModifier]}`에 주입.

계산식:
```
x = transform.x + coords.x - draggingNodeRect.left - draggingNodeRect.width / 2
y = transform.y + coords.y - draggingNodeRect.top  - draggingNodeRect.height / 2
```

→ ghost 중심이 항상 activatorEvent 좌표(포인터/터치 위치)에 맞춰짐.

## 변경 파일

- `src/pages/Dashboard.tsx`
  - `import { CSS, getEventCoordinates } from '@dnd-kit/utilities'` 추가
  - `snapToCursorModifier` 함수 추가 (모듈 레벨)
  - `<DragOverlay modifiers={[snapToCursorModifier]}>` 적용

## AC

- AC-1: S Pen 드래그 시 ghost 중심이 터치 포인트 근처에 표시됨
- AC-2: 마우스 드래그 동작 비회귀
- AC-3: 기존 SLOT-MOVE-REVERT 동작 (즉시 이동) 비회귀

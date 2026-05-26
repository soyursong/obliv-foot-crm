---
ticket_id: T-20260526-foot-PMW-ORDER-REMOVE
title: 결제 미니창 "순서 편집" 기능 제거
domain: foot
priority: P1
status: deploy-ready
created_at: 2026-05-26
deadline: 2026-05-27
deploy_ready: true
build_passed: true
db_changed: false
db_rollback_sql: ""
spec_file: tests/e2e/T-20260526-foot-PMW-ORDER-REMOVE.spec.ts
commit: ""
---

## 개요

PMW-SIDEMENU-FEAT(d3e5479) 배포 직후 현장(김주연 총괄) 즉시 제거 요청.
순서 편집 모드 진입 시 빨간 테두리(red box) + 코드명 잘림(C5900...) 문제로
"그냥 제거해줘" 지시.

## 수용 기준

- **AC-1** ✅ "순서 편집" 탭 완전 제거 — 기본/시술내역/수액/화장품 탭만 유지
- **AC-2** ✅ 드래그 핸들·↑↓ 화살표·빨간 테두리·삭제 아이콘 전부 제거
- **AC-3** ✅ 코드명 잘림 해소 — 순서 편집 UI 제거로 자연 해결
- **AC-4** ✅ DB service_menu_order 로직 유지 — FE 진입점만 제거
  (menuOrder state, menuOrderTimerRef, DB 로드/persist useEffect 모두 보존)
- **AC-5** ✅ npm run build 성공

## 변경 내용

### PaymentMiniWindow.tsx
- `SortableMenuCardRow` 컴포넌트(interface + function) 완전 제거
- `menuReorderMode` state 제거
- `menuTabServicesRef` ref 제거 (핸들러 stale-closure 방지용, 핸들러 제거로 불필요)
- `menuSensors` useSensors 인스턴스 제거
- `handleReorderMenuCard` useCallback 제거
- `handleDragEndMenuCard` useCallback 제거
- `menuTabServicesRef.current` 렌더 동기화 라인 제거
- 탭 클릭·서브카테고리 클릭 핸들러에서 `setMenuReorderMode(false)` 제거
- "순서 편집" 토글 버튼 JSX 제거
- 순서 편집 모드 DnD 리스트 JSX 블록 제거
- 풋케어 그리드 조건 `!menuReorderMode &&` 제거 (항상 표시)

### 유지된 것 (AC-4)
- `menuOrder` state
- `menuOrderTimerRef`
- DB `service_menu_order` 로드 (`Promise.all` 4번째 쿼리)
- DB `service_menu_order` persist useEffect
- `tabServices` 정렬 로직 (저장된 순서 적용)

## 빌드 결과

```
✓ built in 3.28s
```

## DB 변경

없음 — FE 진입점만 제거. service_menu_order 테이블/RLS 변경 없음.

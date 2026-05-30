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
commit: "ed8865d"
qa_result: null
qa_grade: null
qa_fail_reason: null
qa_fail_phase: null
reopen1_commit: "ed8865d"
reopen1_scope: "FEE-ITEM-REORDER ↑↓·드래그핸들 UI 전면 제거 (REOPEN1)"
deployed_at: "2026-05-27T08:00:12+09:00"
deploy_commit: "00520dc"
bundle_hash: "index-RjIprGOw"
field_soak_until: "2026-05-28T08:00:12+09:00"
field_validation_slack_ts: "1779844220.558389"
reopen_investigation: "2026-05-28"
reopen_result: "코드·번들 이상 없음 — 오조사 완료"
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

## REOPEN 조사 (2026-05-28)

**현장 보고:** 김주연 총괄 "새로고침 후에 캡쳐한 화면이야 2번 수정사항 변경안 됨"

### 코드 증거

| 항목 | 결과 |
|------|------|
| `3c30149` origin/main 포함 여부 | ✅ 포함 (2026-05-26 20:21 KST) |
| 이후 커밋 revert 여부 | ✅ 없음 (`dc7333b`, `6ed19d1` 모두 PenChartTab.tsx만 변경) |
| `menuReorderMode` 소스 잔존 | ✅ 없음 (주석 1개만 — 렌더 안됨) |
| `SortableMenuCardRow` 소스 잔존 | ✅ 없음 |
| "순서 편집" 렌더 UI 잔존 | ✅ 없음 (line 1775는 JSX comment) |
| production 번들 hash | `index-5fhHKeWn.js` (index-RjIprGOw 이후 갱신됨) |
| 번들 내 "순서 편집" 텍스트 | ✅ 없음 |
| 번들 내 `menuReorderMode` | ✅ 없음 |
| 번들 내 `menu-reorder-toggle` | ✅ 없음 |

### 결론

**fix는 정상 배포됨.** production 번들에 "순서 편집" UI 없음 확인.

사용자가 보고 있는 것은 수가 항목 목록(우측 Zone2)의 ↑↓ 화살표·드래그 핸들로 추정.
이는 **T-20260525-foot-FEE-ITEM-REORDER** 별도 기능(유지 대상)이며 PMW-ORDER-REMOVE 범위 밖.

- 메뉴 카드 순서 편집 ↑↓ (`menu-reorder-up/down`) → 제거됨 ✅
- 수가 항목 ↑↓ (`reorder-up/down`) → 유지 의도 (FEE-ITEM-REORDER)

### 조치

- stale 주석 업데이트 (line 1775: "순서 편집 토글 제거됨 — PMW-ORDER-REMOVE" 명시)
- 재커밋 → Vercel 재빌드 강제
- 현장에 "수가 항목 ↑↓는 별도 기능" 안내 필요 (planner 전달)

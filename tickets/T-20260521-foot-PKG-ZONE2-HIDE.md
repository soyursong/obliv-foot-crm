---
id: T-20260521-foot-PKG-ZONE2-HIDE
title: "2번차트 2구역 C22 활성패키지 — 잔여 0회 패키지 자동 비노출"
status: deployed
priority: P2
domain: foot
reporter: planner (MSG-20260521-190103-0cs2)
assignee: dev-foot
created: 2026-05-21
deadline: 2026-05-28
deploy_ready: true
deploy_ready_at: "2026-05-21T19:30:00+09:00"
db_change: false
build_pass: true
spec_added: true
regression_risk: low
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-21T23:51:00+09:00"
deploy_commit: d328e326d381ff846830c91729ea2a10777807be
bundle_hash: CustomerChartPage-Bs3ShnFn.js
field_soak_until: "2026-05-22T23:51:00+09:00"
---

## 수용기준

- AC-1: 2구역 C22-PKG-DEDUCT 활성패키지에서 `remaining_count === 0` 패키지 비노출 ✅
- AC-2: 이력/전체 탭은 필터 미적용 (DB status=active 유지, FE 필터링만) ✅
- AC-3: 차감 후 즉시 반영 (로컬 상태 갱신 → 필터 재평가) ✅

## 구현 내용

**파일**: `src/pages/CustomerChartPage.tsx`

**변경 위치**: C22-PKG-DEDUCT 블록 (4곳)

**Before**:
```tsx
packages.filter(p => p.status === 'active')
```

**After**:
```tsx
packages.filter(p => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0))
```

**변경 위치 상세**:
1. Line ~3989 — 회차차감 헤더 "활성 패키지 없음" 조건
2. Line ~3995 — 복수 패키지 드롭다운 표시 조건
3. Line ~4004 — 드롭다운 옵션 렌더링
4. Line ~4066 — 차감 버튼 disabled 조건

- `p.remaining === null`: 비동기 로드 전 방어 — 아직 로드 전이면 노출 유지
- `p.remaining.total_remaining > 0`: 잔여 0회 이하면 비노출
- DB status 변경 없음 → 이력/전체 탭 영향 없음

## DB 변경

없음 (FE only). `status` 컬럼 그대로 `active` 유지.

## AC-3 반영 경위

기존 차감 핸들러가 `setPackages(prev => prev.map(...))` 로 `remaining` 필드를 갱신하므로,
필터 조건이 즉시 재평가 → 차감 후 새로고침 없이 비소진 패키지 목록 갱신.

## 선행 참고

T-20260520-foot-PKG-ZERO-HIDE (deployed, 58fc761) — 1구역 동일 로직 적용 선행.

## 테스트

`tests/e2e/T-20260521-foot-PKG-ZONE2-HIDE.spec.ts`
- DB 레벨 3개: FE 필터 시뮬, AC-2 DB status 유지, AC-3 차감 후 즉시 반영
- UI 스모크 1개: 2번차트 2구역 회차차감 렌더 확인

## 빌드

✅ `npm run build` — 오류 없음 (3.23s)

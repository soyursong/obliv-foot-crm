---
id: T-20260520-foot-PKG-ZERO-HIDE
title: "2번차트 1구역 활성패키지 리스트 — 잔여 0회 패키지 자동 비노출"
status: in_progress
priority: P2
domain: foot
reporter: 김주연 총괄 (U0ATDB587PV)
assignee: dev-foot
created: 2026-05-20
deadline: 2026-05-27
deploy_ready: false
db_change: false
build_pass: true
spec_added: true
regression_risk: low
qa_result: fail
qa_fail_phase: phase2
qa_fail_reason: spec_fail_new
qa_grade: Yellow
---

## 수용기준

- AC-1: 활성패키지 리스트에서 `remaining_count === 0` 패키지 비노출 ✅
- AC-2: 이력/전체 탭에서는 정상 표시 (DB 삭제 아님, FE 필터링) ✅
- AC-3: 차감 시점 즉시 반영 (리페치 or 로컬 상태 갱신) ✅
- AC-4: 잔여 1→0 차감 후 새로고침 없이 활성 리스트에서 사라짐 ✅

## 구현 내용

**파일**: `src/pages/CustomerChartPage.tsx`

**변경 위치**: 2번차트 1구역 활성패키지 렌더 필터 (주석 `T-20260510-foot-C21-PKG-ITEM-DETAIL` 블록)

**Before**:
```tsx
packages.filter((p) => p.status === 'active')
```

**After**:
```tsx
packages.filter((p) => p.status === 'active' && (p.remaining === null || p.remaining.total_remaining > 0))
```

- `p.remaining === null`: 비동기 로드 전 방어 처리 — 아직 로드 전이면 노출 유지 (사라짐 방지)
- `p.remaining.total_remaining > 0`: 잔여 0회 이하면 비노출
- outer wrapper 조건 + inner `.map()` 필터 두 곳 동시 적용

## DB 변경

없음 (FE only). `status` 컬럼 그대로 `active` 유지 — 이력/전체 탭 영향 없음.

## AC-3/AC-4 반영 경위

기존 코드에서 차감 후 `setPackages(prev => prev.map(...))` 으로 `remaining` 필드가 갱신되므로,
필터 조건이 즉시 재평가되어 AC-3/AC-4 충족. 별도 리페치 로직 추가 불필요.

## 테스트

`tests/e2e/T-20260520-foot-PKG-ZERO-HIDE.spec.ts`
- DB 레벨 3개: RPC 분기, DB status 유지, 1→0 차감 후 즉시 반영
- UI 스모크 1개: 2번차트 1구역 렌더 확인

## 빌드

✅ `npm run build` — 오류 없음 (3.14s)

## QA 결과 (2026-05-21 supervisor)

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | 3.14s, exit 0 |
| 코드 리뷰 | ✅ PASS | `p.remaining === null` null guard 정상 |
| Runtime Safety Gate §7.5 | ✅ PASS | 명시적 null 체크 후 `.total_remaining` 접근 |
| env 매트릭스 (Phase 1.5) | ✅ PASS | VITE_SUPABASE_URL/ANON_KEY 기존 변수만 사용 |
| 브라우저 접근 | ✅ PASS | prod bundle hash `CvswHZAQ` 일치, `total_remaining` 3회 매치 확인 |
| E2E spec | ❌ **FAIL** | spec seed에서 `package_type` NOT NULL 필드 누락 |

### E2E 실패 상세

```
Error: 패키지A 생성 실패: null value in column "package_type" of relation "packages" violates not-null constraint
```

**원인**: `tests/e2e/T-20260520-foot-PKG-ZERO-HIDE.spec.ts` seed 함수의 packages 인서트에 `package_type` 컬럼이 빠짐.

**수정 필요**: `pkgZero`, `pkgOne` 인서트 모두에 `package_type: 'custom'` 추가.

**참고**: 구현 코드(`CustomerChartPage.tsx`)는 정상. prod에 이미 반영됨(bundle hash 일치).

→ FIX-REQUEST 발송: MSG-20260521-001942-f0ur (dev-foot, P2)

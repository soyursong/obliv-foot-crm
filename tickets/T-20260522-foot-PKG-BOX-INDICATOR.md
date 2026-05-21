---
id: T-20260522-foot-PKG-BOX-INDICATOR
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
commit_sha: TBD
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260522-foot-PKG-BOX-INDICATOR.spec.ts
risk: low
created_at: 2026-05-22
completed_at: 2026-05-22
deadline: 2026-05-29
---

# T-20260522-foot-PKG-BOX-INDICATOR

대시보드 고객박스에 패키지 보유 표식(badge) 추가

## 배경

현장 피드백: "차트 열기 전 고객박스 상태에서도 표식이 있으면 좋겠다.
코디/치료사가 주로 사용하는 구역에서 표기 필요."

## 구현 내용

### 추가된 요소

1. **`PkgHolderCtx`** — `Set<string>` 컨텍스트 (customer_id → 활성 패키지 보유 여부)
2. **`pkgHolderSet` 상태** — `fetchPackageLabels` 내 배치 조인으로 추가 DB 쿼리 0개
3. **`DraggableCard` 배지** — compact/non-compact 양쪽, `data-testid="pkg-holder-badge"`

### 배지 스펙

```
<span class="bg-violet-100 text-violet-700 text-[9px] px-0.5 py-px rounded font-medium">
  <Package h-2 w-2 /> 패키지
</span>
```

- 초진 딱지(파란/노란)와 나란히 `flex-wrap` 행에 표시
- 잔여 > 0 조건 (remaining > 0) 만족 시 표시
- 모든 패키지 유형 포함 (status='active' 필터만 사용)

## AC 달성

| AC | 내용 | 달성 |
|----|------|------|
| AC-1 | 잔여>0 활성 패키지 보유 → 카드 배지 | ✅ |
| AC-2 | 모든 패키지 유형 포함 | ✅ (status='active' 전체) |
| AC-3 | 초진 딱지와 별도 배지 | ✅ (violet vs blue/yellow) |
| AC-4 | compact/non-compact 양쪽 | ✅ |
| AC-5 | 성능: 추가 DB 쿼리 없음 | ✅ (기존 fetch 배치 조인) |

## 성능

- fetchPackageLabels 기존 2-query(packages + package_sessions) 재사용
- 추가 DB 쿼리 0개
- holderSet 빌드 O(n) 루프 1회 추가 — 50슬롯 기준 추가지연 < 1ms

## DB 변경

없음

## 파일 변경

- `src/pages/Dashboard.tsx` — PkgHolderCtx, pkgHolderSet, DraggableCard badge
- `tests/e2e/T-20260522-foot-PKG-BOX-INDICATOR.spec.ts` — 신규 spec

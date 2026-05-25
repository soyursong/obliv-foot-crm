---
id: T-20260525-foot-SVC-CATEGORY-SORT
domain: foot
priority: P2
status: deployed
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260525-foot-SVC-CATEGORY-SORT.spec.ts
summary: "서비스관리 filteredRows useMemo에 category_label 오름차순 정렬 추가(localeCompare ko). 동일 카테고리 내 sort_order 원본 순서 유지. FE-only. 빌드 3.23s OK. DB 변경 없음."
created: 2026-05-25
risk_verdict: GO
risk_reason: "FE-only. DB 변경 없음. filteredRows spread-sort — 원본 rows 불변. CRUD 로직 무영향."
qa_result: pass
qa_grade: Green
deployed_at: "2026-05-26T00:18:05+09:00"
deploy_commit: 5e76e49
bundle_hash: Services-BcUAJICn
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1779708029.550029"
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
field_soak_until: "2026-05-27T00:18:05+09:00"
field_validation_slack_ts: "1779722487.893889"
---

## T-20260525-foot-SVC-CATEGORY-SORT — 서비스관리 항목분류별 자동 정렬

### 배경

서비스관리 목록이 category_label 기준 정렬 미적용으로 현장에서 카테고리별 그룹 확인 불편. SVC-FILTER-SEARCH(done, c06b7f7) 후속.

### 구현 완료

**파일**: `src/pages/Services.tsx`

**변경 내용**: `filteredRows` useMemo 내 filter 후 `[...filtered].sort()` 추가

```typescript
return [...filtered].sort((a, b) =>
  (a.category_label ?? '').localeCompare(b.category_label ?? '', 'ko'),
);
```

- `localeCompare('ko')` — 한국어 문자열 정렬 올바름
- `[...filtered]` spread — 원본 배열 불변 보장
- Stable sort 특성으로 동일 카테고리 내 rows 원본 순서(sort_order) 유지

### AC 검증

- **AC-1** ✅ category_label 오름차순 정렬 적용
- **AC-2** ✅ 카테고리 드롭다운 필터 filter → sort 순서로 공존
- **AC-3** ✅ CRUD (save/softDelete/hardDelete) 로직 무변경
- **AC-4** ✅ 빌드 3.23s OK + E2E spec 작성

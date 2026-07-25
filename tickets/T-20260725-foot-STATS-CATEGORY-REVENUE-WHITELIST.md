---
id: T-20260725-foot-STATS-CATEGORY-REVENUE-WHITELIST
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260725-foot-STATS-CATEGORY-REVENUE-WHITELIST.spec.ts
summary: "통계 > '시술 종류별 매출'(Stats.tsx → CategorySection) 6개 화이트리스트 버킷만 표기. FE-only 표시 필터(foot_stats_by_category RPC 무변경, no-DDL/no-schema). 매출 산식·집계 불변, 표시 대상만 필터. 버킷: 비가열레이저/가열레이저/포돌로게(내성)/Reborn(각질)/풋화장품/진찰료(기본·서류·검사비). 나머지(풋케어·수액·처방약·상병·기타·처방·trial·preconditioning·iv) 숨김('기타' 합산 없음)."
created: 2026-07-25
risk_verdict: GO
risk_reason: "FE 표시 필터 전용. RPC/DB/스키마 무접촉(db-change=false). 방출 rows 를 6버킷으로 합산만(매출 산식·집계 불변). 변경 격리: src/lib/stats.ts(applyCategoryWhitelist 신규+categoryLabel wl_* 케이스) + CategorySection.tsx(렌더 전 필터). SalesTreatmentTab/매출집계 페이지 무접촉. 신규 spec 4 AC 4/4 PASS + npm run build PASS. KNOWN CAVEAT: 단건 풋케어(services.category='풋케어')는 heated/unheated 분해 불가 → 6버킷 미매칭 숨김 → 레이저/포돌로게/Reborn 은 패키지 생성(pkg_created)분 위주 집계. 단건 편입 필요 시 RPC/name 분해(범위 밖) 별도 티켓."
reporter: planner
mapping_verified: "2026-07-25 prod 실측(foot_stats_by_category 방출 category 코드): unheated_laser/heated_laser/podologue/reborn(패키지 영문코드) + 풋화장품/기본/검사/진료(single_paid services.category). 서류=제증명은 category='기본' 로 적재(pair '기본|제증명' 13건) → '기본' 코드에 포함."
---

# T-20260725-foot-STATS-CATEGORY-REVENUE-WHITELIST

## 요구 (planner NEW-TASK MSG-20260725-212206-71dv)
통계 > 시술 종류별 매출 섹션 → 6개 항목 화이트리스트만 표기.
표시: 비가열레이저 / 가열레이저 / 포돌로게(내성) / Reborn(각질) / 풋화장품 / 진찰료(기본·서류·검사비)
나머지 카테고리는 단순 숨김('기타' 합산 없음). 매출 산식/집계 로직 불변, 표시 대상만 필터.

## 선행 확인 결과
- **소비 컴포넌트/RPC 확정**: 통계 '시술 종류별 매출' = `src/pages/Stats.tsx` → `CategorySection` → `fetchCategoryRevenue` → RPC **`foot_stats_by_category`**(리네이밍 이력 있으나 foot repo 라이브 함수명은 `foot_stats_by_category` 유지, prod 실측 확인). 매출집계 탭의 `SalesTreatmentTab`(sibling 티켓 WHITELIST6)과는 **다른 화면·다른 축**.
- **6 라벨 ↔ DB 실매핑**(2026-07-25 prod 실측):
  - 비가열레이저 ← `unheated_laser` / 가열레이저 ← `heated_laser` / 포돌로게(내성) ← `podologue` / Reborn(각질) ← `reborn` (패키지 생성 브랜치 영문코드)
  - 풋화장품 ← `풋화장품` / 진찰료 ← `기본`·`검사`·`진료` (단건 브랜치 services.category)
  - **서류(제증명)**: services.category='기본'(category_label만 '제증명') → '기본' 코드에 이미 포함, 별도 매칭 불필요.

## 구현
- FE 화이트리스트 필터(RPC 무변경). `applyCategoryWhitelist()` 가 방출 rows 를 6버킷으로 합산·고정순서 반환, 화이트리스트 외 코드는 제외.
- `CategorySection` 이 렌더 전(파이/표/비중/합계) 필터 적용. 비중·전체합계는 6버킷 기준.

## KNOWN CAVEAT (planner/supervisor 인지용)
단건(single_paid) 풋케어 시술은 `services.category='풋케어'` 단일값으로 적재 → heated/unheated 분해 불가 → 6버킷 어디에도 매칭 안 됨 → 숨김. 따라서 레이저/포돌로게/Reborn 버킷은 사실상 **패키지 생성(pkg_created)분 위주**로 집계된다(단건 풋케어 ≈ 서울 1.36M vs 패키지 레이저 234M, 소액). 단건 풋케어를 버킷에 편입하려면 services.name 키워드 분해가 필요하고 이는 RPC 변경(범위 밖) → 필요 시 별도 티켓 재평가.

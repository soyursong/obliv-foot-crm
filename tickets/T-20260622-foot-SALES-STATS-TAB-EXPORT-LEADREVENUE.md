---
ticket_id: T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
id: T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-22
owner: agent-fdd-dev-foot
requester: 김주연 운영총괄 (foot C0ATE5P6JTH, thread 1782104285.460809)
approved_by: planner NEW-TASK MSG-20260622-143634-8zcd
build_ok: true
spec_added: tests/e2e/T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE.spec.ts
db_changed: true
data_architect_consult: 불요 — RPC 함수(foot_stats_consultant) RETURNS TABLE 에 total_amount BIGINT 반환 컬럼 1개 추가(ADDITIVE/비파괴). 테이블 신규 컬럼/enum/필드매핑 0. 선례 20260619020000_foot_stats_consultant_session_presence.sql("RPC 함수 변경=ADDITIVE ⇒ data-architect CONSULT 불요, supervisor DDL-diff만으로 진행")와 동일 성격.
risk_level: GO (2/5 — RPC 반환 컬럼 1개 추가 + FE 컬럼/버튼 추가. avg_amount 정의·기존 산식 무변경, 신규 다운로드 경로는 AGG raw 경로와 분리. FE는 total_amount 옵셔널 소비(fallback=객단가×건수)라 RPC 배포 타이밍 무관)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-22
deploy_commit: d587e81f
commit_sha: d587e81f
db_migration: supabase/migrations/20260622210000_foot_stats_consultant_total_amount.sql (rollback: *.rollback.sql) — dev DB(rxlomoozakkjesdqjtvd) 적용 완료(apply script dry-run 검증). DROP+CREATE(RETURNS TABLE 컬럼 추가는 CREATE OR REPLACE 불가).
---

# T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE — 매출통계 탭 다운로드 + 실장별 총 매출액

## 요청 (김주연 운영총괄)

1. 통계 > **매출통계 탭**에 다운로드 버튼 추가 (현재 매출집계 메뉴에만 있음).
2. **실장별 실적** 섹션에 '총 매출액' 컬럼 추가 (현재 평균 객단가만).
→ 다운로드 시 일간매출보고 양식: 실장별 {매출, 상담건수, 상담객단가} + 총 일간 매출액.
   (객단가 = 매출 ÷ 상담건수 파생)

## 구현 (AC)

### AC1 — 데이터 (DB)
- `foot_stats_consultant` RPC에 `total_amount BIGINT`(= `COALESCE(SUM(rpc.rev),0)`) 반환 추가.
- 리포터 데이터 모델 = "객단가 = 매출 ÷ 상담건수" → **매출(total_amount)이 1차값**.
  현 RPC는 `avg_amount=ROUND(SUM/count)` 만 반환 → FE에서 `avg×count` 역산 시 ROUND 오차.
  ∴ 진짜 `SUM(rev)` 을 노출해 재무보고 정합 확보.
- `avg_amount` 정의·기존 CTE·INNER JOIN(데이터-유무 필터, T-20260619 AC3) 100% 보존.
- dev DB 적용 + dry-run 검증: `avg_amount == ROUND(total_amount/ticketing_count)` 일치 확인.

### AC2 — 실장별 총 매출액 컬럼 (FE)
- `ConsultantSection.tsx` 테이블에 '총 매출액' 컬럼 + 정렬키(`total`) 추가.
- 값 = `consultantRevenue(r)` = `total_amount` 우선, 미반환 시 `avg×count` fallback.

### AC3 — 매출통계 탭 다운로드 (FE)
- `Stats.tsx` 매출통계(revenue) 탭에 '일간매출보고 다운로드' 버튼(`stats-revenue-export`) 추가.
- 신규 export 모듈 `src/lib/consultantSalesExport.ts`:
  실장별 {실장명, 매출, 상담건수, 상담객단가} + 합계행(총 매출액·총 건수·전체 객단가) xlsx.
- 데이터 소스 = 이미 로드된 `consultants`(foot_stats_consultant). 매출집계 다운로드 경로
  (`Sales.tsx` `fetchSalesRawRows`, T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR)와 **완전 분리**
  → AGG 버그(PGRST201/42703) 비전파. 빈데이터·오류 graceful 토스트.

## 의존성 처리
- SALES-AGG-DOWNLOAD-ERROR(이미 deploy-ready, commit 5ce17f25)의 버그 경로는 `Sales.tsx`의
  raw payments/package_payments 쿼리. 본 티켓은 RPC 기반 별도 경로 → 버그 공유 0. 이중 수정 없음.

## 검증
- `npm run build` 통과.
- E2E `T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE.spec.ts`: 2 test PASS (desktop-chrome)
  — 다운로드 버튼 가시 + 클릭 시 오류 토스트 미발생 / TM집계 탭 전환 시 버튼 숨김.
- DB dry-run(서울 오리진점, 2026 누적): 실장 5명 매출/건수/객단가 정합.

## 비고
- 실장(consultant) 축 = 영업/상담 실장. therapist 통계(THERAPIST-STATS)와 별개 대상. (요청 명시 준수)
- supervisor 배포 시: RPC 마이그(20260622210000)는 이미 동일 Supabase(rxlomoozakkjesdqjtvd)에 적용됨.
  FE는 total_amount 옵셔널 소비라 RPC/FE 배포 순서 무관(order-independent).

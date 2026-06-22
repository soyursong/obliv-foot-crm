---
ticket_id: T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR
id: T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR
status: deploy-ready
priority: P0
domain: foot
created_at: 2026-06-22
owner: agent-fdd-dev-foot
requester: 김주연 운영총괄 (U0ATDB587PV)
approved_by: planner NEW-TASK MSG-20260622-143613-57d0
build_ok: true
spec_added: tests/e2e/T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR.spec.ts
db_changed: false
data_architect_consult: 불요 — FE PostgREST 쿼리 셀렉트 문자열만 교정(임베드 FK 명시 + 컬럼명). 신규 컬럼·테이블·enum·필드매핑 0. RLS/GRANT/마이그 변경 0. 신규 npm 0.
risk_level: GO (2/5 — package_payments 조회 셀렉트 1건 교정. 단건 payments·집계 산식·일마감 로직 무변경. prod 실측 재현으로 fix 검증)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-22
deploy_commit: 83f0a3a6
commit_sha: 83f0a3a6
qa_fix_phase2: 83f0a3a6 — E2E 실행환경 정리(상대경로 goto + storageState 오버라이드 제거). desktop-chrome 3 passed. test-only, 소스 무변경. fix는 a6932f06 유지.
---

# T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR — 매출집계 엑셀 다운로드 오류

## 근인 (AC-0, prod 실측 재현 확정)

매출집계 → 엑셀 다운로드 시 `fetchSalesRawRows`의 **패키지 결제(package_payments) 조회가 throw** → catch → "다운로드 중 오류가 발생했습니다." 토스트.

복합 2원인 (둘 다 package_payments 쿼리):
1. **PGRST201 임베드 모호성** — `packages(... customers(...))` 임베드가 어느 FK인지 모호.
   `packages`↔`customers` FK 2개: `packages_customer_id_fkey`(customer_id=구매자), `packages_transferred_to_fkey`(transferred_to=**패키지 양도** 대상). PostgREST가 모호성으로 거부.
2. **컬럼명 오타(42703)** — 코드가 `packages(name)` 조회, 실제 컬럼은 `package_name`. 매핑부도 `p.packages?.name`.

**정정**: 근인은 RLS/GRANT 회귀가 **아님**. 단건 `payments` 쿼리는 정상(prod 60건 조회). GRANT(authenticated SELECT) 정상, RLS read도 admin(김주연) 통과. 진짜 원인 = 패키지 양도 FK 추가로 인한 임베드 모호성 + 컬럼명 오타. → **db_change 불필요**(권한 복원 경로 해당 없음).

재현 증거:
- before: `package_payments` 쿼리 → `PGRST201 Could not embed ... more than one relationship for 'packages' and 'customers'`
- after fix: `packages(package_name, customers!packages_customer_id_fkey(...))` → ok (패키지 12건), 빈 기간 graceful(0건)
- 진단 스크립트: `scripts/T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR_diag.mjs`

## 수정 (AC-1)

`src/pages/Sales.tsx`:
- package_payments 셀렉트: `packages(name, customers(...))` → `packages(package_name, customers:customers!packages_customer_id_fkey(name, chart_number))`
- `PkgPaymentRawRow.packages.name` → `package_name`
- 매핑 `p.packages?.name` → `p.packages?.package_name`
- 빈 데이터 graceful: 기존 `toast.info('해당 기간에 매출 내역이 없습니다.')` 유지

산식·집계 로직 변경 0 (오류만 제거). 양식 신규 컬럼은 본 티켓 밖(DAILY-SALES-EXPORT-REVIEW P1 소유).

## 검증 (AC-2)

- prod 정상 기간(2026-06): 패키지 12건 + 단건 60건 조회 ok
- 데이터 없는 기간(2020-01): 0건 graceful (오류 없음)
- 빌드 통과, Sales.tsx typecheck 통과
- E2E spec: 다운로드 클릭 시 오류 토스트 미발생 가드 + 셀렉트 문자열 회귀 가드(임베드 FK 명시·컬럼명)

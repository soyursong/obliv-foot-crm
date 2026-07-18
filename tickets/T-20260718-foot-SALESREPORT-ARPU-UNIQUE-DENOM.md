---
ticket_id: T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM
id: T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-07-18
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (U0ATDB587PV, foot C0ATE5P6JTH · via MSG-20260718-115039-l2dm)
approved_by: planner NEW-TASK MSG-20260718-115432-4w95
build_ok: true
spec_added: tests/e2e/T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM.spec.ts
db_changed: false
data_architect_consult: 불요 — 스키마 변경 0(신규 컬럼/테이블/enum/RPC 없음). 이미 배포된 foot_stats_consultant RPC 의 canonical 컬럼(avg_amount, consulted_customer_count = T-20260717-foot-CONSULTANT-ARPU-STATS 산출물)을 FE 다운로드에서 그대로 소비. 산식 자체는 T-20260717 DA follow-up(MSG-20260717-194812-i1wo)에서 旣확정.
risk_level: GO (1/5 — 순수 FE 계산 변경. 다운로드 xlsx 상담객단가 셀 값만 재정의. RPC/DB/헤더/컬럼구조/버튼 무변경. 화면 배포본 canonical 재사용이라 화면=다운로드 자동 정합)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-07-18
deploy_commit: da0900f9
commit_sha: da0900f9
---

# T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM — 일간매출보고 다운로드 객단가 분모 통일

## 요청 (김주연 총괄 · via planner MSG-20260718-115432-4w95)
풋센터CRM 통계 > 매출통계 > '일간매출보고' 다운로드 엑셀의 **상담객단가 분모**를
현재 방문횟수(상담건수, ÷ticketing_count) → **distinct 상담고객(unique, ÷상담고객수)** 로 변경.
→ 이미 배포된 화면 '상담실장별 객단가'(T-20260717-foot-CONSULTANT-ARPU-STATS)와 **동일 기준 통일**.

## BINDING (재집계 금지 — 준수)
- 분모 = 화면 배포본 `foot_stats_consultant` RPC 의 canonical 그대로 재사용.
  - **실장별 객단가 = RPC `avg_amount` 직접 소비** (= `ROUND(total_amount / NULLIF(consulted_customer_count,0))`).
    → 화면이 표시하는 바로 그 값. FE 재계산 없음 = 1-byte 동일. 분모=0 → RPC NULL → 엑셀 빈칸.
  - **합계 객단가 = Σ매출 / Σ`consulted_customer_count`** (반올림). 분모=0 → 빈칸.
- 다운로드용 분모 재정의 안 함(동일 소스 소비). 근거집합 = ticketed CTE(to_status='consultation' AND
  consultant_id NOT NULL) distinct 고객, checked_in_at 윈도, 노쇼·예약only 제외 — RPC 가 이미 pin.
- **분자 불변**: 매출 = RPC `total_amount`(net 수납·accounting_date·공단/선수금 제외) — 화면 canonical 과 동일소스.
  ⇒ 분자 divergence 없음(FOLLOWUP 불요).
- **기간 선택·엑셀 컬럼구조·헤더·버튼 = 기존 유지.** '상담건수' 컬럼은 기존대로 ticketing_count(방문횟수) 표시.
  객단가 셀 값만 재계산. 분모0 → 빈칸.

## db_change 판정
- 객단가 = **앱/리포트 코드 계산** 경로(FE `src/lib/consultantSalesExport.ts`). 별도 RPC/뷰 신설 없음.
  → **db_change: false, 코드수정만.** (DA (b) drift 방지 = 신규 RPC 신설 금지 준수 · 기존 RPC canonical 소비.)
- 함수 signature 변경 없음 → MIG-GATE 불요.

## 구현
- `src/lib/consultantSalesExport.ts`
  - per-row 객단가: `consultantUnitPrice(revenue, ticketing_count)` 제거 → `r.avg_amount` 직접 소비(number|null).
  - 합계 객단가: `consultantOverallUnitPrice(totalRevenue, Σconsulted_customer_count)` 신규(분모0 → null).
  - 객단가 NULL → 엑셀 빈 문자열 셀(빈칸). 숫자 서식 루프는 `typeof v === 'number'` 가드로 빈칸 제외.
  - '상담건수' 컬럼(ticketing_count)·매출(total_amount)·헤더·컬럼폭·시트명·파일명 = 불변.

## AC (E2E: tests/e2e/T-20260718-foot-SALESREPORT-ARPU-UNIQUE-DENOM.spec.ts — 6 PASS)
- AC1 헤더/컬럼구조 불변 = ['실장명','매출','상담건수','상담객단가']. 상담건수 컬럼 = ticketing_count.
- AC2 실장별 객단가 = RPC avg_amount(÷상담고객수). ÷상담건수(구 기준) 아님.
- AC3 분모(상담고객)=0 → 객단가 빈칸(구 코드 0 표기 금지).
- AC4 합계 객단가 = Σ매출 ÷ Σ상담고객수. ÷Σ상담건수(구 기준) 아님.
- AC5 helper: consultantOverallUnitPrice 분모0 → null / 매출 분자 = total_amount 그대로.

## 현장 안내 (responder 병기 요청 — planner 전달)
- 분모 축소(방문횟수 → distinct 상담고객)로 다운로드 객단가 수치가 **상향될 수 있음(정상)**.
- 이제 **화면(실장별 실적) 객단가 = 다운로드 객단가 동일 기준**.

## 참고 (합계행 분모 caveat — INFO)
- 합계 객단가 분모 = Σ(실장별 consulted_customer_count). 한 고객이 2명 실장과 상담 시 합계 분모에서 중복 계수될 수 있음
  (per-consultant distinct 의 합 ≠ 전역 distinct). RPC 는 실장별 distinct 만 제공(전역 distinct 미제공),
  신규 RPC 신설 금지(DA drift 방지) 하에선 이 합이 유일한 재사용 경로. 실장별 셀은 화면과 1-byte 동일.

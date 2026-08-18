# T-20260818-foot-STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT — 진단·수정 (P1 hotfix)

**작성**: dev-foot · 2026-08-18 · project ref `rxlomoozakkjesdqjtvd` (obliv-foot-crm)
**방식**: read-only 진단(파괴적 조치 0) → no-db_change 코드 하드닝
**진단 스크립트**: `scripts/T-20260818-foot-STATS-DASHBOARD-PERIOD-QUERY-STMT-TIMEOUT_diag.mjs`

---

## 1. 증상

통계 대시보드 **TM집계 탭**에서 사용자 지정 기간(2026-08-01~2026-08-17, 17일) 조회 시
`canceling statement due to statement timeout · code=57014` 오류 배너. 일부 KPI 카드는(직전 로드분)
표시되나 배너 병존. 보고: 박장군 팀장(U05L44C5P50), #project-doai-crm-풋확장.

## 2. 근본원인 (증거 기반)

`src/lib/stats.ts::fetchTmAggregate` 는 **기간 내 전(全) raw 행을 클라이언트로 끌어와** 집계한다.
1000행/page cursor pagination + 각 reservations 페이지에 `customers(name, phone)` **PHI embed**.

**실측 행수 (jongno-foot clinic `74967aea…`):**

| 범위 | registered(created_at) | scheduled(resv_date) | visited(check_ins) | 총행/페이지수 |
|------|---:|---:|---:|---|
| 17일 (08-01~08-17) | **1,567** | 1,099 | 744 | 3,410행 / 5p |
| 48일 (07-01~08-17) | **2,538** | 1,802 | 1,214 | 5,554행 / 7p |

> KPI 카드에 보였던 246/216/117 은 raw 가 아니라 client 필터(내 예약만·TM팀만) 후 표시값 또는 직전 로드 잔상.

**인덱스 커버리지 (supabase/migrations grep):**
- `reservations`: `(clinic_id, reservation_date)` 인덱스만 존재 → **`created_at` 필터(query A) 무인덱스 스캔**.
- `check_ins`: `(clinic_id, checked_in_at::date)` / `(clinic_id, kst_date(checked_in_at))` → **`created_date` 필터(query C) 무인덱스 스캔**.

**embed(PHI 복호화) 비용 = 부하 비례 (controlled A/B, 1page):**
| DB 부하 | embed | lean(no-embed) | embed 추가비용 |
|---|---:|---:|---|
| 인시던트 근접(초기 측정) | 997ms | 606ms | **+65%** |
| 인시던트 근접 48d | 511ms | 351ms | +46% |
| 현재(저부하, 5회 평균) | 327ms | 293ms | +10% |

lazy 지연조회 실측: distinct 1,330 customer 복호화 = 3,674ms → **customers name/phone 복호화가 CPU-bound 로 비쌈.**

**결론**: 넓은 기간 = 5~7페이지 × (무인덱스 스캔 + 전행 PHI 복호화 embed). 자매 P0
**NEWRESV(57014)** 진단이 확정한 **DB compute 포화**(storage.search 3.5M calls 폭주, authenticated
`statement_timeout=8s`) 하에서, CPU-starved 상태의 이 **가장 무거운 CPU 소비 쿼리**가 8s 를 초과 →
57014. 즉 STATS 는 NEWRESV 와 **동일 에러클래스·동일 상류 인프라의 복수 발현**이며, 동시에
**독립적으로 무거운 쿼리 구조**(넓은 기간에서 baseline 에서도 timeout-prone)를 가진다.

## 3. 상관분석 판정 (AC-3, 에러클래스 실측 대조)

| 티켓 | 에러클래스 | 판정 |
|------|-----------|------|
| **본건 STATS** | **57014 statement_timeout** | — |
| NEWRESV-CUSTOMER-CREATE | **57014 statement_timeout** (RC=DB compute 포화/storage.search) | ✅ **동일 에러클래스·동일 인프라 → 수렴**. 급성 트리거는 NEWRESV 와 공유(shared-infra, dev-meta 소관 storage.list 완화로 해소). |
| CRM-SAVE-FAIL-LOADING-SLOW-OUTAGE | 상류 401(JWT/API Gateway) 축 | ❌ **다른 에러클래스 → 흡수 아님**. AC-3 의 "동일 상류 인프라면 흡수" 대상은 CRM-SAVE(401)가 아니라 NEWRESV(57014). |

**수렴 결론**: 급성 원인(DB compute 포화)은 NEWRESV 와 단일 근본원인 → dev-meta 인프라 완화
(T-20260818-foot-STORAGE-LIST-CALLREDUCE-CACHE)로 해소. 단, STATS 는 쿼리 구조상 baseline 취약성이
있어 **foot-side 독립 하드닝 필요**(아래 §4). CRM-SAVE(401)와는 무관.

## 4. 수정 (no db_change)

hot 집계 fetch 에서 **customers PHI embed 제거** → aggregation(카드/TM별/채널별)은 embed 0 으로 즉시
렌더. 고객명/전화는 **KPI 드릴다운 열릴 때만** `fetchTmDetailCustomers` 로 표시 subset 의 customer_id 만
batched `.in()` 지연조회.

- `src/lib/stats.ts`: `resSelect`/check_ins select 에서 `customers(...)` → `customer_id`. `TmResRow`/`TmCheckInRow`
  타입 `customers?` → `customer_id`. 신규 `fetchTmDetailCustomers(ids)` (distinct·300 청크).
- `src/components/stats/TmAggregateSection.tsx`: `custMap` state + `kpiDetail` 열릴 때 지연조회 effect.
  `mapRes`/`mapCI` 가 `custMap[customer_id]` 참조(best-effort — 실패해도 집계/카운트 유지).

**효과**: 초기 집계 로드(=timeout 나던 지점)의 CPU-bound PHI 복호화를 전 행에서 걷어냄. 부하 비례 이득
(저부하 10% → 포화 46~65%+)이라 **실패 조건(포화)에서 가장 크게 작동**. drill-down 은 사용자 개시·비차단.

## 5. 잔여 / 후속 (db_change — MIG-GATE 대상, 본 티켓 미적용)

baseline 구조취약성(넓은 기간 5~7페이지 무인덱스 스캔)의 **정본 해소**는 db_change 라 본 hotfix 범위 밖 —
GO-token 前 prod DDL 선집행 금지(apply_before_go). planner 로 후속 권고:
1. `reservations(clinic_id, created_at)` + `check_ins(clinic_id, created_date)` 부분/복합 인덱스, 또는
2. 서버측 집계 RPC(그룹 카운트만 반환 → 5,554행 → ~수십행 fetch)로 client 대량 fetch 자체 제거.

둘 다 mig_files/mig_dryrun/mig_ledger_check/mig_rollback 4필드 + supervisor DB-GATE GO-token 後 적용.

## 6. db_change 판정

**db_change = FALSE.** DDL·스키마·enum·컬럼 변경 0. 클라이언트 쿼리 shape(select 컬럼·지연조회)만 변경.
MIG-GATE 무대상(본 hotfix). 정본 인덱스/RPC 는 §5 별도 db_change 후속.

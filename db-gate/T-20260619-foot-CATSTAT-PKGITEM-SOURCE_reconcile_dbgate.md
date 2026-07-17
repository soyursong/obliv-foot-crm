# T-20260619-foot-CATSTAT-PKGITEM-SOURCE (reconcile / FIX batch2 재이식) — db-gate 증거

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD, foot 단일 Supabase)
- **표준**: Migration Ledger Reconciliation (정본=prod 실재) + Migration Dry-Run No-Persistence Protocol v1.0
- **신규 마이그**: `20260717190000_foot_stats_by_category_pkg_created_reconcile.sql` (+ `.rollback.sql`, `.dryrun.mjs`)
- **격리(기존)**: `20260619010000_foot_stats_by_category_pkg_created.sql.SUPERSEDED` (부활 금지)
- **실측 시각**: 2026-07-17 KST (Management API `/database/query`, read-only)

## 0. FIX-REQUEST 대비 base 정정 (중요)

FIX-REQUEST(MSG-20260717-233131-u5ky)는 base 를 "**20260706120000(R5) 이후**" 로 지시했다. 실측 결과:
- **R5(20260706120000, iv-exclude+created_at)** = prod ledger 미등재 + prod prosrc 에 iv 필터 부재 = **prod 미적용(parked)**.
- 실제 prod live = 그 이후 적용된 **`20260715140000_foot_stats_revenue_attrib_axis_unify`** (ledger 등재 확인).
  - `single_paid` 귀속축이 `created_at` → **`accounting_date`** 로 전환됨.
  - `pkg_used` 는 `session_date` 기준 + **iv-exclude 없음**.
- → FIX-REQUEST 의 "iv-exclude(session_type<>'iv')" 전제는 R5(미적용)를 가리킨 것. **본 마이그는 R5 파일이 아니라 실제 prod live(20260715140000)를 base 로 재이식**했다. planner FOLLOWUP 로 이 divergence 별도 보고.

## 1. 정본 확정 (현행 prod live prosrc)

| 항목 | 실측 |
|------|------|
| prod live `foot_stats_by_category` prosrc md5 | `623999a0e12998f2080b976d3c938731` |
| pkg_used 브랜치 | `package_sessions.session_date`, **iv-exclude 없음** |
| single_paid 브랜치 | `payments.accounting_date` (created_at 아님) |
| 시그니처 | `TABLE(category text, sessions bigint, amount bigint)` |
| ledger `20260717190000` (본 신규) | 미등재(신규 timestamp, collision 없음) |
| ledger `20260717180000` | ✋ **이미 점유**(`foot_checkin_sync_reservation_broaden`) → 본 마이그 timestamp 를 190000 으로 조정 |

## 2. 변경의 전부 (base = 위 정본)

- `pkg_used` CTE → **`pkg_created` CTE** 교체 (packages 항목 컬럼 CROSS JOIN LATERAL unnest, `contract_date` 기준, 금액=`sessions*unit_price`).
- `single_paid` = **accounting_date 축 그대로 보존**(20260715140000). 되돌리지 않음.
- 시그니처/`unioned`/최종 SELECT/GRANT = prod 그대로.
- `foot_stats_therapist_summary` / `foot_stats_revenue` / `foot_stats_consultant` = **무접점**.

## 3. (point-2) iv-exclude 정합 재검토

| | 필터 걸림점 | 의미 |
|--|------------|------|
| 현행 prod live pkg_used | (없음) | iv 소진회차가 현재 카테고리 통계에 **포함** |
| 본 마이그 pkg_created | `item.category <> 'iv'` | 패키지 생성 시 iv 품목행 자체 배제 |

- 소스 전환(소진 session_type → 생성 품목)과 함께 iv 제외 걸림점도 **소진 이벤트 → 생성 품목 컬럼(iv_sessions/iv_unit_price)** 으로 이동.
- ★ **순변화**: 현행 prod live 패키지 브랜치엔 iv 필터가 없으므로, 본 마이그는 소스전환과 동시에 **패키지 브랜치에 iv-exclude 를 신규 도입**한다(원 아티팩트 20260619010000·티켓 AC3·DA sg37 의 iv 제외 요구 보존). single_paid 는 기존/신규 모두 iv 미배제 = 무변경. iv 제외는 '패키지 브랜치에서만' 걸린다.

## 4. PROD dry-run (무영속, No-Persistence Protocol)

러너: `20260717190000_..._reconcile.dryrun.mjs` (inline SELECT, 함수 미생성, DDL 0).

| 검증 | 결과 |
|------|------|
| pre-probe prosrc md5 | `623999a0e12998f2080b976d3c938731` (기대 base 일치) |
| post-probe prosrc md5 | `623999a0e12998f2080b976d3c938731` (동일) |
| **non-persistence** | ✅ pre==post → prod 함수 무변경(write 0) |
| 시그니처 불변 | ✅ NEW inline 반환 = 3컬럼(category text, sessions bigint, amount bigint) |
| iv-exclude 정합 | ✅ NEW 결과 category='iv' 행 부재(3개월 전수) |

### 4.1 소스 전환 숫자 이동 (read-only, 오블리브의원 서울오리진점 74967aea…)
| 월 | Σ매출 신(생성/booking) | Σ매출 구(소진/performance) | 비고 |
|----|------------------------|----------------------------|------|
| 2026-05 | 56,309,180 | 54,869,180 | booking≠performance = 의도된 차이(G2) |
| 2026-06 | -41,410,890 | -47,450,890 | 〃 (환불월 음수) |
| 2026-07 | 158,227,360 | 12,618,360 | 대량 신규 패키지 판매 반영(생성기준) |

→ 숫자 이동은 KPI 귀속단위 변경(김주연 2-A confirm) 의도대로. **테이블/데이터 변경 0.**

## 5. MIG-GATE 4필드

- **mig_files**: `supabase/migrations/20260717190000_foot_stats_by_category_pkg_created_reconcile.sql` (+ `.rollback.sql`, `.dryrun.mjs`). SUPERSEDED 격리(부활금지): `20260619010000_*`.
- **mig_dryrun**: No-Persistence Protocol PASS — pre/post prosrc md5 동일(`623999a0…`), 함수 write 0, 시그니처 3컬럼 불변, iv-exclude 정합(iv 행 0), 3개월 숫자 대조 캡처(§4.1). 러너 `.dryrun.mjs` 동봉.
- **mig_ledger_check**: 신규 timestamp `20260717190000` = ledger 미등재(collision 없음). ⚠ `20260717180000` 은 `foot_checkin_sync_reservation_broaden` 로 이미 점유 → 190000 채택. R5(20260706120000)·구 아티팩트(20260619010000)는 ledger 미등재·prod 미적용 → db push 로 SUPERSEDED 재실행 금지. 원장 동기화는 supervisor 소관.
- **mig_rollback**: `20260717190000_*.rollback.sql` — 직전 현행 prod live(20260715140000: pkg_used no-iv + single_paid accounting_date)로 복원. R5 로 되돌리지 않음(R5 미적용이었으므로). 시그니처 불변, 42P13 불가.

## 6. 게이트

- **G1 김주연 2-A confirm** = ✅ 해소(2026-06-19T07:59, MSG-20260619-075306-ptb0).
- **G2/G3 known-limit 주석** = ✅ 마이그 본문 반영.
- **DA CONSULT-REPLY** = GO_WARN(sg37) 기수신.
- **supervisor DDL-diff + prod 적용** = ▶ 대기(비파괴·시그니처 보존 body-only, CREATE OR REPLACE 1종).
- **planner FOLLOWUP** = base 정정(R5 미적용, 실제 base=20260715140000, iv-exclude 순도입) 보고 예정.

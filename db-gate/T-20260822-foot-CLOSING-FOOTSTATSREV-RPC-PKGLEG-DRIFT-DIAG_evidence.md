# T-20260822-foot-CLOSING-FOOTSTATSREV-RPC-PKGLEG-DRIFT-DIAG — Phase-1 DIAG 증적

- **분류**: read-only DIAG (write0 / DDL0). 인증컨텍스트 = service (Supabase Management API `/database/query`, read-only).
- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase). clinic = `74967aea-a60b-4da3-a0e7-9c997a930bc8`.
- **재현 스크립트**: `scripts/T-20260822-foot-CLOSING-FOOTSTATSREV-RPC-PKGLEG-DRIFT-DIAG_introspect.mjs`
- **작성**: dev-foot / 2026-08-22
- **부모**: T-20260822-foot-CLOSING-STAFFREV-AUGUST-ALLSTAFF-RECONCILE (SECONDARY drift)

---

## 결론 (TL;DR)

**deployed drift 실재 확정.** 배포된 `foot_stats_revenue` prod 본체는 sim 제외 술어에
`(c.is_simulation IS TRUE **OR c.is_test IS TRUE**)` 를 both leg(single·pkg)에 걸고 있으나,
**repo 의 최신 선언 마이그(`20260719140000`)에는 `c.is_simulation IS TRUE` 만 존재**한다.
`is_test` 분기를 넣은 마이그레이션 파일은 **repo 에 부재**하며, `schema_migrations` 원장에는
repo 에 없는 버전 `20260719160000` 이 등재돼 있다(orphan ledger row). = **prod ≠ repo-file 선언
divergence** (Migration Ledger Reconciliation 표준 대상).

8월 발산의 **유일 진원 = `is_test` 축 비대칭**:
- 배포 RPC = is_simulation **OR is_test** 고객 결제 제외.
- `staffRevenue.ts`(SSOT S) = `getSimulationCustomerIds` 가 `is_simulation` **만** 필터(= `is_test` 미제외).
- 8월 `is_simulation` 고객 = **0건** → is_simulation 축은 no-op. 발산 전량이 `is_test` 에서 발생.

---

## AC1 — 3자 대조 (prod pg_proc ↔ migration 파일선언 ↔ schema_migrations 원장)

| 소스 | single leg sim술어 | pkg leg sim술어 | 비고 |
|------|----|----|----|
| **prod live `pg_get_functiondef`** | `is_simulation IS TRUE OR is_test IS TRUE` | `is_simulation IS TRUE OR is_test IS TRUE` | `provolatile=s`(STABLE), `prosecdef=false` |
| **repo `20260719140000...sql`**(최신 선언) | `is_simulation IS TRUE` | `is_simulation IS TRUE` | `is_test` 없음 |
| **schema_migrations 원장** | — | — | `20260719140000` 등재 O · `20260719160000` 등재 O(**repo 파일 부재**) |

- repo 전 마이그 grep: `foot_stats_revenue` AND `is_test` **동시 포함 파일 0건**.
- ledger `20260719160000` → `ls supabase/migrations/20260719160000*` = **ABSENT**.
- ∴ 배포 본체의 `is_test` 술어는 **out-of-band(파일 미커밋) 적용**분 = deployed drift 확정.

## AC2 — 패키지 leg gross/refund divergence 지점 (8월, accounting_date)

| 값 | staffRevenue.ts 산식 재현 | 배포 RPC 실호출 | Δ (S − RPC) |
|----|----|----|----|
| pkg gross | 546,587,000 | 535,867,000 | **+10,720,000** |
| pkg refund | 66,330,000 | (pkg분) 60,410,000 | **+5,920,000** |
| pkg net | 480,257,000 | 475,457,000 | **+4,800,000** |

- `is_test`(AND NOT is_simulation) 고객 8월 pkg leg = gross **10,720,000** / refund **5,920,000** / 5행
  → Δ 전량과 **정확히 일치**. (ticket 관찰치 gross −10.72M / refund −5.94M 재현.)
- single leg `is_test` = gross 38,900 / refund 19,800 → ticket "단건 ±39k" 재현(미미).
- 축 무관 확인: pkg gross acct축 546,587,000 = created_at(KST)축 546,587,000 (경계 무영향).
- `is_simulation` 8월 = **0건**(sim_rows=0, sim_pay=0) → is_simulation 필터는 양측 모두 no-op.

## AC3 — staffRevenue.ts 헤더 'foot_stats_revenue 정합' 8월 패키지 미성립 원인

**원인 = sim 제외 축 불일치(필터 축, is_test 누락). 산식/기간축/환불처리 아님.**
- `staffRevenue.ts` 헤더(FIX-2A)는 status 필터(`NOT IN cancelled/deleted`)만 foot_stats_revenue 와
  통일했다고 주장하나, **sim 제외 축은 대조하지 않았다.**
- `simulationFilter.getSimulationCustomerIds` = `.eq('is_simulation', true)` **단일 축** → `is_test` 고객 미포함.
- 배포 RPC 는 `is_simulation OR is_test` 를 제외 → 8월 `is_test` 5건(pkg) 이 S 에만 잔존 → 정합 붕괴.
- 8월에 `is_simulation`=0 이라 status·is_simulation 정합 주장은 우연히 성립처럼 보였고, `is_test`
  케이스가 생기며 발현(재발 위험: is_test 고객이 있는 어느 월이든 재현).

---

## 게이트 / 후속 (blind-fix 금지)

`foot_stats_revenue` = **cross-CRM 공유 RPC(foot/women/body/scalp2)** → 수정 시 **DA CONSULT 필수**.
아래 2개 축 모두 canonical 판정이 DA 소관 (dev 임의 선택 금지):

1. **canonical sim-exclusion 축**: 총매출 KPI 에서 `is_test` 고객을 (a) 제외(현 배포 RPC) 인지
   (b) 포함(현 staffRevenue) 인지 — DA 확정 후:
   - (a)이면 → `staffRevenue.ts`/`getSimulationCustomerIds` 에 `is_test` 제외 추가(S 를 RPC 에 맞춤).
   - (b)이면 → RPC 에서 `is_test` 분기 제거(공유 RPC 4-CRM 영향 → DA + supervisor money-path gate).
2. **ledger drift 정본화**: out-of-band `20260719160000`(is_test 추가)을 repo 마이그로 역커밋(정직 수렴)
   또는 반영구 divergence 로 등재 — Migration Ledger Reconciliation 표준.

RPC 수정 확정 시: 별도 fix 티켓 승격 → **supervisor money-path code-gate + GO-token** 선행.

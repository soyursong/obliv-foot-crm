# T-20260806-foot-TESTTID-479470-PERSEAT-REGISTER-ENABLE — AC-1 CENSUS (dev-foot, READ-ONLY)

**Date**: 2026-08-06 · **Author**: agent-fdd-dev-foot · **Scope**: obliv-foot-crm
**Change to prod/registry in this artifact**: **NONE** (read-only census — ⛔ registry write gated on DA GO, AC-2).
**Commit**: (see git) · **repo**: /Users/domas/GitHub/obliv-foot-crm

---

## AC-1 결론 (등록 목록 실 저장/판정 경로 확정)

**PERSEAT-TID-REGISTRY-GATE(8/5 배포)가 소비하는 "등록 목록" = `redpay_terminal_registry` 테이블의
`(tid ∪ unnest(superseded_tids))` 집합, predicate `WHERE domain='foot' AND active=true`.**

- **별도 per-seat 저장소 아님.** per-seat localStorage(`cband.terminal.config`)는 *해당 seat 자신의 TID 설정값*과
  override 플래그(`cband.tid.gate.override`)·seat id(`cband.seat.id`)만 보관. **allowlist(등록 목록) 자체의 정본은 registry DB.**
- 판정 코드: `src/lib/cband/tidRegistryGate.ts`
  - `loadRegistryTidAllowlist()` = `supabase.from('redpay_terminal_registry').select('tid,superseded_tids').eq('domain','foot').eq('active',true)`
  - `buildRegistryTidSet()` = trim·drop-empty·dedup, `tid ∪ unnest(superseded_tids)` (EF `loadRegistryTids()`와 동일 규칙, 코드 주석에 명시).
  - `checkSeatTidRegistered()` → `registered` / `unregistered` / `unknown`(degrade-open).

### registry 스키마 — `is_test`/test-marker 컬럼 **부재 확인**
`redpay_terminal_registry(clinic_id, domain, merchant_id, tid, terminal_label, active, source, verified_at, superseded_tids)`
(mig `20260711140000_redpay_terminal_registry_ssot.sql` + Opt-B′ `20260724170000` `superseded_tids text[]` ADD COLUMN).
UNIQUE 제약 = `UNIQUE(merchant_id)`. **`is_test`·`is_simulation` 컬럼 전역 부재** (grep 0건).

---

## ★방화벽 핵심 발견 — 게이트 predicate = 정산 소비 predicate (동일)

`tidRegistryGate.ts`는 `redpay-reconcile/index.ts loadRegistryTids()`와 **완전히 동일한 predicate**를 재사용한다
(코드 주석 명시: "★redpay-reconcile/index.ts loadRegistryTids() 와 동일 predicate 재사용").
따라서 **registry에 470을 `active=true`로 넣으면 PERSEAT 게이트에서 선택 가능해지는 것과 동시에
아래 정산/대사 소비처 전부에도 자동 편입**된다 → 부모 REDPAY-INVISIBLE이 봉인한 '정산 사각 오경보' 재생산.

### registry(domain='foot', active) 소비처 전수 (전부 `active=true` 키, **is_test 필터 0**)

| # | 소비처 | 파일 | predicate | 470 편입 시 영향 |
|---|--------|------|-----------|------------------|
| 1 | **PERSEAT 게이트 (FE)** | `src/lib/cband/tidRegistryGate.ts` | domain=foot·active, tid∪superseded | ✅ *이게 목표* — 470 선택 가능화 |
| 2 | **Plan-B 카드결제 기록 RPC** | `supabase/migrations/20260802061500_foot_record_planb_card_payment_rpc.sql` L133-140 | domain=foot·active, MERNO ∈ tid∪superseded (cross-tenant 격리 게이트) | ⚠ 470이 active 아니면 **결제 기록 자체가 거부됨** → active=false(옵션c) 단독은 enablement 불가 |
| 3 | **reconcile EF matcher** | `supabase/functions/redpay-reconcile/index.ts` `loadRegistryTids()` | domain=foot·active, tid∪superseded | ⚠ 470-scoped payments가 Tier1/2 매칭 대상에 편입 → RedPay 사각(feed 0)이라 매칭 실패 → spurious `missing_in_crm`/unreconciled |
| 4 | **v_redpay_reconciliation_daily 뷰** | `20260724170000_...optbprime` (recon view) | merchant∈registry active AND tid∈tid∪superseded | ⚠ 470이 정산 대사 화면에 '예상 단말'로 열거 → 활동0 = 오경보 |
| 5 | **미등록회선 digest EF** | `20260803160000_redpay_unregistered_line_digest.sql` | domain=foot·active 대조 auto-resolve | 470이 registry에 있으면 digest에서 resolved 처리(중립) |
| 6 | **installverify classify** | `20260803235500_foot_redpay_installverify_classify` | merchant∈active AND tid∈active | 470 편입 시 분류 대상 |
| 7 | **A11/A12 recon probes** | `~/ops/etl/recon/*` (DA 소유, tid∪superseded 열거) | domain=foot·active | 470이 registry-side 대사 baseline에 편입 |

**결론**: 게이트(#1)·Plan-B RPC(#2)는 470을 *허용*해야 하고, 정산/대사(#3~#7)는 470을 *배제*해야 한다.
현 스키마엔 이 둘을 가르는 축(is_test 등)이 **없다** → 저장방식 = DA 결정(AC-2).

---

## 저장방식 후보 3종 — 소비처별 영향 (DA 결정 대상, dev-foot 미결정)

| 후보 | 게이트#1·RPC#2 (470 허용) | 정산/대사#3~7 (470 배제) | change-class | 비고 |
|------|---------------------------|--------------------------|--------------|------|
| **(a) is_test ADDITIVE 컬럼 + active=true** | 자동 허용(active 키 그대로) | 각 소비처 predicate에 `AND is_test IS NOT TRUE` 추가 필요(#3~#7) | ADDITIVE 컬럼 1(DDL) + 소비처 predicate 개정 | cross-CRM is_test canonical DA-20260616-LEADS-ISTEST 선례. #1·#2는 개정 불요(470 허용이 목표). |
| **(b) 별도 test-allowlist(테이블/도메인)** | 게이트#1·RPC#2가 registry active ∪ test-allowlist union read하도록 개정 | 정산 소비처는 registry active만 read(무개정, 격리 자동) | 신규 테이블 or domain marker + #1·#2 union read | 정산 소비처 무접점(가장 강한 격리) but #1·#2 read-path 개정. |
| **(c) active=false + test-marker** | ⚠ #1·#2가 `active=true`만 read → **470 미허용**. #1·#2를 `active OR is_test`로 개정해야 함 | active=false라 #3~7 자동 배제 | marker 컬럼 + #1·#2 predicate 개정 | 정산 배제는 공짜이나 enablement 위해 #1·#2 개정 필요 = (a)의 거울상. |

**공통 필수 축 2개** (어느 후보든 DA가 명시해야):
1. **enumeration 축** — 정산 대사 뷰/digest/A11이 470을 '예상 단말'로 열거하지 않을 것(오경보 방지).
2. **recorded-payment 축** — 만약 test 결제가 Plan-B RPC로 payments에 기록되면(merchant_no=470),
   reconcile matcher가 그 행을 `missing_in_crm`/unreconciled로 오경보하지 않도록 test-scope 배제.
   (RedPay 사각 = feed 0이므로 470 raw_transaction은 애초 미적재 → 뷰 데이터 축은 자연 격리되나,
   **CRM-side payments 행**은 별개 축.)

---

## dev-foot 게이트 상태

- **db_change = true (잠정)** — 후보 (a)/(c)면 ADDITIVE 컬럼 = DDL, (b)면 신규 테이블. 어느 경우든 신규 스키마 → §S2.4 데이터 정책 자문 게이트.
- **⛔ DA CONSULT 미해소 → registry write / 마이그 작성 / deploy-ready 전면 금지** (Q-gate Q2, AC-2 하드가드).
- 다음 스텝: DA CONSULT 발주 → 티켓 blocked/dependency → DA GO(ADDITIVE 저장방식 확정) 후 AC-3 착수.

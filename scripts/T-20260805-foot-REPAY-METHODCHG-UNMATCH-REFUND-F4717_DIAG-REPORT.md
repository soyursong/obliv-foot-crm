# T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717 — Phase A 진단 리포트

**작성**: dev-foot / 2026-08-05 · **범위**: Phase A READ-ONLY 진단 (⛔ prod WRITE/DELETE 0)
**제보**: 김주연 총괄 긴급 최우선 (MSG-20260805-133517-o8v2)
**대상**: 현은호 / 차트 **F-4717** / customer_id=`6412fbf7-8a53-4d49-af7a-491e1d731b4c` / clinic=`74967aea…930bc8`
**패키지**: `9455ca84-5798-413b-bd45-7457616d7f55` "24회권" 5,760,000원, **현재 status='refunded'** (updated_at 2026-07-28 02:17:33)

증적 러너(무영속 SELECT):
- `scripts/T-20260805-…-F4717_diag.mjs` (AC-1/2/3 원장 재구성)
- `scripts/T-20260805-…-F4717_census.mjs` (AC-4 재발 census)

---

## 결론 요약 (TL;DR)

현은호는 24회권(5,760,000)을 **분할결제**(카드 4,500,000 + 이체 1,260,000)로 원장①(`package_payments`)에 결제했다.
7/28 02:17 두 leg 전액을 **환불**(원장①에 refund 2행) → net=0 → RPC가 `packages.status`를 **'refunded'로 전이**.
그 직후 02:21:58 **결제수단 변경 재결제**(카드 단건 5,760,000)가 발생했으나, **원장②(`payments`, package_id=NULL)에만 착지**했다.

→ 패키지 status를 파생하는 RPC는 **원장①만** 보므로 net=0 그대로 → **status가 'refunded'에 고착**.
재결제 5,760,000은 원장②에 존재·VAN 대사까지 완료(reconciled)됐으나 **패키지와 어떤 키로도 링크되지 않음(package_id=NULL)** = "매칭 안 됨"의 실체.

**RC = ① 원장 분열(package_payments ↔ payments, 후자는 package_id 상시 NULL) + ② 역전이(refunded→active) 코드 전무.**
**4-Tier VAN 매처(matcher.ts)는 무관·정상 작동** (재결제 5,760,000 → external_trxid K104753583726… reconciled 02:23:29).

---

## AC-1 · F-4717 결제/환불 전 이벤트 원장

### 원장① `package_payments` (RPC net_paid = packages.status 구동)
| 시각(UTC) | type | amount | method | parent | 비고 |
|---|---|---|---|---|---|
| 07-20 05:17:55 | payment | 4,500,000 | card | — | 원결제 leg1 (영수증 업로드) |
| 07-20 07:03:00 | payment | 1,260,000 | transfer | — | 원결제 leg2 (분할 이체 정본화) |
| 07-28 02:17:33 | **refund** | 4,500,000 | card | →leg1 | 전액환불 leg1 (created_by 77ef3500) |
| 07-28 02:17:33 | **refund** | 1,260,000 | card | →leg2 | 전액환불 leg2 (created_by 77ef3500) |

→ 원장① **net_pp = 5,760,000 − 5,760,000 = 0**. (링크 체인 parent_payment_id 정상)

### 원장② `payments` (VAN 대사 원장 · 이 고객 5행, **전부 package_id=NULL**)
| 시각(UTC) | type | amount | method | package_id | external_trxid | reconciled_at | 비고 |
|---|---|---|---|---|---|---|---|
| 07-20 06:32 | payment | 8,800 | card | NULL | 0720C7835749 | 07-20 06:34 | 무관(소액) |
| **07-28 02:21:58** | **payment** | **5,760,000** | **card** | **NULL** | **K10475358372607281100443…** | **07-28 02:23:29** | **★재결제(결제수단변경 단건 카드)** |
| 07-28 10:37 | payment | 1,400 | card | NULL | — | — | 무관(소액) |
| 07-28 10:37 | payment | 240,000 | card | NULL | — | — | 별건 |
| 07-28 10:38 | refund | 240,000 | card | NULL | — | — | 위 240,000 환불(linked) |

→ 재결제 5,760,000은 **payments(원장②)에 실재하며 VAN 대사까지 성공**. 그러나 package_id=NULL, package_payments에도 대응행 없음.

---

## AC-2 · 원결제→환불→재결제 3자 재구성 + 패키지 '환불' 판정근거

- **판정 필드/뷰**: `packages.status` **컬럼 직접 구동**(파생 뷰 없음 — `information_schema.views`에서 package/refund 관련 뷰 0건). FE `src/pages/Packages.tsx` 배지 = `status==='refunded' ? 'destructive'` 로 status 그대로 표시.
- **status='refunded' 판정 경로**: `refund_package_payment(p_payment_id, p_method)` RPC (`20260714200000_…rpc.sql`, 현행 `20260727210000_…created_by.sql`).
  - `net_paid = Σ(payment) − Σ(refund)` **over package_payments only** (원장①).
  - `IF v_net_paid <= 0 AND v_pkg.status='active' THEN UPDATE packages SET status='refunded'` (L123–125).
- **3자 재구성**: 원결제(원장① 5.76M split) → 환불(원장① 5.76M, net→0, status→refunded) → **재결제(원장② 5.76M, package_id=NULL)**.
  재결제가 status 파생축(원장①)과 **다른 원장**에 있으므로 net_pp는 0에 머물고 status는 refunded로 남는다.

---

## AC-3 · 매칭 실패 RC (systemic vs 국소)

**RC(2중 구조):**
1. **원장 분열(구조적·systemic 소지)**: 패키지 구매/환불은 `package_payments`(원장①)에, 수납(check-in) 결제는 `payments`(원장②)에 적재. **원장②는 전 554행 package_id=NULL**(pkgid_set=0) — 설계상 payments는 패키지와 FK 링크를 갖지 않음. 결제수단 변경 재결제가 수납 경로로 처리되면 원장②에 착지 → status 파생축(원장①)에서 구조적으로 불가시.
2. **역전이 전무**: 코드베이스 내 모든 `UPDATE packages SET status` 는 `→ 'refunded'`(또는 transferred/cancelled/completed). **`status='active'` 복원 경로가 어디에도 없음**(grep 전수). 설령 재결제가 원장①에 들어왔더라도 refunded→active 자동복원은 안 됨(가드 `v_pkg.status='active'`가 단방향 고정).

**systemic vs 국소 판정**: **RC 조건(원장 분열·역전이 부재)은 systemic**이나, **현재 실발현은 F-4717 국소 1건**(AC-4). 재결제가 원장②로 새는 경로 + 역전이 부재가 상존하므로 재발 가능성은 systemic. Phase C forward-fix 대상.

**4-Tier 매처/redpay 무관 확증**: 재결제 5,760,000은 VAN 4-Tier 매처가 정상 reconcile(external_trxid 부여·reconciled_at 02:23:29). 본 결함은 matcher.ts 대사층이 아니라 **패키지↔결제 원장 링크·status 파생층**의 문제 → **matcher.ts SSOT 무접점**.

---

## AC-4 · 재발 census (READ-ONLY)

`status='refunded' & package_payments net≤0` 패키지 **6건** 중, 환불 직후 원장②에 package_id=NULL 재결제 후보(≥100,000)가 있는 = **F-4717형 = 1건뿐**:

| 차트 | 고객 | 패키지 | 환불총액 | 오펀 재결제 후보 | 판정 |
|---|---|---|---|---|---|
| **F-4717** | 현은호 | 24회권 | 5,760,000 | **2건 / 6,000,000** | ★본건(재결제 5.76M + 별건 240K) |
| F-4790 | 박민석 | 36회권 | 10,000 | 0 | 정상환불 |
| F-5014 | 정미자 | 1 | 800,000 | 0 | 정상환불 |
| F-4550 | 이영수 | 12회권 | 2,940,000 | 0 | 정상환불 |
| F-4814 | 이인숙 | 무좀체험권 | 10,000 | 0 | 정상환불 |
| F-4646 | 박형규 | 무좀체험권 | 10,000 | 0 | 정상환불 |

- **F-4717형 실발현 = 1명(현은호)**. 나머지 5건은 재결제 없는 진성 환불(정상).
- **원장 분열 규모(광의)**: `payments` payment행 554건 **전부 package_id=NULL** — 원장② ↔ 패키지 링크는 구조적으로 0. (재발 방지의 핵심 축.)

---

## ★조율 의무 (같은 매처 SSOT 공유 티켓)

- **PLANA-PG-REDPAY-DUP-VERIFY (P0, over-match/double-count)**: 본건 RC는 **matcher.ts 4-Tier / redpay_macstudio_poller 대사층이 아님**(VAN 대사는 정상). Phase B/C 정정은 matcher.ts 무접촉 → **SSOT 충돌 없음**. DUP-VERIFY의 매처 튜닝과 독립.
- **REDPAY-PLANA-REATTACH-DORMANTGAP-GUARD (dedup guard: '동일금액·동일일자 payment 존재 시 auto-create 금지')**: 본건 재결제는 **이미 실재**(원장② payments). 정정은 payment **auto-create가 아니라** (a)기존 재결제↔패키지 링크 복원 또는 (b)packages.status 복원이어야 함 → **guard와 양립**. ⚠ **비파괴 note**: Phase B/C에서 원장①에 재결제 미러 payment를 auto-create하면 guard의 dedup 취지 위배 + 이중계상 위험 → **미러 생성 금지**, cross-ledger 근거 기반 status 복원/링크로 해소할 것.

---

## Phase B/C 권고 (착수 금지 — planner 게이트 대기)

- **Phase B (F-4717 1건 정정)**: DA CONSULT(원장 링크·status 복원 정책) + 김주연 per-row confirm + supervisor dry-run + Data-Correction Backfill SOP(archive-first·freeze 1행). 정정 방향 후보: 재결제 5,760,000 실재 근거로 packages.status를 active 복원(회차 소진/양도 상태 별도 확인). 원장① 미러 payment auto-create 금지(guard·이중계상).
- **Phase C (근본 forward-fix)**: ① 결제수단 변경 재결제 경로가 패키지 결제일 때 `package_payments`(원장①)에 반영되거나 payments.package_id 링크를 채우도록 배선, ② refunded→active 역전이 로직 신설(net_paid>0 회복 시). AC-3 systemic 확인 → 자식 티켓 분리.

**DB 변경**: 없음(Phase A 전량 READ-ONLY SELECT). DA CONSULT: Phase B/C에서 필요(신규 상태전이·링크 정책 → 데이터 정책 게이트).

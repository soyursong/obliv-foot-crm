# HARD CENSUS (C1~C5) — T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX (Phase C)

- **owner**: dev-foot · **type**: READ-ONLY census (prod WRITE/DDL = 0, mutation 0)
- **SSOT**: DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX (GO 조건부·census-gated)
- **선행**: parent Phase A diag (commit 49fb14946fe4, READ-ONLY) — 원장분열 RC 확정
- **GO-finalize 판정**: **census 통과 · 재-CONSULT 트리거 0건 hit → DA GO finalized**
- **date**: 2026-08-05

---

## 프레이밍 (DA §0 계승)
status 오표시 = 매출 undercount 버그의 status-축 판본(동일 2-원장 blindness). 3축 직교:
결제수단(instrument) ⊥ 매출인식(payments+pkgpay net·§7-3 불변) ⊥ status/entitlement(=f(cross-ledger net_paid)·본 fix). 매출 인식 축 **무접촉**.

---

## C1 — net_paid 파생 site 전수 + status 소비처 (원장①-only 확인)

**net_paid → packages.status='refunded' 파생 지점 = refund RPC 계열뿐:**
- `supabase/migrations/20260727210000_foot_package_payments_created_by.sql` L135-142 **(현행 latest)**
  ```sql
  SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END),0)
    INTO v_net_paid
  FROM package_payments                        -- ★원장①(package_payments) ONLY
  WHERE package_id = v_orig.package_id;
  IF v_net_paid <= 0 AND v_pkg.status = 'active' THEN
    UPDATE packages SET status = 'refunded' WHERE id = v_orig.package_id;   -- 단방향
  END IF;
  ```
  → **이 SELECT 1개가 blindness 지점.** 원장②(payments)의 결제수단-변경 재결제에 구조적 blind.
- 선행 판본(동일 원장①-only 패턴): 20260420000013 L135, 20260603000000 L58, 20260714200000 L123.
- **역전이(refunded→active) 코드: 전무** (grep 확인). status='active'로 되돌리는 write-site 부재.

**paid_amount 재집계 site (전부 원장①-only, 산재):**
- `src/lib/manualPaymentWritePath.ts` L134-141 (package 분기), `src/pages/CustomerChartPage.tsx` L1053,
  `src/pages/Packages.tsx` L1840·1855, `record_planb_card_payment` RPC(20260802061500) L224-227.
  → 전부 `SUM(package_payments) WHERE package_id=...` = 원장①만. **payments 미합산.**

**packages.status 소비처 (열거):**
- display: `PackageTicketReadonlyList.tsx` L102-109 (PKG_STATUS_KO), CustomerChartPage L7528.
- **entitlement (핵심)**: `CustomerChartPage.tsx` L5019·5021·6467·6472·8925-9018 등 `status==='active'` = **회차권 소진 UI/차감 버튼 gate**. status=refunded → 회차권 사용 불가(F-4717 증상).
- report: `v_daily_revenue`(20260718200000) — payments(status=active)+package_payments 환불차감. ★이 status는 **payments.status(결제레벨)** 이지 packages.status 아님(C5 firewall 근거).

---

## C2 (dispositive) — 재결제 write-path가 write 시점 원천 package_id 보유하는가?

**verdict = 有(clean link feasible). 구조적 blind 아님.** → 재-CONSULT 불요.

- 재결제 write-path 2벌 모두 **`packageId` 파라미터 + `'package'` attribution을 이미 노출**:
  - `src/lib/manualPaymentWritePath.ts` — `ManualPayAttribution = {kind:'package',packageId} | {kind:'checkin'} | {kind:'single'}`.
  - `src/lib/recordPlanbCardPayment.ts` / `record_planb_card_payment` RPC — `PlanbAttribution='checkin'|'single'|'package'` + `p_package_id`.
- **원장분열 원인 = write-path 자체가 아니라 라우팅 분기**:
  - `'package'` 분기 → **package_payments(원장①)** 착지(package_id 有). net_paid 자연 회복. ← 정상 패키지 잔금 경로.
  - `'checkin'`/`'single'` 분기 → **payments(원장②) INSERT** 하면서 **package_id 미기록**(memo='영수증 수납'). ← F-4717 재결제가 탄 경로.
    - `manualPaymentWritePath.ts` L146-207(checkin), L200-215(single): payments INSERT payload에 `package_id` 필드 **부재**.
- F-4717은 결제수단-변경 재결제를 **checkin/single 귀속**으로 처리 → payments(원장②) package_id=NULL 착지 → 원장①-only net_paid가 blind → refunded 오표시.
- **clean link 가능**: caller에 package 컨텍스트가 존재(package 선택 UI/attribution 有). fix = checkin/single→payments INSERT 에 **원천 package 컨텍스트에서 package_id 스레딩**(fabricate/guess-match 아님·VG3 충족). DA REJECT(a)(원장 이동) 회피 = payments 존치 + package_id 링크.

> ⚠ 정밀 UX 배선(결제수단-변경 재결제 flow에서 package를 어느 진입점이 surface하는가)은 Phase C 구현 스코프. **capability는 구조적으로 존재**하므로 매칭 휴리스틱(별건 재-CONSULT) 불요.

---

## C3 — cohort 규모 (READ-ONLY prod census, 2026-08-05 재실행)

census 스크립트: `T-20260805-foot-REPAY-METHODCHG-UNMATCH-REFUND-F4717_census.mjs` (SELECT-only).

| 항목 | 값 |
|------|-----|
| refunded & 원장① net<=0 패키지 | **6건** |
| ↳ 오펀 재결제 후보 有 (F-4717 signature) | **1건** (F-4717 현은호) |
| 영향 고객 | 1명 |
| 오펀 재결제 gross | 6,000,000원 (net 매출 5.76M) |
| 나머지 5건 | orphan 후보 **0** = 진성환불 → **refunded 유지(VG5)** |
| payments.package_id NULL 비율 | **554/554 (100%)** — 설계상 전건 NULL(수납=check_in 기반) |

→ **cohort = 1 (F-4717 단독) · small · homogeneous** → 백필 대량/heterogeneous 재-CONSULT 불요.
매칭 = under-correct ≫ over(나머지 5건 auto-link 금지·refunded 유지).

---

## C4 — 역전이 landing: 트리거 vs RPC chokepoint

**verdict = 트리거(양원장 writer-agnostic·신규 ADDITIVE). RPC-재정의 단독 REJECT.**

- payments/package_payments 에 **packages.status 재계산 트리거 부재**(grep 확인). 현존 트리거 = created_at 기본값(sales_common), pos_response PCI guard, payment_sync_outbox emit — **status 무접촉**.
- 재결제는 **payments INSERT(원장②)** 로 착지하며 `refund_package_payment` RPC를 **거치지 않음**.
  → refund_package_payment 재정의(C19)만으로는 **원장② 착지(F-4717 재결제)를 auto-heal 불가**. RPC는 환불 시점에만 발화.
- ∴ writer-agnostic 파생 = **payments AND package_payments 양쪽 write에서 발화하는 트리거**가 유일 정답.
  선례 정합: v2.73 TRIGGER CHOKEPOINT(다수 write-site → 트리거 값 불변식), VG4(원장① AND ②).
- 트리거 recompute: `packages.status = f(net_paid_crossledger)`,
  `net_paid_crossledger = Σ package_payments(net for pkg) + Σ payments(net WHERE package_id=pkg)`.
  진성복원(net>0) → active / 진성환불(net<=0) → refunded. **결정적 양방향.**
- 산재 paid_amount 재집계도 트리거 chokepoint로 수렴 가능(선택·drift 제거) — 최소 스코프는 status만.

---

## C5 — 매출 firewall (status ⊥ 매출·이중계상 0)

**verdict = firewall INTACT.**
- `v_daily_revenue` = payments(**payments.status**=active) + package_payments, 환불차감. 매출은 **이미 양원장 합산**.
- packages.status(패키지-레벨) ≠ payments.status(결제-레벨) → **packages.status 변경은 매출뷰 무영향**.
- payments.package_id 세팅 = 순수 link 컬럼. v_daily_revenue는 amount를 package_id 무관 합산 → **재-add/이중계상 0**. 5.76M은 이미 원장②에 계상됨(fix 前後 불변).
- net_paid_crossledger(entitlement 계산) = 매출뷰와 **별개 파생축**. 동일 돈 이중계상 없음(각 원장 net 1회).

---

## verify-gate 사전 판정 (설계 checkable)

| VG | 판정 | 근거 |
|----|------|------|
| VG1 net_paid cross-ledger 정확 netting | ✅ 설계가능 | Σpkgpay(net)+Σpayments(net WHERE pkg) · 역전이=진성복원 시만 |
| VG2 매출 firewall | ✅ | 재계산=packages.status만·payments/pkgpay net 무접촉(C5) |
| VG3 링크 authority | ✅ | package_id=caller 원천 컨텍스트(C2)·guess-match 금지 |
| VG4 single-authority 멱등 | ✅ | 트리거=원장① AND ② writer-agnostic(C4) |
| VG5 무-spurious 복원 | ✅ | 진성환불 5건(orphan=0) refunded 유지(C3) |

## 재-CONSULT 트리거 점검 — **0건 hit**
- 재결제 write-path 구조적 package_id 미보유? → **아니오**(C2 有).
- cohort 대량/heterogeneous? → **아니오**(C3=1·homogeneous).
- net_paid cross-ledger 매출 이중계상 노출? → **아니오**(C5 firewall intact).
- 역전이가 매출-affecting 필드 접촉? → **아니오**(packages.status/paid_amount만).
- CONSULT 절단부(PLANA-PG-RE…=REDPAY-PLANA-REATTACH-DORMANTGAP-GUARD dedup guard) 가시 RC와 divergent? → **아니오**. dedup guard(동일금액·동일일자 payment auto-create 금지)는 DA 설계(기존 payments行 package_id 링크·미러 생성 금지)와 **정합**(비충돌).

---

## forward-fix 설계 요약 (census 확정 기반 · 착수는 planner approved 후)
1. **링크 write-path (코드)**: `manualPaymentWritePath` checkin/single 분기 + `record_planb_card_payment` RPC — 재결제가 패키지 관련일 때 `payments.package_id` = 원천 package 컨텍스트 세팅(컬럼 旣존재·DDL 불요).
2. **양방향 파생 트리거 (신규 ADDITIVE DDL·MIG-GATE)**: payments+package_payments AFTER INSERT/UPDATE/DELETE → `packages.status = f(cross-ledger net_paid)`. refunded↔active 결정적 양방향.
3. **refund_package_payment 재정의 여부(C19)**: 트리거가 status 파생을 인수하면 RPC 내 단방향 status UPDATE는 트리거에 위임/제거(중복 방지) — supervisor function-diff·pre-apply md5 대조.
4. **순서**: source-close(1~3) FIRST → backfill(F-4717 링크 + status·양방향 배포 후 링크만으로 auto-heal 가능·Data-Correction Backfill SOP·freeze 1행·archive-first·re-freeze ABORT).
5. **gate**: §3.1 대표게이트 면제(ADDITIVE) · supervisor DDL-diff/function-diff + C19(RPC 재정의 시) + MIG-GATE(트리거) · 박민지/원장 entitlement light-awareness(non-blocking).

*census 완료 · READ-ONLY · mutation 0 · DA GO finalized · ball → planner(status blocked→approved) → dev-foot forward-fix*

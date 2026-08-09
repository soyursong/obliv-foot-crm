# VG1~VG5 READ-ONLY census evidence — T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI

- **owner**: dev-foot · **date**: 2026-08-09 · **change_class**: DATA_CORRECTION_BACKFILL · **artifact_class**: db_only
- **DA GO**: `agents/docs/da_replies/da_decision_foot_f4741_cis_reinsert_kimgyuri_20260809.md` (HEAD e16841f2f36) verdict=조건부 GO, ball=dev-foot(VG census)
- **gate order**: DA GO → **VG1~VG5(본 census, READ-ONLY)** → freeze-set → 박민지 comp → supervisor DB-GATE dry-run → apply
- **probe**: `scripts/T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI_vg_census.mjs` (SELECT-only, prod write 0)
- **resolved ids**: 김병완 F-4741 customer=`259abd32-d784-4c45-b59e-1ccae1b69492` · clinic=`74967aea-a60b-4da3-a0e7-9c997a930bc8`

---

## VG1 — source-close (PRESERVE-FIX 가 reinsert 라인을 후속 재저장에서 보존) = **PASS (code-proven, conditional)**

RC(부모 DIAG): `PaymentMiniWindow` load 재구성 `svcs.find(s.id===ci.service_id)`(L1344) 이 활성 매칭 실패 라인을 else 없이 silent drop → 재저장 DELETE-all→reinsert 시 영구 소멸.

Forward-fix `T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX`(deployed) = `src/lib/cisPreserve.ts` 3-way MECE partition (`partitionCisSnapshot`), PMW 통합 L2296-2352(주 저장) + L2854-2896(X-close autosave).

**reinsert 라인의 후속 재저장 생존 경로 (2중 안전):**
- **B1 (활성 service_id)**: reinsert 를 활성 풋화장품 service_id 로 하면 → 다음 PMW open 시 load 재구성(L1343-1358)이 `selectedItems` 로 복원 + `seller_staff_id` 를 `sellers` map 으로 복원(L1356) → `setSellerMap`(L1364). 다음 저장 시 `rows=selectedItems.flatMap`(L2314) 로 재구성되며 `seller_staff_id: resolveSellerStaffId(service)`(L2337) = `sellerMap.get(service.id) ?? defaultSellerId`(L2254) → **김규리 귀속 clobber 없이 보존**. partition 상 isLive=true → B1(재구성).
- **B2 (비활성/NULL service_id)**: orphan → `partitionCisSnapshot` 이 `orphanRows` 로 verbatim preserve-reinsert(L2352). 소멸 안 됨.

⟹ 어느 경로든 **재-wipe 안 됨 = source 닫힘 실증**. **conditional**: reinsert 는 **활성 풋화장품 service_id** 로 해야 함(B1 경로 + 아래 VG2 SalesStaffTab 가시성 요건과 동일 제약). moving-target 아님.

## VG2 — SalesStaffTab 집계 소스 = cis-grain 단독 (payments∪cis union 아님) = **PASS (code-proven)**

`src/components/sales/SalesStaffTab.tsx` L398-453: 화장품 매출 컬럼(김규리 73,000 착지처)은 `cosmeticLines` = **`check_in_services`** 쿼리(풋화장품 service_id ∈ active · `voided_at IS NULL` · `price>0`)에서만 파생. 버킷 = `COALESCE(seller_staff_id, check_ins.therapist_id)`(L445). **payments 와 union/합산 아님.**

double-count 방지 능동 집행: 수납기준은 치료 매출에서 화장품분(`cosmeticByTherapist`) 차감(`treatmentRevenue = max(0, revenue - cosmeticDeducted)` L636); 차감기준은 package_sessions 가 화장품 미포함이라 구조적 분리. ⟹ reinsert 는 매출총액 이중계상 불가(payments 무접촉·cis line-귀속만). **VG2 union-위험 없음.**

## VG3 — 3라인 amount 합 == b7ab6496.amount(73,000) = **PASS (prod-confirmed)**

- payment `b7ab6496-9efc-429c-9d5c-60a248eabc15` = **73,000**, status=active, payment_type=payment, accounting_date=2026-08-01, check_in_id=`dec7e6c4-9c8b-4e50-b3dd-c8b6b2fedfbf`, parent_payment_id=null. (parent check_in checked_in_at=2026-08-01T01:02Z=08-01 10:02 KST → SalesStaffTab 8월 date-range 가시)
- 활성 풋화장품 카탈로그 정확 매칭 (fabrication-proof — 카탈로그 실가 일치):
  | 품목 | service_id | price |
  |---|---|---|
  | 풋샴푸 (200ml) | `89095450-223f-4863-89a9-c7f32f62809d` | 42,000 |
  | Care Toe Band (CTB) | `e17ba3a3-4842-4097-87bc-0778a64d2755` | 15,000 |
  | 리페어 핸드크림 (30ml) | `cb6443a3-fe53-40e7-bd51-a4444d8a8966` | 16,000 |
  - 합 = 42,000+15,000+16,000 = **73,000 == b7ab6496.amount** ✓
- (동일 check_in 에 별도 5,200 payment 존재 — 화장품 아님·범위 외.)

## VG4 — reinsert 스크립트 payments write 0 = **설계 제약 (dry-run 에서 실증 예정)**

reinsert 스크립트는 `check_in_services` INSERT 3행 + (필요 시) seller_staff_id attribution write 만. payments 테이블 write 0(신규 payment INSERT 0·amount 변경 0). supervisor DB-GATE dry-run 에서 payments rows-affected=0 POSTCHECK. (아직 스크립트 미작성 — freeze-set 단계 산출.)

## VG5 — seller provenance = **CONDITIONAL / ATTESTATION-REQUIRED (before-image 부재 + 동명이인)**

- **소멸 CONFIRMED**: check_in `dec7e6c4` 현 cis = 재진진찰료(13,370)·비가열레이저(240,000)·손발톱백선(0)·발백선(0)·터미졸크림(0) — **화장품 3라인 전부 부재**. 결제-라인 unlink 확정.
- **before-image 물리 부재**: `check_in_services` archive/audit 테이블 마이그레이션 census = **없음**. 소멸 前 cis 원본(seller_staff_id 포함) 물리 복구 **불가** → DA §3(a) before-image 경로 unavailable → **(b) 현장 attestation 경로 강제**.
- **★ 동명이인 (HARD provenance 게이트)**: clinic 74967aea 에 활성 김규리 **2행** —
  - `3a0c6774-2bd9-4018-bb38-ef6fab75d04b` = 김규리, role=**therapist** (이 환자 designated_therapist + check_in dec7e6c4 therapist_id)
  - `d26717cb-2088-4cde-84d0-8fcd98367bbf` = 김규리, role=**admin**
  - reporter "김규리 **매니저**" 지시 = admin(d26717cb) vs therapist(3a0c6774) 불명. seller_staff_id 는 incentive-bearing → 스크립트-추론 REJECT(DA §3·re-CONSULT #3). **김주연 총괄 attestation 으로 어느 김규리 확정 필수** (thread 1785492540.190029 / C0ATE5P6JTH).
- **품목/금액 provenance**: fabrication-proof (VG3 카탈로그 정확 매칭 + KIMBB-REMOVE closed SSOT '73,000=8/1 유지단건'). 3라인 identity/amount 는 evidentiary floor 충족. **seller identity 만 attestation 미결**.

---

## §7 ADDENDUM 추가 VG READ-ONLY census (DA CONSULT-REPLY MSG-20260809-112911-vnjw)

- **probe**: `scripts/T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI_vg_addendum_census.mjs` (SELECT-only, prod write 0; pg_catalog census = Management API `/database/query` 경유 dryrun_lib.q, information_schema/pg_trigger 조회만)
- verdict 불변(조건부 GO). 추가 VG 4건 전건 PASS·재-CONSULT 트리거(§7-E #7~11) 미발동.

### VG-add-1 (Q2-tail-1) service_charges 무접촉 = **PASS**
- 화장품 3종 service `is_insurance_covered = false` 전건 (풋샴푸200ml/CTB/리페어핸드크림30ml) → PMW `snapshotCoveredServiceCharges`(PaymentMiniWindow.tsx L2442-2513)의 `filter(is_insurance_covered === true)` 에서 **구조적 제외** → 화장품 라인은 service_charges 행 생성 0.
- 게다가 본 backfill = **직접 cis INSERT**(PMW 경로 미경유) → 앱 명세 스냅샷 경로 자체 미실행.
- 부모 check_in `dec7e6c4` 현 service_charges = 6행(전부 기존 치료라인·`is_insurance_covered=false`·금액 0) → 화장품 reinsert 무접촉. insurance-split 축(급여/비급여/공단) 이동 0. **§7-E #7 미발동.**

### VG-add-2 (Q2-tail-3, BLOCKING) outbox emit 결속 = **PASS (결속 없음)**
- prod census: `check_in_services` 결속 트리거 = **0건**(pg_trigger, not tgisinternal) → AFTER INSERT emit/outbox/도파민 push 미결속.
- 대조군 확인: 모든 outbox/역sync/sim 트리거는 **payments 결속**(`trg_enqueue_payment_sync_from_payments`=AFTER INSERT ON payments, `trg_payments_sim_stamp_insert`, `trg_payments_pkg_status_recompute` 등). 코드 census 정합: `payment_sync_outbox`=`AFTER INSERT ON payments WHEN payment`(20260730200000), `dopamine_callback_outbox`=예약/내원 lifecycle 축.
- reinsert = **cis INSERT only·payments 무접촉**(VG4) → 하류 phantom "신규 판매" emit·spurious 알림·cross-CRM fan-out **불발생**. **emit-suppress 경로 불요**(결속 부재). POSTCHECK 에 outbox 신규0/도파민 push0 는 확인차 유지. **§7-E #8 미발동.**

### VG-add-3 (Q3) seller_staff_id 컬럼 실재 = **PASS**
- prod census: `check_in_services.seller_staff_id` = **실재**(uuid, nullable, FK→staff(id) ON DELETE RESTRICT, 20260725120000). 귀속 착지 = 이 정본 컬럼. 대체 컬럼 임의사용/신규 attribution 컬럼 신설 불요. **§7-E #9 미발동.** (착지값=김규리 실 staff UUID는 VG5 attestation 후 확정.)

### VG-add-4 (Q4) evidentiary tier = **Tier 2** (Tier1 부재)
- prod census: cis archive/audit/history/soft-delete 저장 테이블 = **0건** → **Tier1(before-image verbatim) 물리 부재**.
- `voided_at` soft-void 컬럼은 실재하나 **08-05 신설**(20260805110000) → 08-03 hard delete-all wipe 이전 소멸행의 before-image 아님(무효).
- ⟹ **Tier 2 확정**: 라인 identity/단가/수량 = payment-line 지문 + KIMBB-REMOVE 확정 3품목·금액 + 산술폐합 Σ(42,000+15,000+16,000)=73,000==b7ab6496.amount(VG3). DA §7-C acceptable floor 충족(창작 아님).
- **seller_staff_id 는 payment-line 파생 불가** → floor = Tier1(부재) OR 현장 attestation → **attestation-only**(= VG5 human_pending 정합). **§7-E #10·#11 미발동**(필수값 전건 소싱가능·폐합 성립).

---

## 종합
- **VG1/VG2/VG3 = PASS.** **VG-add-1/2/3/4 = PASS**(추가 census, verdict 불변·재-CONSULT 미발동). VG4(payments write 0) = supervisor DB-GATE dry-run POSTCHECK 실증 대기(설계 제약 확정). **VG5 = seller 김규리 동명이인 attestation BLOCKER**(before-image 부재·payment-line 파생불가 → attestation-only, 김주연 총괄 human_pending).
- DA §7 ADDENDUM(MSG-20260809-112911-vnjw) 수신·census 완결 → **DA-측 재-CONSULT 트리거 전건 미발동, verdict 조건부 GO 불변**. 잔여 = **오직 VG5 seller attestation 1건**(김주연 총괄, thread 1785492540.190029 / C0ATE5P6JTH).
- 다음: (1) [primary gate] 김주연 총괄 per-row seller attestation(therapist 3a0c6774 / admin d26717cb 中) → (2) freeze-set(명시 VALUES: check_in `dec7e6c4` + 3 service_id + Tier2 지문 + 확정 seller UUID·per-value provenance tier 기재) → (3) [comp settled 시] 박민지 comp-transparency → (4) supervisor DB-GATE No-Persistence dry-run + POSTCHECK(§2 불변식 + outbox 신규0·도파민 push0·payments rows-affected 0) + GO-token → (5) prod apply(guard chokepoint) → applied_at 기입 → deployed.
- **apply/파괴 write 미착수** (Q-gate Q2·false-signal 회피). deploy-ready 미마킹(attestation·dry-run 미완).

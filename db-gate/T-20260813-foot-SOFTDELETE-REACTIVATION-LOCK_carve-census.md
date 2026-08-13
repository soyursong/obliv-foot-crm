# T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK — CARVE census 2건 (service_charges · staff_attendance)

- 도메인: foot (obliv-foot-crm)
- 성격: **READ-ONLY census · prod write/DDL/DML = 0 · apply 0** (voided_at 신설/reconcile 구현은 supervisor DDL-diff + 물리 GO-token 선행·apply_before_go 금지)
- 상위 지시: planner MSG-20260814-000912-rsyu (DA REPLY MSG-20260814-000358-6osg reply_to vf5f 착지)
- envelope Q3(is_deleted vs deleted_at·233438-2n14/234331-ilot) 잔여 HOLD 와 **독립** (이 census 두 축은 voided_at/reconcile 축)
- census method: `src/**` + `supabase/functions/**` 콜사이트 정적 분석 + 기존 canonical flag/제약/트리거/FK 대조(mirror-not-invent)
- 작성: dev-foot 2026-08-14

---

## ■ Q1 — service_charges = Tier-0 (매출/insurance-split ledger) · 콜사이트별 settlement 경계상태 판정

### C1. 콜사이트 census 결과 (write0)
전체 앱-런타임 `src/**` 에서 `service_charges` 물리 **removal(`.delete()`) 콜사이트 = 정확히 1건**.

| # | 콜사이트 | 함수 | 성격 | 경계 guard |
|---|----------|------|------|-----------|
| 1 | `DocumentPrintPanel.tsx:3161` | `handleDeleteItem(id)` (T-20260513-foot-BILLING-DETAIL-EDIT) | 세부내역서(bill_detail) 편집 UI '항목 삭제' — `service_charges` 라인 1건 hard-DELETE (`.delete().eq('id', id)`) | **없음** (id 지정 무조건 삭제·settlement 경계 미검사) |

- 그 외 `service_charges` 접근은 **전량 read 또는 append-only INSERT**:
  - INSERT(append): `InsuranceCopaymentPanel.tsx:179`, `PaymentMiniWindow.tsx:2576`(snapshotCoveredServiceCharges), `DocumentPrintPanel.tsx:3859`.
  - UPDATE(금액수정, 삭제 아님): `DocumentPrintPanel.tsx:3171`(handleSaveEditItem, base_amount/copayment_amount).
  - read: SalesDailyTab / SalesPatientTab / autoBindContext / footBilling / useEdiExport / PaymentSusuDetailModal / ediExport 등.
- `scripts/*`·`db-gate/*` 의 1회성 cleanup DELETE 는 remediation 레인(Tier-2)·앱 removal surface 밖(orphan_archive_fk_guard_sop 소관).
- **DA 프레이밍 "DocumentPrintPanel.tsx:3161 등" 의 '등'은 앱-런타임에는 부재** — 단일 콜사이트로 확정.

### C2. 저장기전 (pre/post 불변) = B-2 sibling `voided_at` softvoid — verbatim 신설 대상
- `service_charges` 에 기존 soft flag(is_deleted/deleted_at/voided_at) **부재** (테이블 census: T-20260504 insurance_copayment 계열 + 이후 마이그 어디에도 무).
- B-2 sibling 실재 확인 (mirror shape):
  - `check_in_services.voided_at timestamptz NULL` (20260805110000_foot_check_in_services_softvoid.sql) — 라인그레인 softvoid, `.is('voided_at', null)` read 필터 + 원자배포 계약(DDL 선행/동시).
  - `closing_manual_payments.voided_at` (20260802160001_foot_closing_confirmed_edit.sql:201·203·237) — `SET voided_at = now()` softvoid + `voided_at IS NULL` read 술어.
- → **DA §Q1 정합**: `is_deleted` envelope 부적합. census 기존flag 부재이므로 **B-2 sibling shape(`voided_at timestamptz NULL`) verbatim 신설**이 canonical (신규 발명 아님). 저장기전은 pre/post **불변**(둘 다 voided_at); 경계는 reversal-offset leg 필요여부만 결정.

### C3. settlement 경계상태 판정 (콜사이트 :3161)
`handleDeleteItem` 은 경계 guard 없이 `check_in_id` 로 로드된 `service_charges` 행(급여 `is_insurance_covered=true` 명세 + 일반행 혼재)을 id 지정 삭제. 삭제 대상 행이 **매출인식에 이미 기여**하는지 3개 축으로 판정:

| 경계 축 | 실측 근거 | 함의 |
|---------|-----------|------|
| **청구전송(autodraft)** | `trg_service_charges_autodraft` = service_charges **INSERT/UPDATE/DELETE(급여행)** → `fn_build_insurance_claim_draft` (20260811000000_foot_ins_claim_autodraft_b2). 급여행 INSERT 순간 draft claim 파생 | `is_insurance_covered=true` 행은 **삽입 즉시 청구 draft 존재** → post-recognition |
| **수납기록(FK)** | `payments.service_charge_id` = parent C4 canonical 공유 컬럼(20260715160000). payments 가 service_charges 를 FK 참조 | 결제 링크된 행 hard-DELETE = **수납기록 FK orphan/파손** → post-recognition |
| **마감스냅샷 / 발생기준 매출** | SalesDailyTab = 발생(청구)기준 급여 3값(급여총액·본부금·공단청구액) 권위 grain = `service_charges WHERE is_insurance_covered=TRUE`. 마감 herald recompute(20260806150000 / 20260804170000) 도 read | 마감 확정 후 삭제 = **매출 재계상** → post-recognition |

- :3161 은 **경계 guard 부재** → 3축 중 어느 행이든 무차별 삭제 가능.
- **보수적 default(DA: 매출인식 기여 시점부터 immutable·불확실시 Tier-0)** 적용:
  - **분류 = Tier-0. hard-DELETE BLOCKED.**
  - 단일 콜사이트가 pre/post 를 정적 구분 불가하므로, 경계는 **런타임 per-row** 로 결정:
    - post-recognition(청구 draft 존재 ∨ payments.service_charge_id FK 존재 ∨ 확정 마감 스냅샷 포함 中 ≥1) → **softvoid(voided_at) + reversal-offset append**.
    - pre-settlement(3축 전무) → **softvoid(voided_at) 단독**.
  - 불확실시 Tier-0(=post-recognition 취급)이 안전 default.

### C4. guards 기록 (DA §Q1 G1~G4)
- **G1** delete≠void≠cancel (§6-7-1): :3161 리팩터 = hard-DELETE → `voided_at = now()` UPDATE(void). is_cancelled/취소 축과 무관·restore≠cancel 방화벽 유지.
- **G2** 공단부담액 recompute `voided_at IS NULL` 술어 **N-axis parity**(전 site byte-identical). voided_at 신설 시 `is_insurance_covered` 집계/공단부담액 read 전 site 에 `.is('voided_at', null)` 동시 삽입 필요 — **parity 대상 read-site 열거(census)**:
  - `SalesDailyTab.tsx:226`(급여 명세 발생기준), `:179`(payments FK embed)
  - `autoBindContext.ts:607`, `:910`(합산·상병)
  - `footBilling.ts:624`(customer_grade_at_charge 폴백)
  - `useEdiExport.ts:146`(등급·율 스냅샷)
  - `DocumentPrintPanel.tsx:964 · 1392 · 2851 · 2906 · 5143`(bill_detail/배치/refresh/비급여합산)
  - `PaymentSusuDetailModal.tsx`(마감 수납 상세), `PaymentMiniWindow.tsx:2520`(스냅샷 read)
  - closing herald recompute 마이그(20260806150000 / 20260804170000)
  - → 12+ read-site. byte-identical parity 미확보 시 급여/공단부담 divergence 리스크(Leg2 구현 게이트).
- **G3** 수납 재무 SSOT(`payments`/`check_in_settlements`) **무접촉**: softvoid 는 service_charges(명세 grain) 한정. payments/settlements write 0.
- **G4** residual FOR DELETE grant **REVOKE**: softvoid 착지 後·per-table census 선결·co-atomic. (service_charges DELETE 경로는 authenticated RLS 경유 — Leg2 에서 grant/RLS DELETE 정책 census 후 REVOKE.)

### Q1 disposition
**service_charges = Tier-0 확정. 단일 removal 콜사이트(:3161) = 경계 guard 부재 → 보수적 post-recognition 취급(softvoid + reversal-offset append), per-row 3축으로 pre 강등.** 저장기전 = B-2 `voided_at` verbatim 신설. hard-DELETE BLOCKED. **apply 대상 = Leg2(GO-token 게이트)·현재 write 0.**

---

## ■ Q2 — staff_attendance = Tier-2 하향 · discriminant census (attendance-sync:412 toDelete 술어 분석)

### C5. toDelete 술어 실측 (attendance-sync/index.ts:406-415)
```
// 1) DELETE: google_sheet 인데 desired 에서 빠진 사람
const toDelete: string[] = [];
for (const [staffId, row] of existingSheet) {      // existingSheet = Map<staff_id, {id}> (source='google_sheet')
  if (!desiredIds.has(staffId)) toDelete.push(row.id);   // 라이브 시트 desired 집합에 없는 staff → 삭제
}
supabase.from("staff_attendance").delete().in("id", toDelete);   // :412 물리 DELETE
```
- 술어 = **`source='google_sheet'` AND `staff_id ∉ desiredIds`** (라이브 시트에서 빠진 사람). desiredIds = 당일 시트 출근자→staff_id 집합.
- 대상 창 = `[today-days_back(기본1), today+days_forward(기본14)]` KST → **과거(어제)·당일 포함**.

### C6. exact-dup-only 판정 = **DISPROVEN (반증)**
2개 독립 근거로 exact-dup 붕괴 아님을 확정:

1. **DB 제약**: `UNIQUE (clinic_id, date, staff_id)` 이 SSOT 테이블에 존재 (20260618200000_staff_attendance_ssot.sql:43). → 동일 (clinic,date,staff) exact-dup 행쌍은 **구조적으로 존재 불가**. 붕괴할 dup 자체가 없음.
2. **술어 구조**: `existingSheet` 는 `staff_id` 키 Map(중복 staff_id 는 last-write-wins 로 이미 1행). toDelete 는 **staff_id 의 desired 집합 부재**로 판정 = 시트에서 제거된 **distinct 진성 출근행**(1인 1행) 제거. exact-dup collapse leg **부재**.

- → DA 프레이밍 "'중복/stale' 2 leg 혼재"는 이 코드에서 **혼재 아님**: 중복(duplicate) leg 는 UNIQUE 제약으로 애초에 발생 불가·부재. 술어는 **순수 stale/superseded distinct 제거** 단일 기전.

### C7. stale/superseded 성격 = Tier-1 (근태 감사 파괴)
- 삭제 행 = "시트에 출근으로 마킹됐다가 시트에서 제거된" 진성 근태 레코드. 창에 **과거(today-1)·당일** 포함 → 물리삭제 시 **실제 출근 감사 이력 파괴**.
- 근로기준법§42(임금대장 3년 보존) 저촉 리스크. 보수적 default(exact-dup-only 미증명 시 stale=Tier-1)와 discriminant 실측이 **동일 결론으로 수렴**.

### C8. grant/REVOKE 실효 nuance (census 발견)
- attendance-sync EF 는 **service_role 로 동작(RLS bypass)** (index.ts:53·주석 L31). staff_attendance RLS 는 SELECT/INSERT/UPDATE 정책만 존재·**FOR DELETE 정책 부재** (20260618200000). 즉 authenticated 경로 DELETE 는 이미 정책 부재로 차단, 실제 removal surface = **EF 의 service_role `.delete()` 레그(:412)**.
- → **"FOR DELETE grant REVOKE" 만으로는 :412 삭제를 못 막음** (service_role 이 grant 우회). Tier-1 집행 = **EF reconcile 레그의 소프트 기전 전환**(예: DELETE → status 전이/superseded 마킹으로 "출근→시트제거" 전이를 감사로 보존) 이 실질 조치. grant REVOKE 는 authenticated 잔여 경로 봉인(hygiene)으로 병행.

### C9. forward-improvement (DA idempotent-upsert 조건) = MOOT
- DA (b) 경로(exact-dup-only CONFIRM → FOR DELETE KEEP + idempotent-upsert UNIQUE+onConflict → 물리삭제 소멸)는 **본 census 에서 미충족**:
  - UNIQUE(clinic_id,date,staff_id) 는 **이미 존재** → upsert 개선의 전제(중복 재충돌 방지)는 이미 만족돼 있고, :412 삭제는 dup 붕괴가 아니라 superseded 제거이므로 idempotent-upsert 로 "소멸"되지 않음.

### Q2 disposition
**staff_attendance = Tier-1 (진성 파기의무 아님이나 근태 감사 보존). attendance-sync:412 toDelete = exact-dup-only 반증·순수 stale/superseded distinct 제거 → hard-DELETE BLOCKED.** REVOKE FOR DELETE grant(잔여 authenticated 봉인) + **EF reconcile 레그 소프트 기전 전환**이 실질 집행. **apply 대상 = Leg2(GO-token 게이트)·현재 write 0.**

---

## AC / 게이트
- [x] census md (READ-ONLY · prod write/DDL/DML/apply = 0) — 본 문서.
- [x] Q1 service_charges = Tier-0 · 단일 removal 콜사이트 · B-2 voided_at verbatim · post-recognition 보수 default · G1~G4 기록.
- [x] Q2 staff_attendance = Tier-1 · exact-dup-only 반증(UNIQUE + staff_id-부재 술어) · service_role grant nuance.
- [ ] Leg2 apply(voided_at 신설 / EF 소프트전환 / REVOKE) = **supervisor DDL-diff + 물리 GO-token 선행**(apply_before_go 금지). 현재 apply 대상 없음 = GO-token 요청 시점 아님.
- [ ] envelope Q3(is_deleted vs deleted_at·233438-2n14/234331-ilot) 잔여 HOLD 불변 — DA REPLY 대기. 본 census 와 독립.

## planner 회신 요청
1. CARVE scope 최종확정: service_charges(Tier-0·voided_at)·staff_attendance(Tier-1·EF 소프트전환) 2건 disposition CONFIRM.
2. Q2 실집행 nuance 확인: service_role 우회로 인해 "REVOKE FOR DELETE" 단독 무효 → EF reconcile 소프트 기전 전환이 Tier-1 핵심 조치임을 Leg2 scope 에 반영.
3. envelope Q3~Q6 DA REPLY 대기 상태 유지 (본 census 와 독립 병렬).

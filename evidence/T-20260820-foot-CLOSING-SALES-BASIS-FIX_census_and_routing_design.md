# T-20260820-foot-CLOSING-SALES-BASIS-FIX — 병렬 선행 산출물 (census + 화면① canonical 라우팅 설계)

> **STATUS: PREP-ONLY.** DA CONDITIONAL-GO(MSG-20260820-192232-4bax) 병렬 선행 인가 범위(write0/DDL0).
> ★live routing 반영·main 착지·배포 **금지** — field-confirm(Q1/Q3·김주연 총괄) + supervisor 물리 GO-token 확보 후에만 착지(DA AC-1, 티켓 blocked/human_pending 유지).
> 본 문서는 착수 스펙이 아니라 **증적 + 설계 초안**. db_change=false.

---

## 1. NULL attributed_staff_id census (stamp coverage · read-only)

스크립트: `scripts/T-20260820-foot-CLOSING-SALES-BASIS-FIX_attrstaff_null_census_readonly.mjs`
실행 auth = Management API(postgres 슈퍼유저·무RLS). 실행일 2026-08-20.

### payments (`status NOT IN ('cancelled','deleted')`)
| scope | total | attr_stamped | attr_null | NULL 중 live-join 해소 | NULL→UNASSIGNED |
|---|---:|---:|---:|---:|---:|
| all-time | 1450 | 1365 (94.1%) | 85 | 24 | 61 |
| 최근 90일 | 1447 | 1365 | 82 | 24 | 58 |
| 표본일 08-18/08-20 | 161 | 151 | 10 | 7 | 3 |

### package_payments (status 컬럼 부재 → 필터 없음)
| scope | total | attr_stamped | attr_null | NULL 중 live-join 해소 | NULL→UNASSIGNED |
|---|---:|---:|---:|---:|---:|
| all-time | 336 | 321 (95.5%) | 15 | 7 | 8 |
| 최근 90일 | 336 | 321 | 15 | 7 | 8 |
| 표본일 08-18/08-20 | 40 | 36 | 4 | 4 | 0 |

### 재배정 divergence — `attributed_staff_id <> live assigned_staff_id` (최근 90일)
①→② 전환 시 **화면①의 셀 값이 실제로 바뀌는 유일한 케이스** = 재배정 고객의 과거 매출.
| src | divergent_rows | divergent_net |
|---|---:|---:|
| payments | 6 | 30,600원 |
| package_payments | 1 | 500,000원 |
| **합** | **7** | **530,600원** |

### census 해석 (fallback belt 필요량 평가)
1. **stamp coverage 높음** (payments 94.1% · pkg 95.5%). 대부분 행은 snapshot 직접 귀속.
2. **NULL 행은 belt에서 현행 화면①과 동일하게 동작한다.** NULL attributed → COALESCE belt가 `customer_id → customers.assigned_staff_id`(= 현행 화면①의 바로 그 live-join)로 폴백. ∴ NULL 행에 대해서는 ①→② 전환 후에도 화면① 숫자 **불변**. belt는 레거시/워크인 안전판일 뿐 신규 재귀속 경로 아님(staffRevenue.ts §push 주석과 일치).
3. **표본일 화면①/화면② 정합**: 표본일 NULL payments 10건 중 7건이 live-join 해소(belt=화면②와 동일) → per-실장 잔차 미미. DA/vi35 census 결론(08-18 엄경은 3,900원 = sim/test 단독, 재배정 delta 아님)과 정합.
4. **실질 전환 임팩트 = 재배정 7행/530,600원(90일)** 뿐. 이것이 곧 DA가 요구한 fix(재배정 소급이동 방지·snapshot 고정). 표본일(08-18/08-20)에는 재배정 divergence 미발화 → 총괄 체감 수백만 delta의 원인 아님(= seed-0 GROSS vs NET 이 원인).

> **belt 결론**: NULL 폴백 belt 유지 필수(스탬프 미보유 85+15행). 단 belt는 화면①과 등가 동작 → 전환이 NULL 행에 회귀 리스크 유발 안 함. 별도 stamp 백필 없이도 화면①→canonical 전환 안전.

---

## 2. 화면① 위치 확정 (미전환 read-site)

- **화면①** = `src/pages/Closing.tsx` → 일마감 > 결제내역 탭 > `staffTotals` (담당자별 매출 카드, L1573~1588, 렌더 L3089~3145).
- 현행 귀속축 = **LIVE** `customers.assigned_staff_id`:
  - 단건: `enrichedRows` L1277 `payStaffId = cust?.assigned_staff_id` → `staff_name`.
  - 패키지: L1331 `assignedStaffName = cust?.assigned_staff_id`.
  - `staffTotals`(L1575)가 `enrichedRows`의 `staff_name`로 그룹핑 → **snapshot 미채택**.
- Closing.tsx는 `attributed_staff_id`를 **select조차 하지 않음** (grep 0건) = DA-20260814 POSTCHECK#2 N-axis parity가 지적한 '누락 read-site'·반쪽 fix.
- 대조군 **화면②** = `src/components/sales/SalesDoctorTab.tsx` = 이미 `staffRevenue.ts`(fetchAttributedPayments → aggregateStaffNet, snapshot belt) 경로 = canonical.

---

## 3. canonical 라우팅 설계 (①→② · staffRevenue.ts 경유)

### 설계 원칙 (DA doctrine)
- **재구현 금지**: 화면①에 belt 로직을 inline 복제하면 staffRevenue.ts가 죽이려던 "독립 4벌" 안티패턴 재발. → 화면① `staffTotals`를 **staffRevenue.ts SSOT 코어로 라우팅**한다(화면②와 동일 코어 = ①==② 구조적 tie-out).
- **by-construction 동반 이득** (DA Q4): canonical 경로 = `excludeSimulationPaymentRows` 내장 → (c) sim/test 필터 비대칭(08-18 3,900원 delta) 자동 해소. + accounting_date grain 통일(seed-3 latent 축 완화).

### 라우팅안 (권장·A) — staffTotals를 canonical 코어로 재배선
```
fetchAttributedPayments(clinicId, day, day)   // accounting_date 축·snapshot 귀속·sim 제외·belt
  → rows
  → aggregateStaffNet(rows)                    // staffId별 net (화면②와 동일)
  → staffMeta로 이름 resolve, STAFF_UNASSIGNED='미지정' 매핑
  → 카드/현금/이체 소계: 현행 shape 보존 위해 rows를 staffId×method로 재버킷
     (all-method MANDATORY·INV5 — DA Q3. 현행 L1582 membership→card 합산 규칙 유지 or 총괄 confirm 시 분리)
```
- staffId → 표시명: `staffMeta.get(id).name`, 미지정 = '미지정'(현행 AC-3 라벨 유지).
- 카드/현금/이체 소계: `aggregateStaffNet`은 method 분해를 안 하므로, staffId×method 경량 재버킷 헬퍼 1개 추가(코어 rows 재사용 — 새 페치 0). 현행 `card||membership→card` 합산 규칙은 **display 규칙**이라 보존; 변경 시 money-path=총괄 confirm.
- **범위 게이트(DA Q3)**: 이 rebucket은 화면①(closing staffTotals) 표면 **내부** all-method 한정. `SalesPaymentMethodTab`(raw method) = EXCLUDE default(편입 시 김주연 confirm + dual-axis 라벨).

### 대안(B) — inline attributed_staff_id 채택 (비권장)
Closing.tsx select에 `attributed_staff_id` 추가 + enrichedRows 귀속키를 `attributed_staff_id ?? cust.assigned_staff_id ?? '미지정'`로 교체. grain은 리스트와 정합하나 **belt 재구현 = SSOT 4벌화**·화면②와 코어 분리 잔존 → DA single-choke doctrine 위배. **채택 안 함.**

### 미해소 grain 주의 (착수 전 확인 필요)
- 화면① staffTotals는 현재 단건=created_at 리스트 기반, 패키지=accounting_date. canonical은 양쪽 accounting_date 통일. 표본일은 두 축 일치라 무영향(seed-3 dormant)이나, 선수금·익일귀속일에 화면① 리스트 합계와 staffTotals가 미세 발산 가능 → **field/DA follow-up(seed-2/seed-3)와 함께 확정 후 착지**.

---

## 4. 착지 게이트 (본 문서로 해소 안 됨 — 대기 항목)
1. **field-confirm (김주연 총괄)**: Q1 화면① = 매출-credit 표면(→B-1 통일 강제) vs 비-credit utility(→B-2 label-distinct). DA DEFAULT LEAN=통일. + Q3 SalesPaymentMethodTab grain 편입 여부. + drawer 물리실사. + seed-0 환불기준 C(★PRIMARY)·seed-1 현금표시 A.
2. **supervisor**: money-path code-gate + 물리 GO-token(db_change=false ≠ gate 면제·AC-1). apply-gate/순서=supervisor.
3. 확정 후 planner가 seed별 착수 스펙 → approved 전환 시 dev-foot 구현·spec·POST-VERIFY(화면①==화면② 동일실장 동일총액·재배정cell snapshot·sim 제외·매출총합/AC-3 byte-불변·rebucket line-scoped).

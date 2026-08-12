# T-20260813-foot-SURCHARGE-SRCCLOSE-PMWCHECKOUT — RECON (READ-ONLY, write 0)

**상태**: recon 완료 (무-게이트 leg). **구현/apply = supervisor MIG-GATE + billing-invariant oracle + 물리 GO-token 선행 → write 0 until GO.**
**DA canon SSOT**: 티켓 본문 [DA CONSULT-REPLY 확정] (MSG-20260813-013118-fzjr, verdict=CONDITIONAL forward-fix GO).
**probe**: `scripts/T-20260813-foot-SURCHARGE-SRCCLOSE-PMWCHECKOUT_recon_probe.mjs` (service_role, SELECT only)
**raw**: `_artifacts/T-20260813-foot-SURCHARGE-SRCCLOSE-PMWCHECKOUT_recon.txt`

---

## 1) detectSurchargeKind 실제 키잉 축 (Q1)

- `src/lib/nightHolidaySurcharge.ts:128` `detectSurchargeKind(refDate, isCalendarHoliday)` = **시간 축**(요일/시각/공휴일) → kind(`night`/`holiday`/`null`). 이건 **가산율(rate 0.3/0) 축**이지 "어느 line-item 이 가산 대상인가" 축이 아님.
- 가산 **대상 판정 축** = `src/lib/footBilling.ts:806 isConsultationFeeItem`. 현 우선순위:
  1. `hira_category === 'consultation'` (권위 enum, **PRIMARY**)
  2. NULL 폴백 → `SURCHARGE_EXAM_FEE_SERVICE_CODES = {AA154, AA254, AA222}` service_code 명시목록.
- **⇒ 두 축(시간 rate축 ⟂ 대상 eligibility축)이 병립. DA Q1 = eligibility SSOT 하나로 정렬 필요.**

### ★ 키잉 축 census (dispositive — hira_category PRIMARY = REJECT 근거)
급여(is_insurance_covered=true) services **11행 중 hira_category 적재 4행 / NULL 7행 (63.6% NULL)** — §30 NULL-proof 근거.

| name | service_code | hira_code | hira_category | hira_score | covered | price |
|---|---|---|---|---|---|---|
| 초진진찰료-의원 | AA154 | AA154 | **NULL** | 197.12 | ✅ | 18,840 |
| 재진진찰료-의원 | AA254 | AA254 | **NULL** | 139.85 | ✅ | 13,370 |
| 재진-물리치료,주사 등 | AA222 | AA222 | **NULL** | 49.09 | ✅ | 4,690 |
| **진찰료 (초진)** | (없음) | AA154 | **consultation** | **153.36** | ✅ | **0** |
| 초진진찰료 | (없음) | NULL | NULL | NULL | ✅ | 18,840 |
| 재진진찰료 | AA155 | NULL | NULL | NULL | ✅ | — |
| 공휴일 초진진찰료-의원 | 050 | NULL | NULL | NULL | ❌(비급여) | 24,490 |

**진단**: 유일하게 `hira_category='consultation'` 태깅된 행("진찰료 (초진)")은 **hira_score=153.36 / price=0 = stale/legacy 중복행**이다. 실 활성 초진진찰료(AA154)는 hira_category=**NULL** / score=197.12. **hira_category PRIMARY 로 키잉하면 잘못된 행(153.36, price=0)을 집고 실 AA154(197.12)를 놓친다** → DA "hira_category='consultation' 태깅 = REJECT-as-primary" + "lean=(b) hira_code-based §30 NULL-proof" **완전 검증**. canonical eligibility 축 = **hira_code {AA154,AA254,AA222}** (naive `AA%` prefix blanket 금지 — 정확 eligible 집합 mirror).

---

## 2) computeSurcharge 현 산식 + 두 leg divergence (Q3)

- **문서/표시 leg** (`nightHolidaySurcharge.ts:176 computeSurcharge`): `amount=floor10(base×0.3)`, copay/covered floor10 분할. **base = 이미 산출된 진찰료 급여액** (진찰료 본인+공단). → `applyNightHolidaySurcharge` (서류 4종 SSOT).
- **수납/영속 leg** (pmw_checkout, `footBilling.ts:422 coveredBaseUnit` + RPC `calc_copayment` v1.7): `base = ROUND(hira_score × hira_unit_value × (1+rate))` **per line-item**, rate=0.3.
  - PMW: `computeConsultationSurchargeBase(footBillingItems, grade, {surchargeRate})` → `settleSurchargeInclusive − settleSurchargeBase = 가산 delta` (PaymentMiniWindow.tsx:2031~2048).
  - RPC persist: `record_insurance_consult_payment` v2 에 `p_surcharge_rate` 재전달 (T-20260810 Phase B, PMW:2668; 두 leg 모두 main 배포됨: 7956f248 / 6fd6dc85).

### DA canonical vs 현 산식 gap
- **DA canonical**: `ROUND((기본진찰료점수×1.3 + 외래관리료점수) × edition_환산지수)` — **single-round-at-end**, 원미만 4사5입, base-consult scope.
- **현 산식**: `ROUND(hira_score × unit × 1.3)` **per line-item round** (single-round-at-end 아님) + **full-hira_score blanket ×1.3**.
- **gap ①(rounding)**: per-item round ≠ single-round-at-end → 원단위 divergence 가능(oracle 대상).
- **gap ②(★over-billing, HARD gate)**: 아래 §4.

---

## 3) pmw_checkout 구조 / floor10 (Q2)

- 수납 chokepoint: `handleDocAndSettle` → `record_insurance_consult_payment`(진찰료 copay/service_charge 원자 생성) + `calc_copayment`(급여 시술 명세). **가산 rate 는 FE(`settleSurchargeRate`)에서 도출해 RPC 로 전달.**
- **결함 이력(§2-2-7 FALSIFIED 근거)**: 6fd6dc85 가 RPC 에 rate 전달 → FE(floor10)/RPC(base×(1+rate)+floor100) **rounding 모델 divergence(결함①)** → 11c1ebcf 가 rate 전달 **revert**(가산 = FE 표시 잔존, **service_charges 미영속 = 명세 저계상**) → Phase B(7956f248)가 동일 모델로 재도입. **⇒ under-collection(51/52) 의 진원 = 이 leg 의 rate 도출·영속 divergence. pmw_checkout = MONEY-layer 맞음(§2-2-7 FALSIFIED 확인).**
- floor10: 문서 leg 전용(`computeSurcharge` floor10). 수납 leg 는 base ROUND(1원) + 급여 본인부담 floor100(외래) — **floor10 base derive 아님** (DA "floor10 base derive 금지" 이미 준수). 문서 leg floor10 을 산식 base 로 역산 금지 = 준수.
- **DA Q2 canonical**: pmw_checkout → **RPC 경유(preferred) single chokepoint**, FE-inline rate 재도출 = REJECT. **현재는 FE 에서 rate 도출 후 RPC 전달** → FE-inline 도출 성격 잔존 → chokepoint 단일화(rate 판정도 RPC/공유 SSOT 로) 필요. **change-class = money-path VALUE-CHANGE → 'FE-only/no-DDL' ≠ MIG-GATE 면제(AC-1).**

---

## 4) ★ 외래관리료 별표1 scope (별건 track, 산식 go-live HARD gate)

- probe: `name.ilike.%외래관리%` / `%관리료%` → **외래관리료 별도 line-item = ZERO** (매칭된 "의약품관리료"는 처방 조제료로 무관).
- **⇒ foot services 는 외래관리료를 별도 저장하지 않음. 의원급 진찰료 소정점수(AA154=197.12 / AA254=139.85)에 기본진찰료+외래관리료가 번들.**
- **HARD gate**: DA canonical `기본진찰료점수×1.3 + 외래관리료점수` 는 **기본진찰료 ⟂ 외래관리료 점수 split 를 요구**하는데, 현 데이터에는 combined score 만 존재 → **canonical 산식 계산 불가**. 현 `full-score×1.3` = 외래관리료분까지 ×1.3 = **over-billing**.
- **⇒ 산식 go-live 는 별건 track `T-20260813-foot-OUTPATIENT-MGMTFEE-BYLAW1-EDITION-SCOPE`(별표1 기본진찰료/외래관리료 점수 split) 해소 전 금지** (DA ★CRITICAL 그대로). recon 이 이 종속성을 dispositive 하게 확인.

---

## 5) edition window (Q3, 89.40 stale)

- **prod 실측**: clinics 2곳 모두 `hira_unit_value=95.6 / year=2026` — **live 행에 89.40 stale 없음 (governed, T-20260714 적용됨).**
- **잔존 latent hazard**: `calc_copayment` 계열 마이그가 `COALESCE(hira_unit_value, 89.4)` 폴백 상수 보유(20260504/20260526/20260629 등). 실 행이 NULL 로 빠지면 **89.4(2024) silent 착지** → DA "89.40 stale snapshot 금지" 위배. **canonical: NULL 시 89.4 silent 폴백 대신 fail-closed(가산/급여 계산 거부) 권고** — 별건 track/oracle 에서 확정.

---

## 6) 착수 sequencing 상태 (dev-foot leg)

| 단계 | 소유 | 상태 |
|---|---|---|
| recon (무-게이트) | dev-foot | ✅ 완료 (본 문서) |
| 외래관리료 별표1 scope | 별건 track (병렬) | ⛔ 미해소 = 산식 go-live HARD gate |
| 구현 → MIG-GATE + oracle + GO-token | dev-foot 구현 / supervisor 게이트 | ⏸ **write 0 until GO-token** |
| forward-fix live → POST-fix 포렌식 | supervisor | 대기 |
| backfill(T-20260725) 재개 = Layer-2 MONEY | finance/CEO+총괄 | business 게이트(planner relay 별도) |

**dev-foot 다음 행동**: (a) 별건 track 산식 split 확정 대기 + (b) supervisor MIG-GATE/oracle/GO-token 대기. 둘 다 열리기 전 money-path write 0.

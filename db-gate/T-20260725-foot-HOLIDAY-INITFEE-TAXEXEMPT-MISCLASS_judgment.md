# T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS — 1차 판정 (READ-ONLY 진단)

- 채널 C0ATE5P6JTH · thread 1784968975.397929 · reporter 코디님(U0B6VLNBR2B)
- 진단 스크립트: `scripts/T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS_diag.mjs` (prod rxlomoo, SELECT-only)
- 판정 시각 스냅샷: 2026-07-25

## 결론 — 원인 = (a) services 마스터 급여/면세 플래그 config 오설정. FE 분기(getTaxClass) 정상.

`getTaxClass`(src/lib/footBilling.ts L265) 규칙:
```
급여        ← (COVERED_GRADE && hira_code) || is_insurance_covered === true
비급여(과세) ← vat_type in (exclusive, inclusive)
비급여(면세) ← 그 외 전부   ← ★ 문제 항목이 여기로 떨어짐
```
→ `is_insurance_covered=true` 이면 grade 무관 무조건 급여. 이 항목이 면세로 잡힌다는 것은
   해당 services row 가 `is_insurance_covered != true` 이고 `hira_code` 도 없다는 뜻 = 데이터 config.

## 스모킹건 (prod services 마스터)

| name | active | code | is_insurance_covered | hira_code | hira_score | vat_type | → getTaxClass |
|------|--------|------|----------------------|-----------|-----------|----------|---------------|
| **공휴일 초진진찰료-의원** (id 3eb86239) | ✅true | 050 | **false** | null | null | none | **비급여(면세)** ← 버그 |
| (공휴일)초진진찰료-의원 (id df698d26, 비활성 중복) | false | 050 | false | null | null | none | 비급여(면세) |
| 초진진찰료-의원 (id de611ed5) — 비휴일 형제 | true | AA154 | **true** | null | 197.07 | none | 급여 ✓ |
| 재진진찰료-의원 (id 117befad) | true | AA254 | true | null | 139.85 | none | 급여 ✓ |

- 정상 형제 `초진진찰료-의원`(is_insurance_covered=true, hira_score=197.07)은 급여로 잘 잡힘.
- **문제 항목만 `is_insurance_covered=false` + hira 플래그 전무** → 면세 오분류. 데이터 config 누락 확정.
- price 24,490 = round(197.07 × 95.6[clinics.hira_unit_value]) × 1.3 = 18,840 × 1.3. **가산 30%가 price 에 이미 baked-in** 된 단일 line-item.

## db_change 확정 = YES (데이터 정정, 스키마 무변경)

- 정정 = `UPDATE services SET is_insurance_covered=true` (신규 컬럼/테이블/enum 없음).
- 따라서 data-architect 스키마 CONSULT(§S2.4)는 게이트 대상 아님. 단 **mutable-field 데이터 정정 SOP** 적용:
  단일 count UPDATE 금지 · 대상셋 freeze(아래 2건) · 판정근거 스냅샷(본 문서) · 롤백 SQL 동봉.
- freeze 대상셋: `id=3eb86239-af92-468c-afd3-94daa28acad6`(active). 비활성 중복 df698d26 은 selectable 아님 → 정정 제외(수납 무영향), 단 잔존 명시.

## ⚠ REDEFINITION_RISK 실증 — 순진한 급여 flip 단독은 **이중 가산(과다청구) 회귀**를 낳음. 방향확인 필요.

수납창(PaymentMiniWindow L1776~1790)은 배포된 SATURDAY-SURCHARGE-CONSULTFEE-SETTLE(07458cf6)로
`computeConsultationSurchargeBase(footBillingItems…)` → `isConsultationFeeItem` 필터로 **진찰료 급여에 30% auto-가산**을 건다.

`isConsultationFeeItem`(footBilling.ts L590): 급여 && (hira_category='consultation' || (category_label='기본' && /진찰|상담|초진|재진/.test(name))).
→ `공휴일 초진진찰료-의원` 을 급여로 flip 하면 이 필터에 **매칭됨**(category_label='기본', 이름 '초진').

**공휴일(checked_in_at=휴일) 수납 시뮬레이션** (general 30%):
| | 총액 | 본인부담 | 공단부담 |
|---|---|---|---|
| 정상(가산 baked-in, 재가산 없음) | 24,490 | 7,300 | 17,190 |
| 버그(naive 급여 flip → 휴일 auto-surcharge 이중) | 31,837 | 9,490 | 22,347 |
| **과다청구** | **+7,347** | **+2,190** | +5,157 |

→ 이미 price 에 30% 포함된 항목에 auto-surcharge 30%가 재적용 → 본인부담 +2,190원 과다청구.
   매출정합 이중계상 금지(Revenue Insurance Split) 위반. **naive flip 단독 배포 불가.**

## 권장 방향 (이은상 팀장 direction_review_gate 확인 요청) — Arch A

1. **데이터 정정**: 위 active row `is_insurance_covered=true` (mutable-field SOP). copay base = price 24,490
   (hira_score 없음 → computeFootBilling 이 price base 사용 = 가산 포함가 그대로, 정확). copay 자동 split 정상.
2. **이중 가산 차단(FE 가드)**: 가산이 price 에 baked-in 된 항목(service_code='050' 또는 이름에 '공휴일')을
   `isConsultationFeeItem` 에서 **제외** → auto-surcharge base 에 미산입. (산식/요율/3조건 불변 = REDEFINITION 아님,
   적용대상 line-item 필터만 축소. SURCHARGE-SCOPE-GYUNTEST-EXCLUDE 선례와 동일 성격.)
   - service_code='050' = HIRA 공휴일 가산코드(nightHolidaySurcharge.ts L115 "+050" 명시)라 정밀 신호.

**Arch B(대안)**: baked-in 휴일항목 폐기 → 데스크가 평시 진찰료 선택 후 auto-surcharge에 위임. 단 reporter가
현재 baked-in 항목을 능동 사용 중 → 워크플로 파괴. 비권장.

## 다음 단계

- 방향확인(Arch A/B) 후 착수. Arch A 확정 시: (1) 데이터 정정 SQL + 롤백 + freeze 재검증, (2) isConsultationFeeItem
  050/공휴일 제외 가드 + E2E 금액 assert(급여 처리 + 공단/본인 분리 + 본인부담=수납금액 + **휴일 무이중가산** + 다른항목 무회귀).
- scalp2(obliv-scalp2-crm) isConsultationFeeItem byte-mirror 대상 → 가드 동시 이식 필요(co-change 플래그).

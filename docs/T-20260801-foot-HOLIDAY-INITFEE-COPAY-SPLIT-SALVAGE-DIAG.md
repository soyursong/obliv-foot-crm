# T-20260801-foot-HOLIDAY-INITFEE-COPAY-SPLIT-SALVAGE-DIAG — Phase 1 진단 리포트

> **READ-ONLY 진단** (rebase·머지·삭제 없음). 고아 브랜치 `ticket/T-20260725-foot-HOLIDAY-INITFEE-INSURED-COPAY-SPLIT`(tip `ac59aa4bf337263fa9168cc0fb28ad6dbbf38a72`)의 살림/폐기 판정.
> 진단일 2026-08-02 · assignee dev-foot · 현행 prod main HEAD `e393798d` (진단 기준 커밋).

---

## 판정 요약 (TL;DR)

**폐기 권고 (DISCARD).** ×1.69 이중가산은 **현행 prod main에 live 아님**. 브랜치의 `isSurchargeBakedItem()` 격리 코드는 이미 CANCELLED된 Arch A(급여 flip)의 동반 코드이며, flip 미적용 상태에선 dead code(방어대상 버그가 비활성).

- tip SHA 기록: **`ac59aa4bf337263fa9168cc0fb28ad6dbbf38a72`**
- 브랜치 자체 tip 커밋이 이미 **CANCELLED/스탠드다운** 상태(`ac59aa4b`).
- census Phase 3에서 **삭제 가능**.

---

## AC1 — 브랜치 diff ↔ 현행 main 대조 (×1.69 경로 특정)

브랜치가 `src/lib/footBilling.ts`에 추가하는 것(merge-base `109a01b2` 대비):

1. **`isSurchargeBakedItem(svc)`** 신규 predicate — `svc.service_code === '050'`(HIRA 공휴일 가산코드)면 true.
2. `isConsultationFeeItem()` 초입에 `if (isSurchargeBakedItem(svc)) return false;` 삽입 — '050' 항목을 **가산 base에서 제외**.

**×1.69 경로 논리**: '050' 항목의 저장단가(24,490)는 이미 terminal 급여수가(진찰료 base × 1.3, 공휴일 가산 1회 baked-in)다. 만약 이 항목이 급여로 분류되어 `isConsultationFeeItem`에 걸리면 → `computeConsultationSurchargeBase`에 산입 → `computeSurcharge`가 다시 ×1.3 → **base × 1.69 이중가산**(환자 과부담 + 공단 과청구).

현행 main에는 `isSurchargeBakedItem` **부재**(HEAD grep=NOT PRESENT). 즉 코드 방어막은 없는 상태.

## AC2 — 현행 prod main 재현 진단 (이중가산 live 여부)

**결론: live 아님 (재현 불가). 트리거 선행조건 미충족.**

이중가산이 발생하려면 **두 조건 모두** 필요:
| 조건 | 현행 prod 상태 | 판정 |
|------|----------------|------|
| (1) '050' 항목이 **급여**로 분류 | **비급여(면세)** — 아래 evidence | ✗ **미충족** |
| (2) 코드에 `isSurchargeBakedItem` 가드 부재 | 부재(HEAD) | ✓ 충족 |

조건 (1)이 false이므로 이중가산 경로 자체가 차단됨.

**prod evidence** (READ-ONLY SELECT, 2026-08-02 `rxlomoozakkjesdqjtvd`):
```
공휴일 초진진찰료-의원   (code 050, active=true ) : is_insurance_covered=false, hira_code=null, vat_type=none → getTaxClass=비급여(면세)
(공휴일)초진진찰료-의원  (code 050, active=false) : is_insurance_covered=false, hira_code=null, vat_type=none → getTaxClass=비급여(면세)
```

**차단 지점**: 현행 `isConsultationFeeItem()` 첫 줄
```ts
if (getTaxClass(svc, insuranceGrade) !== '급여') return false;
```
'050' 항목은 `is_insurance_covered=false` + `hira_code=null` → getTaxClass=**비급여(면세)** ≠ 급여 → **즉시 false**.
→ `computeConsultationSurchargeBase`의 filter에서 탈락 → 가산 base 미산입 → `computeSurcharge` ×1.3 미적용 → **이중가산 0**.

즉 ×1.69는 **Arch A(면세→급여 flip)를 적용한 뒤에만** 발현되는 조건부(prospective) 버그다. flip은 미적용(아래).

## AC3 — 권고: 폐기 (근거 + tip SHA)

**폐기 근거**

1. **버그 비-live**: '050' 항목이 현행 prod에서 면세로 분류되어 `isConsultationFeeItem`이 첫 줄에서 short-circuit → 가산 base 미산입. 재현 조건 미충족.
2. **Arch A 취소됨**: 브랜치 tip 커밋 `ac59aa4b`가 이미 **CANCELLED/스탠드다운**. planner CANCELLATION(MSG-185124-poze, 07-25 18:52)로 Arch A(급여 flip) 중단, 유효 방향 = **Arch B(ITEM-DEACTIVATE, 항목 폐기)**, 김주연 총괄 폐기승인 human_pending. flip은 **미배포·미머지·flag 미flip**(commit `ac59aa4b` 본문 명시).
3. **격리 코드는 flip 동반물**: `isSurchargeBakedItem`은 급여 flip을 전제로만 가치가 있다. flip 없이 현행(면세)에 머지하면 `isConsultationFeeItem`이 이미 false를 반환하므로 **dead code**(방어대상 버그가 비활성). 상보성(revert 아님) 주장의 전제인 "flip으로 급여화된 상태"가 부재.
4. **절사 SSOT 무관**: 이중가산이 비활성이므로 FLOOR canon(T-20260728, `13ff260b`/`637371a0`) 재검증 트리거 없음. 살림 시 요구되던 재검증 부담도 소멸.

**tip SHA (삭제 전 기록)**: `ac59aa4bf337263fa9168cc0fb28ad6dbbf38a72`
브랜치 unique 커밋: `ac59aa4b`(CANCELLED) → `6a59394d`(deploy-ready docs, 철회됨) → `cb0b4971`(feat, 미머지) → `8715bb20` → `e757785e`.

**census Phase 3 조치**: 삭제 대상 포함 가능(존치 사유 소멸).

### 살림 조건부 단서 (forward note)
IF 향후 Arch B가 뒤집혀 Arch A(면세→급여 flip)가 부활하면 → `isSurchargeBakedItem` 격리가 **다시 필요**해진다. 그러나 그 경우에도 이 고아 브랜치를 rebase하지 말고, **신규 티켓에서 재도출**할 것(그 시점 FLOOR canon SSOT `637371a0` + 세부내역서 계/끝처리/합계 불변식 동시 재검증). 격리 코드는 flip과 분리하면 독립 가치 0이므로 브랜치 보존 이득 없음.

## AC4 — planner 보고

FOLLOWUP 발행 완료(실행=삭제는 planner 승인 후). 아래 §통신 참조.

---

## 가드 준수
- READ-ONLY 진단만 수행. rebase·머지·삭제·flag flip·DB write **없음**(prod 쿼리는 SELECT only).
- 절사 SSOT(FLOOR canon `637371a0`) 무접촉 — 이중가산 비활성으로 재검증 트리거 자체가 없음.
- 브랜치 삭제는 이 진단 결과에 대한 planner 승인 후 census Phase 3에서.

*Phase 1 진단 by dev-foot 2026-08-02 · READ-ONLY · from STALE-BRANCH-CENSUS (c) spin*

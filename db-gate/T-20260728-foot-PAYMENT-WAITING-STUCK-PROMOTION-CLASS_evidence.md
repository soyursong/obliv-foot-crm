# T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS — 진단·분류·백필 evidence

**도메인**: foot (obliv-foot-crm, Supabase rxlomoozakkjesdqjtvd)
**DA verdict**: GO_WARN (CONSULT-REPLY MSG-8fb8 Q3, 2026-07-28) — data_correction_backfill_sop §1-D 버킷분해 + PK freeze + apply직전 재검증 abort + rollback + completed_at 교정 + 원장 무접점
**분류 기준일(KST)**: probe 실행일 (evidence JSON `kst_today` 참조)
**변경 성격**: 순수 데이터 UPDATE (DDL 0 · schema_migrations 무관 · 원장 무접점)

---

## 1. AC1 — payment_waiting 정체 전수 열거 + (a)/(b) 분류

| 구분 | 건수 |
|---|---|
| 총 `check_ins.status='payment_waiting'` (foot) | **63** |
| **(a) 정정대상** — 동일자 reconciled(+양수·비삭제·비시뮬) payment 존재 + checked_in date < today | **29** |
| (a-test) 테스트계정 제외 — 승격조건 충족하나 apply 제외(§2-F under-correct) | 2 |
| **(b) 정상대기(EXCLUDE)** — payment 무/취소/노쇼/환불 → 승격 시 가짜완료 날조 | 32 |

> 티켓 최초 보고(2026-07-28)는 53건이었으나 그 사이 신규 정체가 누적되어 probe 시점 63건. freeze셋은 probe 시점 명시 PK VALUES로 박제(시간윈도우 술어 아님, §0-2-a).

### (a) 정정대상 29건 — status→done 승격 + completed_at 교정 (freeze셋)

| 고객 | 차트 | check_in(8) | 내원일 | cust.visit_type | 결제합 | completed_at 교정값 |
|---|---|---|---|---|---|---|
| 김OO | F-01XX | 33f16b07 | 2026-05-25 | returning | 4,690원 | 2026-05-25 |
| 엘런 | F-4857 | 8f974a90 | 2026-07-17 | new | 1,500,000원 | 2026-07-17 |
| 양재경 | F-4668 | 2c76eea6 | 2026-07-20 | new | 265,600원 | 2026-07-20 |
| 정성호 | F-4833 | 01c58fa8 | 2026-07-20 | returning | 255,600원 | 2026-07-20 |
| 장선영 | F-4567 | 5f381bd7 | 2026-07-20 | new | 350,000원 | 2026-07-20 |
| 허유희 | F-4696 | abe9d41f | 2026-07-21 | returning | 16,400원 | 2026-07-21 |
| 박경수 | F-5051 | de57cfbb | 2026-07-23 | new | 300,000원 | 2026-07-23 |
| 강성민 | F-5081 | 535014e6 | 2026-07-23 | returning | 250,000원 | 2026-07-23 |
| 조재훈 | F-5055 | ddcbde38 | 2026-07-23 | returning | 260,000원 | 2026-07-23 |
| 김정숙 | F-4872 | 119cb71c | 2026-07-25 | returning | 1,820원 | 2026-07-25 |
| 김병완 | F-4741 | fdd5c165 | 2026-07-25 | returning | 10,500원 | 2026-07-25 |
| 신윤아 | F-4604 | 59324dab | 2026-07-25 | new | 10,500원 | 2026-07-25 |
| 김민석 | F-4861 | aed5b1de | 2026-07-25 | returning | 1,820원 | 2026-07-25 |
| 한정수 | F-4571 | fd071e95 | 2026-07-25 | returning | 10,500원 | 2026-07-25 |
| 최양환 | F-5157 | 6b966a8c | 2026-07-25 | new | 10,500원 | 2026-07-25 |
| 김미숙 | F-4748 | d85638b5 | 2026-07-25 | new | 325,500원 | 2026-07-25 |
| 송육섭 | F-5093 | ea1b5720 | 2026-07-25 | new | 260,500원 | 2026-07-25 |
| 김영웅 | F-4959 | c73f759b | 2026-07-25 | returning | 275,500원 | 2026-07-25 |
| 김세훈 | F-5143 | b2c1590f | 2026-07-25 | new | 260,500원 | 2026-07-25 |
| 박민석 | F-4790 | d346a002 | 2026-07-27 | returning | 35,200원 | 2026-07-27 |
| 염고운 | F-5019 | 73367834 | 2026-07-27 | returning | 10,000원 | 2026-07-27 |
| 유진웅 | F-5226 | ccec53c4 | 2026-07-27 | new | 10,000원 | 2026-07-27 |
| 김다예 | F-5238 | 6b28344e | 2026-07-27 | new | 31,440원 | 2026-07-27 |
| 박민석 | F-4790 | 485cb066 | 2026-07-28 | returning | 38,000원 | 2026-07-28 |
| 김미성 | F-5016 | e977cbb0 | 2026-07-28 | returning | 7,000원 | 2026-07-28 |
| 허유희 | F-4696 | a0daf444 | 2026-07-28 | returning | 1,400원 | 2026-07-28 |
| 이미현 | F-4695 | 4a7adbdd | 2026-07-28 | returning | 1,400원 | 2026-07-28 |
| 장희정 | F-5216 | 8cc28de6 | 2026-07-28 | new | 10,480원 | 2026-07-28 |
| 남정현 | F-5263 | eb1b58dd | 2026-07-30 | returning | 35,200원 | 2026-07-30 |

> 판정근거 per-row 스냅샷(payments id·amount·status·external_status·reconciled_at·paid_at) = `_probe_evidence.json` `bucket_a_promotable[].payments_evidence`.
> **completed_at 교정 규칙(DA)**: reconciled payment일 우선, 폴백 checked_in_at. 29건 모두 현재 `completed_at IS NULL`(정상 승격 경로 PaymentDialog는 completed_at 미기입) → 교정 fill은 additive.

### (a-test) 테스트계정 제외 2건 (§2-F under-correct ≫ 역오염)

| 고객 | 차트 | check_in(8) | test 판정 |
|---|---|---|---|
| 접수테스트2 | F-4510 | 0e2dba57 | name_pattern |
| 서류테스트 | F-4990 | ac0c2f1d | name_pattern |

> 이름 패턴상 스태프 테스트 계정(is_simulation=false지만 실환자 아님). 승격 시 통계에 가짜 완료 추가 우려 → apply 제외, 정체 잔존(무해).

### (b) 정상대기 EXCLUDE 32건 — 전부 `no_reconciled_positive_payment`

미수/취소/노쇼/환불로 실제 결제 미완 → 승격 시 **가짜완료 날조**. 대표: 김OO(F-01XX)은 (a)에 5/25 1건(결제완료)만 들어가고, 5/30·6/2·6/15·6/16·6/23·6/25·6/27 등 미결제 정체는 (b)로 정확히 분리 → **단일 count 블랭킷 UPDATE 금지 원칙(§1) 정상 작동**. 전수는 `_probe_evidence.json` `bucket_b_exclude`.

---

## 2. AC2 — 근본원인 + 처방 채택

**근본원인**: `check_ins.payment_waiting → done` 승격 기전이 **스태프 '완료' 수동 액션(PaymentDialog.tsx L659-663)뿐**. 수납이 external(VAN/POS)로 완료·reconciled 되어도 스태프가 칸반에서 완료 이동을 누락하면 done 미도달 → recency 기반 방문분류가 초진 오분류 + 매출/방문 정합 왜곡.

**처방 (DA 협의 정본)**:
- **본 티켓** = (a)군 1회성 class 백필(status 승격 + completed_at 교정)로 **누적 정체 정정**.
- **승격 기전 갭 forward-fix**(수납 reconcile→done 자동승격 / 정산게이트 마감시 정체경보)는 **별도 티켓 `T-…-foot-PMW-RECONCILE-AUTOPROMOTE-FORWARDFIX`로 이관**(DA 명시: 모티켓 단건·본 백필과 번들 금지). → planner FOLLOWUP 발행.

> ⚠ **소스차단(§0-2)**: 본 정정은 **1회성 누적분 정정**이며, 승격 갭은 forward-fix 배포 전까지 신규 정체를 계속 생성할 수 있음. freeze셋은 명시 PK 박제라 재오염돼도 moving-target 아님(§0-2-a). forward-fix 배포 후 잔여분은 동일 SOP 재실행(fresh 스냅샷)으로 sweep. **잔여 정체 주기 보고, silent cap 금지.**

---

## 3. AC3 — 백필 안전 봉투 (SOP §3)

| 안전 항목 | 구현 |
|---|---|
| freeze셋 | 명시 PK VALUES `_freeze.json` (29건), FREEZE_SHA `8b66b388bfe6` |
| apply직전 재검증 abort | `_apply.mjs` [1] — 각 PK가 `status='payment_waiting' AND completed_at IS NULL` 유지 확인, drift 1건이라도면 write 0 전량 abort. **dry-run: 29/29 통과, drift 0** |
| 멱등 WHERE | `UPDATE … WHERE id=PK AND status='payment_waiting' AND completed_at IS NULL` (재실행·경합 안전) |
| rows-affected 검증 | PK당 정확히 1행, 불일치 즉시 중단 |
| 판정근거 스냅샷 | `_probe_evidence.json` per-row payments 스냅샷 |
| rollback | `_rollback.mjs` — before-value manifest 기반 status/completed_at 원복 + 삽입 status_transitions 삭제 (완전 가역) |
| 원장 무접점 | DDL 0 · schema_migrations 무관 · **customers.visit_type 미접점**(직교축, §3-3-a 커플링 금지) · 원장 UI 무접점 |
| 매출 중립 | payments 미접점 — status 승격만. 매출 총합/split 불변 |

**실행 (supervisor DB 게이트 + 사람 confirm 後)**:
```
APPLY=1 node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_apply.mjs --confirm 8b66b388bfe6
```
(freeze 파일 변경 시 FREEZE_SHA 변동 → apply 자동 거부. dry-run 재실행으로 재산출.)

---

## 4. AC4 — 8명 실고객 정합 재확인

| 고객 | 분류 | visit_type |
|---|---|---|
| 엘런 | (a) 정정대상 → done 승격 | new |
| 양재경 | (a) 정정대상 → done 승격 | new |
| 정성호 | (a) 정정대상 → done 승격 | returning |
| 현은호 | 해당 없음(이미 해소) | - |
| 장선영 | (a) 정정대상 → done 승격 | new |
| 박경수 | (a) 정정대상 → done 승격 | new |
| 강성민 | (a) 정정대상 → done 승격 | returning |
| 조재훈 | (a) 정정대상 → done 승격 | returning |

> **현은호(F-4717)** = 모티켓(VISITTYPE-HEO-4717-RETURNING-FIX)으로 이미 해소: check_in 3건(7/20 done, 7/28 cancelled, 7/28 done) + customers.visit_type=`returning`. 현재 payment_waiting 정체 0건.
> 나머지 7명은 (a) 승격 대상. status→done 승격 시 recency 기반 방문분류가 완료 반영. **customers.visit_type 스토어값은 본 백필 미접점(§3-3-a 직교축)** — visit_type 재파생은 모티켓/forward-fix 소관.

---

## 산출물
- `scripts/…_probe.mjs` — READ-ONLY 진단·분류 (prod write 0)
- `scripts/…_apply.mjs` — 기본 DRY-RUN, APPLY=1 --confirm 시 write (재검증 abort·멱등·rows-affected·rollback manifest)
- `scripts/…_rollback.mjs` — 완전 가역 원복
- `db-gate/…_probe_evidence.json` / `…_freeze.json` / `…_dryrun_evidence.json`

# T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-1 게이트 플랜 (DA CONSULT-REPLY 수신 후)

**작성**: dev-foot / 2026-08-06 · **선행**: AC-0 census(READ-ONLY, commit ff46ba19)
**DA CONSULT-REPLY**: MSG-20260806-102803-0uof (DA-20260806-foot-HEO4717-CBAND-15K-MISSPAY-WRITETARGET)
**SSOT**: `da_replies/da_decision_foot_heo4717_cband_15k_misspay_writetarget_20260806.md`
**현 상태**: ⛔ **HOLD** — 김주연 comp-gate(실수금 확정) 미satisfied. prod WRITE 0.

---

## DA 판정 요약
- **verdict = 조건부 GO(실수금 confirm-gated)**. change-class = ADDITIVE 1회성 Data-Correction(현금주의 §7-3 under-recognition 정정·비파괴·forward-only) → §3.1 대표게이트 면제.
- **dispositive**: F-4741(payment 존재→삭제 NO-GO)의 정확한 mirror image. 본 건 = payment 부재 → under-recognition 정정. '실수금 있었는가' = census 판정불가 = **김주연 comp-gate가 authority**.

## Write target (Q1)
- **(A) payments INSERT = PRIMARY(조건부)** — `recordManualPayment` canonical single write-path 경유. package_id=NULL(CTB=비패키지 소매). method=실 instrument. 결제일 = createdAtOverride.
- **(C) check_in service line = 판매방문 확정 시 동반**. ★line-only(payments 없이) = REJECT(§7-3 위반).
- **(B) VAN raw 승격 = HARD REJECT** — census상 미매칭 VAN 15,000 5건 전부 F-4717 방문일 밖 → 귀속근거 부재. 승격 = phantom 귀속 + 남의 정산 오귀속.
- ★**linkage 방향(HARD)**: 결제일 특정 FIRST(김주연) → THEN 해당 일 미매칭 VAN 15,000 존재 시에만 1:1 링크. **역방향(VAN→날짜 guess) 절대 금지.**

## ⚠ verify-gate → **해소(코드 변경 불요)**
DA 물음: "CTB=소매성 → 순수 소매(check_in 부재) 가능 → foot 소매 payment 모델이 check_in=NULL 허용하는지 확인."
→ `src/lib/manualPaymentWritePath.ts` **`'single'` 라우트(L204-225)가 이미 `check_in_id: null` 지원** = 소매 단건 payment 1급 경로. **check_in=NULL 허용 확정 → 선-visit 확립 불요.**
- 결제일 check_in 존재 시 → `{kind:'checkin', checkIn}` 로 bind(orphan payment 회피).
- check_in 부재(순수 소매) 시 → `{kind:'single'}` (check_in_id NULL). 둘 다 canonical 단일 경로(AC7).

## 이중계상 방지 불변식 (Q2) — 실행 시 assert
1. 결제일 미확정 상태 임의 VAN 링크 **금지(HARD)**. 확정 후 해당 일 unmatched VAN 15,000 1행만 1:1(matched_payment_id).
2. VAN raw 링크 시 rows-affected==1 assert(멱등앵커=raw PK), ≠1 → txn ABORT.
3. payment idempotency: apply 직전 F-4717 CTB 15,000 재확인(census 0이나 재확인) — 이미 존재 시 no-op.
4. recordManualPayment 단일 경유 · rows-affected DID-IT-PERSIST · single 원자 txn.
5. `record_planb_card_payment` = 본 건 부적합(raw 부재 수동재구성이지 raw claim 아님 → claim 시 rows==0 fail).

## 실수금 미확정/미수/non-event 분기 (Q3)
- (i) **실수금 확정** → (A) INSERT (+VAN 있으면 1:1 / 없으면 orphan flagged, blocking 아님).
- (ii) **미수** → line-only + payment_waiting(매출 미인식·원장 무접점, F-4872 선례).
- (iii) **non-event** → record 안 함.
- method가 card인데 VAN 전무 = suspicious → method는 실 instrument 따름, 미확정 시 stamp 금지.

## AC-3 매출중립 목표 (Q4)
Before F-4717 CTB payments=0 → After=1. v_daily_revenue[결제일] delta = **+15,000 exactly 1 row**. 이중계상 0.

---

## 게이트 순서 (DA CONFIRM 요청 → dev-foot CONFIRM)
1. **[BLOCKER, 현재]** responder 경유 **김주연 comp-gate** — 실판매/실수금/결제일/method 확정. → planner FOLLOWUP 발행함.
2. **[실수금 확정 후]** recordManualPayment INSERT(package_id=NULL·실 instrument·결제일 check_in 결속 or single) + [해당일 VAN 있으면] 1:1 link.
3. **supervisor dry-run** (rows==1 · +15,000 · VAN 1:1 or orphan) + write-correctness.
4. **apply → AC-3** 매출중립 검증.
5. **[미확정]** HOLD 유지(INSERT 금지 · under-correct ≫ over · phantom 금지).

**dev-foot CONFIRM**: 위 HOLD 게이트 순서 그대로 준수. gate #1 satisfied 전까지 prod WRITE 0.

**DB 변경**: 없음(본 커밋 = 문서). **다음 트리거**: 김주연 comp-gate 회신(실수금/결제일/method) → AC-2 실행.

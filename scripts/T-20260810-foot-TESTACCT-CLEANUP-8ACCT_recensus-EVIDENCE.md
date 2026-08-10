# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — 재-census + Path-A/B dry-run 증적 (dev-foot)

- 실행: dev-foot / 2026-08-10 / foot prod `rxlomoozakkjesdqjtvd` / Management API
- 근거: planner NEW-TASK **MSG-20260810-192917-pm2h** (DA SCOPE-SPLIT 조건부 GO, SSOT `da_decision_foot_testacct_cleanup_formsubmissions_retention_purge_20260810.md`)
- 클래스: **READ-ONLY census + 무영속(no-persistence) dry-run**. DELETE 0 / WRITE 0 / DDL 0 (apply HOLD 유지, GO-token 前 선집행 없음).
- 스크립트: `T-20260810-foot-TESTACCT-CLEANUP-8ACCT_recensus.mjs` · `..._pathA_dryrun.mjs`

---

## ★ 헤드라인 — DA 재프레이밍 FALSIFIED · Path-B 필요

DA SSOT 재프레이밍: *"트리거 `trg_form_submissions_published_immutable` 은 status='published'/printed-class 에만 발화(status-종속·컬럼-무관)=전면차단기 아님. 3행 전면차단=F-4427(printed) 42501 원자롤백 아티팩트."*

→ **prod 트리거 소스 + 무영속 실증 probe 로 FALSIFIED.** 트리거 함수 본문(prod 실측):
```sql
IF OLD.status = 'published' THEN RAISE ... USING ERRCODE='42501'; END IF;  -- published UPDATE/DELETE
IF TG_OP = 'DELETE' THEN  RAISE '서류는 물리적으로 삭제할 수 없습니다...' USING ERRCODE='42501'; END IF; -- ★전 status blanket DELETE 차단
```
- 두 번째 분기 `IF TG_OP='DELETE'` = **status 무관 전 status 전면 DELETE 차단기**. draft/voided/printed 동일 차단.
- `status='published'` 분기는 published 行의 **UPDATE 까지** 추가 차단할 뿐. hard-DELETE 차단은 status-종속이 아님.
- 트리거 정의: `BEFORE DELETE OR UPDATE ON form_submissions FOR EACH ROW` · `tgenabled='O'`(enabled).

### Path-A dry-run 결과 (무영속, F-4427 삭제셋 제거 상태)
```
DRAFT (F-4425, draft,  serial NULL)              = BLOCKED[42501]
VOIDED(F-4692, voided, serial NULL)              = BLOCKED[42501]
PRINTED(F-4427, printed, serial74, EXCLUDED-control) = BLOCKED[42501]
NO_PERSISTENCE: PASS  (3행 전건 잔존 = 되감김 확인)
```
- **F-4427 을 삭제셋에서 제거해도** draft·voided form_submissions hard-DELETE 는 여전히 42501 차단.
- ∴ '3행 전면차단'은 F-4427 42501 원자롤백 아티팩트가 **아니라** 트리거의 진성 blanket DELETE 차단 동작.

### ▶ VERDICT: **Path-B REQUIRED** (Path-A clean pass 불가)
- Path-A(트리거 DISABLE 없이 draft/voided archive-first FK-closure DELETE) = **불가**.
- 정당 purge 유일 경로 = **Path-B**: 동일 txn 내 `ALTER TABLE form_submissions DISABLE TRIGGER ...` → 대상 행 DELETE → 커밋 前 `ENABLE TRIGGER` → `tgenabled` 재확인 (session_replication_role/persistent/전역 DISABLE 금지, H3).
- ⇒ **CEO 경량 sign-off REQUIRED (H6)**. §3.1/SEORYU2 §5 의 "Path-A=CEO 파괴게이트 불요" carve-out **미적용**.
- (대안) draft/voided 2계정(F-4425·F-4692)을 Leg B(is_test 원장보존)로 재분류하면 hard-DELETE 자체가 소거되어 트리거 DISABLE 불요 — 단 이는 DA/총괄/CEO 처분 결정이며 dev 판정 아님. 참고: form_submissions 는 customers 에 **NO ACTION FK** 이므로 soft-delete(UPDATE deleted_at)로는 customers hard-DELETE 언블록 불가(행 물리 잔존) → soft-delete 는 Path-B 대체 불가.

---

## 1. [H5] form_submissions 재-census — 6계정 전건 재스캔
AC-1 census 가 form_submissions 축 누락 → 전건 재스캔. 6계정 통틀어 **form_submissions 3행**(3계정), 나머지 3계정 0행.

| 계정 | F-id | customer_id | fs 행수 | status | doc_serial_seq | serial NULL? |
|------|------|-------------|--------|--------|----------------|--------------|
| 풋테스트3 | F-4425 | 21a82994… | 1 | **draft** | NULL | ✅ NULL |
| 송지현2 | F-4692 | d7faae9b… | 1 | **voided** | NULL | ✅ NULL |
| 풋테스트1 | F-4427 | e72022d0… | 1 | **printed** | **74** | ❌ 발번 |
| 풋서류테스트입니다 | F-4468 | c074025b… | 0 | — | — | — |
| 엄경은2 | F-4691 | a0f8c846… | 0 | — | — | — |
| 엄경은2(DUMMY) | F-4703 | 02594dfa… | 0 | — | — | — |

- 6행 customers 전건 잔존 · 이름 일치 · is_simulation=false · created_by=NULL (identity re-bind OK).
- form_submissions_audit_log(RESTRICT child) = **0** · self source_submission_id ref = 0 (추가 blocker 없음).

## 2. draft/voided doc_serial_seq IS NULL 확인 (H2)
- **F-4425 (draft): doc_serial_seq IS NULL = TRUE** ✅
- **F-4692 (voided): doc_serial_seq IS NULL = TRUE** ✅
- 둘 다 발번 이력 없음(발번후무효 아님) → **H2 조건상 Leg B 강등 불요**. 발번 시퀀스 gap 위험 없음. (단, hard-DELETE 실행은 Path-B 게이트에 종속.)

## 3. 재무 자식 분리 재확인 (H8 / DA Q3)
**form_submissions ⊥ payments/service_charges/closing/fct_revenue_daily 무접점 CONFIRM.**
- `form_submissions` 아웃바운드 FK = customers·check_ins·clinics·form_templates·staff·form_submissions(self) 뿐. **payments/service_charges/closing/fct_revenue_daily 로의 FK 0.**
- payments/service_charges → form_submissions 인바운드 FK = **0** (오직 form_submissions_audit_log RESTRICT[count 0] + self SET NULL).
- 6계정 재무·의료 자식 전건 0:

| table | 6계정 합계 |
|-------|-----------|
| payments | 0 |
| service_charges | 0 |
| package_payments | 0 |
| package_credit_ledger | 0 |
| medical_charts | 0 |
| prescriptions | 0 |
| insurance_claims | 0 |
| consent_forms | 0 |

- **F-4427(풋테스트1) 원장보존 매출영향 = 0** (F-4427 payments/sc/ledger 전건 0). CONFIRM.

## 4. Path-A dry-run → **Path-B 필요** (§헤드라인 참조)
무영속 3요소: sub-block SQLSTATE trap + 커밋 없는 sentinel RAISE 원자롤백 + post-probe 3행 잔존(NO_PERSISTENCE PASS).

## 5. is_test 컬럼 실재 재확인 (foot customers)
- `customers` 컬럼: **is_simulation(boolean, default false) 만 존재. `is_test` 컬럼 ABSENT.**
- ⇒ Leg B flip(현 4계정: 서류테스트 F-4990·총괄테스트중 F-4574·서류테스트2 F-5113·**풋테스트1 F-4427 신규**)은 **DA CONSULT p00f(is_test ADDITIVE) GO 선행 필수.** 컬럼 부재로 미집행 HOLD.

---

## 게이트/HOLD 상태 (변경 없음 — READ-ONLY 종결)
- apply 전체 **HOLD 유지.** GO-token 前 prod DELETE/DDL/DISABLE 선집행 **없음**(본 작업 = census + 무영속 dry-run 까지만).
- 잔여 게이트(planner 라우팅 대상): (1) DA 재프레이밍 falsified 반영 재판정 + (2) 총괄 김주연 확대 confirm + (3) **Path-B → CEO 경량 sign-off (H6, Path-A carve-out 미적용)** + (4) Leg B is_test 컬럼 DA p00f GO(4계정) + (5) supervisor DDL-diff+Dry-Run+tgenabled 재확인+GO-token.

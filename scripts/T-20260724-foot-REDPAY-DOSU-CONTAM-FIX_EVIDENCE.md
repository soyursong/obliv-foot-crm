# T-20260724-foot-REDPAY-DOSU-CONTAM-FIX — 파트B 818행급 child-first archive-first + 파트A parity · CEO 5조건 evidence

- 집행자: dev-foot / 2026-07-25 KST
- ref: rxlomoozakkjesdqjtvd (foot prod) · CEO A안 승인 MSG-20260725-120457-co4i
- ⚠ **DELETE/apply 무실행** — 본 문서는 마이그 재작성 + READ-ONLY 포렌식/freeze evidence. 실행 = supervisor DB-GATE.

---

## 0. ★핵심 발견 (planner FOLLOWUP 대상) — scope moving-target

| 시점 | recon_log child (raw parent 2 에 매달린) | 총 대상 |
|------|------|------|
| supervisor forensic816 (07-25 07:44 KST) | 816 | 818 |
| dev-foot 재작성 freeze (07-25 12:14 KST) | 860 | 862 |
| dev-foot DRY 러너 (07-25 12:23 KST) | **867** | 869 |

- **recon_log child 는 매 poller cycle 계속 증가하는 moving-target.** 원인 = 2 raw parent(body 도수)가 foot DB 에
  잔존 → reconcile 이 매 cycle 재처리 → `match_failed ↔ missing_in_crm` **flapping**(전이) → idempotency 가 정당하게
  매번 로그(전이는 억제 비대상). forensic 분포 436 missing + 424 match_failed = 교대 flapping 실증.
- ⇒ **CEO consent "818" 은 이미 stale**(실측 867+, 증가 중). CEO조건3(판정시점 id 목록 freeze, 불일치 abort)이
  literal 로는 불충족. → **planner/CEO scope 재확인 필요**(아래 §6 권고).
- ⇒ **decisive fix = 2 raw parent DELETE**. parent 제거 시 flapping 소스 소멸 → recon_log 증가 정지 → 영구 수렴.

---

## 1. CEO조건1 — archive-first 2단 · 순소실 0

- 설계: DELETE 대상 = `_backup` archive 에 스냅샷된 **id 집합만**(`id IN archive`). 삭제된 모든 행이 archive 에
  존재 → **순소실 0 구조적 보장**. up.sql 이 `archive_count == delete_count` 를 하드 가드(불일치 시 전체 롤백).
- 러너 `..._apply.mjs` [1단]에서 `_backup.redpay_dosu_contam_raw_20260725`(parent 2) +
  `_backup.redpay_dosu_contam_reconlog_20260725`(child N) 선적재 → 카운트 검증 후에만 [2단] 파괴.
- archive 부재 시 up.sql `to_regclass` 가드로 즉시 abort(파괴 금지).

## 2. CEO조건2 — child-first 순서 (FK 무결성)

- FK: `payment_reconciliation_log.raw_transaction_id → redpay_raw_transactions(id) ON DELETE SET NULL`.
  parent 先삭제 시 child 의 FK 가 silent-nullify → 고아 telemetry 잔존. ⇒ **child(recon_log) 先 DELETE → parent(raw) 後 DELETE**.
- rollback 은 역순(parent 先복원 → child 後복원)으로 FK 성립 보장.

## 3. CEO조건3 — 대상셋 freeze (버그경로 지문 교집합, 단일 count 삭제 금지)

- parent 지문: `approval_no='62071914' ∧ merchant.id='1777276003' ∧ _mode≠'observe'`.
- 판정시점 명시 parent id (실측 full):
  - `f5ca6ec5-9372-466d-9b12-39200ce6e1d0`
  - `60667463-e09b-4a2d-b98b-0175a7c7014c`
  - ⚠ 티켓 truncation `f5ca6ec5-…09b0` 는 실측 `…e1d0` 와 불일치(오탈자 추정) — 지문+full-id 로 재확정. planner 확인 요망.
- child freeze = 러너 archive 시점에 동결된 recon_log id 집합. up.sql 이 `id IN archive` 로만 삭제 → freeze 밖 신규행 미삭제.
- DELETE 직전 재검증: parent 지문<>2, 명시 id 부재, archive<>delete → **즉시 abort**. (단일 count 기준 삭제 아님.)

## 4. CEO조건4 — DESTRUCTIVE→검증→ADDITIVE 분리 + 판정근거 스냅샷

- up.sql = 순수 DESTRUCTIVE DML(archive CREATE=DDL 미포함, DA §4 준수). archive(ADDITIVE)는 러너 [1단] 분리.
- 판정근거 스냅샷: `..._freeze818_FREEZESET.json`(parent 2 id + child id 목록 + 불변식) + `..._freeze818_EVIDENCE.txt`.

## 5. CEO조건5 — 원장(payment/service_charges) 무접점

- READ-ONLY 실측(12:14 & 12:23 KST): child `payment_id NOT NULL = 0` (전량 NULL, forensic816 계승).
- child `external_trxid` 단일 `0723C8124555`, `center='body'` 100%, event_type = `match_failed`/`missing_in_crm` 순수 telemetry.
- up.sql 이 archive된 child `payment_id NOT NULL` 발견 시 abort(원장 접점 → change-class 상향). payments/service_charges 미접촉.

---

## 게이트-0 — 실 leak 경로 prod 포렌식 (파트A 선행)

- 2 raw parent 적재 시각 = `2026-07-23 11:00:33.736451+00`(=20:00:33 KST), `_mode` NULL(observe 아님).
- leak 벡터 = **reconcile 경로 `filterToFootScope` 가 TID-only pass-through**(tidWhitelist 비면 통과) → body merchant
  `1777276003` ingest 통과(webhook EF·poller.mjs 는 merchant-drop 정상, parity 비대칭). scope-filter.ts 헤더 주석 실측 정합.

## 파트A — 필터 parity (근본, 재발방지) · 이미 커밋됨

- `supabase/functions/redpay-reconcile/scope-filter.ts`: `filterToFootScope` = merchant_id 1차 권위 ingest-drop
  (body/unknown drop, merchant 부재시에만 TID 폴백). index.ts L412 wired. (커밋 43328e24 / 3a1c5268)
- drift-assert 회귀 `scope-filter.regress.test.ts` + `reconlog-idempotency.test.ts` **self-QA 22/22 PASS** (deno test).
- ⚠ **커밋됨 ≠ prod 배포됨**. recon_log 가 아직 증가 중 → reconcile EF(merchant-drop) prod 배포 상태 supervisor 확인 필요.
  단 ingest-drop 은 NEW raw 만 차단 — 기존 2 parent 는 미제거. flapping 정지는 parent DELETE 로만 달성.

---

## 6. 권고 실행 순서 (planner/supervisor)

1. **파트A reconcile EF(merchant-drop) prod 배포 확인** (NEW body raw 재유입 차단). [supervisor]
2. **planner/CEO scope 재확인**: consent "818" → 실측 867+(moving). SET 정의(지문, 순수 telemetry)는 불변이나 count 변동.
   재확인 사항: (a) count 변동을 informed-consent 가 포섭하는지, (b) freeze=archive 시점 실측 N 채택 승인.
3. **supervisor DB-GATE apply** (`..._apply.mjs --apply`): [1단] archive → [2단] child-first DELETE(archive==delete) → parent DELETE → residual 계측.
4. parent DELETE 로 flapping 소스 소멸 → recon_log 증가 정지 확인 → residual sweep(archive後 극소 신규분).
5. 풋 457 net 재집계(도수쌍 ±1,004 제거) → 현장 진실값(승인24+취소1/net 10,779,980) 정합.
6. responder relay(thread 1784708681.507149, @U05L6HE7QF6 최필경).

## 산출물
- `supabase/migrations/20260725140000_redpay_dosu_contam_delete.{sql,rollback.sql,dryrun.sql}` (재작성: child-first 818행급)
- `scripts/T-20260724-foot-REDPAY-DOSU-CONTAM-FIX_apply.mjs` (재작성: 2-table child-first archive 러너)
- `scripts/T-20260724-foot-REDPAY-DOSU-CONTAM-FIX_freeze818_READONLY.mjs` + `_freeze818_EVIDENCE.txt` + `_freeze818_FREEZESET.json`
- 파트A: `scope-filter.ts` + `scope-filter.regress.test.ts` (기 커밋) · self-QA 22/22 PASS

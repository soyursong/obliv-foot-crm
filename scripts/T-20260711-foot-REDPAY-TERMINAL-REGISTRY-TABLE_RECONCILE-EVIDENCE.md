# T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — redpay family Ledger Reconciliation evidence

FIX-REQUEST **MSG-20260718-022303-rvh4** (supervisor Option A GO + drift 범위 확대) 조치 1~6 evidence.
ref `rxlomoozakkjesdqjtvd` (obliv-foot-crm prod). Management API 직접 SQL(PostgREST 캐시 우회).
runner: `_apply.mjs` / introspect: `_introspect.mjs` / 로그: `_introspect_BEFORE.log`·`_apply.log`·`_introspect_AFTER.log`.

## 조치1 — BEFORE 실측 (원장 유무 AND 객체/데이터 실재 분리) — 2026-07-18 02:36 KST

| 대상 | ledger 원장행 | 객체/데이터 실재 |
|------|:---:|:---|
| 20260710120000 ocr_receipt_redpay_match | **ABSENT** | payments.image_url/ocr_receipt_datetime = 부재, parsed_approval_no = 부재 |
| 20260711140000 redpay_terminal_registry_ssot | **ABSENT** | redpay_terminal_registry = **부재**, v_receipt_settlement_daily = 부재, v_redpay_unclassified_merchants = 부재 |
| 20260714170000 paylog_center_column | **ABSENT** | payment_reconciliation_log.center = 부재, CHECK = 부재 |
| 20260714170100 redpay_dohsu_registry_seed | **ABSENT** | (registry 부재 → body seed 자체 불가) |
| 20260714210000 redpay_body_recon_view_grant | **ABSENT** | v_redpay_reconciliation_body = 부재, role body_recon_ro = 부재 |

- ledger MAX version = `20260718130000` (전후 마이그는 적용됨).
- **핵심 정정**: supervisor 가설(20260714170100 원장행 존재 → body silent-SKIP hazard)과 달리 **5종 전량 ledger ABSENT + object ABSENT**. → silent-SKIP hazard **未발생**(orphan 원장행 0). 단순 2건 drift 도 아닌 **redpay family 전량 미적용**. 정본(prod 실재) 기준 = forward-apply 전량으로 3자(원장·prod·파일) 수렴이 정답.

## 조치3 — VALIDATE fail-closed 프리체크 (20260710 apply 직전 재실측)

- `receipt_ocr_results` total = **0**, `raw_text ~ '[0-9]{13,}'` = **0** → ✅ SAFE. no_full_pan CHECK NOT VALID→VALIDATE 안전(0 실측 전제 유지). >0 abort 조건 미해당.

## 조치2·4·5 — 순서 apply (엄수) + body-seed 실 seed + body 뷰/role

순서: `20260710120000 → 20260711140000 → 20260714170000 → 20260714170100 → 20260714210000`
각 파일 `applyMigration` 헬퍼 경유 = **적용 + schema_migrations 원장 idempotent 기록 단일경로**(orphan 0).
20260714170100 직전 registry 실존(`to_regclass` NOT NULL) 재확인 → **skip-guard 통과 → body 14-band 실제 seed**(silent-drop RC 원천 봉인).

## 조치1·6 — AFTER 실측 (전 항목 GREEN) — 2026-07-18 02:36 KST

- **LEDGER**: 20260710120000 / 20260711140000 / 20260714170000 / 20260714170100 / 20260714210000 = **전량 PRESENT**.
- **registry**: `domain counts = foot:17, body:14` ✅ (body seed 실 materialize — hazard 회피 확증).
- **소비처 재배선**: v_redpay_reconciliation_daily registry-derived = **true**, v_receipt_settlement_daily·v_redpay_unclassified_merchants 실재.
- **paylog center**: `center` NOT NULL DEFAULT `'foot'` + CHECK 실재 (value dist=[] — recon_log 현재 0행, 컬럼/DEFAULT 정상).
- **payments/ocr**: image_url·ocr_receipt_datetime·parsed_approval_no 실재.

### 20260714210000 deploy-precheck 4점 (격리 실측)
- (i) `v_redpay_reconciliation_body` center 컬럼 노출 count = **0** (MUST 0) ✅
- (ii) `body_recon_ro` grant: base(payment_reconciliation_log)=**false** / foot뷰=**false** / body뷰=**true** ✅
- (iii) FE 번들 크리덴셜 0 = **dev-body side**(foot 마이그 범위 밖 — role passwordless=inert, 로그인 불가).
- (iv) foot 대칭뷰 v_redpay_reconciliation_daily = **실재**(registry 파생) ✅

## prod 안전성
- Management API `/database/query` = 파일당 단일 txn. 5종 전량 성공(부분적용/실패 롤백 0). 전량 ADDITIVE(신규 컬럼/테이블/뷰/role, DROP·타입변경·enum제거 0). 기존 데이터 파괴 0. role body_recon_ro 는 패스워드 미설정(로그인 불가 = inert, 크리덴셜=supervisor vault 서브스텝).

## 거버넌스 flag (비블로킹 fast-follow)
- 원 `mig_dryrun: pass`(20260711) = stub-deps FALSE PASS(no-persistence/sentinel-bypass class). dryrun 러너가 실제 선행-마이그 상태(또는 명시 dep-chain) 위에서 돌도록 보강 요망 — `migration_dryrun_no_persistence_standard.md`. 본 remediation 비블로킹.

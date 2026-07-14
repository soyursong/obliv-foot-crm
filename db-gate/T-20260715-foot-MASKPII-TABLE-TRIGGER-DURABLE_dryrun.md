# T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — dry-run + blast-radius 증빙

- ticket: T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE (P1/foot)
- **1차게이트 상태: DA CONSULT-REPLY GO(조건부) 수신** (MSG-20260715-014202-e3cz, 2026-07-15) — 하드닝 2조건 반영 완료(아래).
- 근거 DA signoff: `memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_maskpii_table_trigger_durable_signoff_20260715.md`
- 계보 DA decision: `memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_maskreject_writepath_rescope_20260715.md`
- 성격: **db_only · ADDITIVE**(신규 트리거 함수 + 트리거 / 스키마·컬럼·enum 무변경). 旣GO helper `_fn_is_masked_pii` 재사용(신규 predicate 0).
- migration: `supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql`
- rollback:  `supabase/migrations/20260715130000_customers_maskreject_table_trigger.rollback.sql`
- dry-run runner: `scripts/..._dryrun.mjs` (BEGIN…ROLLBACK 무영속, txn-control strip)
- fp 감사 runner: `scripts/..._fp_audit.mjs` (READ-ONLY prod)

## 설계 요약
`customers` BEFORE INSERT OR UPDATE FOR EACH ROW 트리거 → `_fn_is_masked_pii(NEW.name, NEW.phone)` 참이면 fail-closed `RAISE 22023`.
- 11 INSERT경로 + 미래 전경로 + UPDATE 4경로(update_personal_info / save_customer_address / complete_prescreen_checklist / rrn_match)를 **한 곳에서 폐쇄**. per-RPC 4가드 신설 없음(DA 지시).
- rrn_match 자연 면제: 트리거는 customers.name/phone **최종값(NEW)** 만 검사 → 마스킹 RRN 을 비교 입력으로만 받는 경로는 name/phone raw 유지 시 통과.
- **UPDATE unchanged-short-circuit**: `TG_OP='UPDATE' AND name·phone 양축 미변경` → 재검사 면제. grandfathered flagged 행(아래 9행)의 무관 필드 UPDATE 를 막지 않아 false-positive 회귀0. SET-to-masked(정상행 corruption) 은 여전히 차단.
  - **하드닝①(DA-GO 조건, 반영완료)**: 미변경 비교는 **NULL-safe `IS NOT DISTINCT FROM`** (`=` 아님) — NULL phone(정당 미수집)·sentinel 조합 미변경 오판 제거. 마이그레이션 함수에 이미 적용됨.
  - **하드닝②(DA-GO 조건, 반영완료)**: prod 사후검증 = dry-run 무영속(INV-3: txn-control strip + plpgsql exception-handler + `pg_trigger` post-probe has_trigger=false) + apply 후 `has_trigger=true` + grandfathered 9행 무관 UPDATE 1건 스모크 → supervisor MIG-GATE 착지항.

## Blast-radius 감사 (READ-ONLY prod, apply 前) — DA 판정 3항 근거

### 판정항 1) 정상 write false-positive 감사
customers 353행 중 helper flagged = **9행**:

| 축 | phone 유효자릿수 | n | first | last | created_by |
|----|----|----|----|----|----|
| name_star (name 에 `*`) | 4 | 7 | 2026-07-13 | 2026-07-14 | (null) |
| phone_short (phone 자릿수 1~7) | 4 | 2 | 2026-07-11 | 2026-07-13 | (null) |

- 9행 전부 `created_by = NULL` = **anon SECURITY DEFINER RPC 산**(세션 유저 무) = per-RPC whack-a-mole 이 bound 못한 그 경로. e3216e83 은 name_star 7행 중 하나.
- name_star 7행 = e3216e83-type **마스킹 오염**(정상 write 아님). phone_short 2행 = phone 유효자릿수 4 → DA 정당/오염 분류 요청.
- **sentinel "미확인" 통과 확인**: `_fn_is_masked_pii('미확인', 정상phone)=false`, `(…, NULL)=false` → 정상 통과(false-reject 무). ✅

### 판정항 2) hold 경로 무접점
WS-A hold(self_checkin unlinked)는 masked payload 시 customers INSERT 거부·customer_id NULL·denorm "미확인" sentinel → **customers row 미생성 = 트리거 미발화**. 트리거는 customers write 에만 발화하므로 hold 경로와 무접점. ✅ (forensic: WRITEPATH-FORENSIC commit 3cca07c5 line 87 재확인)

### 판정항 3) UPDATE NEW 최종값 규약
트리거는 NEW.name/NEW.phone 최종값만 검사. **grandfathered 9행 회귀 방지 위해 unchanged-short-circuit 채택**(위 설계 요약). → DA 판정 요청: (a) short-circuit 규약 승인 여부, (b) name_star 7행 오염은 별도 contam-backfill 로 정리(트리거는 grandfathered 로 통과시키되 정정 UPDATE 는 허용) — 정합 확인.

## dry-run 결과 (무영속 BEGIN…ROLLBACK)

| test | 기대 | 결과 |
|----|----|----|
| A_insert_masked_name | reject 22023 | ✅ rejected 22023 |
| B_insert_masked_phone (자릿수4) | reject 22023 | ✅ rejected 22023 |
| C_insert_clean | pass | ✅ passed(inserted) |
| D_update_clean_to_masked_phone (corruption) | reject 22023 | ✅ rejected 22023 |
| E_update_clean_to_masked_name (corruption) | reject 22023 | ✅ rejected 22023 |
| F_grandfathered_unchanged (무관 UPDATE) | pass(회귀0) | ✅ passed(short-circuit) |
| G_grandfathered_correction (masked→raw) | pass | ✅ passed |
| H_change_to_masked (변경 & masked) | reject 22023 | ✅ rejected 22023 |
| I_insert_sentinel_name ('미확인'+raw phone) | pass(false-reject 無) | ✅ passed |
| I2_null_sentinel_helper (NULL/sentinel/dummy) | pass(false-reject 無) | ✅ passed |
| TRIGGER_PRESENT (in-tx) | true | ✅ true |
| POST-TX has_trigger (prod 무영속) | false | ✅ false |

→ **판정: PASS** — 폐쇄 정상 + corruption 차단 + 회귀0(short-circuit) + 정정 허용 + sentinel/NULL false-reject 無 + 무영속 확증.

## Q2 순서 강제 (DA CONSULT-REPLY) — 트리거=문 / 9행=별도 백필
- 본 트리거 = **소스 봉쇄(door)**. 오염 9행 정리는 **별도 DESTRUCTIVE contam-backfill 티켓**(20260714020000 계열) — 본 티켓에 혼입 금지(트리거가 기존행 정리 시도 시 정당 UPDATE 파괴).
- **순서**: (1) 트리거 apply + `has_trigger=true` + 스모크 → 소스 정의상 봉쇄 확정 → (2) **그 후에만** 9행 백필 착수. 본 트리거가 백필을 unblock(2026-07-14 백필 mutation0 중단 사유 = 소스 미봉쇄).
- **★트리거↔백필 상호작용**: 백필 정정 UPDATE 는 name·phone **양축을 한 UPDATE 로 최종 non-masked 값**으로 써야 함. 한 축만 정정 시 → 변경축으로 short-circuit 미발동 → 잔존 masked축에 helper true → RAISE 로 백필 차단(dry-run H 케이스가 이를 실증). 백필 티켓 설계가 반영해야 함(planner TICKET-REQ 대상).

## 게이트 상태 (apply 前)
- [x] dry-run PASS (무영속 확증 has_trigger=false, 10 케이스)
- [x] false-positive 감사 완료 (9행 특정 + sentinel/NULL/dummy 통과 실증)
- [x] **1차게이트: DA blast-radius CONSULT-REPLY GO(조건부)** 수신 (MSG-20260715-014202-e3cz) — 하드닝 2조건 반영완료(IS NOT DISTINCT FROM + prod 사후검증 착지항)
- [ ] **supervisor DDL-diff(pg_trigger) 단일게이트** ← 다음 단계(DA 지시). §3.1 대표게이트 면제(회귀0 실증 완료). prod apply + has_trigger=true + 스모크는 supervisor MIG-GATE 소관.
- E2E: db_only → Playwright 면제. 검증 = dry-run 10행위테스트로 갈음(면제≠검증 면제).

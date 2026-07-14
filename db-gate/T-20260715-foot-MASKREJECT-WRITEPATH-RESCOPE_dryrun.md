# T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE — dry-run 증거 (무영속)

**작성**: dev-foot / 2026-07-15
**마이그**: `supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.sql` (+ `.rollback.sql`)
**러너**: `scripts/T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE_dryrun.mjs` (Management API, BEGIN…ROLLBACK 무영속)
**forensic**: `scripts/T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE_forensic.mjs` (READ-ONLY, e3216e83 실경로 특정)
**DA CONSULT-REPLY**: MSG-20260715-001514-b6jm / DA-20260715-FOOT-MASKREJECT-WRITEPATH-RESCOPE

---

## 1) 확장 범위 (DA RE-SCOPE)

旣GO 공유 helper `public._fn_is_masked_pii(text,text)`(20260714120000, prod n=1)의 fail-closed reject 를
**2경로**에 확장. 신규 predicate 0 · 스키마/컬럼/enum 무변경 = **ADDITIVE**(旣GO helper 연장).

| 경로 | write | 가드 배치 | 근거 |
|------|-------|-----------|------|
| `fn_dashboard_reissue_health_q_token` | customers INSERT(신규) + '미등록' UPDATE | **BEGIN 직후 상단** | masked 입력에 보존할 no-persist 성공동작 無 → 상단 reject 부작용 없음 |
| `upsert_reservation_from_source` | customers INSERT/UPSERT | **customers persist 경계(비-companion 분기, INSERT 직전)** | 취소 fast-path·companion 무write 경로를 hard-fail 로 전환 안 함(DA Q2 carve-out 동형) |

- **self_checkin_with_reservation_link 제외** (DA Q2): WS-A soft-hold 로 이미 가드(masked → customers 미INSERT·customer_id NULL·"미확인" sentinel). blanket reject 는 dead code 이거나 soft-hold UX 를 hard-fail 로 전환.
- **UPDATE 4경로 미포함** (DA Q3): 별도 durable table-level trigger 티켓으로 흡수. per-RPC 가드 추가 안 함.

## 2) e3216e83 실경로 특정 (선행조건, READ-ONLY forensic)

apply(REPRO Phase2, 07-14 10:32 KST) 이후 생성된 유일 마스킹 row `e3216e83`("접****1"/"7887"/F-4759) 지문:

| 지문 | 값 | 판정 |
|------|-----|------|
| `customers.created_by` | `NULL` | self_checkin_create('self_checkin' stamp) **아님** |
| `reservations` (customer_id=e3216e83) | **0건** | 이 row 는 upsert_reservation_from_source 산 아님 |
| `health_q_tokens` | 1건, `form_type='general'`, 정확히 +24h 만료 | **fn_dashboard_reissue_health_q_token 지문 확정** |
| `check_ins.changed_by`(status_transitions) | `'self_checkin'` (registered→receiving) | 已생성 마스킹 customer 에 phone-match link 한 **하류** 이벤트(생성 벡터 아님) |

⇒ **e3216e83 = `fn_dashboard_reissue_health_q_token` 산.** hold 경로 아님 → DA 가설(hold 가 customers INSERT 차단 ∴ 2경로 산) 확증. self_checkin 제외 정당.

## 3) helper predicate 정오탐 (라이브, READ-ONLY)

```
_fn_is_masked_pii('접****1','7887')          = true   (masked row 지문 → reject)
_fn_is_masked_pii('홍길동','+821012345678')   = false  (정상 → 통과)
_fn_is_masked_pii('미등록', NULL)             = false  (reissue 폴백 default → 통과, false-reject 0)
_fn_is_masked_pii(NULL,'+821012345678')      = false  (성함 미제공 정상 → 통과)
```

## 4) 행위 테스트 (in-tx, BEGIN…ROLLBACK 무영속)

| 테스트 | 시나리오 | 결과 | 판정 |
|--------|----------|------|------|
| A | reissue 마스킹('접****1'/'7887') | **rejected 22023** | 가드 fire ✅ |
| B | reissue 정상('홍길동') + 없는 clinic | passed guard → clinic_not_found | 회귀 무·false-reject 0 ✅ |
| C | upsert 마스킹 active('접****1'/'7887', real slug) | **rejected 22023** | customers persist 경계 가드 fire ✅ |
| D | upsert 마스킹 + **취소 fast-path**(없는 external_id) | no-reject, returned NULL | carve-out: 취소 hard-fail 무 ✅ |
| E | upsert 정상('김정상') active(real slug) | passed guard → reservation ok | 회귀 무·false-reject 0 ✅ |

- **GUARD_PRESENT** in-tx: `fn_dashboard_reissue_health_q_token`=true, `upsert_reservation_from_source`=true.

## 5) 무영속 확증 (Migration Dry-Run No-Persistence Protocol)

- up.sql 의 top-level txn-control(`BEGIN;`/`COMMIT;`) strip → 러너가 `BEGIN…ROLLBACK` 로 감쌈(COMMIT sentinel-bypass 차단).
- **post-tx introspection(별도 쿼리)**: prod 실재 두 함수 `has_guard=false` → dry-run **무영속** 확증(supervisor DDL-diff apply 前 상태 불변).

## 6) 회귀/게이트

- **ADDITIVE**: `ALTER TABLE`/`CREATE TABLE`/`ADD COLUMN`/`CREATE TYPE` 0 — 함수 본문에 가드 IF 만 가산. 본문은 prod `pg_get_functiondef`(2026-07-15) verbatim.
- **GRANT/ACL 무변경**: CREATE OR REPLACE 가 기존 ACL 보존(reissue=anon+authenticated+service_role / upsert=anon+service_role).
- **롤백 가역**: `.rollback.sql` = 가드-前 정의 복원(helper DROP 안 함 — 20260714120000 공유 자산).
- **게이트**: DA GO(旣GO helper 연장) + ADDITIVE → 대표 게이트 면제(autonomy §3.1). **supervisor DDL-diff(pg_proc) 단일게이트**.
- ⚠ **write-path "closed" 선언 유보** — durable table-level trigger 착지까지(DA 지시 §요약 2·3). 본 티켓은 소스차단 부분전진(2/추가경로), 완결 아님.

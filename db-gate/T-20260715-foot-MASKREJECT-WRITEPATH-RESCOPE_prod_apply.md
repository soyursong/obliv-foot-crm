# T-20260715-foot-WRITEPATH-MASK-SOURCE-CLOSE-R2 — PROD APPLY 증거

- **ticket**: T-20260715-foot-WRITEPATH-MASK-SOURCE-CLOSE-R2
- **migration**: `supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.sql` (DB-only)
- **게이트**: supervisor DDL-diff = PASS(ticket §125~131) + DA CONSULT-REPLY GO(MSG-20260715-001514-b6jm) + supervisor PUSH-ESCALATION apply 지시(MSG-20260715-182431-m3do). ADDITIVE → 대표 게이트 면제(§3.1).
- **runner**: `scripts/T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE_prod_apply.mjs`

## apply timestamp

- **KST**: 2026-07-15 18:30:49.159708
- **UTC**: 2026-07-15 09:30:49.159708+00

## PRE (apply 前)

- 원장 `20260715120000` 기존기록 n=0 (forward-only, collision 0)
- `fn_dashboard_reissue_health_q_token` has_guard=**false**
- `upsert_reservation_from_source` has_guard=**false**
- 공유 helper `_fn_is_masked_pii` n=1 (20260714120000 旣GO)

## POST-PROBE (apply 後) — 전부 PASS ✅

| 항목 | 결과 |
|------|------|
| 가드 지문 present: `fn_dashboard_reissue_health_q_token` | ✅ has_guard=true |
| 가드 지문 present: `upsert_reservation_from_source` | ✅ has_guard=true |
| 원장 기록 | ✅ version=20260715120000 name=maskreject_writepath_rescope_2paths |
| 공유 helper `_fn_is_masked_pii` 영속 | ✅ n=1 |

### 가드 행위 확인 (무영속 BEGIN..ROLLBACK)

| 케이스 | 결과 | 기대 |
|--------|------|------|
| A reissue masked (`접****1`/`7887`) | rejected 22023 | ✅ reject |
| B reissue legit (`홍길동`, no clinic) | passed → clinic_not_found | ✅ false-reject 0 |
| C upsert masked active | rejected 22023 | ✅ reject |
| D upsert masked 취소 fast-path | no-reject, returned NULL | ✅ carve-out 무해 |
| E upsert legit active (`김정상`) | passed → reservation ok | ✅ false-reject 0 |

### 신규 masked customers write 0 (소스차단 사후 확증)

- apply 직후 10분내 신규 masked customers = **0건** ✅
- (참고) 잔존 masked customers 총 9건 — 정정은 CONTAM-BACKFILL 소관(소스차단=본 R2).

## 판정: PASS ✅ (2경로 가드 present + fire + 회귀 0 + 신규 masked write 0)

## 롤백

- `supabase/migrations/20260715120000_maskreject_writepath_rescope_2paths.rollback.sql` — 2함수 가드-前 정의 CREATE OR REPLACE 복원. helper DROP 없음(20260714120000 소관). 단일 tx·데이터 무변경·멱등.

## 유보 (DA 지시)

- write-path "closed" 선언 유보 — UPDATE 4경로 durable table-level trigger(T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE) 착지 후 완결.
- 하류 CONTAM-BACKFILL freeze 재산출은 trigger 착지까지 대기 권고.

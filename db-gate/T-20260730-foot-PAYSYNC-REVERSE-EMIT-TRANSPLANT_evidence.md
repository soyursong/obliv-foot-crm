# T-20260730-foot-PAYSYNC-REVERSE-EMIT-TRANSPLANT — DB-GATE evidence

> dev-foot / 2026-07-30 · DA GO(조건부) 수신 후 구현. change-class = **ADDITIVE**.
> DA: DA-20260730-XCRM-CUECARD-FUNNEL-PAYSYNC (MSG-o3e6) + addendum DA-20260730-FOOT-PAYSYNC-REVERSE-EMIT-Q1Q4 (MSG-6psu).
> 대표게이트 = ADDITIVE + DA GO → autonomy §3.1 면제. 잔여 게이트 = **supervisor DDL-diff**.

## 1. introspect-first (상속 가정 금지) — foot DB 실측 2026-07-30
| 확인 | 결과 |
|------|------|
| `to_regclass('public.payment_sync_outbox')` | **NULL (부재)** → 신설 정당(ADDITIVE) |
| `payments` 컬럼 | check_in_id(uuid, nullable), amount(int, NOT NULL), payment_type(text, nullable, default 'payment'), created_at, external_id(uuid) + VAN 대사컬럼(external_trxid/external_approval_no/external_tid/external_root_trxid/external_status) 실재 |
| `check_ins.reservation_id` | 실재 |
| `reservations.source_system` / `reservations.external_id` | 둘 다 실재 |
| `get_vault_secret()` | 실재 (20260603/20260525 선례) |

★ **Q2 정정 근거 확인**: foot `payments` 는 VAN/RedPay 대사 주석컬럼(external_trxid/approval_no/tid/root_trxid) 보유 →
payments.external_id 류를 cue link 로 쓰면 POS/VAN 거래식별자와 시맨틱 충돌. → cue link = **reservations.external_id 단독**(정본 resolver).

## 2. change-class = ADDITIVE (파괴변경 0)
- 신규: 테이블 1(`payment_sync_outbox`, target_crm 컬럼 **없음**) + enqueue fn 1 + payments AFTER INSERT 트리거 1 + drain/alert fn 2 + cron 1(`foot-payment-sync-drain`).
- 무접촉: payments 본체 / dopamine_callback_outbox(visited·no_show·cancelled·rejected) + 그 트리거/워커/cron(관심사 격리).
- DROP / 기존컬럼 ALTER / backfill = **0**. 트리거 `EXCEPTION→WARNING`(결제 tx 절대 비차단).
- 롤백 = `20260730200000_foot_payment_sync_outbox_emit.rollback.sql` (cron→trigger→fn→table 역순 DROP).

## 3. dry-run (No-Persistence Protocol) — dev-isolation DB 실행 결과
`20260730200000_foot_payment_sync_outbox_emit.dryrun.sql` — 단일 DO 블록 무영속 실행 → 말미 RAISE unwind.

```
DRYRUN RESULT: ALL PASS
(A) 신설 전 payment_sync_outbox 부재(대조군): PASS
(B1) UNIQUE(crm_payment_id): PASS
(B2) target_crm 컬럼 부재(단일대상): PASS
(C) trigger AFTER INSERT ON payments: PASS
(D) 도파민 결제 → outbox 1행(cue=reservations.external_id): PASS
(E) 추가결제 ON CONFLICT DO NOTHING(방문당 1행 멱등): PASS
(F) 비-도파민 결제 무적재(누출가드): PASS

POST-PROBE to_regclass: null  (무영속 재확인 — 신설이 롤백됨)
```

## 4. EF / resolver self-QA
- `deno check supabase/functions/crm-payment-sync-emit/index.ts` → OK
- `deno check supabase/functions/_shared/external-id.ts` → OK
- `deno test supabase/functions/_shared/external-id.test.ts` → **8 passed / 0 failed**
  (평문 UUID 후방호환 · 동행 base 추출+isCompanion=true · 비UUID/빈동행key/prefix없음 permanent-DLQ · null 누출가드 · case-insensitive).
- FE `npm run build` → OK (FE 무접촉, 회귀 0).

## 5. supervisor 배포 게이트 (POST-DEPLOY, DA GO 후에만)
1. migration `20260730200000_foot_payment_sync_outbox_emit.sql` 적용(단일 tx) + POST-DEPLOY CHECK 8항.
2. EF `crm-payment-sync-emit` 배포 + env 주입:
   - `DOPAMINE_CALLBACK_URL`(도파민 functions base 또는 full endpoint)
   - `FOOT_CALLBACK_SECRET`(우선) → `DOPAMINE_CALLBACK_SECRET`(폴백)
   - `PAYMENT_SYNC_EMIT_ENABLED` = **'false'(기본 dark)** — 수신부 확인 전 조기발사 방지.
3. 수신부 도파민 `crm-payment-callback` 이 `source_system='foot'` + payload 계약 수용 확인.
4. 위 3 확인 후 `PAYMENT_SYNC_EMIT_ENABLED='true'` flip → live.
5. (READ-ONLY probe, prod, addendum §7) DoD 분모 = emit-eligible DISTINCT check_in 모수 계수(companion 제외) + companion 비중 특성화.
6. soak: 7일 대사 GREEN + 결제 회수율 ≥95%(companion=DoD 분모 제외).

## 6. 필수 제약 충족 매핑 (티켓)
| 제약 | 충족 |
|------|------|
| ① payload cue_card_id 직접 포함(external_id 조인 의존 금지) | EF payload.cue_card_id = resolveBaseCueCardId 로 emit 시점 1회 해소 → clean UUID 직송(수신부 재조인 0) |
| ② outbox + retry + DLQ(fire-and-forget 금지) | payment_sync_outbox + drain cron(분당) + backoff 1·2·4·8·16·32·60min + attempts>=7→dlq + 슬랙 알람 |
| ③ 멱등(중복 계상 0) | crm_payment_id=check_in_id::text UNIQUE + ON CONFLICT DO NOTHING(발신) + 수신부 cue_cards.crm_payment_id 전역 UNIQUE(INV-PAYID-1, 이중방어) |
| ④ COMPANION 가드 | isCompanion=true → companion_no_cue_attribution 종결(무발신), 부모 cue 오귀속 금지 |

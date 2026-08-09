# T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — #7 is_healer_intent apply / STEP-1 no-persistence probe

- prod: rxlomoozakkjesdqjtvd | 2026-08-09T22:08:02Z (UTC) | mode: **READ-ONLY probe (no persistence, SELECT only)**
- runner: `scripts/T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT_healer-intent_probe.mjs`
- lane: apply-guard 밖 introspection. ★ 어떤 DDL/DML 도 실행하지 않음.
- GO-token 가드 준수: **prod DDL 선집행 없음 (apply_before_go 미발생)**. GO-token 미요청(사유는 아래 DISPOSITION).

## [A] 대상 컬럼 부재 재확인 → 결과: **이미 존재(present)**
```
information_schema.columns (public.reservations.is_healer_intent):
[{"column_name":"is_healer_intent","data_type":"boolean","is_nullable":"NO","column_default":"false"}]
```
→ 마이그 20260614130000 선언(`ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false`)과 **메타 완전일치**.
   (boolean / NOT NULL / default false)

## [B] DRIFT 재대조 — 동명이표(is_healer_intent 보유 테이블) 전수 스캔
```
[{"table_schema":"cleanup_bak_20260628110546","table_name":"reservations"},
 {"table_schema":"public","table_name":"reservations"}]
```
→ `public.reservations` = 정본(대상). `cleanup_bak_20260628110546.reservations` = 06-28 cleanup **백업 스키마 스냅샷**(아카이브 사본, 라이브 아님).
→ **라이브 public 축에 동명이표 DRIFT 없음.** 티켓 #A 자동롤백을 유발했던 "prod 동명이표 DRIFT" 는 현 시점 public 에서 재현되지 않음.

## [C] 마이그 원장(schema_migrations)
```
[{"version":"20260614130000","name":"reservation_is_healer_intent","created_by":"ledger-drift-sweep-track3"}]
```
→ 원장에 version 기록됨 (ledger-drift-sweep 로 reconcile 완료 상태).

## [D] parity 컨텍스트
```
{"total":1791, "healer_flag_true":0}
```
→ reservations 총 1791행. healer_flag=true = **0행** (backfill 상한 0 — 본 apply 는 backfill 제외이며, 별도 backfill 티켓도 현재 대상 0행).

## [E] 테이블 유형
```
public.reservations: {"table_type":"BASE TABLE"}
```

## VERDICT: **ALREADY-PRESENT (idempotent no-op)**
- `is_healer_intent` 컬럼은 prod public.reservations 에 **이미 존재하며 메타가 마이그 선언과 정확히 일치**.
- `ADD COLUMN IF NOT EXISTS ...` 재실행 시 = **순수 no-op**(변경 0). 즉 #7 컬럼 ADD 는 사실상 이미 완료 상태.
- Jun-16 evidence(APPLY PASS)와 현 prod 실재가 **일치** → #A 관련 "자동롤백으로 컬럼이 소실됐다"는 우려는 현 실측상 성립하지 않음(컬럼 온전).

## DISPOSITION (dev-foot)
1. **prod 쓰기 미집행.** GO-token 가드에 따라 GO-token 前 DDL 선집행 금지 준수 — 그리고 apply 대상이 no-op 이라 실집행 의미 없음.
2. **GO-token 자체 요청 안 함.** 티켓 sequence 는 "컬럼 부재" 전제로 설계됐으나 probe 로 전제가 falsified(컬럼 존재) → no-op apply 를 위한 GO-token 요청은 불필요 오버헤드. 처분은 planner 결정으로 라우팅.
3. planner FOLLOWUP 발행: #7 = already-satisfied 권고 + backfill(#C, T-20260615-foot-IS-HEALER-INTENT-BACKFILL) 은 현재 healer_flag_true=0 이라 대상 0행 → 필요성 재판단 요청.
4. #C room_assignments = supervisor db-gate lane (dev-foot 비주관) — 무접촉.

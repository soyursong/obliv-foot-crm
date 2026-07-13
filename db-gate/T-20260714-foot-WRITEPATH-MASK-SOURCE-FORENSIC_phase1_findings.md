# T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC — Phase 1 포렌식 증거 (READ-ONLY)

> READ-ONLY prod 검증 (Management API). UPDATE/DELETE/INSERT **0** (behavioral probe 는 DO+RAISE 원자롤백 = 무영속).
> PHI 위생(§4): 실명/전체번호 미기재 — 8자 PK·길이·tail 4자리만.
> 실행: dev-foot / 2026-07-14 00:5x (KST). BACKFILL(T-20260713…CONTAM-BACKFILL) 2차게이트 BLOCK 후속.
> 스크립트: `scripts/T-20260714-foot-WRITEPATH-MASK-SOURCE-FORENSIC_phase1{,b,c}.mjs`

---

## ★ 결론 요약

| 항목 | 결과 |
|---|---|
| **가설 판별** | **(i) apply 무영속/지연** — WS-A 가드가 13:05 커밋 시점에 prod 발효 안 됨. **(ii) 두 번째 벡터 반증** |
| 오염 write 벡터 | 전부 `self_checkin_with_reservation_link` (WS-A 가 패치한 바로 그 함수) — 단일 벡터 |
| 3자 대조 (i-test) | **CONVERGENT** — 원장 20260713120000 ✓ / prod 함수 지문+behavior ✓ / 파일선언 ✓ |
| 가드 현재 발효 | ✅ **behavioral probe 로 실증** (마스킹 payload 거부·`미확인` sentinel·customer INSERT 0) |
| 소스 닫힘 | ✅ 확정 — 구조적(가드 live) + 경험적(마지막 오염 이후 유입 0) |
| 마지막 오염 write | check_in `dbca2465` @ **2026-07-13 16:32:46 KST** (name-masked) |
| 소스 닫힘 확정시각 | 가드 발효 = behavioral probe 시점(**2026-07-14 00:5x KST**)에 확증. 발효 window = 16:32:46 이후 |
| freeze tz 재산출 | 마스킹 customers 7건 전부 오염 — 단 실 윈도우 END = 13:05 아닌 ~18:04 |
| 백필 선결조건 | ✅ **충족** — 소스 차단 확정 → BACKFILL unblock 권고 |

---

## 1. Phase 1 ①  customers/check_ins name write 경로 전수 열거 (pg_proc 기계 스캔)

customers/check_ins 를 INSERT/UPDATE 하는 함수 = **18개**. 이 중 **name(고객명/denorm) write + anon 실행가능 + INSERT** 경로:

| 함수 | ins_cust | ins_ci | name write | anon EXEC | **마스킹 가드** | 비고 |
|---|---|---|---|---|---|---|
| **self_checkin_with_reservation_link** | ✓ | ✓ | ✓ | ✓ | ✅ **유일 보유** | 키오스크 체크인 write (오염 벡터) |
| self_checkin_create | ✓ | ✓ | ✓ | ✓ | ❌ | 키오스크 미호출(레거시) |
| fn_selfcheckin_create_check_in | · | ✓ | ✓ | ✓ | ❌ | 키오스크 미호출 |
| fn_selfcheckin_upsert_customer | ✓ | · | · | ✓ | ❌ | 키오스크 미호출 |
| fn_selfcheckin_upsert_customer_resolve_v2/v3 | ✓ | · | · | ✓ | ❌ | 키오스크 미호출 |
| batch_checkin | · | ✓ | ✓ | ✓ | ❌ | 스태프 일괄 |
| reservation_to_checkin | · | ✓ | ✓ | ✓ | ❌ | 예약→체크인 |
| upsert_reservation_from_source | ✓ | · | ✓ | auth only | ❌ | 도파민 ingest |
| fn_sync_customer_name (트리거) | · | upd_ci | ✓ | — | ❌ | customers.name→check_ins denorm 동기화 |

**핵심**: 마스킹 가드는 `self_checkin_with_reservation_link` **1개에만** 존재. 나머지는 미가드.
**단, 키오스크(foot-checkin) 의 유일 customer/check_in INSERT 경로 = `self_checkin_with_reservation_link`** (SelfCheckIn.tsx L1960, `.rpc(...)`).
키오스크가 호출하는 `fn_selfcheckin_update_personal_info` 는 name 을 write 하지 않음(주소/RRN/동의만). → **관측 오염 벡터는 self_checkin 단일**. 나머지 미가드 경로는 잠재 위험(스태프 FE 는 raw 성함 입력)이나 본 사고의 활성 벡터 아님. → Phase 2 defense-in-depth 후보(DA, non-blocking).

트리거: customers/check_ins 각 4·6개(chart_number/phone_dummy/sync_name/updated_at/waiting_board/dopamine_cb 등) — name 마스킹 유입 경로 아님.

---

## 2. Phase 1 ②  가설 (i) vs (ii) 판별

### 2-A. 가드 이후 생성 masked customers 5건의 write 경로 = 전부 self_checkin (단일 벡터)

가드 커밋(13:05) 이후 생성된 masked customers **5건**의 참조 check_ins 는 **전부** `status_transitions.changed_by='self_checkin'` 의 `registered→receiving/…` 최초전이를 보유:

| customer(8) | check_in(8) | created (KST) | denorm name | resv_id | 경로 마커 |
|---|---|---|---|---|---|
| 67ea1793 | 3ac02464 | 07-13 14:01:52 | MASKED(*) | NULL | self_checkin |
| bd307dfe | e3189149 | 07-13 14:02:02 | MASKED(*) | NULL | self_checkin |
| 44a6a076 | b7929905 | 07-13 14:02:13 | MASKED(*) | NULL | self_checkin |
| 2dc21d1c | f65fa43e | 07-13 14:17:22 | MASKED(*) | NULL | self_checkin |
| 44a6a076 | dbca2465 | 07-13 16:32:46 | MASKED(*) | NULL | self_checkin |
| 02594dfa | 1f5a2cad | 07-13 18:04:45 | name_len4(비마스킹) | NULL | self_checkin |

- 키오스크 호출 `ci_status='receiving'`(초진, SelfCheckIn.tsx L1948) = 관측된 `registered→receiving` 전이와 정확 일치.
- → **(ii) 두 번째/다른 write 벡터 반증.** 스태프 워크인·직접 RPC·admin·EF·트리거 아님. 전부 `self_checkin_with_reservation_link`.

### 2-B. 그 write 들은 **현재 가드 함수가 만들 수 없는 형태** → 당시 미가드 = (i)

관측 check_ins 는 `customer_name` 에 마스킹값(`*`) 저장 + masked customer 신규 INSERT.
현재 가드 함수는 마스킹·resolve불가 시 → **customer INSERT 거부 + `customer_name='미확인'`(sentinel)** (아래 §2-D behavioral 실증).
따라서 14:01~16:32 write 시점의 self_checkin 은 **미가드(구 20260617 정의)** 였음 = **13:05 커밋이 prod 에 발효되지 않았다 → 가설 (i).**

### 2-C. 3자 대조 (Ledger Reconciliation — i-test)

| 축 | 상태 |
|---|---|
| schema_migrations `20260713120000` | present (`selfcheckin_writepath_harden_masked_reject`, created_by dev-foot WS-A) |
| prod 함수 실재 | WS-A 지문 present(`unlinked_masking_hold`/`v_masking_seen`/`미확인`/`WS-A`) + behavior ✓ |
| 파일선언 `20260713120000_*.sql` | `unlinked_masking_hold`·`미확인` 포함 ✓ |

→ **3자 CONVERGENT(현재).** 원장-실재-선언 divergence 없음. = 가드는 **현재 영속**돼 있음.
= (i) 은 "현재 미영속" 이 아니라 **"13:05 커밋 ↔ 실 발효 사이 시차(non-persistence/지연 apply)"**. `schema_migrations` 는 timestamp 컬럼 부재로 실 apply 시각 원장추적 불가(= LEDGER-DRIFT 계열 한계). 데이터(마스킹 write 16:32 까지 지속)가 실 발효를 **16:32 이후**로 확정.

### 2-D. behavioral post-probe — 가드 발효 **실증** (영속 확증, 무영속 dry-run)

현재 prod `self_checkin_with_reservation_link` 에 마스킹 payload(name `최***트`, phone tail `5453`, reservation_id/customer_id 없음) 투입 (단일쿼리 `DO`+`RAISE EXCEPTION` 원자롤백):

```
unlinked_masking_hold = true       ← 가드 발화
customer_id            = null       ← masked customer 신규 INSERT 거부
success                = true       ← 환자 hard-block 안함(DA (c) 준수)
customers count        304 → 304    ← 마스킹 신규 INSERT 0 (probe 전후 불변)
check_ins denorm name  = '미확인'    ← sentinel (마스킹값 저장 안함, DA (d) 준수)
```

→ 지문 present 를 넘어 **함수가 실제로 마스킹을 거부**함을 실증. probe 부작용은 `RAISE` 로 전부 롤백(mutation 0 확인 = count 불변). = planner Phase2 (i) "영속 확증(post-probe)" **충족**.

---

## 3. Phase 1 ③  freeze tz 버그 재산출 (timestamptz 정확비교)

`_freeze_dryrun.mjs` 는 UTC ISO(`+00:00`) 문자열을 KST offset(`+09:00`) 상수와 **사전순 비교** → 오판정.
timestamptz 실비교(KST) 결과:

| customer(8) | created (KST) | name* | phone* | in [07-11,13:05](tz) | after 13:05(tz) |
|---|---|---|---|---|---|
| 0356b229 | 07-11 13:09:47 | · | ✓ | ✓ | · |
| 512998d0 | 07-13 09:32:49 | ✓ | ✓ | ✓ | · |
| 67ea1793 | 07-13 14:01:51 | ✓ | ✓ | · | **✓** |
| bd307dfe | 07-13 14:02:01 | ✓ | ✓ | · | **✓** |
| 44a6a076 | 07-13 14:02:13 | ✓ | ✓ | · | **✓** |
| 2dc21d1c | 07-13 14:17:22 | ✓ | ✓ | · | **✓** |
| 02594dfa | 07-13 18:04:45 | · | ✓(0000/DUMMY) | · | **✓** |

- masked customers 총 **7건** · 실 윈도우 END=13:05 기준 in-window **2건** · 13:05 이후 **5건** · 이전 0건.
- 버그 freeze("윈도우 내 7건")는 우연히 총계는 맞았으나 근거는 오류. **실 오염 윈도우 END = 13:05 이 아니라 실 가드발효(~16:32~18:04)** → 정정 윈도우 [07-11 00:00 ~ 07-13 18:04:45] 기준 **7건 전부 오염 대상**. → BACKFILL 대상셋(7건, 6 resolvable / 1 ambiguous `02594dfa`) **불변**, 근거만 정정.

---

## 4. 소스 닫힘 확정 (Phase 2 step 5)

- **마지막 name-masking write**: check_in `dbca2465` @ 2026-07-13 **16:32:46 KST** (via self_checkin, customer 44a6a076).
- 마지막 masked customers row: `02594dfa` @ 18:04:45 (name 비마스킹, phone 0000 = DUMMY/freeze-ambiguous).
- 16:32:46 이후 신규 **name-masked customers 0 / name-masked check_ins 0** (probe 시점 2026-07-14 00:5x 까지 ~8h+ clean).
- 가드 **현재 발효 실증**(§2-D) + 3자 convergent(§2-C).
- **`미확인` sentinel 행 전체 0건** — 가드 발효 후 마스킹 payload 가 더 이상 유입되지 않았음(상류 키오스크도 정상화) → 가드가 발화할 일이 없었음. 소스 닫힘과 모순 아님(가드 존재+behavior 실증으로 구조적 차단 증명).

### Phase 2 판단 (i 분기)
가드가 **이미 영속 + behavior 실증** → WS-A 재-apply 는 **idempotent no-op** (동일 함수 CREATE OR REPLACE). 재-apply 시 prod DDL write 추가만 발생, 이득 0. planner (i) 목표("영속 확증 post-probe present")는 behavioral probe 로 **이미 달성**. → **db_change 불요**. MIG-GATE/DA-CONSULT 대상 아님.
(만약 supervisor 가 belt-and-suspenders 재-apply 요구 시 = 기존 WS-A DB-GATE MSG-20260713-125902-y9sy 범위 내 idempotent 실행 가능.)

---

## 5. 백필 unblock 권고

Cross-CRM Data-Correction Backfill SOP 제1원칙(**소스 차단 선행**) = **충족**.
→ BACKFILL(T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL) blocked 해제 → dry-run(BEGIN..ROLLBACK, 32 FK re-anchor) → per-row confirm → supervisor 최종게이트 진행 가능.
잔여 미가드 sibling write 경로(§1)는 별건 defense-in-depth(DA CONSULT, non-blocking)로 planner 판단 요청.

*mutation/deploy-ready 미실행. 본 게이트 = READ-ONLY 포렌식 전용.*

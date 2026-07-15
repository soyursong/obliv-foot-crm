# check-in WRITE 정체성 계약 cross-CRM sweep — dev-foot forensic (READ-ONLY)

- **티켓**: T-20260715-meta-CHECKIN-WRITE-IDENTITY-XCRM-SWEEP (P1)
- **CRM**: obliv-foot-crm (롱레 happy-flow-queue 하드포크 계열)
- **결정 SSOT**: memory/_handoff/diagnosis/da_decision_derm_checkin_write_identity_20260715.md
- **선례**: T-20260710-body-SELFCHECKIN-PHONE-SYNC (동일 하드포크 상속)
- **엄수**: 코드 수정·DDL·백필 0. 코드/DB read-only 확인만. prod 도입 = pg_indexes/pg_constraint SELECT(무변경).

---

## 대상 = self-checkin / 체크인 write 계열 RPC 전부

| RPC | 성격 | 예약연결 | 파일 (현행 정의) |
|-----|------|---------|------------------|
| `self_checkin_with_reservation_link(uuid,jsonb,date)` | anon 키오스크 셀프체크인 (주 write RPC) | O | 20260713120000 (0715 carve-out으로 무변경) |
| `self_checkin_create(text,text,text)` | anon phone+name 단순 셀프체크인 | X (예약 미연결) | 20260714120000 L441 |
| `batch_checkin(uuid,jsonb)` | 스태프 일괄 배치 체크인 | O | 20260517000011 |
| `fn_checkin_sync_reservation()` (AFTER INSERT 트리거) | check_in→예약 status 투영 | O | 20260506000010 |
| `fn_selfcheckin_dup_guard(...)` | 당일 중복 조회 가드 | — (read-only, write 0) | 20260602200000 |

---

## 지문① (rebind) — 23505 회피 목적 기존 active check_in 행 재바인딩?

**판정: NO (rebind 부재 / fresh INSERT + 멱등-return)**

- 전 코드베이스 grep `UPDATE check_ins SET reservation_id` → production 0건. 유일 매치 = 탐지 스크립트 자체(`scripts/T-20260715-crm-...SWEEP_divergent.mjs`).
- `self_checkin_with_reservation_link`: 당일 활성 체크인 존재 시 **재바인딩 없이 기존 행 그대로 반환**(멱등). L208-228 (step 2.5 `already_checked_in`) → 신규 발번·INSERT 안 함. 신규는 항상 fresh INSERT (L236-249 step 4). **derm 지문(RPC L54-71 rebind)과 반대 패턴.**
- `batch_checkin`: `IF EXISTS (... check_ins WHERE reservation_id=...) → CONTINUE`(skip). rebind 없음 (20260517000011 L40-43).
- `self_checkin_create`: 예약 미연결 경로, reservation_id 자체를 안 다룸 → rebind 대상 아님.

## 지문② (비원자 sync) — check_in.status 전이 ↔ reservations.status 투영 분리 write?

**판정: RPC/DB 계층 = NO(원자). FE 스태프 계층 = YES(분리 write, 1경로 무-에러핸들).**

- **RPC/트리거 (원자)**:
  - `self_checkin_with_reservation_link`: check_in INSERT(step4) + `UPDATE reservations SET status='checked_in' WHERE status='confirmed'`(step5, L251-257)이 **동일 plpgsql 트랜잭션**. 추가로 AFTER INSERT 트리거 `fn_checkin_sync_reservation`(동일 txn)도 투영 → 원자.
  - `batch_checkin`: INSERT + `UPDATE reservations SET status='checked_in'`(L66)이 동일 txn 루프 내 → 원자.
- **FE 스태프 경로 (비원자, 분리 supabase 호출)**:
  - `NewCheckInDialog.tsx` L397-402: check_in INSERT 후 별도 `reservations.update({status:'checked_in'})` — **에러핸들 없음** → 2차 호출 실패 시 active check_in 있는데 reservations.status='confirmed' stuck = divergence 경로.
  - `Dashboard.tsx` L6117, `ReservationDetailPopup.tsx` L1130: 동일 별도 `reservations.update({status:'checked_in'})`.
  - `CheckInDetailSheet.tsx` L951-971: 체크인 삭제 saga — 예약 복구 먼저 커밋 후 삭제, 실패 시 보상 롤백(명시적 비원자 saga, 보상 있음).
- ⇒ anon 셀프체크인(키오스크) 경로는 원자. divergence 가능 표면은 **스태프 FE 접수/삭제 경로**(별도 REST call, 트랜잭션 미보증).

## 제약 grain — 현행 active check_in 유일성 제약 (실측 prod introspection)

**판정: reservation-scoped (customer+day 아님)**

prod `pg_indexes` (rxlomoozakkjesdqjtvd, 2026-07-15 read-only):
- `unique_reservation_checkin`: `UNIQUE (reservation_id) WHERE reservation_id IS NOT NULL AND status <> 'cancelled'` → **reservation scoped, cancelled 제외 partial**. (20260529010000)
- `idx_checkins_clinic_date_queue`: `UNIQUE (clinic_id, kst_date(checked_in_at), queue_number) WHERE queue_number IS NOT NULL` → 큐번호 유일성 (정체성 제약 아님).
- `check_ins_pkey`: PK(id).
- **`idx_checkins_walkin_daily`(customer+day partial UNIQUE) 미존재** — 마이그 파일(20260602200010)만 존재, dedupe 러너 ABORT(활성중복 5그룹: 김민경 3건 CEO-유지 + 테스트경과 4건). prod 미적용. (scripts/out/checkins_dedupe_execution_report.md = ABORT_ACTIVE_DUP_REMAIN)
- `pg_constraint` unique/PK: `check_ins_pkey`(PK id)만. (customer+day UNIQUE 제약 0)

---

## 종합 verdict: **CLEAN** (RPC/DB write-path, derm 2지문 기준) + FE 비원자 caveat

- derm systemic RC(STAGE5-WRITE-CHECKIN) 핵심 = RPC 레벨 **rebind(지문①)** + RPC 주변 **비원자 sync(지문②)**.
- foot self-checkin/체크인 write **RPC/DB 계층**은 두 지문 모두 부재: rebind 0, 예약 status 투영은 전부 in-transaction 원자.
- 단 **FE 스태프 접수 경로**(NewCheckInDialog 등)는 check_in write ↔ reservations.status 투영을 분리 REST 호출로 수행(1경로 에러핸들 부재) → derm 지문②와 다른 계층이나 divergence-capable 표면. DA fold 판정 시 별도 하위-티켓 대상 여부 판단 요망(anon RPC 경로는 원자 보증되어 있으므로 severity 낮음).
- grain = reservation-scoped (derm 기대형과 정합). customer+day index는 미적용 상태.

*author: dev-foot / 2026-07-15 / READ-ONLY forensic (no code/DDL/backfill)*

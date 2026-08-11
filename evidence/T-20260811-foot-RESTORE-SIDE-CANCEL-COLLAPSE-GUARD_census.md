# T-20260811-foot-RESTORE-SIDE-CANCEL-COLLAPSE-GUARD — census 증거 (READ-ONLY)

- **티켓**: T-20260811-foot-RESTORE-SIDE-CANCEL-COLLAPSE-GUARD (P2, GUARD-IMPL, census-first)
- **부모**: T-20260810-meta-DELETE-NEQ-CANCEL-RESTORE-FIREWALL-CODIFY (AC-3 2차 per-CRM 분번)
- **계약 정본**: cross_crm_data_contract §6-7-2 restore-side 방화벽 (DA codify 2026-08-10)
- **실행주체 판정**: dev-meta CONSULT-REPLY MSG-20260811-213933-x8r3 (per-CRM dev = dev-foot)
- **census 일시**: 2026-08-11
- **베이스 커밋**: 9280b80c (origin/main HEAD)
- **결론**: **cancelled-붕괴 경로 부재 (COHERENT-ABSENCE) → 가드 불요 · db_change=false 유지 · done 종결 권고**

---

## 계약 규칙 (§6-7-2 — 준수 대상)

삭제(delete=중립 removal/void)된 예약행을 복구(restore)할 때 자동으로 `cancelled` 로 붕괴시키면 delete≠cancel canon 위반.
- (A) genuine cancel 확증 → status=cancelled + cancelled 콜백 FIRE
- (B) void(오등록 정정) → 중립 removal 유지 · cancelled leg 폐기(콜백 억제)
- intent 부재/unknown → 자동 cancel 금지 (safest=삭제-前 상태/void 유지 + 현장 재확인)
- 도파민 콜백 파급 = intent 분기에 종속

---

## census 실측 (obliv-foot-crm)

### 판정 A — 예약행(reservations)은 HARD delete = "삭제된 예약행 복구" 경로 자체가 부재

- `src/pages/Reservations.tsx:2136` — 삭제 = 물리 `.delete()` (`supabase.from('reservations').delete().eq('id', resvId)`), 토스트 "예약 완전 삭제됨".
- `src/pages/Reservations.tsx:2916` — 명시 주석: **`reservations 는 hard-delete(deleted_at 컬럼 없음)이므로 row 존재 = 메뉴 표시 대상.`**
- ⇒ 예약은 soft-delete(deleted_at/status='deleted') 표식이 없다. 물리 삭제된 행은 되살릴 대상이 없다.
  **"삭제(void)된 예약행을 restore" 라는 경로가 구조적으로 존재하지 않음 → cancelled 붕괴가 발생할 지점이 없음.**

### 판정 B — 존재하는 예약 restore 2경로는 모두 `confirmed` 착지 (붕괴의 반대방향, void-safe)

1. `handleEditorRestore` (`Reservations.tsx:2144`): **cancelled → confirmed** 복원.
   `.update({ status: 'confirmed', cancelled_at: null, cancel_reason: null, cancelled_by: null })`
   — cancel 필드를 **비우는** 동작 = cancelled 로 붕괴시키는 것의 정확한 반대. reservation_logs `action:'restore'` 기록.
2. 체크인 취소 역전이 (`Dashboard.tsx:6069`, T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE):
   체크인(`checked_in`) 원본 예약을 **`confirmed`** 로 되돌려 통합시간표 슬롯 복구. cancelled 아님.

두 경로 어디에서도 restore 결과가 `cancelled` 로 착지하지 않는다.

### 판정 C — 취소 emit 트리거는 `cancelled` 전이 시에만 발화 → restore 시 도파민 cancelled 콜백 오발 없음

- `supabase/migrations/20260807120000_foot_cancel_sync_outbox_emit.sql:191-195`:
  ```
  CREATE TRIGGER trg_enqueue_cancel_sync_from_reservations
    AFTER UPDATE OF status ON public.reservations
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND NEW.source_system = 'dopamine' AND NEW.external_id IS NOT NULL)
  ```
- 함수 `enqueue_cancel_sync_from_reservations` (동 파일 138): `IF NEW.status <> 'cancelled' THEN RETURN NEW;`
- ⇒ 취소 콜백(cancel_sync_outbox → crm-cancel-callback)은 **status가 cancelled 로 전이될 때만** 적재된다.
  restore(→confirmed)는 트리거 WHEN 조건을 만족하지 않아 **미발화** → 복구 시 도파민에 cancelled 콜백이 잘못 나가지 않음. **emit-side 방화벽 정합.**

### 판정 D — 인접 soft-delete restore 경로(패키지/회차)도 void-safe (cancelled 로 착지 안 함)

- `restore_package_session` RPC (`migrations/20260612140000_pkg_session_soft_delete_restore.sql:58-60`):
  `UPDATE package_sessions SET status='used' ... WHERE ... status='deleted'` — **'deleted' → 'used'** (never cancelled).
- `RestorePackageDialog` (`Packages.tsx:2243~`): 환불 오표시 패키지를 돈-원장 정합으로 **활성(active)** 복구 (never cancelled).
  - (별건 확립 canon: `T-20260805-foot-PACKAGE-RESTORE-CANCEL-BTN` — 복구=활성 / 취소=명시적 cancelled 별 버튼. 자동 붕괴 없음.)

---

## 결론 / 분기

- 티켓 산출 분기: **"붕괴 경로 부재(이미 void-safe) → coherent-absence 로 done 종결(가드 불요)".**
- **자동 cancelled 붕괴 경로 = 부재** (판정 A~D 4중 근거):
  - 예약은 hard-delete → 복구 대상 부재(A).
  - 존재하는 restore는 전부 confirmed/used/active 착지, cancelled 아님(B, D).
  - 취소 emit은 cancelled 전이 전용 → restore 시 콜백 오발 없음(C).
- **가드 코드/DDL 불요.** db_change=false 유지. §6-7-2 restore-side 방화벽은 foot 에서 by-construction 이미 충족.
- 소급 정정(backfill) 대상 없음 (오붕괴 이력이 생성될 경로가 애초에 없음).

## AC 대응

- **AC-1** (census 결과 명시): ✅ 위 판정 A~D. 붕괴 경로 = 무. 근거 코드경로 인용 완료.
- **AC-2** (붕괴 존재 시 가드): N/A — 붕괴 부재로 발동 안 함.
- **AC-3** (db_change 재판정 + E2E): db_change=false 확정(코드/DDL 무변경). E2E 신규 spec 면제 — 코드/DB 변경 0(census-only 종결), 방화벽은 기존 로직/트리거로 이미 충족.

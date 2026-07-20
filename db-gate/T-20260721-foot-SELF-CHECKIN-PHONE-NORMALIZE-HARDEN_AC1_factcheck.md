# AC-1 사실확인 (freeze-safe, read-only) — self_checkin_create phone 미정규화 severity 판정

- 티켓: T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN
- 작성: agent-fdd-dev-foot
- 성격: read-only 분석 (코드/DB 무변경). AC-1 완료 · AC-2(DA CONSULT)·AC-3(code) 미착수.

## 판정 결론 (severity)
**LOW / dormant(잠재) — 현재 앱에서 트리거 불가. carve-out B(안전-필수) 아님.**

## 근거

### 1) 메커니즘은 실재 (constraint-level)
- `customers.phone` 제약: `customers_phone_e164_chk`
  `CHECK (phone IS NULL OR phone ~ '^\+82(1[016789]\d{7,8})$' OR phone !~ '^\+?82?0?1[016789]')`
  (mig 20260426090000)
- `self_checkin_create`(mig 20260714120000 L489-491)는 `p_phone`을 **normalize 없이** as-is:
  - find-or-create SELECT: `WHERE clinic_id=... AND phone = p_phone`
  - `INSERT INTO customers(...phone...) VALUES(..., p_phone, ...)`
- 검증은 `length(digits) >= 9`뿐. raw 로컬 `01012345678` 전달 시:
  - `^\+82(1…)$` 불일치 → 1절 실패
  - escape `phone !~ '^\+?82?0?1[016789]'` → `010` 접두가 매치되어 `!~`가 false → 2절 실패
  - **→ check_violation(23514) 발생 = 접수 실패 실재 경로.**
- 대비: 형제 RPC `upsert_reservation_from_source`(mig 20260715120000 L271)는 `v_norm_phone := public.normalize_phone(p_customer_phone)` 적용 → TM 경로 정상.
- 부수 위험: normalize 누락 시 find-or-create SELECT가 raw≠저장(+82) 불일치 → 동일인 중복 customers row 생성 벡터도 존재.

### 2) 그러나 현재 라이브 FE 호출자 = 0 (severity를 LOW로 확정)
- `self_checkin_create` / `self_checkin_with_reservation_link`: **src/ 전체에 호출부 없음** (grep 확인). git 브랜치명도 `...SELFCHECKIN-LEGACYCREATE-...` = legacy 명시.
- 라이브 anon 셀프체크인/태블릿 경로가 실제 호출하는 anon RPC (전수):
  - `fn_prescreen_start` (TabletChecklistPage L266)
  - `fn_complete_prescreen_checklist` (TabletChecklistPage L402)
  - `fn_health_q_validate_token` (HealthQMobilePage L371)
  - `fn_health_q_submit` (HealthQMobilePage L453)
  - → 모두 check_in_id/token 기반. **customers 로 raw phone INSERT 하는 경로 아님.**
- FE 정규화 유틸 `src/lib/phone.ts::normalizeToE164`는 존재하며 Dashboard/Customers/Reservations/CustomerChart/AdminSettings 등 스태프 write 경로에서 +82 정규화 후 전송(dev 채널 확인). 즉 스태프 경로는 이미 무해.
- 결론: `self_checkin_create`의 normalize 누락은 **휴면 코드 경로의 결함**이지, 현재 현장에서 접수실패를 일으키는 라이브 버그가 아님.

### 3) freeze 상태
- 상위 동결 티켓 T-20260720-foot-CEO-FIELD-FREEZE-HALT: **CANCELLED** (`freeze_still_active: false`, CEO 직접 green-light "진행해" 2026-07-20T18:56). 본 티켓 frontmatter의 `freeze_held: true`/dispatch_hold_reason는 stale 참조.

## AC-3(코드) 미착수 사유 — 게이트 미충족
1. **AC-2 DA CONSULT 미해소**: `consult_pending: agent-data-architect`. phone E.164는 cross_crm_data_contract 소유(data-architect) → 1차 게이트 필수. RPC INSERT 직전 normalize_phone 적용의 정합·anon RLS write 영향은 DA 승인 후 착수.
2. **MIG-GATE**: db_change=true(CREATE OR REPLACE). mig_files/mig_dryrun/mig_ledger_check/mig_rollback/applied_at evidence 5필드 + prod 직접 apply는 CONSULT GO 후. 지금 prod 반영은 조기.
3. deploy-ready 미마킹 = false signal 회피(persona 원칙).

## 제안 패치 (DA CONSULT 검토용 — 미적용)
`self_checkin_create` 본문에서 mask-reject·invalid_phone 검증 직후, 클리닉 조회 전에 1회 정규화:
```sql
-- AC-3 후보: 형제 RPC와 정합. normalize_phone은 idempotent(이미 +82면 no-op).
p_phone := public.normalize_phone(p_phone);
```
- 이후 find-or-create SELECT/INSERT/check_ins INSERT 모두 canonical(+82) 사용 → CHECK 위반·중복행 동시 해소.
- 멱등: 이미 +82 입력은 무변경. UNKNOWN 반환(원본유지) 케이스는 기존 검증(`length(digits)>=9`)이 이미 거른 후이므로 회귀 없음.
- 롤백: 직전 정의로 CREATE OR REPLACE 복원(rollback.sql 동봉 예정).

## 권고
- 실버그 아님 → **carve-out B(안전-필수) 에스컬레이션 불요**. 저우선(P2급) 방어 하드닝으로 재분류 후, DA CONSULT GO 시 AC-3 착수.
- foot-006 red 사후대조: 본 RPC는 라이브 미사용이므로 foot-006 red와 직접 인과 낮음(별도 확인 권고).

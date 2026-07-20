# T-20260720-foot-AICC-ANON-PII-LEAK — AC1 (셀프체크인 load-bearing CONSULT + usage-baseline)

- date: 2026-07-20
- author: dev-foot
- gate: **blind REVOKE 금지 준수 — REVOKE/tighten 미착수. 본 문서는 AC1(규명)만.**
- prod: rxlomoozakkjesdqjtvd (read-only introspect + SET ROLE anon positive-control, DDL/DML 0)
- probe: `scripts/T-20260720-foot-AICC-ANON-PII-LEAK_ac1_usage_baseline.mjs`

## 1. usage-baseline positive-control 실측 (DA 504/504 재확증)

| 항목 | 실측 |
|------|------|
| aicc_crm_phone_match anon privs | `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` (GRANT ALL, 미회수 — L9649 원본) |
| viewdef | `SELECT id AS customer_id, clinic_id, name, phone, created_at FROM customers c` → name/phone 직접 투영 |
| customers anon privs | `SELECT` (grant 존재) |
| customers RLS | enabled=true |
| customers anon 정책 | `anon_select_customer_self_checkin`(SELECT, USING `clinic_id IS NOT NULL`) + `anon_insert_customer_self_checkin`(INSERT, WITH CHECK `clinic_id IS NOT NULL`) |
| **positive-control (SET ROLE anon)** | **customers 직접: 504/504 reach, name 504, phone 504** · **aicc 뷰 경유: 504** |
| resolve_v3 | SECURITY DEFINER=true, anon EXECUTE=true |

→ **SEV-1 live PHI 읽기 누출 확증(추정 아님).** anon 공개키로 504명 전원 name+phone 실-읽기 도달. 뷰·customers 양경로 모두 열림.

## 2. 셀프체크인 load-bearing CONSULT (AC1 핵심)

**정당 anon 경로 규명** — foot 셀프체크인 kiosk = 별도 앱 `~/GitHub/foot-checkin` (obliv-foot-crm FE의 `/checkin` 라우트는 외부 리다이렉트·deprecated).

### (a) aicc_crm_phone_match 뷰 — **소비자 0건**
- obliv-foot-crm src/ grep: 0건 (scripts/audit/test 픽스처만).
- foot-checkin src/ grep: 0건.
- ∴ **뷰 REVOKE ALL = zero regression 확정.** FE/kiosk 어디도 뷰를 읽지 않음.

### (b) customers 직접 anon 접근 — **load-bearing = 정확히 1곳**
foot-checkin `SelfCheckIn.tsx` 전수 grep 결과 direct anon `customers` 접근:
- **L1760-1766: `anonClient.from('customers').select('id').eq('clinic_id',…).in('phone',candidates).limit(1)`**
  - 동선 = 검증된 예약(phone-gated RPC 통과)인데 예약행에 customer_id 결측인 **상류갭 edge fallback**. phone→기존 customer_id 해소(link, INSERT 아님).
  - 반환 컬럼 = **`id` 단독** (name/phone 미투영). 단, 의존하는 정책 `anon_select_customer_self_checkin(USING clinic_id IS NOT NULL)`이 **행-가시성**을 열어 → PostgREST에서 anon이 임의 컬럼(`.select('name,phone')`) 크래프팅으로 504 전량 exfil 가능(RLS는 컬럼이 아닌 행 통제).
- 그 외 customers write/match 전량 = **SECDEF RPC로 일원화 완료** (T-20260719 CHECKIN-REPO-ANON-HARDENING): `resolve_v3`(match-or-insert), `dup_guard`, `reservation_banner`, `today_reservations`, `verify_reservation`, `update_personal_info`, `rrn_match`, `create_health_q_token`, `next_queue_number`. 직접 anon customers INSERT/UPDATE/DELETE **잔존 0**.
- (check_ins: anon INSERT/SELECT 별도 정책 `anon_insert_checkin_self` — customers PHI-read 스코프 밖, 본 티켓 무관.)

## 3. 권고 대체안 (planner 확정 후 착수) — DA 옵션 ② = SECDEF 이관 채택

**predicate-tightening은 부적합**: RLS는 컬럼이 아닌 행을 통제 → "phone-match+today+single-clinic"로 행을 좁혀도 anon이 그 행들의 name/phone을 `.select()`로 읽음(축소된 누출이지 0 아님). 게다가 phone-match 값은 정적 정책 술어로 표현 불가.
→ **reach를 0으로 만드는 유일 경로 = anon SELECT 완전 제거 + L1760을 SECDEF RPC로 이관** (2026-07-11 canonical).

**제안 remediation (RLS-술어 gated·non-blind·회귀0):**
- ① `REVOKE ALL PRIVILEGES ON public.aicc_crm_phone_match FROM anon` (멱등, 롤백=exact prior priv 역-GRANT). 소비자 0 → zero regression. breadth=ALL (DA §15-5-9 canonical).
- ② 신규 SECDEF RPC `fn_selfcheckin_resolve_customer_id_by_phone(p_clinic_id uuid, p_phone_candidates text[]) RETURNS uuid` (clinic-scoped, **id만 반환·name/phone 미투영**) 신설 → foot-checkin `SelfCheckIn.tsx:1760` 이관 → 이후 `DROP POLICY anon_select_customer_self_checkin` + `REVOKE SELECT ON customers FROM anon`. → anon customers reach 504→0, kiosk fallback 보존.
  - ※ 신규 컬럼/테이블/enum 0 (신규 함수만) → §S2.4 data-architect CONSULT 게이트 비해당. DA 결정문이 이미 SECDEF 이관을 remediation으로 명시(da_decision_xcrm_aicc_anon_dml_revoke_breadth §A(A) ②).
- ③ baseline L9649 `anon PII revokes preserved` 주석 = prod상 거짓 → forward-doc 정정(fork-template 전파차단).
- 게이트: owner=postgres → supervisor DDL-diff DB-GATE. MIG-GATE 4필드 evidence.
- AC4 검증: 반영 후 positive-control 재실행 504/504 → 0 + 정당 셀프체크인(검증예약 fallback 포함) 회귀0.

## 4. 다음 단계
planner에 AC1 FOLLOWUP 회신 → 대체안(②) 확정 수신 후 REVOKE/RPC 이관 착수. **현시점 prod 무변경.**

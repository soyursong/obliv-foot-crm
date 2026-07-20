# T-20260720-xcrm-AICC-ANON-PII-RELATION-SWEEP — foot lane AC1

- date: 2026-07-20
- author: dev-foot
- gate: **blind REVOKE 절대 금지 준수 — REVOKE/tighten 미착수. 본 문서 = AC1(규명)만. prod 무변경(read-only introspect + pg_stat_statements, DDL/DML 0).**
- prod: rxlomoozakkjesdqjtvd (foot LIVE)
- probe: `scripts/T-20260720-xcrm-AICC-ANON-PII-RELATION-SWEEP_foot_probe.mjs`
- 선행 권위 문서(동일 surface, SEV-1): `db-gate/T-20260720-foot-AICC-ANON-PII-LEAK_ac1_consult_evidence.md`

## 0. 결론 요약 (TL;DR)
- 스윕 티켓의 foot-lane 명시 대상 **`aicc_reservations` = foot prod에 부재(ABSENT)** — relation 없음. 라벨 오기.
- foot의 실제 anon-PII surface = **`aicc_crm_phone_match`(VIEW)** + **`customers`(base)** 2건.
- 이 2건은 이미 **상위 SEV-1 자매 티켓 `T-20260720-foot-AICC-ANON-PII-LEAK`** 가 AC1 완료·planner 대체안 확정 대기 중으로 owning. 스윕 foot-lane = 사실상 **중복/subsumed**.
- ∴ 스윕 lane에서 **별도 REVOKE 마이그 미작성** — LEAK 티켓으로 dedup 권고(이중적용/충돌 방지).

## 1. (a) grant 대상 relation — 실측
| relation | kind | owner | anon privs | 판정 |
|----------|------|-------|-----------|------|
| `aicc_reservations` | — | — | — | **부재(ABSENT)**. 티켓 라벨 오기. foot엔 존재 안 함 |
| `aicc_crm_phone_match` | VIEW (security_invoker=on) | postgres | `SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE` (GRANT ALL 미회수) | anon SELECT 실재 |
| `customers` | table (RLS enabled) | postgres | `SELECT` | anon SELECT 실재 |

- viewdef: `SELECT id AS customer_id, clinic_id, name, phone, created_at FROM customers c` → name/phone 직접 투영.

## 2. (b) 정책 USING 술어 정독 = 실노출 여부
**customers anon/public 정책 2건 정독:**
1. `anon_select_customer_self_checkin` — cmd=SELECT, role={anon}, PERMISSIVE, **USING `(clinic_id IS NOT NULL)`**
2. `anon_insert_customer_self_checkin` — cmd=INSERT, role={anon}, PERMISSIVE, WITH CHECK `(clinic_id IS NOT NULL)`
- (public 롤 전용 정책 없음. anon 롤 2건이 전부.)

**실노출 판정 = YES (실-노출).**
- SELECT 정책 술어 `clinic_id IS NOT NULL` = 사실상 전행 가시. RLS는 행만 통제(컬럼 미통제) → anon이 `.select('name,phone')` 크래프팅으로 name+phone 전량 읽기 가능.
- 뷰 `aicc_crm_phone_match`는 security_invoker=on → 위 customers anon 정책이 그대로 적용 → 뷰 경유로도 name+phone 노출.
- 선행 LEAK 티켓 positive-control(SET ROLE anon) 실측: **customers 직접 504/504 reach(name 504·phone 504), 뷰 경유 504** — 추정 아닌 확증.

## 3. (c) usage-baseline = anon 키 실사용 有/無 (positive-control)
pg_stat_statements (stats_reset 2026-04-19, ~3개월 창) 실측:

| relation | anon 키 앱-소비자 | pgss anon 호출 | 판정 |
|----------|------------------|---------------|------|
| `aicc_crm_phone_match`(뷰) | **0건** (obliv-foot-crm src + foot-checkin src grep 모두 0; scripts/audit 픽스처만) | 3 (`SELECT customer_id,clinic_id,left(name,N)‖'*' AS name_masked,right(phone,4)… LIMIT N`) | 앱 소비자 無. pgss 3건 = DA A7-c introspect/positive-control probe 아티팩트(masked-read 패턴, 양 레포 부재) 최유력 → **뷰 REVOKE = zero-regression** (LEAK 티켓 확정 계승) |
| `customers`(base) | **有 = 정확히 1곳** (foot-checkin `SelfCheckIn.tsx` L1760 검증예약 상류갭 fallback, `id` 단독 반환이나 정책이 행-가시성 open) | — | anon SELECT **load-bearing** → blind REVOKE 시 셀프체크인 파손. SECDEF RPC 이관 선행 필수 |

→ 뷰: anon 앱-실사용 **無**(REVOKE-safe). customers: anon 실사용 **有**(blind REVOKE 금지, SECDEF 이관 선행).

## 4. 처리 결정 (ticket step 4 분기)
- **REVOKE 보류 + planner 즉시 통보** — 이유:
  1. 스윕 명시 대상 `aicc_reservations` 부재 → REVOKE 대상 없음.
  2. 실 surface(뷰+customers)는 SEV-1 LEAK 티켓이 이미 owning, 더 완전한 remediation(뷰 REVOKE ALL + customers SECDEF RPC 이관) AC1 완료·planner 확정 대기.
  3. customers는 load-bearing → blind REVOKE 시 셀프체크인 회귀.
- 스윕 foot-lane → **LEAK 티켓으로 dedup** 권고. 별도 REVOKE 마이그 미작성(이중적용/충돌 방지).
- MIG-GATE evidence: REVOKE 마이그 미발생이므로 본 lane 미해당(뷰 REVOKE 실행 시 LEAK 티켓 lane에서 MIG-GATE 4필드 동봉).

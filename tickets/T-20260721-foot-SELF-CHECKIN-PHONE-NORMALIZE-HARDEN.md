---
id: T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN
domain: foot
priority: P2
status: deploy-ready
qa_result: pending (supervisor DB-gate DDL-diff 사후 검증 대기 — PROD DDL 이미 dev-foot 실적용)
deploy_commit: 76c2714f
medical_confirm_gate: not-required
confirm_status: gate-exempt
gate_exempt_basis: "surface축=셀프체크인 kiosk anon 접수 RPC(비의료 접수 경로, §11 진료대시보드/진료관리 화면 무관). 성격축=DB write-path 정규화 계약 CONFORMANCE(behavioral surface = 저장 phone E.164). 의료화면 코드 0."
db_change: true
db_migration: supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql
db_gate: "DA CONSULT-REPLY MSG-20260721-030943-9hj0 (DA-20260721-FOOT-SELFCHECKIN-NORMALIZE) = GO · ADDITIVE-equivalent YES (no DDL, normalize_phone 재사용, 가역). no-persistence dry-run PASS → db-gate/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN_dryrun.md (post-probe absent=true, 무영속 실증). 신규 컬럼·테이블·enum·파생 0."
mig_files: "supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql (up, 멱등 CREATE OR REPLACE) + .rollback.sql (raw p_phone 07-14 정의 원복)"
mig_dryrun: pass
mig_dryrun_postprobe: absent (dry-run 시점 prod self_checkin_create 정의 normalize_phone 부재 = 변경 미영속 실증)
mig_ledger_check: "3자 대조 OK — schema_migrations version=20260721100000(name=foot_selfcheckin_create_phone_e164_conformance) INSERT 완료 ↔ 파일 20260721100000_*.sql 존재 ↔ prod pg_get_functiondef(self_checkin_create) normalize_phone 적용 확인. (기존 OOB divergence: ledger top 20260720170000 < repo 20260720232000 — 본 티켓 무관, ledger_reconcile 별건.)"
mig_rollback: "supabase/migrations/20260721100000_*.rollback.sql — CREATE OR REPLACE self_checkin_create 를 raw p_phone(07-14) 정의로 원복. 가역·멱등."
applied_at: "2026-07-21 03:23 KST — Management API POST /database/query 로 up.sql 전문(BEGIN..COMMIT) 실적용. POSTCHECK: has_norm_assign=true · WHERE phone=v_phone=true · raw '= p_phone' 잔존=false · normalize_phone('010-1234-5678')→+821012345678 · ('+821012345678')→멱등 · ('DUMMY-abc')→passthrough(caveat1) · sibling upsert_reservation_from_source normalize 무훼손(AC-4)."
build: pass (npm run build ✓ built in 5.72s)
scenario_count: 10 (아티팩트·tx 구조 3 + 정규화 도출·일관성 5 + 롤백 가역 1 + AC4 ADDITIVE 포함 — 10 static/pure PASS)
e2e_spec: tests/e2e/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN.spec.ts
spec: tests/e2e/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN.spec.ts
reporter: dev-foot (DA CONSULT-REPLY GO 수신 후 자율 구현)
branch: hotfix/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN
created: 2026-07-21
assignee: dev-foot
summary: self_checkin_create RPC 의 phone E.164 계약 CONFORMANCE 정정. raw p_phone → v_phone := normalize_phone(p_phone) 도출 후 customers 조회 WHERE·customers INSERT·check_ins INSERT 에 동일 v_phone 일관 적용. masked-PII guard + length(digits)>=9 는 raw p_phone pre-normalize 로 유지. 형제 RPC upsert_reservation_from_source(house pattern) 정합. no-DDL, DB write-path only, FE 무변경.
---

## 배경 (RC)

`self_checkin_create`(mig 20260714120000)가 raw `p_phone` 를 **조회 WHERE + customers/check_ins INSERT** 에 그대로 사용 → `cross_crm_data_contract §Phone`(GLOBAL JOIN KEY = phone E.164 L34, UNIQUE(clinic_id, phone) L33, `normalize_phone(text)→text` L47-51) **위반 상태**. 형제 RPC `upsert_reservation_from_source`(mig 20260715120000 L271 `v_norm_phone`)는 이미 정규화 적용 = house pattern. 셀프접수만 이탈.

`customers_phone_e164_chk`(mig 20260426090000)가 로컬포맷을 원천 차단하므로 prod row 는 전부 E.164. kiosk 가 로컬포맷을 전달하면 조회 miss → 중복 customers row 생성 또는 CHECK 위반 라이브 실패 위험.

## DA CONSULT-REPLY (MSG-20260721-030943-9hj0)

- **판정 GO** — belt-and-suspenders 아니라 계약 CONFORMANCE 정정. **ADDITIVE-equivalent: YES**.
- **필수조건 1건**: 조회 WHERE 와 INSERT 에 동일 `v_phone` 일관 적용(하나만 정규화 시 조회 miss → 중복 row = UNIQUE·GLOBAL JOIN KEY 오염). → **준수**.
- **검증순서**: masked-PII guard + length(digits)>=9 는 raw `p_phone` pre-normalize 유지(방어 보존). → **준수**.

## 변경 (AC)

- **AC1** — DECLARE 에 `v_phone text` 추가, 가드 통과 후 `v_phone := public.normalize_phone(p_phone)` 도출.
- **AC2** — customers 조회 `WHERE ... phone = v_phone` · customers INSERT `v_phone` · check_ins INSERT `v_phone` 일관 적용. (raw p_phone 조회/저장 잔존 0.)
- **AC3** — 가드(masked-PII 양축 + length digits>=9) raw `p_phone` 기준 verbatim 유지.
- **AC4** — 단일 tx · 스키마 DDL 0(ADDITIVE) · 롤백은 raw p_phone(07-14) 정의로 가역.

## 검증

- `npm run build` PASS (built in 5.72s).
- E2E spec 10 케이스 PASS (`tests/e2e/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN.spec.ts`).
- no-persistence dry-run PASS (`db-gate/…_dryrun.md`, post-probe absent=true = 무영속 실증).

## 구현 3-caveat 준수 (planner NEW-TASK / DA)

1. **무전화 외국인 DUMMY 우회** — `normalize_phone` 은 non-KR/sentinel 을 원본 그대로 반환(ELSE p_phone). `normalize_phone('DUMMY-abc')→'DUMMY-abc'` POSTCHECK 확인. self_checkin_create 본문에 DUMMY 분기 없음 + 정규화가 sentinel 훼손 안 함. ✓
2. **phone_dummy 명시 set 불요** — RPC 본문에서 phone_dummy 를 set 하지 않음(트리거 파생 존중). ✓
3. **버킷3 fail-loud** — 정규화불가 junk/국제-raw 는 normalize 원본 반환 → customers_phone_e164_chk 가 REJECT(fail-loud). sentinel 흡수 0. 정당 국내환자 drop 0(masked-PII/length 가드는 raw pre-normalize). ✓

## AC-4 회귀

- 형제 TM 경로 `upsert_reservation_from_source` 무영향 확인(prod pg_get_functiondef 에 normalize_phone 유지 = 무훼손, 이 마이그는 self_checkin_create 만 replace). 
- 기존 정상 `+82` 접수 무변경: `normalize_phone('+821012345678')→'+821012345678'` 멱등 확인.
- DA carve-out probe: planner INFO(MSG 03:18) 판정 = 라이브 FE 호출자 0건(orphan) → dormant, check_violation 라이브 실패흔적 트리거 불가. 실버그 격상 아님(비블로킹).

## 후속 (비블로킹, planner FOLLOWUP)

DA carve-out 등급 probe(07-14 이후 self_checkin_create 경로 check_violation 로그 / 셀프접수 기원 customers row 도수)는 하드닝 블로킹 아님(병행). 실패흔적·row 부재 발견 시 실버그로 우선순위 격상 대상.

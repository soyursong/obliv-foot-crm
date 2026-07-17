---
ticket_id: T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-07-06
build_ok: true
spec_added: tests/e2e/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260706140000_koh_publish_birth_server_derive.rollback.sql
data_architect_consult: GO · ADDITIVE · 대표 게이트 불요 (CONSULT-REPLY MSG-20260706-135616-hw9w)
db_gate: supabase/migrations/20260706140000_koh_publish_birth_server_derive.sql (테이블/컬럼/enum 무변경·publish_koh_result RPC body만, supervisor 함수-diff Gate 대기)
risk_level: GO (1/5 — RPC body만, 시그니처 무변경 CREATE OR REPLACE, 테이블/enum 무변경. fn_customer_birthdates 재사용)
deploy_ready: true
commit_sha: 79686f20
# ── MIG-GATE 4필드 ──
mig_files: supabase/migrations/20260706140000_koh_publish_birth_server_derive.sql (멱등 CREATE OR REPLACE + $verify$ 가드) / .rollback.sql 동봉
mig_dryrun: scripts/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST_dryrun.log (트랜잭션 COMMIT→ROLLBACK 재현, $verify$ 통과·미영속 확인)
mig_ledger_check: [APPLIED 2026-07-16 13:32, 멱등 재확인 2026-07-18] schema_migrations(version=20260706140000)=기록有(created_by=T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST) / 파일=존재 / prod=birth 서버파생 반영有 — 3자 완전수렴. apply=ledger helper 경유(applyMigration → schema_migrations 자동 INSERT, ON CONFLICT DO NOTHING 멱등)
mig_rollback: supabase/migrations/20260706140000_koh_publish_birth_server_derive.rollback.sql (직전 20260616180000 publish_koh_result 정의 CREATE OR REPLACE 복원, 시그니처 무변경·데이터 무손실)
---

## 요청 (NEW-TASK, planner P1 — MSG-20260706-140453-6mni · Path A)

균검사 결과지 문서표면(3경로: 진료대시보드 / 치료테이블 발급 / 미리보기)의 `birth_date`
바인딩이 FE payload(`effectiveBirth`) 계산 경로 유무에 따라 불일치(BINDING-INCONSIST).
→ **Path A:** 발행 RPC `publish_koh_result` 가 `birth_date` 를 서버 확정 파생해 `field_data.birth_date`
스냅샷을 채운다. 기존 phone/의뢰번호/검체번호 서버파생과 parity.

data-architect CONSULT-REPLY(MSG-20260706-135616-hw9w): **GO · ADDITIVE · 대표 게이트 불요.**

## 구현

- `publish_koh_result` RPC 본문에 birth 서버파생 1점 추가:
  `fn_customer_birthdates(v_clinic, ARRAY[v_customer])` 재사용(세기휴리스틱 SSOT 단일화)으로
  `birth_date_display`(YYYY-MM-DD) 확보 → 결과지 렌더 포맷('YYYY년 MM월 DD일')으로 변환 →
  `field_data.birth_date` 에 `COALESCE(서버파생, FE payload, '')` 로 적재.

## Acceptance Criteria (DA 하드 AC)

- **AC7 [COALESCE 순서]** — `COALESCE(v_birth_ko, p_field_data->>'birth_date', '')`. 서버파생 우선,
  FE payload fallback. 서버파생 NULL이면 FE effectiveBirth 유지(회귀 0). 역순(FE 우선) 없음. ✅ ($verify$ + spec S3)
- **AC8 [AC-PHI]** — field_data엔 렌더포맷 파생 표시값만. `fn_customer_birthdates` 가 `birth_date_display`만
  반환(RRN 평문·세기코드·뒷자리 미노출) → RPC는 그 값만 수신·기록. ✅ (spec S5)
- **AC9 [AC-GRANT]** — publish_koh_result(SECURITY DEFINER) owner(postgres) = fn_customer_birthdates
  owner(postgres) 동일 → implicit EXECUTE. fn anon EXECUTE 회수는 20260613120000 유지(본 마이그 미변경). ✅
- **AC10 [AC-MERGEKEY]** — write는 `field_data.birth_date`(스냅샷)뿐. `customers.birth_date`(병합키)로
  역기록 없음(customers는 SELECT만). $verify$ `UPDATE customers` 부재 가드. 스냅샷 포맷 = formatBirthKo 동형(포맷 회귀 방지). ✅
- **AC4 [RRN 미표기]** — birth만 복구, RRN 재노출 0. ✅ (spec S5)

## 스코프 경계

- Path A(신규 발행분 항구책)만. 기발행(legacy) 소급 backfill 금지(의료법 §22) → form_submissions 불변.
  발행 write 시점(스냅샷 생성)에만 서버파생. 기발행 UPDATE·트리거 없음.
- legacy 소급은 별도 티켓 LEGACY-BIRTH-RECOVERY(사람 결정).

## 검증

- **build:** ✅ `npm run build` (5.19s)
- **dryrun:** ✅ 트랜잭션 ROLLBACK 재현 — $verify$ 통과, prod 무변경 확인
- **E2E (시나리오 2):** ✅ 신규 발행분 birth 3경로 공통 정상 표시 — S1~S5 6 passed (auth 포함)
- **회귀:** ✅ sibling KOH-SPECIMENNO-FORMAT + KOHDOC-BIRTHDATE-FROM-RRN-FALLBACK 10 passed

## 게이트

- supervisor = **함수-diff 리뷰만**(DDL-diff 공집합). 대표 게이트 불요.
- **apply 는 supervisor 게이트 통과 후** `scripts/…_apply.mjs --apply`(ledger helper 경유 → schema_migrations 자동 기록).

## APPLY 결과 (2026-07-18 — APPLY-APPROVED MSG-20260718-044431-4occ, R3-DRAIN batch5)

supervisor 함수-diff 게이트 사전승인 통과 → `scripts/…_apply.mjs --apply` 실행(ledger helper 경유).

**핵심 사실 (정직 보고):** 본 마이그(20260706140000)는 **직전 FIX-REQUEST(MSG-20260716-132302-hipm) 대응으로 2026-07-16 13:32에 이미 apply 완료**되어 있었음(apply.log 증거). supervisor 07-18 승인 근거의 mig_ledger_check(원장無/prod無)는 07-16 apply **이전의 stale dryrun.log**를 읽은 것. 07-18 재실행은 `applyMigration → recordLedger(ON CONFLICT DO NOTHING)` + `CREATE OR REPLACE` = **완전 멱등 재확인**(중복기록·재정의 부작용 0).

### 사후검증 증거 3종
- **(a) pg_get_functiondef(publish_koh_result):** 시그니처 `publish_koh_result(uuid, jsonb)` 무변경 · `fn_customer_birthdates` 호출 실재 ✅ · `COALESCE(v_birth_ko, p_field_data->>'birth_date', '')` 서버파생 우선(역순 아님) ✅ · birth 파생은 `birth_date_display`(YYYY-MM-DD) 수신 + `substr`(생년월일 문자열 대상) → **AC4 RRN/세기코드/뒷자리 read·노출 0**(RRN 언급 2건 전부 주석 = 미노출 명시) ✅
- **(b) schema_migrations 원장:** `version=20260706140000 · name=koh_publish_birth_server_derive · created_by=T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST` 기록 확정 ✅
- **(c) E2E spec 재실행:** `tests/e2e/T-20260706-…spec.ts` **6 passed (6.3s)** — S1~S5 전원 PASS(S5 AC8/AC4 RRN 평문·세기코드·뒷자리 미노출 포함) ✅

3자 대조(apply 후): 파일有 · 원장有 · prod有 = 완전 수렴. RRN 재노출 0 유지(AC4).
→ signals qa-pending 재신호. supervisor 사후검증(라이브 결과지 birth 표시) 후 qa_result 마킹 대기.

## APPLY 재확인 (2026-07-18 — 재발행분 MSG-20260718-044450-qirm 처리)

⚠ 본 처리 = supervisor 재발행 메시지(qirm, 4occ의 미등록 type APPLY-APPROVED 재발행분) 기준. **직전 4occ 처리분과 동일 대상**이며 상태는 이미 완전 수렴 상태였음(원장有·prod有·시그니처 무변경).

**blind re-apply 금지 준수 + 멱등 재확인:** 착수 전 `--ledger` 3자 대조로 상태 완전 파악(원장有/prod反映有) 후 `--apply` 실행 = `applyMigration`(CREATE OR REPLACE 동일 body) + `recordLedger`(ON CONFLICT DO NOTHING) = **완전 멱등**(중복기록·재정의 부작용 0). apply.log 보존.

### 사후검증 증거 3종 (apply 후 실측, 2026-07-18)
- **(a) pg_get_functiondef(publish_koh_result):** 시그니처 `public.publish_koh_result(p_check_in_service_id uuid, p_field_data jsonb)` **무변경** · `fn_customer_birthdates` 호출 실재 **YES** · `COALESCE(v_birth_ko, …)` 서버파생 우선(역순 아님) **YES** · birth 파생값은 `v_birth_display`(YYYY-MM-DD, 주석: "RRN/세기코드 미수신") → **AC4 RRN 평문·세기코드·뒷자리 read/노출 0** (RRN 언급 전부 주석) ✅
- **(b) schema_migrations 원장:** `version=20260706140000 · name=koh_publish_birth_server_derive` 기록 확정 ✅
- **(c) E2E spec 재실행:** `tests/e2e/T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST.spec.ts` → **6 passed (6.0s)** — S1~S5 전원 PASS (S5 = AC8/AC4 RRN 평문·세기코드·뒷자리 미노출 포함) ✅

3자 대조(apply 후): 파일有 · 원장有 · prod有 = 완전 수렴. RRN 재노출 0 유지(AC4). 실패·에러 0 → rollback 불요.
→ signals qa-pending 재신호. supervisor 사후검증(라이브 결과지 birth 표시 확인) 후 qa_result 마킹 대기.

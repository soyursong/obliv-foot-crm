# T-20260811-foot-INS-CLAIM-AUTODRAFT-BACKFILL — DB-GATE 제출 (dev-foot)

> 청구 명세 **소급 백필** leg. 부모 `T-20260810-foot-INS-CLAIM-AUTODRAFT`(B-2, deployed 08-11 11:24)
> forward-only 트리거(08-11 08:09~)가 못 잡은 트리거 이전 기적재 진료분에 대해
> **이미 배포된** `fn_rollup_insurance_claim_drafts(clinic, from, to)` 를 **GO-token 게이트 하 1회 실행**.
> **신규 코드/DDL 0** (함수는 부모에서 배포 완료·origin/main 에 fc2bbe4f 병합 확인).

## artifact-class / change-class
- **artifact-class = `db_only`** (DATA write via 배포된 SECDEF 함수. FE/EF/APK 무변경, 빌드 대상 없음).
- **change-class = 데이터 write only** (신규 컬럼/테이블/enum/함수 0 → §S2.4 DA 스키마 CONSULT 대상 아님).
  - 예외: **fallback** rollback.sql 만 archive-first 임시 테이블 2개 CREATE(정상 경로 미실행).
- **db_change = false** (스키마 불변. 함수 기배포).

## clinic 앵커 (요양기관기호 13328581)
- slug `jongno-foot` = 오블리브의원 서울오리진점 = **`74967aea-a60b-4da3-a0e7-9c997a930bc8`**.
  - 근거: `db-gate/T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT_dbgate.md` (nhis_code 13328581 ↔ jongno-foot),
    `db-gate/T-20260630-foot-CODY-CLINICID-BACKFILL_dbgate.md` (jongno-foot = 74967aea).
  - 링크키 = **slug** 정본(business_no 링크 금지). 모든 러너가 `slug='jongno-foot'` resolve 후 uuid 앵커 assert.

## ★DECISION-1 — range 실측 대조 (착수 전 게이트)
- 원 요청 range = `from='2026-08-01', to=NULL`. supervisor 실측 = **365건 / 3,246,569원 (7~8/10 진료분)**.
- 원 요청은 8월 시작 → **7월 진료분 미커버 가능성**. 7월분이
  (a) 이미 지난 8월 청구사이클 별건인지, (b) 본 백필 포함(from='2026-07-01')인지 **실측+업무판단 필요**.
- **dev 처리**: `_decision_probe.mgmt.sql`(READ-ONLY) 로 미청구 급여 방문을 **진료월 분해** →
  7월/8월 claimable 건수·금액 산출. `REQ-RANGE from=2026-08-01` 행이 `TOTAL` 과 같으면 7월 잔여 0(default 종결),
  `2026-07` 행 ≥1 이면 supervisor/reporter 확정 필요.
- **default = 요청값 `'2026-08-01'`**(AC-1). (b) 확정 시 러너의 `v_from := DATE '2026-07-01'` 1줄 수정.
- **에스컬레이션**: planner FOLLOWUP 발행(아래 §통신) — supervisor/reporter range 확정 요청. 확정 전 GO-token 금지.

## Data-Correction Backfill SOP 봉투
| 요소 | 구현 |
|---|---|
| **dry-run 무영속** | `_dryrun.mgmt.sql` — BEGIN → freeze → fn_rollup → 순증/이탈/금액/원장 검증 → `RAISE`(sentinel) → ROLLBACK. + POST-PROBE(신규 draft 0 확인). Migration Dry-Run No-Persistence Protocol 정합. |
| **대상셋 freeze** | `_freeze` 임시셋 = 미청구(draft 미존재) 급여 방문 check_in (선택 range). 예상 순증 ≈ 365 고정. 실행 후 freeze 이탈 신규 draft = 0 assert(drift = abort). |
| **판정근거 스냅샷** | BEFORE/AFTER draft count + 금액 합계(base+copay+covered) + 순증분(new). dryrun 은 error body, apply 는 `APPLY_REPORT` NOTICE. |
| **폴백** | `_rollback.sql` — engine_version='autodraft_from_charges_v1' + clinic + claim_status='draft' + **apply 윈도우**(forward-트리거 draft 오삭제 방지) → archive-first(CREATE TABLE AS SELECT = 컬럼 완전성) → 순소실0 assert → 자식(claim_items)→부모(insurance_claims) 삭제. |

## AC 충족
- **AC-1 소급 draft 생성**: fn_rollup(clinic, from, to). default from='2026-08-01'(DECISION-1 게이트).
- **AC-2 멱등**: fn_build = check_in_id+claim_status='draft' upsert. 순증 = AFTER-BEFORE, 재실행 중복 0. dryrun/apply 가 순증==freeze assert.
- **AC-3 금액 verbatim**: fn 이 service_charges 값 복사(재산출 0). 러너는 **검증만**(SUM 대조), 재산출 없음. revenue_insurance_split_spec §2-2 SSOT.
- **AC-4 원장 방화벽**: insurance_claims/claim_items 만 write. service_charges+payments 행수 무변동 assert(위반=LEDGER-FIREWALL-BREACH abort). H2 계승.
- **AC-5 missing_code 보존**: fn 이 hira_code NULL 항목 보존(silent drop 0). B-1 시드 미충족분 = draft 유지, 제출 전 코드충족 별건.
- **AC-6 draft≠전송**: edi_submissions 무접촉. EDI 전송 = CEO 게이트 별건.

## ★실행 게이트 (apply_before_go 금지)
- service_role prod DATA write 라도 **supervisor DB-GATE GO-token 후에만** `_apply.mgmt.sql` 실행.
- **dev 자체 prod apply 금지**(foot pooler DB 비번 미보유). dev 산출 = 러너 3종 + 폴백 + probe(mgmt.sql 경로).
- owner=supervisor: GO-token 발행 + service_role prod 실행 + 판정근거 검증 + 원장 원자봉합(applied_at/deployed_at).

## 실행 순서 (supervisor 런북)
1. `_decision_probe.mgmt.sql` 실행(READ-ONLY) → 진료월 분해 확인 → ★DECISION-1 확정(7월 포함/별건).
2. (필요 시 v_from 수정) `_dryrun.mgmt.sql` 실행 → `DRYRUN_BACKFILL_REPORT ... PASS` + freeze≈365 + outside_freeze=0 + ledger unchanged 확인 → POST-PROBE(신규 0).
3. **GO-token 발행**.
4. `_apply.mgmt.sql` 실행 → `APPLY_REPORT OK` → COMMIT → 사후 검증 쿼리.
5. 이상 시 `_rollback.sql`(apply 윈도우 기입) → archive-first 폴백.

## E2E
- `e2e_spec_exempt_reason`: **db_only 백필, UI 파일 touch 0**(FE 무변경). 검증은 DB-side dry-run(No-Persistence)+판정근거 스냅샷으로 대체. browser_verify 불요(렌더 표면 무변경).

## Q-gate 자가검증 (deploy-ready 前)
- **Q0**: commit_sha 병기 · canonical_repo=obliv-foot-crm · artifact-class=db_only(단일) · 변경파일=scripts 4 + db-gate 1(신규, caller 0 — 러너는 독립 실행 스크립트, import/호출 grep 0건) · 시나리오=supervisor 런북(§실행 순서) · e2e exempt 사유 명시.
- **Q1(db_only)**: dry-run 무영속(sentinel+POST-PROBE) · freeze/before-after 스냅샷 · 멱등 순증 assert · 원장 방화벽 assert · fallback rollback. DDL 0(fallback archive 제외).
- **Q2(DB)**: 스키마 변경 0 → DA CONSULT 대상 아님(신규 컬럼/테이블/enum 0). da_consult_ref = N/A(부모 B-2 change-class ADDITIVE 판정 계승, 본 leg=데이터 write only).
- **Q3(E2E)**: exempt(db_only, UI 무접촉) — browser_verify 불요.
- **Q4**: 최초 마킹(재제출 아님).

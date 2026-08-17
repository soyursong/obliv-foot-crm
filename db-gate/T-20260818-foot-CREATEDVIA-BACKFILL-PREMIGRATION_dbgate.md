# DB-GATE — T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION

**status: census 완료 · 구현 write0 완료 · supervisor MIG-GATE+GO-token 대기 (apply 미실행)**
DA verdict = **CONDITIONAL** (`agents/docs/da_replies/da_decision_foot_createdvia_backfill_premigration_20260818.md`).
db_change = TRUE (pure data UPDATE, **DDL 0**). artifact-class = `db_only`.
canonical_repo = obliv-foot-crm · Supabase foot prod `rxlomoozakkjesdqjtvd`.

---

## STEP 1 — READ-ONLY census (DISPOSITIVE) 결과

증적 스크립트(READ-ONLY, postgres superuser, RLS bypass):
- `scripts/T-20260818-foot-CREATEDVIA-BACKFILL_discovery_readonly.mjs`
- `scripts/T-20260818-foot-CREATEDVIA-BACKFILL_census_step1_readonly.mjs`
- `scripts/T-20260818-foot-CREATEDVIA-BACKFILL_freezeset_verify_readonly.mjs`
- `scripts/T-20260818-foot-CREATEDVIA-BACKFILL_dryrun_beforeimage_readonly.mjs`

### Q3 — created_via CHECK 제약 존부 → **존재**
`reservations_created_via_check`: `CHECK (created_via IS NULL OR created_via IN ('manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'))`.
→ `'manual'`/`'dopamine'` 둘 다 **기존 허용값** → backfill 에 **CHECK widening/DDL 불요**. sentinel 미채택(NULL 유지 선호, DA §B).

### Q2 — dopamine-마커 결정론 부분집합 정확 count → **1행**
predicate `created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL` = **1행**
(id `2fb4885d-7a96-4881-8859-c0645724ea75`, created 2026-08-02, external_id `e2e0a3c3-…-c301`).
경계사례(`source_system='dopamine' AND external_id IS NULL`) = 0. census(≈1) 일치.
⚠ 이 1행 = **E2E 카나리**(`AC3취소카나리`). provenance=dopamine 은 사실이나 실운영 analytics 가치 ≈0.

### Q1 — 2026-06-28 前 foot reservations 생성-경로 공간이 manual-only 였는가 → **YES (실증)**
| 축 | 증거 | 판정 |
|----|------|------|
| created_via 컬럼 | 2026-06-28 16:00 migration 최초 ADD ("풋 reservations 에는 created_via 부재") · 최초 non-NULL row 2026-06-29 11:09 | pre-mig 컬럼 물리 부재 |
| **dopamine push** | source_system='dopamine' 최초 row = **2026-07-01** (경계 後) · pre-mig dopamine = **0행**. dopamine-ingest EF 코드는 2026-05-20 존재하나 pre-mig 예약행 0 생성 | pre-mig 부재 |
| **selfbook/kiosk** | foot 코드에 셀프북/키오스크 **예약생성 경로 자체가 없음**(pages/functions grep=0) | 전무(현재까지도) |
| **API import/external** | pre-mig 187행 전부 external_id=NULL·lead_id=NULL | 부재 |
| source_system 컬럼 | 2026-05-20 추가(pre-mig 존재) · 187행 전부 NULL | **적극적** 비-external 증거(by-construction 부재 아님) |
| visit_route/referral | 최다 NULL, 소수 '지인소개'(=수기 입력 소개경로) | 수기 |

→ 187 pre-mig 행의 **유일한 물리적 생성경로 = 스태프 수기(admin manual)**. DA §A-2 by-construction 조건 충족 → Class R → `'manual'` fill = GO.

---

## STEP 2 — 187행 3-분할 처분 (freeze-set 확정)

| subset | predicate | count | 처분 | class |
|--------|-----------|-------|------|-------|
| **FS1 dopamine-marker** | `created_via IS NULL AND source_system='dopamine' AND external_id IS NOT NULL` | **1** | `'dopamine'` fill (GO) | R |
| **FS2 by-construction manual** | `created_via IS NULL AND created_at < '2026-06-29 11:09:35.494874+00' AND source_system IS NULL AND external_id IS NULL` | **187** | `'manual'` fill (GO·manual-only 실증) | R |
| **FS3 residual** | `created_via IS NULL AND created_at >= mig AND NOT(dopamine-marker)` | **12** | **NULL 유지·무접촉** | do-less |

- 정합: FS1(1)+FS2(187)+FS3(12) = **200** (전체 created_via NULL). FS1∩FS2 = **0** (disjoint).
- FS3 12행 = 전부 `registrar_name='테스트시드'`(test seed, 2026-06-30) → NULL 유지가 정직(DA §A-3 do-less).
- **blanket UPDATE fold 금지**(DA §E-H3): FS1/FS2 별 predicate·별 UPDATE 문. `else→'manual'` 휴리스틱 **미채택**(HARD REJECT 준수).

---

## 구현물 (write0 · apply 미실행)

- apply SQL: `migration_packages/T-20260818-foot-CREATEDVIA-BACKFILL-PREMIGRATION_backfill.sql`
  - FS1/FS2 별 UPDATE + `GET DIAGNOSTICS` freeze-set 단언(FS1==1·FS2==187·잔여==12 불일치 시 전체 롤백) · 멱등(`created_via IS NULL` 술어) · 단일 txn.
- rollback SQL: `..._backfill.rollback.sql` (188행만 NULL 복원, id 화이트리스트 포함).
- dry-run(무영속) evidence: `db-gate/..._dryrun.json` (rows_would_update FS1=1/FS2=187/total=188 · before_image_purity 0/0 · 실 UPDATE 미실행).

### dry-run 무영속 성격
dev-foot 측 dry-run = **순수 predicate SELECT** 기반(rows-would-update 산출) — 실 UPDATE 미실행 → 영속 위험 0.
BEGIN..UPDATE RETURNING..ROLLBACK 형 실검증은 **supervisor MIG-GATE** 소관(GO-token 후).

---

## 게이트 핸드오프 → supervisor (MIG-GATE)

AC-1 HARD CAVEAT 준수: `schema무변`/`ADDITIVE-data`/`§3.1 N/A` ≠ MIG-GATE 면제.
supervisor 선행 필수: **MIG-GATE + dry-run + rollback SQL 확인 + rows-affected==freeze-set(188=1+187) + 물리 GO-token**.
apply-gate = supervisor (NOT DA, NOT dev-foot). apply_before_go 금지.

**apply 후 POSTCHECK**(supervisor 또는 dev-foot):
1. 채운 188행만 변경(FS1 created_via='dopamine' 1 · FS2 created_via='manual' 187).
2. 잔여 created_via NULL == 12 (FS3 test-seed 무접촉).
3. rows-affected == freeze-set(188).
4. provenance analytics 오염 0 (%manual/%dopamine 분포에 FS2 187·FS1 1 만 반영, FS3 미포함).

### dev-foot 관찰(supervisor 판단 참고)
- FS1 1행은 E2E 카나리 → skip 해도 do-less 정합(실가치≈0). fill 시에도 provenance-correct.
- 실운영 의미 backfill = FS2 187행(pre-mig 수기 예약)이 본질.

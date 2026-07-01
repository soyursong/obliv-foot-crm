# T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE — DB-gate evidence (shape ii · rework)

**phrase_templates write RLS 드리프트 복구 + FE 7역할 정합 (단일 통합정책, pen_chart/customer_chart)**
db_change=true · ADDITIVE only · DA GO(shape ii) 확보 · supervisor DDL-diff 5-check 게이트 대기

> ★rework: 앞선 shape(i) 아티팩트(commit 78d355c8, 20260620120000 재적용)는 **deploy VOID**.
> DA 2-reply race — f5k2(10:23:54, shape i)는 6분 뒤 **2k2i(10:29:53, shape ii)가 명시 반려**
> ("(i) 반려" + "92a95431/staff_write 재apply **금지**"). 정본 = 2k2i(shape ii). 본 문서는 shape(ii) 기준 재작성.

---

## AC-1 — 드리프트 root-cause (Phase A, read-only, 확정 · shape 무관 유지)

**RC = 순수 미apply.** (revert 아님 / 20260624180000 덮음 아님)

- `staff_write_staffarea_phrases` (마이그 `20260620120000` / commit `92a95431`) = **PROD phrase_templates 부재**.
- PROD 실측 정책 = `admin_write_phrase_templates{admin,manager,director}` + read=true 2건뿐.
- **원인**: 6/09 이후 `supabase_migrations.schema_migrations` 원장 미추적(20260609234500 에서 정지) → 마이그는 개별 apply `.mjs` 로만 PROD 반영. `92a95431` 은 apply 스크립트 부재로 reconcile 경로 자체 없음 → 영구 미반영.
- **혐의 기각①** revert: rollback 실행/커밋 흔적 0, 정책 애초 미생성.
- **혐의 기각②** 20260624180000 덮음: 그 마이그는 **별개 정책명** `admin_write_phrase_templates` 만 DROP/CREATE. `staff_write_staffarea_phrases` 미참조 → 덮을 수 없음.
- **systemic carry**: 인접 마이그 PROD 미반영 parity audit = 별 티켓 T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP 로 이관.
- 실측 스크립트: `scripts/T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE_phaseA_diag.mjs`

## AC-2 — DA CONSULT-REPLY shape 확정 = **(ii) 단일 통합정책** ✅

정본 DA CONSULT-REPLY **MSG-20260701-102953-2k2i** (DA-20260701-PHRASETMPL-RLS-4ROLE):

- **shape = (ii) 단일 permissive 통합정책 신설** `staffarea_write_phrases`.
- **shape (i) 명시 반려**: "20260620120000/staff_write 재apply **금지**"(fragmentation·drift 재생산). shape(i)이 하려던 재apply가 바로 그 금지 대상 → shape(i) 아티팩트 **deploy VOID**.
- 정책명 role-prefix(`_write_staffarea_phrases`) 금지 → `staffarea_write_phrases`. 주석에 `mirrors FE canEditStaffAreaPhrase` 태그.
- 대상 role = **7역할 verbatim** `{admin, manager, consultant, coordinator, therapist, part_lead, staff}` = FE `PHRASE_STAFFAREA_EDIT_ROLES`(ALL_STAFF_ROLES−director)와 1:1(anti-drift 핵심). admin/manager는 admin_write와 OR 중복이나 무해·자기문서화 → 7역할 전부 명시.
- **coordinator 이중정책 방지**: sibling `20260701030000`(coordinator 단일) = **흡수·폐기**. shape(i) `20260620120000`(5역할) = **재apply 불사용·흡수**. 두 superseded 정책은 통합정책 마이그에서 방어적 `DROP IF EXISTS`(PROD 미존재 시 no-op) → 중복 permissive 원천 차단.

## AC-3 — 확정 shape(ii) 마이그 + 롤백 (deploy 아티팩트)

- **신규 통합 마이그(1건)**: `supabase/migrations/20260701040000_phrase_templates_staffarea_write_7role_unified.sql`
  - 정책 `staffarea_write_phrases` · **FOR ALL** · 7역할 · `phrase_type IN ('pen_chart','customer_chart')` **USING + WITH CHECK 양쪽**.
  - 상단 방어적 `DROP IF EXISTS staff_write_staffarea_phrases / coordinator_write_staffarea_phrases`(흡수·폐기, admin_write 무접촉).
- **롤백**: `..._unified.rollback.sql` (`DROP POLICY staffarea_write_phrases` → effective write = {admin,manager,director} 원복, 데이터 영향 0).
- **apply 스크립트**: `scripts/T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE_apply.mjs` — pre-snap(DDL-diff BEFORE) → 통합 마이그 실행 → post-snap(AFTER) → **5-check 자동 구조검증**. 멱등.
- **superseded 중립화**: `20260620120000`(재apply 안 함) / `20260701030000_*.SUPERSEDED`(glob 제외, 미apply). shape(i) 아티팩트는 VOID 표기.
- **FE 변경 0**: `PHRASE_STAFFAREA_EDIT_ROLES = ALL_STAFF_ROLES − director` = 7역할, 旣 열림. 통합정책 role set과 verbatim 1:1.

### ★DELETE scope 정렬 (dev-foot PROD 실측)
- PROD `admin_write_phrase_templates` = **FOR ALL** (USING-only, WITH CHECK 없음) → SELECT/INSERT/UPDATE/**DELETE** 전부 커버.
- 스펙 "DELETE = admin_write 현행 scope와 맞춤" → admin_write가 FOR ALL(DELETE 포함)이므로 `staffarea_write_phrases`도 **FOR ALL**로 INSERT+UPDATE+**DELETE** 포함 정렬. SELECT는 기존 `staff_read_phrase_templates`(USING true)와 OR 중복·무해.

### apply 후 FE↔서버 정합
| 정책 | role | phrase_type | cmd |
|------|------|-------------|-----|
| admin_write_phrase_templates (무변경) | admin, manager, director | 全 (medical 포함) | ALL |
| **staffarea_write_phrases (신규 통합)** | **admin,manager,consultant,coordinator,therapist,part_lead,staff (7역할)** | pen/customer 한정 | ALL |
| **pen/customer write union** | = FE `canEditStaffAreaPhrase` 7역할 정확 일치 (over-grant 0, gap 0) | | |

director medical_chart write = admin_write 로 보존(OPINIONPHRASE director-only 무회귀).

## AC-4 — 침투테스트 (supervisor DDL-diff 게이트, apply 후)

apply.mjs 자동 **5-check 구조 검증**:
- ①role=7 정확 (7역할 전부 + director 부재) ②USING+WITH CHECK 양쪽 phrase_type 가드 ③admin_write 무변경 {admin,manager,director} ④sibling `coordinator_write_staffarea_phrases` 부재 ⑤(구조) staff medical_chart 차단.
- 부가: shape(i) `staff_write_staffarea_phrases` 부재 + coordinator 이중정책 부재.

**토큰 기반 침투테스트 (supervisor):** 잔여 4역할(consultant/therapist/part_lead/staff) + coordinator 토큰별:
1. medical_chart INSERT → **deny** (WITH CHECK phrase_type 가드 fail)
2. pen_chart UPDATE 로 phrase_type→medical_chart 변조 → **deny** (신규 row WITH CHECK fail)
3. medical_chart UPDATE/DELETE → **deny** (기존 row USING fail)
+ pen/customer INSERT/UPDATE/DELETE → **성공** (5역할)
+ admin/manager/director/원장 무회귀 + `pg_policies`에 coordinator 중복 permissive 부재.

---

## 게이트 / 배포 상태
- **DA GO ✅ (shape ii, 2k2i)** — ADDITIVE + DA GO → autonomy §3.1 대표 게이트 면제.
- **supervisor DDL-diff 5-check GO 대기** → GO 후 apply.mjs forward apply → 토큰 침투테스트.
- 타임스탬프 out-of-order(원장 20260609 정지) → supabase 툴 skip 가능 → **명시적 forward apply**(apply.mjs 관리 API 직접 실행).
- DB apply 경로는 Vercel FE 배포와 무관(관리 API 독립).
- **cross-ticket**: sibling T-20260630-foot-PHRASETMPL-CODY-WRITE-RLS = **CLOSED(superseded)**, 20260701030000 apply 금지. MIGRATION-LEDGER-DRIFT-SWEEP: 92a95431/staff_write = **SUPERSEDED**(blind reconcile 재apply 금지, AC2 casualty 제외).
- field_confirm = 전 역할 정합 완료 후 통합 1회(코디 계정 + 상용구관리 딥링크). HOLD_UNTIL_ALL_AC_DONE. **지금 현장 핑 금지.**

---

## ✅ PROD APPLY 실행 결과 (dev-foot, 2026-07-01T03:07:28Z / KST 12:07)
- **트리거**: supervisor MSG-20260701-115923-6eb8 — DDL-diff 5-check PASS(ticket log 11:12) → PROD apply 지시.
- **대상**: commit `a9081233` / migration `20260701040000_phrase_templates_staffarea_write_7role_unified.sql` (작업트리 == 커밋본, diff 0).
- **경로**: `scripts/T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE_apply.mjs` — 관리 API(REF rxlomoozakkjesdqjtvd) 직접 forward apply. Vercel FE 배포와 독립.

### pg_policies (DDL-diff AFTER, PROD 실측)
| policy | cmd | roles | 가드 |
|--------|-----|-------|------|
| `admin_write_phrase_templates` | ALL | {admin,manager,director} | phrase_type 무가드 (무변경 ✅) |
| `staff_read_phrase_templates` | SELECT | {authenticated} | USING true (무변경) |
| `staffarea_write_phrases` | **ALL** | **{admin,manager,consultant,coordinator,therapist,part_lead,staff}** | phrase_type IN(pen_chart,customer_chart) **USING+WITH CHECK 양쪽** ✅ (신규) |

### apply.mjs 자동 5-check = **ALL PASS**
- ✅ ①role=7 정확 (7역할 전부 + director 부재)
- ✅ ②USING 가드 + ②WITH CHECK 가드 (pen/customer, no medical) — 변조 hole 차단
- ✅ ③admin_write_phrase_templates 무변경 {admin,manager,director}
- ✅ ④sibling `coordinator_write_staffarea_phrases` 부재 (흡수·폐기)
- ✅ ★shape(i) `staff_write_staffarea_phrases` 부재 (재apply 불사용)
- ✅ ★coordinator 이중정책 부재 (단일정책에만 등장)

### medical_chart write = 비-director 차단 (구조 전수검증, /tmp/medchart_block_verify.mjs)
- medical_chart WRITE 허용 role 합집합 = **{admin,manager,director}** (변경 전과 동일, admin_write 경로 뿐).
- 신규 staffarea 5역할(consultant,coordinator,therapist,part_lead,staff) 중 medical_chart write 가능 = **0건**.
- `staffarea_write_phrases`는 phrase_type 가드로 medical_chart 전면 제외 → director-only OPINIONPHRASE 무회귀 ✅.
- (토큰 기반 실사용자 침투테스트 = AC-4 supervisor 담당 범위 유지 — 본 apply는 구조/실측 검증까지 완료.)

### 후속
- field_confirm = **HOLD_UNTIL_ALL_AC_DONE 유지** — 현장 핑 미발송.
- 롤백 준비: `supabase/migrations/20260701040000_...rollback.sql` (DROP POLICY staffarea_write_phrases → effective write {admin,manager,director} 원복).

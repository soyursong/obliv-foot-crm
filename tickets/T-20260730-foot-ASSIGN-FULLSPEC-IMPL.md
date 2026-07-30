---
id: T-20260730-foot-ASSIGN-FULLSPEC-IMPL
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: ae1a52c1
deployed_at: pending (supervisor QA + main merge 후 CF Pages 자동배포)
bundle_hash: pending
db_change: true
da_consult: 면제 (DA CONSULT-REPLY MSG-20260730-091327-j8us / da_decision_foot_assign_leadsource_6path_split_20260730 = ADDITIVE+GO, Option B → autonomy §3.1 대표게이트 면제·supervisor DDL-diff 게이트만)
mig_files: [supabase/migrations/20260730120000_foot_assign_leadsource_6path_split.sql]
mig_dryrun: pass
mig_dryrun_postprobe: 무영속 실증 — dry-run 왕복(fwd→fwd멱등→rbk→ROLLBACK) 후 POST-PROBE policy_6 0→0·pointer_6 0→0·ledger 0→0 (canonical: txn-strip + 외곽 BEGIN..ROLLBACK + post-probe)
mig_ledger_check: clean
mig_rollback: supabase/migrations/20260730120000_foot_assign_leadsource_6path_split.rollback.sql
applied_at: "2026-07-30 POSTCHECK CHECK 6값 실재(assignment_leadsource_policy_lead_source_check·assignment_pointer_state_lead_source_check 둘 다 NAVER/REFERRAL/HOMEPAGE 포함), ledger 20260730120000 n=1, 기존 TM policy row 무손상, NAVER INSERT 허용(check_violation 없음)"
e2e_spec: tests/e2e/T-20260730-foot-ASSIGN-LEADSOURCE-6PATH-SPLIT.spec.ts (unit 6종 PASS)
created: 2026-07-30
reporter: planner
slack_thread_ts: ""
summary: "자동배정 §094v 다. 비TM 유입경로 6경로 분리(Option B). 네이버/지인소개/공홈이 워크인 커서에 묶이던 fall-through를 결정적 3경로(NAVER/REFERRAL/HOMEPAGE)로 승격 — 각 경로가 assignment_leadsource_policy/assignment_pointer_state에서 독립 row + 독립 랭킹 커서. DA=ADDITIVE+GO(Option B). lead_source CHECK 3→6 ADDITIVE(값 추가만·백필불요·파괴0). 라우팅 primary=deriveAssignLeadSource(governed enum 파생-only), 집계/audit 축(deriveConsultAxis)·재진 365-recency 로직 무접촉(CEO gate 경계, T-20260713 직교)."
---

# T-20260730-foot-ASSIGN-FULLSPEC-IMPL — 자동배정 §094v 다. 비TM 유입경로 6경로 분리

## 착수 근거
DA CONSULT-REPLY `MSG-20260730-091327-j8us` (SSOT=`da_decision_foot_assign_leadsource_6path_split_20260730.md`)
= **VERDICT ADDITIVE + GO, 권장 Option B**(경로별 governed enum row + 독립 커서). autonomy §3.1 →
대표게이트 면제, supervisor DDL-diff 게이트만. G1(전주 윈도우 355d6e87) 선착수 확인 완료.

## ★ 설계 판단 (DA Q1~Q3 이행)
- **Q1 (A vs B) → B**: 기존 설계가 이미 INBOUND·WALK_IN을 per-lead_source policy+cursor로 독립 운용 →
  3경로 추가는 그 확립 선례의 ADDITIVE 연장(minimal-surprise). B는 '해당 경로 누적 차등'을 결정적으로 보장
  (A=공유 WALK_IN 커서는 기댓값 수준만 → 저볼륨 경로 고분산). '각 경로 독립 인식'을 rotation state까지 만족.
- **Q2 (정본 표기) → 영대문자 governed enum** `NAVER`/`REFERRAL`/`HOMEPAGE` (한글 주입 금지, 혼합컨벤션 drift 차단).
  `visit_route`(한글 원천캡처) → `lead_source`(영대문자) 매핑을 계약 아티팩트로 **명시 codify**
  (`VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE`, `deriveConsultAxis` 암묵 fall-through 제거). CHECK ADDITIVE(값 추가만).
  이 lead_source는 foot-local 배정 라우팅 enum — cross_crm_data_contract `lead_source='dopamine_tm'`(customers 귀속축,
  source_system과 직교)과 다른 컬럼 → cross-CRM shared enum 아님, 계약 충돌 0.
- **Q3 (axis free-text) → axis를 primary accounting substrate로 쓰지 않음**: 배정 공정성(돈 인접) first-class
  차원을 governance 없는 free-text `axis`에 얹지 않고, governed `lead_source`(deriveAssignLeadSource,
  파생-only·수기입력 금지)를 라우팅 primary로 삼음. `axis`는 집계/analysis 라벨로 유지(무변경).

## ★ CEO-게이트 cross-check (오게이트 방지)
본 6경로 분리는 T-20260713(CEO 재진 365-recency 통일)과 **직교** — CEO가 통일한 건 재진 recency 축이지
유입경로 라우팅 축 아님. **`deriveConsultAxis`(재진 365-recency 분류 로직)는 무접촉**으로 유지하고,
라우팅 lead_source 파생은 별도 함수 `deriveAssignLeadSource`로 분리 → CEO 게이트 불발, DA 자율 성립.
경계(유입경로 매핑 ⊥ 재진 recency) supervisor code-review 명시 분리 확인 요망.

## 구현 (변경 파일)
1. `src/lib/types.ts` — `AssignLeadSource` 3→6(NAVER/REFERRAL/HOMEPAGE) + `VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE` 명시 매핑 상수.
2. `src/lib/assignmentStrategy.ts` — `deriveAssignLeadSource`(governed primary substrate) 신설 +
   `pickConsultantByStrategy`(axis→leadSource 파라미터) 전환 + `AXIS_TO_LEAD_SOURCE` 6값 codify(보조).
3. `src/lib/autoAssign.ts` — 라우팅 lead_source = `deriveAssignLeadSource(customer)` 직접 파생.
   집계/audit 축(`deriveConsultAxis`)·재진 skip·365-recency 무접촉(라인 600 재진 skip 불변).
4. `src/components/AssignmentSettingsTab.tsx` — 배정 설정 UI 6경로 노출(미설정=월균등 opt-in).
5. `supabase/migrations/20260730120000_foot_assign_leadsource_6path_split.sql` (+rollback +dryrun) —
   ADDITIVE: `assignment_leadsource_policy`·`assignment_pointer_state` lead_source CHECK 3→6 +
   WALK_IN 설정 clinic 조건부 seed(현행 prod 무 WALK_IN row → seed no-op, 회귀0). 커서는 lazy 생성.
6. `tests/e2e/T-20260730-foot-ASSIGN-LEADSOURCE-6PATH-SPLIT.spec.ts` — unit 6종.

## 회귀 안전 (opt-in·비파괴)
- CHECK 값 추가만 → 기존 3값 행 전부 유효·PK 무영향·백필 불요·파괴변경 0.
- deriveConsultAxis(집계/audit 축) 무변경 → 금일 배분 이력·월균등 카운트·assignment_actions.axis 계보 불변.
- 정책 미설정 경로 → `pickConsultantByStrategy` null → 기존 월균등 least-loaded fallback(회귀0).
- 매핑 미스(레거시 '온라인'/'기타'/공란) → WALK_IN 안전 폴백 = 기존 '워크인' 수렴 보존.
- 매출귀속 RED LINE(INV-1): 반환값은 check_ins.consultant_id set 대상일 뿐 customers.assigned_consultant_id 무접촉.

## 검증
- `npm run build` OK (tsc + vite).
- 마이그 dry-run 무영속 ALL-PASS → `--apply` REAL APPLY ALL-PASS(CHECK 6값 + ADDITIVE 실효 + 비파괴 TM row 무손상).
- unit spec 6/6 PASS(6경로 매핑·워크인 미결합·재진 null·매핑완전성·CEO경계·DB CHECK 6값 실측).

## supervisor QA 요청 포인트
1. DDL-diff: CHECK 3→6 ADDITIVE 비파괴 재확인(값 추가만·기존 행 유효·PK 무영향).
2. CEO-게이트 경계: `deriveConsultAxis` 재진 365-recency 로직 무접촉 확인(유입경로 매핑 ⊥ 재진 recency).
3. code merge → main → CF Pages 자동배포(FE). DB DDL은 이미 prod 적용 완료(applied_at 참조) — ADDITIVE 선적용 안전.

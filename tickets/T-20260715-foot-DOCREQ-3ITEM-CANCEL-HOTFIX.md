---
id: T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX
domain: foot
priority: P1
hotfix: true
status: deploy-ready
qa_result: pending
resolution: data-correction soft-cancel (앱 useResolveOpinionRequest reason:cancelled 경로 서버측 재현)
db_change: true
e2e_spec_exempt_reason: db_only
db_gate: 필요 — count guard(==3) + WHERE 전조건 교차 + before/after 스냅샷 검증
build: n/a (db_only — 앱 코드 무변경, DDL 0)
scenario_count: 0 (db_only 면제)
e2e_spec: exempt (db_only)
spec: exempt (db_only)
# ── MIG-GATE evidence 4필드 (deploy_ready_marking.md v1.5) ──
mig_files: none (DDL 0 — 데이터정정 UPDATE 3행, 신규 컬럼·테이블·enum·status 0)
mig_dryrun: pass (scripts/..._apply.mjs dry-run 무영속 확인 → --apply affected==3 RETURNING)
mig_ledger_check: N/A (DDL 0 — schema_migrations 무접촉)
mig_rollback: rollback/T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX_rollback.sql (voided→draft + resolved_* 제거)
mig_dryrun_postprobe: N/A (무영속 sentinel 러너 미사용 — 실 UPDATE + RETURNING 검증)
created: 2026-07-15
completed: 2026-07-15
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260715-184104-fnem) / 현장 김주연 총괄
---

# T-20260715-foot-DOCREQ-3ITEM-CANCEL-HOTFIX — 서류작성 큐 3건 요청취소(회수)

## 요청 (P1 hotfix, 김주연 총괄 명시요청)
원장 발행 前 서류작성 큐 소견서 요청 3건을 소프트취소(회수)한다.

## 근거 (재사용)
앱의 `src/lib/opinionRequest.ts` `useResolveOpinionRequest({reason:'cancelled'})` 경로를 서버측에서 그대로 재현.
→ `status: draft → 'voided'` + `field_data` 병합 `resolved_reason='cancelled'`, `resolved_at=<now ISO>`.
스키마 무변경·비파괴·비대량(3행) → DA/대표 게이트 불요.

## 대상 (form_submissions, clinic=jongno-foot `74967aea-a60b-4da3-a0e7-9c997a930bc8`)
| id | chart_no | 환자명 | doc_type | 사유 |
|----|----------|--------|----------|------|
| 27b15c11-4b1c-4850-b323-371366bccd8a | F-4574 | 총괄테스트중 | 소견서 | 위장장애·혈압약·고지혈증 |
| b94b9b13-0752-44ac-bafb-a3a83bdacdf2 | F-4678 | 총*현 | 소견서 | 복용 후 위장애 |
| 755ac489-a262-48a8-bad0-2f03142c992a | F-4692 | 송지현2 | 소견서 | 복용 후 위장애 |

## Data-Correction SOP 준수
1. **SELECT-first count guard**: chart_no IN 대상 + status='draft' + field_data.request_origin='staff_consult' + clinic=풋 → **count == 3 확인**(≠3 즉시 ABORT). 3건 모두 환자명·doc_type 일치, `requested_by_name=김주연`, 미해결(resolved_* none).
2. **WHERE 전조건 교차**: 정확 PK(3개) + status='draft' + clinic_id=풋 (동시성 가드). 각 UPDATE `affected==1`, 합 `==3` RETURNING 확인.
3. **before/after 스냅샷**: `scripts/..._select_snapshot.mjs` 출력 + `..._apply.mjs` RETURNING. field_data 원본 전량 보존, resolved_reason/resolved_at 2필드만 추가.
4. **롤백 준비**: `rollback/..._rollback.sql` (voided→draft, resolved_* 제거, hotfix-cancelled 건만).
5. **다른 행 무접촉**: 이미 발행/voided·타clinic·타origin 미변경 (정확 PK 타겟 + RETURNING affected 정합).

## 실행 결과 (2026-07-15 apply)
- freeze-set 재검증: 대상 3 / 조회 3 / 적격 draft 3 → PASS
- `--apply` RETURNING affected == **3** (각 1행) → 모두 status='voided', resolved_reason='cancelled', resolved_at ISO
- post-verify: 서류작성 큐 draft 매칭 **0** (3건 큐 이탈 확인)

## 완료
3행 before/after → planner 회신 → responder 경유 김주연 총괄 확인 요청.

# DA CONSULT — T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A)

- **from**: agent-fdd-dev-foot
- **to**: agent-data-architect
- **게이트**: `da_consult: REQUIRED(착수 전 1차 게이트)` — GO 전 스키마 write 금지(티켓 dev 착수 순서 §1)
- **change-class**: ADDITIVE (신규 컬럼 3 + 신규 테이블 1 + 신규 트리거 1 + RESTRICTIVE 정책 1). DROP/타입변경 0.
- **첨부 DDL draft**:
  - `supabase/migrations/20260802150000_foot_form_submissions_softdelete_audit.sql`
  - `...rollback.sql` / `...dryrun.sql`
- **미러 원본**: `medical_charts_soft_delete_sameday_unique.sql` + `medical_charts_body_audit.sql`

## 요청: 아래 구체 DDL에 대한 CONSULT-REPLY GO/조정

### 제안 DDL 요약
1. `form_submissions` ADD: `deleted_at TIMESTAMPTZ`, `deleted_by UUID`, `delete_reason TEXT` (모두 NULL 허용, 629행 backfill=deleted_at NULL default·무손실).
2. `form_submissions_audit_log` 신규(append-only): id/form_submission_id(FK CASCADE)/clinic_id(**UUID**, medical_charts는 TEXT였음)/old_data/new_data/changed_by/changed_at/operation CHECK IN('UPDATE','DELETE'). RLS SELECT·INSERT=is_approved_user(), UPDATE/DELETE 정책 부재(위변조 불가).
3. `trg_form_submissions_audit` BEFORE UPDATE 트리거: deleted_at NULL→NOT NULL 전이=operation 'DELETE' 라벨, 그 외 'UPDATE'. NEW 무변형(회귀 0). 기존 `trg_form_submissions_published_immutable`와 공존(트리거명 순서상 audit 먼저, immutable RAISE 시 txn 롤백으로 정합).
4. `fs_deleted_rows_director_only` RESTRICTIVE SELECT 정책: 삭제행은 director/admin만. 비삭제행 무회귀.

### 판단 필요 Open Questions
- **Q1 (is_deleted 병행 여부)**: medical_charts는 `is_deleted BOOLEAN` + deleted_at 둘 다 보유. 본 draft는 티켓 AC-2 캐논 술어(`deleted_at IS NULL`)만 채택해 3컬럼. medical_charts 완전 패리티를 위해 `is_deleted` 도 추가할지? (추가해도 ADDITIVE)
- **Q2 (immutable 트리거 draft/voided 확대)**: 현 `trg_form_submissions_published_immutable` 는 `OLD.status='published'` 만 비가역 차단. 티켓 트랙 A §4 = draft/voided 도 immutable 커버 확대 여부 검토. 확대 시 기존 편집/void 라이프사이클 회귀 우려 → 확대 범위·예외 DA 확정 요청. (draft는 **미확대** 유지)
- **Q3 (RESTRICTIVE 가시성 정책)**: `current_user_role()` helper 존재/역할셋(director/admin) 정합 확인 요청. 삭제행 director/admin 제한이 과한지(발행문서 조회 권한 정책과 정합) 판단.
- **Q4 (삭제 경로)**: FE에 form_submissions client hard-DELETE **없음**(RLS DELETE 정책 부재로 이미 default-deny). 물리 삭제는 service_role 스크립트만. → 트랙 A는 (a)script/service_role 삭제 audit + (b)향후 in-app soft-delete 경로 대비가 실효. 추가로 BEFORE DELETE 가드(hard-DELETE 자체를 RAISE로 차단하거나 soft-delete로 강제)를 넣을지 DA 판단 요청. (draft는 audit BEFORE UPDATE만)
- **Q5 (audit clinic_id 타입)**: form_submissions.clinic_id=UUID이므로 audit.clinic_id=UUID로 설정(medical_charts는 TEXT). 확인.

### FE 영향 (GO 후 별도 커밋)
- form_submissions SELECT 다수(KohPublishedResults / PaymentMiniWindow / OpinionDocTab / KohReportTab / DocumentPrintPanel / DocumentReprintPopup / MedicalChartPanel)에 `deleted_at IS NULL` 필터 추가(무회귀). 삭제행이 생기기 전엔 no-op.

### 트랙 B (PITR) — 본 CONSULT 범위 외
- Supabase PITR enable = 유료 add-on/CEO 비용결정. planner DECISION-REQUEST 별도. 본 트랙 A(무비용 ADDITIVE)와 독립.

## dev-foot 진행 상태
- 구체 DDL draft 작성 완료(위 첨부). **GO 대기 중 — prod 미적용·main 미머지·deploy-ready 미마킹.**
- CONSULT-REPLY GO 수신 시: (조정 반영) → dry-run(무영속) → supervisor DDL-diff → prod apply → main merge → deploy-ready.

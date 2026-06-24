# T-20260624-foot-CHART2-MEMO-EDIT-DELETE — DB-gate evidence
- db: rxlomoozakkjesdqjtvd | 2026-06-24T07:21:54.221Z | mode: AUDIT+APPLY
- ADDITIVE deleted_at/deleted_by ×3 + role-manage UPDATE RLS + DELETE RLS 제거(의료법 hard-delete 금지)
- 동기: FE(6264679f) 라이브 + .is(deleted_at,null) → 컬럼 미적용 시 메모이력 회귀. 정합 회복.

## [A] read-only audit (pre)
```
soft-delete 컬럼(적용 전):
없음(3테이블 신설 대상)

정책(적용 전):
  customer_consult_memos.clinic_isolation_ccm_insert [INSERT]
  customer_consult_memos.clinic_isolation_ccm_select [SELECT]
  customer_consult_memos.own_delete_ccm [DELETE]
  customer_consult_memos.own_update_ccm [UPDATE]
  customer_reservation_memos.clinic_isolation_crm_insert [INSERT]
  customer_reservation_memos.clinic_isolation_crm_select [SELECT]
  customer_reservation_memos.own_delete_crm [DELETE]
  customer_reservation_memos.own_update_crm [UPDATE]
  customer_treatment_memos.clinic_isolation_ctm_insert [INSERT]
  customer_treatment_memos.clinic_isolation_ctm_select [SELECT]
  customer_treatment_memos.own_delete_ctm [DELETE]
  customer_treatment_memos.own_update_ctm [UPDATE]
```

## [B] migration apply (20260624160000_memo_soft_delete_role_manage)
✅ deleted_at/deleted_by ×3 + manage_update_* RLS + DELETE RLS drop 적용 완료

## [C] NOTIFY pgrst 'reload schema' 전송

## [D] post-verify
```
soft-delete 컬럼(적용 후):
[{"table_name":"customer_consult_memos","column_name":"deleted_at","data_type":"timestamp with time zone","is_nullable":"YES"},{"table_name":"customer_consult_memos","column_name":"deleted_by","data_type":"text","is_nullable":"YES"},{"table_name":"customer_reservation_memos","column_name":"deleted_at","data_type":"timestamp with time zone","is_nullable":"YES"},{"table_name":"customer_reservation_memos","column_name":"deleted_by","data_type":"text","is_nullable":"YES"},{"table_name":"customer_treatment_memos","column_name":"deleted_at","data_type":"timestamp with time zone","is_nullable":"YES"},{"table_name":"customer_treatment_memos","column_name":"deleted_by","data_type":"text","is_nullable":"YES"}]

정책(적용 후):
  customer_consult_memos.clinic_isolation_ccm_insert [INSERT]
  customer_consult_memos.clinic_isolation_ccm_select [SELECT]
  customer_consult_memos.manage_update_ccm [UPDATE]
  customer_reservation_memos.clinic_isolation_crm_insert [INSERT]
  customer_reservation_memos.clinic_isolation_crm_select [SELECT]
  customer_reservation_memos.manage_update_crm [UPDATE]
  customer_treatment_memos.clinic_isolation_ctm_insert [INSERT]
  customer_treatment_memos.clinic_isolation_ctm_select [SELECT]
  customer_treatment_memos.manage_update_ctm [UPDATE]
```

## [결과] PASS ✅
- soft-delete 컬럼 6개 nullable: OK
- manage_update_* UPDATE 정책 3개: OK
- DELETE 정책 잔존 0(hard-delete 차단): OK
- 롤백: psql -f supabase/migrations/20260624160000_memo_soft_delete_role_manage.down.sql

---
ticket_id: T-20260520-foot-CHECKIN-RLS-STAFF
title: check_ins RLS UPDATE 정책 — staff/part_lead/tm 역할 누락 버그 수정
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
db_change_note: |
  supabase/migrations/20260520000060_check_ins_staff_update_rls.sql
  - is_floor_staff() 헬퍼 함수 신규 추가 (admin/manager/director/staff/part_lead/tm)
  - check_ins_staff_update UPDATE 정책 신규 추가 (check_ins 테이블)
  롤백: 20260520000060_check_ins_staff_update_rls.down.sql
  (DROP POLICY check_ins_staff_update + DROP FUNCTION is_floor_staff())
build_ok: true
e2e_spec: tests/e2e/T-20260520-foot-CHECKIN-RLS-STAFF.spec.ts
created_at: 2026-05-20
deadline: 2026-05-22
implemented_by: dev-foot
---

# T-20260520-foot-CHECKIN-RLS-STAFF — check_ins RLS staff 역할 UPDATE 권한 수정

## 문제 요약

대시보드 칸반 드래그앤드롭 시 슬롯이 되돌아오는 버그. **스태프 계정 전원** 동일 증상.

**원인**: `check_ins` 테이블 RLS UPDATE 정책에 `staff`, `part_lead`, `tm` 역할 누락.
- 현재: admin/manager/consultant/coordinator/therapist만 UPDATE 허용
- 누락: staff/part_lead/tm 역할 → optimistic UI 후 서버 거부 → realtime 원상 복구

## 수정 내용

### 1. 신규 헬퍼 함수 `is_floor_staff()`

```sql
CREATE OR REPLACE FUNCTION is_floor_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','staff','part_lead','tm');
$$;
```

- 기존 `is_coordinator_or_above()` 변경 없음 (사이드 이펙트 방지)
- 독립적인 신규 헬퍼로 격리

### 2. 신규 UPDATE 정책 `check_ins_staff_update`

```sql
CREATE POLICY check_ins_staff_update ON check_ins
  FOR UPDATE TO authenticated
  USING (is_floor_staff())
  WITH CHECK (is_floor_staff());
```

- 기존 5개 check_ins 정책 변경 없음 (OR 결합 — 충돌 없음)
- `check_ins_admin_all`, `check_ins_consult_update`, `check_ins_coord_update`, `check_ins_therap_update` 모두 유지

### 3. 롤백 SQL

```sql
DROP POLICY IF EXISTS check_ins_staff_update ON check_ins;
DROP FUNCTION IF EXISTS is_floor_staff();
```

파일: `supabase/migrations/20260520000060_check_ins_staff_update_rls.down.sql`

## AC 검증

| AC | 설명 | 검증 방법 |
|----|------|-----------|
| AC-1 | staff 계정 칸반 드래그 이동 정상 반영 | `check_ins_staff_update` 정책 적용 후 UPDATE RLS 통과 |
| AC-2 | part_lead 계정 칸반 드래그 이동 정상 반영 | `is_floor_staff()`에 `part_lead` 포함 |
| AC-3 | 기존 5역할 회귀 없음 | 기존 정책 변경 없음, OR 결합으로 기존 정책 유효 |
| AC-4 | 마이그레이션 SQL + 롤백 SQL 쌍 제출 | `20260520000060_check_ins_staff_update_rls.sql` + `.down.sql` |

## 리스크

- GO_WARN — DB RLS 정책 수정
- FE 코드 변경 없음 (Dashboard.tsx handleDragEnd 정상, RLS만 수정)
- 롤백: `.down.sql` 실행으로 즉시 원복 가능

## 파일 목록

| 파일 | 종류 | 설명 |
|------|------|------|
| `supabase/migrations/20260520000060_check_ins_staff_update_rls.sql` | DB 마이그레이션 | is_floor_staff() + check_ins_staff_update 정책 |
| `supabase/migrations/20260520000060_check_ins_staff_update_rls.down.sql` | 롤백 SQL | 정책 + 함수 DROP |
| `tests/e2e/T-20260520-foot-CHECKIN-RLS-STAFF.spec.ts` | E2E spec | AC-1~4 검증 |

## Supervisor 검토 사항

1. `is_floor_staff()` 역할 목록 적절성 확인 (admin/manager/director/staff/part_lead/tm)
2. `check_ins_staff_update` 정책 범위 — UPDATE 전 status 제한 없음 (전 단계 이동 허용) 의도적 설계
3. DB 마이그레이션 적용 전 `is_floor_staff()` 함수 의존 없음 확인

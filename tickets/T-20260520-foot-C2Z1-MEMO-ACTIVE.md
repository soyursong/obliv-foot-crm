---
id: T-20260520-foot-C2Z1-MEMO-ACTIVE
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: true
regression-risk: low
e2e-spec: tests/e2e/T-20260520-foot-C2Z1-MEMO-ACTIVE.spec.ts
created: 2026-05-20
---

# T-20260520-foot-C2Z1-MEMO-ACTIVE — 2번차트 1구역 예약메모 활성화 상태 전환

## 현장 요청

> "2번차트 1구역 예약메모 활성화 상태로 변경해줘" (C0ATE5P6JTH 풋확장, 2026-05-20)

## AC-1: 비활성 원인 진단 결과

**근본 원인: `reservation_memo_history` RLS 정책 `clinic_isolation_rmh` 버그**

```sql
-- 기존 (broken)
CREATE POLICY "clinic_isolation_rmh" ON reservation_memo_history
  USING (clinic_id = (SELECT clinic_id FROM staff WHERE id = auth.uid()));
```

- `staff.id` = `gen_random_uuid()` PRIMARY KEY → `auth.uid()`와 무관
- `SELECT clinic_id FROM staff WHERE id = auth.uid()` → 항상 NULL 반환
- `clinic_id = NULL` → 항상 false → SELECT 0행 + INSERT 차단
- FE 컴포넌트 자체는 정상 (disabled/readOnly prop 없음)
- 기능적으로 read-only 상태: 메모 없음 표시 + 추가 시 toast 에러

## AC-2: 수정 내용

### DB 마이그레이션 (신규)
파일: `supabase/migrations/20260520000110_reservation_memo_history_rls_fix.sql`

```sql
-- 깨진 정책 DROP
DROP POLICY IF EXISTS clinic_isolation_rmh ON reservation_memo_history;

-- 올바른 정책 생성
CREATE POLICY rmh_clinic_access ON reservation_memo_history
  FOR ALL TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());
```

`current_user_clinic_id()` = `SELECT clinic_id FROM user_profiles WHERE id = auth.uid()` (올바른 매핑)

### FE 변경 없음
- `ReservationMemoTimeline.tsx` 컴포넌트 정상 확인 (disabled/readOnly prop 없음)
- `CustomerChartPage.tsx` row ⑬ 정상 확인 (clinicId 전달 올바름)
- `CheckInDetailSheet.tsx` 정상 확인

## AC-3: 회귀 검증

| 항목 | 상태 |
|------|------|
| 1번차트 ReservationMemoTimeline | ✓ 동일 컴포넌트, 동일 데이터 |
| 2번차트 row ⑬ ReservationMemoTimeline | ✓ 수정 없음 |
| append-only 정책 | ✓ UPDATE/DELETE 쿼리 없음 |
| 다른 클리닉 격리 | ✓ clinic_id = current_user_clinic_id() 유지 |
| ReservationDetailPopup | ✓ 수정 없음 |
| Reservations 예약수정 모달 | ✓ 수정 없음 |

## DB 변경

| 파일 | 내용 |
|------|------|
| `supabase/migrations/20260520000110_reservation_memo_history_rls_fix.sql` | 신규 — RLS 정책 수정 |
| `supabase/migrations/20260520000110_reservation_memo_history_rls_fix.down.sql` | 롤백 |

**운영 DB 적용 필요** (supervisor 이관)

## 롤백

```bash
-- 롤백 SQL 실행
\i supabase/migrations/20260520000110_reservation_memo_history_rls_fix.down.sql
```

주의: 롤백 시 기존 broken 정책 복원 → 예약메모 비활성 재현

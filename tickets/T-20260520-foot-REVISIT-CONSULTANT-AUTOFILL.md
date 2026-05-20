---
id: T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
build_passed: true
spec_added: tests/e2e/T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL.spec.ts
db_migration: false
created_at: 2026-05-20
updated_at: 2026-05-20
---

# T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL

## 요약

재진(revisit) 체크인 시 `customers.assigned_staff_id` → `check_ins.consultant_id` 자동 매칭

## 구현 방식 결정

**FE 코드 (NewCheckInDialog.tsx) 선택** (DB 트리거 미사용)

이유:
- `new` 케이스(assign_consultant_atomic RPC)와 동일 패턴 — INSERT 전 async lookup
- AC-3(수동 변경 보호): INSERT 시점 only → UPDATE 이후 자동 재쿼리 없음
- 테스트 용이성: Playwright route mock으로 쉽게 검증
- SelfCheckIn(anon client)은 스코프 밖 — 변경 없음

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/NewCheckInDialog.tsx` | `returning` 분기 추가 — customers.assigned_staff_id 조회 후 consultantId 세팅 |
| `tests/e2e/T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL.spec.ts` | AC-1/2/4 E2E spec 신규 |
| `tickets/T-20260520-foot-REVISIT-CONSULTANT-AUTOFILL.md` | 본 티켓 |

## DB 마이그레이션

없음. `customers.assigned_staff_id` 컬럼은 `20260508000060_chart2_c2_tickets.sql`에 이미 존재.

## AC 체크

- [x] AC-1: assigned_staff_id 있는 고객 재진 → consultant_id 자동 세팅
- [x] AC-2: assigned_staff_id NULL → consultant_id null 유지 (기존 동작)
- [x] AC-3: 수동 변경 시 덮어쓰기 X (INSERT 시점 only)
- [x] AC-4: 초진 assign_consultant_atomic RPC 유지 — 회귀 없음

## 코드 변경 상세

```typescript
// NewCheckInDialog.tsx — handleSubmit 내부 (line 199~)
let consultantId: string | null = null;
if (visitType === 'new') {
  consultantId = await autoAssignConsultant(clinicId);     // 기존 유지
} else if (visitType === 'returning' && customerId) {
  // AC-1: 재진 → customers.assigned_staff_id 조회
  const { data: cust } = await supabase
    .from('customers')
    .select('assigned_staff_id')
    .eq('id', customerId)
    .maybeSingle();
  consultantId = (cust?.assigned_staff_id as string | null) ?? null;
}
```

## 참고

- 참고 티켓: T-20260512-foot-ASSIGN-CONSULTANT-DOC (RPC 로직 조사 완료)
- assign_consultant_atomic: `20260421000001_p2_fixes.sql` line 59
- assigned_staff_id: `20260508000060_chart2_c2_tickets.sql` line 14

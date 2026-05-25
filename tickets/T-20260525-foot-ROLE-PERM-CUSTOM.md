---
id: T-20260525-foot-ROLE-PERM-CUSTOM
domain: foot
priority: P2
status: deployed
qa_result: pass
qa_grade: Yellow
deploy_commit: 5e76e495b93ee86e2f1c96d1ae3f47c49bc33c06
deployed_at: "2026-05-26T00:55:00+09:00"
bundle_hash: index-BI3fd5Us.js
field_soak_until: "2026-05-27T00:55:00+09:00"
field_validation_slack_ts: "1779724597.881249"
deploy-ready: true
build-ok: true
db-change: true
db-change-note: "supabase/migrations/20260525050000_refund_perm_expand.sql — refund_single_payment RPC 역할 목록에 consultant/coordinator/therapist 추가 (롤백: .down.sql)"
spec-added: tests/e2e/T-20260525-foot-ROLE-PERM-CUSTOM.spec.ts
commit_sha: 2798917dec151e7117289dccff82a60dd540610d
summary: "3역할(consultant/coordinator/therapist) 전권한 개방 — 통계·매출집계·계정관리 제외 + 환불 처리 권한 추가"
created: 2026-05-25 17:55
deadline: 2026-06-01
---

# T-20260525-foot-ROLE-PERM-CUSTOM: 통계·매출집계·계정관리 제외 전권한 포지션 + 환불 권한

## 요청 (Part 1: 17:55)
통계·매출집계·계정관리 제외, 나머지 전 메뉴 열린 포지션.

## 요청 (Part 2: 19:47 추가)
상담실장(consultant)·코디네이터(coordinator)·치료사(therapist) 3역할에 환불 처리 action 권한 부여.

## 접근방식

### Part 1: 3역할 전권한 개방
- `permissions.ts` PERM_MATRIX: messaging에 coordinator/therapist 추가 (3차 전수 검수)
- `AdminLayout.tsx` NAV_ITEMS: 진료도구·메시지설정 therapist 추가, 기타 역할 갭 보완
- `App.tsx` settings RoleGuard: consultant/coordinator/therapist 추가
- 차단 유지: 통계(`stats`)=admin/manager/part_lead, 매출집계(`sales`)=admin/manager, 계정관리(`accounts`)=admin

### Part 2: 환불 권한
- `Closing.tsx` canRefund 변수: isAdminOrManager + consultant/coordinator/therapist
- `supabase/migrations/20260525050000_refund_perm_expand.sql`: refund_single_payment RPC 역할 목록 확장

## 메뉴 현황 (3차 전수 검수 완료)

| 메뉴 | consultant | coordinator | therapist | 목표 |
|------|-----------|-------------|-----------|------|
| 대시보드 | ✅ | ✅ | ✅ | ✅ |
| 예약관리 | ✅ | ✅ | ✅ | ✅ |
| 고객관리 | ✅ | ✅ | ✅ | ✅ |
| 패키지 | ✅ | ✅ | ✅ | ✅ |
| 진료도구 | ✅ | ✅ | ✅ | ✅ |
| 서비스관리 | ✅ | ✅ | ✅ | ✅ |
| 메시지 설정 | ✅ | ✅ | ✅ | ✅ |
| 직원·공간 | ✅ | ✅ | ✅ | ✅ |
| 병원·원장 정보 | ✅ | ✅ | ✅ | ✅ |
| 치료 테이블 | ✅ | ✅ | ✅ | ✅ |
| 일마감 | ✅ | ✅ | ✅ | ✅ |
| 일일 이력 | ✅ | ✅ | ✅ | ✅ |
| 통계 | ❌ | ❌ | ❌ | ❌ 제외 |
| 매출집계 | ❌ | ❌ | ❌ | ❌ 제외 |
| 계정관리 | ❌ | ❌ | ❌ | ❌ 제외 |

## AC 체크리스트
- [x] AC-1: 3역할 PERM_MATRIX 전권한 개방 (통계·매출집계 제외)
- [x] AC-2: AdminLayout.tsx NAV_ITEMS 메뉴 접근 정상 작동
- [x] AC-3: 통계·매출집계·계정관리 제어 정확히 차단 유지
- [x] AC-4: 환불 처리 — consultant/coordinator/therapist 3역할 허용
- [x] AC-5: 일마감 환불 버튼 3역할 활성화
- [x] AC-6: refund_single_payment RPC 역할 목록 확장 (migration 20260525050000)
- [x] AC-7: 환불 처리 전체 flow — 3역할 정상

## 변경 커밋 이력
- `a498b1a`: consultant messaging 권한 추가 (A안)
- `c0adeef`: 환불 처리 권한 확장 — 3역할 + migration 20260525050000
- `d4fc33a`: E2E spec 환불 AC-4~7 추가
- `2798917`: 3차 전수 검수 — coordinator/therapist 누락 메뉴 보완

## 테스트
- 빌드: `npm run build` ✅ (3.35s, 2026-05-26)
- E2E spec: tests/e2e/T-20260525-foot-ROLE-PERM-CUSTOM.spec.ts (AC-1~7 커버)
- DB 변경: 20260525050000_refund_perm_expand.sql (롤백 .down.sql 포함)

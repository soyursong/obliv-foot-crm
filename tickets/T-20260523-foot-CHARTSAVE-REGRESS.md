---
ticket_id: T-20260523-foot-CHARTSAVE-REGRESS
title: 진료차트 저장 RLS 회귀 — coordinator clinic_id NULL 보정 (P0 hotfix)
status: deploy-ready
priority: P0
domain: foot
type: FIX-REQUEST
deploy_ready: true
commit_sha: pending
db_changed: true
migration: 20260523030000_chartsave_regress_coordinator_clinic_fix.sql
e2e_spec: tests/e2e/T-20260523-foot-CHARTSAVE-REGRESS.spec.ts
created_at: 2026-05-23
deployed_at: ""
---

## 요약

진료차트(MEDCHART-REVAMP Drawer UI) 저장 시 빨간색 에러 토스트 발생 (P0).  
이전 핫픽스(T-20260522-foot-MEDCHART-SAVE-ERR)가 admin/director/manager만 커버했고,  
coordinator 역할의 clinic_id=NULL 계정(김은지 kim@oblivseoul.kr)이 누락됨.

## 진단 과정

### AC-1: 실재현 및 에러 캡처

브라우저 재현 환경 없음(태블릿). 대신 **프로덕션 DB 직접 진단** 수행:

```bash
# user_profiles 전체 조회 (service role)
GET /rest/v1/user_profiles?select=id,email,role,clinic_id,active
```

**발견:**
```json
{
  "id": "2b613328-5c4e-43d3-8b8c-649806bc1095",
  "email": "kim@oblivseoul.kr",
  "name": "김은지",
  "role": "coordinator",
  "clinic_id": null,
  "active": true
}
```

### 루트 코즈

`mc_clinic_isolated_v2` (이전 핫픽스 825e2ca 적용) WITH CHECK:
```sql
clinic_id = current_user_clinic_id()::text
OR (current_user_clinic_id() IS NULL AND current_user_role() IN ('admin','director','manager'))
```

- `kim@oblivseoul.kr` → `current_user_clinic_id()` = NULL
- 1번 조건: `NULL::text = '74967aea-...'` → NULL → 실패
- 2번 조건: `NULL IS NULL = TRUE` BUT `'coordinator' IN ('admin','director','manager')` = **FALSE**
- **결과: WITH CHECK 실패 → PostgreSQL 42501 → FE toast.error('저장 실패: ...')**

### 이전 핫픽스가 왜 불충분했나

T-20260522-foot-MEDCHART-SAVE-ERR 는 gh.lee@medibuilder.com (HQ admin, clinic_id=NULL) 에 초점.  
coordinator 역할은 2번 조건 미해당이어서 커버되지 않았음.

### DB 수정 (원인 기반, 추정 없음)

단일 클리닉 확인 → `74967aea-a60b-4da3-a0e7-9c997a930bc8` (오블리브의원 서울 오리진점)  
→ kim@oblivseoul.kr clinic_id 직접 배정

```sql
UPDATE user_profiles
   SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
 WHERE id = '2b613328-5c4e-43d3-8b8c-649806bc1095'
   AND clinic_id IS NULL;
```

## AC 체크리스트

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 에러 근본원인 특정 (로그 기반) | ✓ kim@oblivseoul.kr clinic_id=NULL → RLS 42501 |
| AC-2 | 원인 기반 수정 (추정 금지) | ✓ DB data fix — FE 코드 변경 없음 |
| AC-3 | 진료차트 저장 정상 (RLS 해소) + 기존 조회 OK + doctor_memo RBAC 정상 | ✓ DB 적용 완료·검증 완료 |
| AC-4 | 빌드 OK + 무파괴 | ✓ DB only 변경, FE 코드 미변경 |

## 프로덕션 DB 적용 확인

```
# 수정 후 검증
kim@oblivseoul.kr clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 ✓
clinic_id=NULL 잔여 active 사용자: 0건 ✓
```

## 파일 목록

- `supabase/migrations/20260523030000_chartsave_regress_coordinator_clinic_fix.sql`
- `supabase/migrations/20260523030000_chartsave_regress_coordinator_clinic_fix.rollback.sql`
- `tests/e2e/T-20260523-foot-CHARTSAVE-REGRESS.spec.ts`
- `tickets/T-20260523-foot-CHARTSAVE-REGRESS.md` (이 파일)

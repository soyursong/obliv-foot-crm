---
id: T-20260524-foot-DESIG-SAVE-ERR
title: "지정 치료사 저장 에러 수정 — RPC 미생성 → REST UPDATE 전환"
status: deployed
priority: P1
domain: foot
created_at: 2026-05-24
deadline: 2026-05-25
deploy_ready_at: 2026-05-24
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.28s"
e2e_spec: "tests/e2e/T-20260524-foot-DESIG-SAVE-ERR.spec.ts"
e2e_spec_exempt_reason: ""
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
risk: "1/5 (FE only — saveDesignatedTherapist + 3 side-channel 경로)"
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-24T22:02:00+09:00"
deploy_commit: d4a0a66
bundle_hash: CustomerChartPage-D9WfDI1N
field_soak_until: "2026-05-25T22:02:00+09:00"
field_validation_slack_ts: "1779627824.401479"
---

# T-20260524-foot-DESIG-SAVE-ERR — 지정 치료사 저장 에러 수정

## 배경

김주연 총괄 "저장 에러 그대로구만 뭐가 해결이야!!!" — 2번차트 [지정 치료사] 드롭다운 변경 시
`지정 치료사 저장 실패: ...` 토스트가 반복 노출. 현장 테스트 완전 차단.

## 근본 원인 (최종 확정)

**`save_designated_therapist` RPC 함수 live DB 미생성.**

- `customers.designated_therapist_id` 컬럼: live DB에 **존재** ✅ (REST SELECT 정상)
- `save_designated_therapist` RPC: live DB에 **미존재** ❌
  - REST 직접 검증: `PGRST202 "Could not find the function public.save_designated_therapist"`
- FE 코드가 이 RPC를 호출 → PGRST202 → `toast.error("지정 치료사 저장 실패: ...")`

이전 세션(f26f669)에서 DB 컬럼은 적용됐으나 RPC 함수가 미생성 상태로 남아 있었음.

## 수정 내용

**FE 4곳 `supabase.rpc('save_designated_therapist')` → REST UPDATE 전환:**

| # | 위치 | 역할 |
|---|------|------|
| 1 | `saveDesignatedTherapist()` | 2번차트 [지정 치료사] 저장 버튼 (핵심 경로) |
| 2 | `handleResvMiniSubmit()` | 예약 등록 시 지정 치료사 역동기화 |
| 3 | `handleEditResvSave()` | 예약 수정 시 재진 치료사 역동기화 |
| 4 | `handleInlineResvTherapistSave()` | 인라인 재진 예약 치료사 역동기화 |

```typescript
// Before (PGRST202 오류)
await supabase.rpc('save_designated_therapist', {
  p_customer_id: customer.id,
  p_therapist_id: newTherapistId || null,
});

// After (REST UPDATE — 컬럼 존재 + 스키마 캐시 갱신 확인 후 적용)
const { data: updatedRows, error } = await supabase
  .from('customers')
  .update({ designated_therapist_id: newTherapistId || null })
  .eq('id', customer.id)
  .select('id');
```

## 검증

- RPC 미존재 확인: ✅ `PGRST202` 직접 검증
- 컬럼 존재 확인: ✅ `select=designated_therapist_id&limit=0` REST SELECT 성공
- 스키마 캐시 갱신: ✅ 컬럼 SELECT 가능 = 캐시 반영 완료
- RLS UPDATE 허용: ✅ `customers_staff_update` 정책 (is_floor_staff())
- 빌드: ✅ 3.28s

## AC 달성

- AC-1 ✅ 저장 에러 원인 특정 — RPC 미생성 (PGRST202)
- AC-2 ✅ REST UPDATE 전환으로 저장 성공 경로 확보
- AC-3 ✅ 기존 기능 회귀 없음 (드롭다운 노출·차감 자동선택 제거 유지)
- AC-4 ✅ 빌드 3.28s 통과

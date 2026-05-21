---
id: T-20260522-foot-CHART-SAVE-FAIL
domain: foot
priority: P0
status: resolved_by_dependency
deploy-ready: false
commit_sha: f5b07aa+61a2b52+85280f5
build_ok: true
db_changed: true
spec_file: tests/e2e/T-20260520-foot-PENCHART-VIEW-SPLIT.spec.ts
risk: resolved
created_at: 2026-05-22
completed_at: 2026-05-22
resolved_by: T-20260520-foot-PENCHART-VIEW-SPLIT
resolution_deployed_at: "2026-05-22 02:43 KST (CEO override)"
field_soak_until: "2026-05-23 02:35 KST"
---

# T-20260522-foot-CHART-SAVE-FAIL

전체 진료차트(form_submissions) 저장 마비 — CHART-SAVE-FAIL

## 배경

FIX-REQUEST MSG-20260522-014604-ffev 수신 (01:46 KST).
PUSH MSG-20260522-025138-gtil 수신 (planner, P0 HOTFIX).

## 근본원인 분석 (PENCHART-VIEW-SPLIT과 동일)

```
form_submissions INSERT 완전 차단 3중 원인:
  1) 코드: if ((isPC || isHQ) && activeDrawTemplate && staffId) → staffId=null 상시 → INSERT 블록 미진입
     → 원인: staff 테이블 user_id 전체 null → staffId 조회 항상 null
  2) DB: issued_by UUID NOT NULL → staffId null이면 FK 위반
  3) RLS: staff.user_id = auth.uid() 기반 정책 → staff.user_id 전부 null → 모든 사용자 INSERT/SELECT 완전 차단
  → 결과: form_submissions 레코드 0건, [내용보기] 영구 비활성, 진료차트 저장 불가
```

## 해소 확인 (PENCHART-VIEW-SPLIT 배포, 02:43 KST)

| 수정 항목 | 커밋 | DB 적용 | 상태 |
|-----------|------|---------|------|
| staffId null 가드 제거 (PenChartTab.tsx) | f5b07aa | - | ✅ 배포 |
| issued_by DROP NOT NULL + RLS user_profiles 교체 | 85280f5 (파일) | 20260522000010 | ✅ DB 적용 완료 |
| template_id DROP NOT NULL | 61a2b52 | 20260521090000 | ✅ DB 적용 완료 |
| onFormSubmissionSaved 콜백 (즉시 UI 갱신) | 61a2b52 | - | ✅ 배포 |

`supabase migration list` 확인: `20260522000010` remote 적용 확인.

## 결론

**CHART-SAVE-FAIL = PENCHART-VIEW-SPLIT (deployed 02:43, field-soak until 5/23 02:35) 로 완전 해소.**
별도 수정 불필요. 현장 확인 후 closed로 전환 가능.

## 현장 확인 요청 항목

1. 펜차트 탭 → 양식 선택 → 서명/작성 → [저장] → form_submissions 레코드 생성 여부
2. 상담내역 탭 → [내용보기] 버튼 활성화 여부 (페이지 새로고침 불필요)
3. 에러 없이 저장 완료 toast 표시 여부

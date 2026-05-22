---
id: T-20260522-foot-CUST-REG-LOGOUT
domain: foot
priority: P2
status: deploy-ready
title: 고객 접수 시 주민번호 저장 후 로그아웃 오류
created: 2026-05-22
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260522-foot-CUST-REG-LOGOUT.spec.ts
qa_result: pending
---

# T-20260522-foot-CUST-REG-LOGOUT — 고객 접수 시 주민번호 저장 후 로그아웃 오류

## 문제

풋센터 CRM 고객 접수 화면(CustomerChartPage)에서 주민번호 저장 시 로그아웃되는 버그.
#62 김테스트(F-0359) 고객 건 재현.

**Root Cause:**
JWT가 만료된 시점과 `rrn_encrypt` RPC 호출 시점이 겹치는 경우:
1. `rrn_encrypt` → PostgREST 401 (PGRST301: JWT expired)
2. Supabase SDK 내부 토큰 갱신 시도 → 실패 → `SIGNED_OUT` 이벤트 발화
3. auth.tsx의 150ms 디바운스(v1 fix) 한계: 갱신이 150ms 이상 걸리거나 네트워크 순단 시 세션 소실

## 수정

### auth.tsx (v2 복구 로직)
- 150ms 단순 대기 → `refreshSession()` 적극 재시도 + 100ms fallback으로 교체
- `SIGNED_OUT` 수신 시 `refreshSession()` 직접 호출 → 성공 시 세션 복구
- `refreshSession()` 실패 시 100ms 대기 후 `getSession()`으로 다른 탭 갱신 결과 확인

### CustomerChartPage.tsx — saveRrn
- 401/JWT 에러 시: `refreshSession()` 후 `rrn_encrypt` 1회 재시도
- 재시도 성공 → 정상 저장 (SIGNED_OUT 발화 전에 FE 레벨에서 복구)
- 재시도도 실패 → 명시적 에러 토스트 (로그아웃 없음)

### CustomerChartPage.tsx — handleInfoPanelSave (rrn 섹션)
- 동일 패턴 적용 (통합 저장 버튼 경로도 커버)

## 수용 기준

- AC-1: 주민번호 저장 → 로그아웃 없이 정상 저장 ✅
- AC-2: 콘솔/네트워크 에러 없음 (403/401/RLS 확인) ✅ (retry로 401 흡수)
- AC-3: 다른 고객에서도 동일 동선 정상 ✅ (고객-무관 fix)
- AC-4: 기존 데이터 회귀 없음 ✅ (rrn_encrypt 로직 변경 없음)

## 조사 결과

| 항목 | 결과 |
|------|------|
| customers UPDATE RLS | ✓ 정상 (consult/coord/staff 3정책) |
| therapist UPDATE 권한 | ✗ 없음 (별도 이슈 — 본 티켓 범위 외) |
| rrn_encrypt 함수 | ✓ SECURITY DEFINER + 폴백키 사용 중 |
| app.rrn_key | NULL (폴백 'obliv_foot_rrn_key_2026' 사용) |
| STAFF-REEXPAND 영향 | customers_staff_update 재생성 — rrn_encrypt에 영향 없음 (SECURITY DEFINER 우회) |

## 변경 파일

- `src/lib/auth.tsx` — SIGNED_OUT 복구 로직 v2
- `src/pages/CustomerChartPage.tsx` — saveRrn + handleInfoPanelSave 401 retry
- `tests/e2e/T-20260522-foot-CUST-REG-LOGOUT.spec.ts` — E2E spec 신규

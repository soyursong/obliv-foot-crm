---
id: T-20260522-foot-SSN-SESSION-KILL
title: 주민번호 저장 후 로그아웃(세션 종료) 오류
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
risk_verdict: GO_WARN
db_changes: false
build_pass: true
e2e_spec: tests/e2e/T-20260522-foot-SSN-SESSION-KILL.spec.ts
created: 2026-05-22
deadline: 2026-05-26
reporter: 대표 직접 보고
---

## 현상

고객 접수 화면 → 주민번호 저장 → 세션 종료(로그아웃). 재현: #62 김테스트.
접수 워크플로 완전 중단. 운영 영향.

## 근본 원인 분석

**Root Cause**: JWT 액세스 토큰 만료 → `rrn_encrypt` RPC 호출 시 PostgREST 401 반환 → Supabase JS SDK v2.49.x 내부 토큰 갱신 시도 → 갱신 실패(refresh token 만료/네트워크 오류) → `SIGNED_OUT` 이벤트 발화 → `onAuthStateChange` 즉시 `setSession(null)` → `ProtectedRoute` `/login` 리다이렉트.

두 번째 경로: `handleInfoPanelSave` 통합 저장에서도 동일 패턴 (editingRrn=true 상태에서 통합 저장 버튼 클릭 시).

## 수정 내용 (FE only — DB 변경 없음)

### 1. `src/lib/auth.tsx` — SIGNED_OUT 디바운스 복구

- `explicitSignOutRef` 플래그 추가: 명시적 `signOut()` 호출 여부 구분
- 암묵적 `SIGNED_OUT` (SDK 내부 토큰 갱신 실패) 시 150ms 대기 후 `getSession()` 재확인
  - 다른 탭에서 갱신 완료 / 백그라운드 갱신 race condition 허용
  - 150ms 후에도 세션 없으면 정상 로그아웃 처리
- 명시적 `signOut()` 시에는 디바운스 없이 즉시 처리 (UX 유지)

### 2. `src/pages/CustomerChartPage.tsx` — 저장 전 세션 체크 + 에러 분기

**`saveRrn`**:
- `rrn_encrypt` 호출 전 `supabase.auth.getSession()` 으로 세션 유효성 선제 확인
- 세션 없으면 "세션이 만료되었습니다. 페이지를 새로고침하고 다시 시도해주세요." 토스트 후 조기 리턴
- `rrn_encrypt` 에러 코드 분기: PGRST301 / status 401 / JWT 포함 메시지 → 세션 만료 안내. 그 외 → 일반 에러 메시지

**`handleInfoPanelSave` — RRN 섹션**:
- 동일 세션 체크 로직 적용

## AC 검증

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | #62에서 주민번호 저장 시 세션 유지 (로그아웃 X) | ✅ auth.tsx 디바운스로 race condition 방지 |
| AC-2 | 저장 실패 시 에러 메시지 표시 (세션 종료 X) | ✅ 에러 코드별 분기 메시지 추가 |
| AC-3 | 정상 저장 시 encrypted column 정상 확인 | ✅ 성공 경로 변경 없음 |
| AC-4 | auth 세션 토큰 저장 전후 유효 유지 | ✅ getSession() 선제 확인 |

## 변경 파일

- `src/lib/auth.tsx` — SIGNED_OUT 디바운스 + 명시적 로그아웃 플래그
- `src/pages/CustomerChartPage.tsx` — saveRrn / handleInfoPanelSave 세션 체크
- `tests/e2e/T-20260522-foot-SSN-SESSION-KILL.spec.ts` — E2E spec 신규

## DB 변경사항

없음 (FE only)

## 롤백 방법

`src/lib/auth.tsx`와 `src/pages/CustomerChartPage.tsx`를 이전 커밋으로 되돌림.
DB 변경 없으므로 DB 롤백 불필요.

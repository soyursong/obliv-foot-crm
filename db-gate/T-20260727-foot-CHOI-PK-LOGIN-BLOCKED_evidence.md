# T-20260727-foot-CHOI-PK-LOGIN-BLOCKED — recovery 링크 재발급 evidence

## 대상
- 최필경 총괄 (pk.choi@medibuilder.com, slack U05L6HE7QF6, role=manager)
- auth uid: `d9bde8a8-887b-4c98-845e-fcc85d6d25af` <!-- gitleaks:allow (Supabase auth uid, 비-secret; before.json에도 旣존재) -->
- CRM: obliv-foot-crm (Supabase rxlomoozakkjesdqjtvd)

## 실행 (reopen 2026-07-28 FOLLOWUP)
- 러너: `scripts/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_recover.mjs`
- DRY → APPLY (2026-08-01T17:51Z 실행)
- 방식: `admin.generateLink(type=recovery)`, `redirect_to=https://obliv-foot-crm.pages.dev/login` (정본 CF Pages)
- 평문 비번 미생성 — 재설정 링크 방식만.

## Cross-CRM Auth Identity Resolution 표준 준수
- `?email=` 서버필터 단독 신뢰 금지 → `listUsers` 전량 페이지네이션 후 client-side exact(lowercase) email 매칭.
- exact-email 매칭 계정 수 = **1** (유일성 assert 통과).
- 링크 발급 직후 반환 `user.id↔email` 재검증 통과 (resolved=returned=d9bde8a8.../pk.choi@medibuilder.com).

## 계정 상태 스냅샷 (before, rollback/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_before.json)
| 필드 | 값 |
|------|----|
| banned_until | null |
| deleted_at | null |
| email_confirmed_at | 2026-07-21T07:22:06Z |
| last_sign_in_at | **2026-07-29T02:38:35Z** (2026-07-29 11:38 KST) |
| identities_cnt | 0 |

## 원인 판정
- 서버측 계정 이상 없음(banned/deleted 無, email 확인, role=manager 유지) — 7/27 진단 재확인.
- RC = 자격증명 레벨(비번 불일치) 차단. 인가 오염 0. → recovery 링크 재발급으로 해소(비파괴).

## ★ 주목 — reopen 이후 정상 로그인 흔적
- `last_sign_in_at = 2026-07-29T02:38:35Z` = **7/28 reopen(17:17 KST) 이후 시점**.
- 최필경 계정이 7/29 오전 이미 로그인 성공한 것으로 보임 → 현장에서 이미 복구되었을 가능성.
- 그럼에도 reopen AC 이행 위해 **fresh recovery 링크 재발급 완료**. responder가 현재 로그인 가능 여부 우선 확인 권장.

## 조치 결과
- recovery 링크 재발급 성공 (action_link = 콘솔 전용, 민감 토큰 → git 커밋물 미기재).
- `generateLink`는 이메일 자동발송 안 함 → 링크만 responder MQ relay(AC step3, 재설정 링크 방식).
- 파괴적 조치 불요. DB 스키마/데이터 변경 없음(auth 토큰 regen only). code_change=false.

## 롤백
- recovery 토큰은 GoTrue 기본 만료(1h~24h) 또는 재발급 시 무효화 → 별도 롤백 불요.

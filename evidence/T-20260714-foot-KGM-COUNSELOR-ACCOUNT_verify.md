# T-20260714-foot-KGM-COUNSELOR-ACCOUNT — 검증 결과 (승인/활성화 대상 이미 완료)

**처리**: dev-foot / 2026-07-15
**scope (ticket SSOT 정정판)**: `signup_path: APPROVE-EXISTING` — 생성 아님. 이미 가입된 계정 승인/활성화 + role=consultant.
**결론**: **idempotent no-op** — 대상 계정 이미 승인·활성·본인 로그인 성공 확인됨. 신규 생성/비번 리셋 안 함.

## 대상
- name: 강경민 / title: 상담실장
- login_email: kgm8337@gmail.com
- clinic: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (jongno-foot, 오블리브의원 서울오리진점)

## Cross-CRM Auth Identity Resolution 준수
- auth 순회(page 1..N, perPage 1000) 전수 스캔 = 49명. `?email=` 서버필터 **단독 미사용**.
- kgm8337@gmail.com 매칭 = **정확히 1건**(중복 auth user 없음).
- id↔email 재대조: `auth.users.id` == `user_profiles.id` == `staff.user_id` = `170e0cd5-2d17-43d7-9433-3be5280d5d30` (3자 일치).

## 실재 상태 (읽기 검증)
| 소스 | 값 |
|------|-----|
| auth.users.id | 170e0cd5-2d17-43d7-9433-3be5280d5d30 |
| auth email_confirmed_at | 2026-07-14T02:25:21Z (승인/확인 완료) |
| auth created_at | 2026-07-10T09:16:03Z |
| auth last_sign_in_at | **2026-07-14T15:45:49Z (본인 로그인 성공)** |
| user_profiles | role=consultant, clinic=jongno-foot, active=true, approved=true |
| staff | id=6ab26d9f-fd10-4042-9fd7-076f277be5d4, role=consultant, active=true, user_id=170e0cd5(링크됨) |

## AC 대사
- [x] 존재 여부 확인 → 존재(승인/활성 상태)
- [x] 승인/활성화 + role=consultant → email_confirmed_at set + active/approved + role=consultant (전부 충족)
- [x] id↔email 재대조 OK (email 필터 단독 미신뢰, 전수 순회 1건)
- [x] 로그인 가능 검증 → last_sign_in_at = 실제 로그인 성공(테스트 signIn보다 강한 근거)
- [ ] responder 경유 요청자(U0ATDB587PV, thread 1783991843.114099) relay + 현장 확인 → planner FOLLOWUP로 요청
- [x] 강경민 로그인 성공 확인 → last_sign_in_at 2026-07-14 15:45 로 확정

## 비파괴 결정
- 비밀번호 **리셋 안 함**: 본인이 이미 로그인 중(07-14 15:45)인 working 계정. 지금 리셋하면 정상 사용 중 계정을 깨뜨림.
- "봇 선발송 임시비번 미검증" 우려 → 본인 실제 로그인 성공(last_sign_in_at)으로 무력화. 별도 임시비번 발송 불요.

## 타임라인
- 07-10 09:16 auth 계정 생성(선행 프로비저닝)
- 07-14 02:25 email 확인/승인
- 07-14 10:17 responder NEW-TICKET(c1sg) → 10:18 planner 티켓, 10:26 정정(feur, 생성→승인)
- 07-14 15:45 강경민 로그인 성공
- 07-15 dev-foot 검증 → 이미 완료 확인(no-op)

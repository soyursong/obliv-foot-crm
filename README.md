# 오블리브 풋센터 CRM

종로 5층 문제성발톱클리닉 전용 CRM. 패키지 기반 시술 관리 + 이중 동선(신규/재진) 칸반.

## Stack

- React 18 + TypeScript + Vite 5
- Supabase (Auth, DB, Realtime, Storage)
- shadcn/ui + Tailwind CSS
- @dnd-kit (칸반 DnD)

## 개발

```bash
npm install
npm run dev    # localhost:8082
```

## 설계문서

- 풋센터_CRM설계.md — 인터뷰 기반 요구사항
- 풋센터_기능명세_DB아키텍처.md — 기능명세 + DB 스키마
- 풋센터_lovable_prompt_v1.md — UI 기능 상세

## Admin RPC 정책

`admin_register_user` / `admin_toggle_user_active` / `admin_reset_user_password` 3종 RPC는 앱 레이어 admin/manager 토큰만 통과합니다. service_role 직접 호출도 거부됩니다(2026-04-26 정책 확정, T-foot-055).
- 자동화 스크립트는 admin 사용자 토큰으로 호출하거나 직접 SQL 사용
- service_role 키 유출 시에도 직원 계정 생성/비활성화/비번리셋 차단 (강력한 보안 게이트)

## 셀프체크인 구현

`/checkin/:clinicSlug` 경로의 셀프체크인은 anon RLS 정책 기반 direct INSERT로 동작합니다(2026-04-26, T-foot-054).
- `customers` + `check_ins` 직접 INSERT (RPC 미사용)
- 대기번호만 `next_queue_number` RPC 사용
- 자세한 구현: `src/pages/SelfCheckIn.tsx`

## CI / E2E

`.github/workflows/e2e.yml` 가 main push / PR 시 Playwright E2E 22 spec 을 실행합니다.

### 필수 GitHub Secrets

Repo → Settings → Secrets and variables → Actions 에 등록 필요:

| Secret | 용도 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL (예: `https://xxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `TEST_USER_EMAIL` | E2E 로그인용 계정 (예: `test@medibuilder.com`) |
| `TEST_USER_PASSWORD` | E2E 로그인용 비밀번호 |
| `SUPABASE_SERVICE_ROLE_KEY` | (선택) admin RPC 보안 검증용 — 미설정 시 해당 spec skip |

워크플로우는 빌드 → Playwright (chromium, desktop-chrome project) 순으로 실행되며, 실패 시 `playwright-report/` 가 아티팩트로 업로드됩니다.

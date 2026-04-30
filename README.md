# 오블리브 풋센터 CRM

종로 5층 문제성발톱클리닉 전용 CRM. 패키지 기반 시술 관리 + 이중 동선(신규/재진) 칸반.

> **2026-04-30 하드포크 완료**: Lovable 연동 해제 → GitHub → Vercel 직접 배포로 전환.
> 상세: `2_Areas/204_오블리브_종로점오픈/풋센터_lovable_분리.md`

## Stack

- React 18 + TypeScript + Vite 5
- Supabase (Auth, DB, Realtime, Storage)
- shadcn/ui + Tailwind CSS
- @dnd-kit (칸반 DnD)
- **배포**: GitHub main → Vercel 자동 배포 (Lovable 경유 X)

## 개발

```bash
# 1) 환경변수 설정
cp .env.example .env.local
# .env.local 의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 를 실제 값으로 채움

# 2) 의존성 설치 & 로컬 실행
npm install
npm run dev    # localhost:8082
```

## 배포

```
git push origin main
  → GitHub Actions (ci-push.yml): TypeCheck + Build + Critical-Flow E2E
  → Vercel: main 브랜치 webhook → 자동 빌드 & 배포
  → https://obliv-foot-crm.vercel.app
```

> ⚠️ Lovable 프로젝트는 2026-04-30 GitHub Disconnect 완료. 향후 Lovable에서 변경 시 이 레포에 반영되지 않음.

## DB 마이그레이션

```bash
# 마이그레이션 파일 생성
# supabase/migrations/YYYYMMDDHHMMSS_description.sql

# 원격 DB 적용
npx supabase db query --linked -f supabase/migrations/<파일명>.sql

# 롤백
npx supabase db query --linked -f supabase/migrations/<파일명>.down.sql
```

## 설계문서

- 풋센터_CRM설계.md — 인터뷰 기반 요구사항
- 풋센터_기능명세_DB아키텍처.md — 기능명세 + DB 스키마
- 풋센터_lovable_prompt_v1.md — (참고용) Lovable 하드포크 전 UI 명세
- 풋센터_lovable_분리.md — Lovable 분리 경과 및 운영 방식

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

`.github/workflows/ci-push.yml` 이 main push / PR 시 TypeCheck + Build + Critical-Flow E2E를 실행합니다.
`.github/workflows/ci-nightly.yml` 이 매일 KST 02:00 에 전체 E2E + Visual + Functional 스위트를 실행합니다.

### 필수 GitHub Secrets

Repo → Settings → Secrets and variables → Actions 에 등록 필요:

| Secret | 용도 |
|--------|------|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL (예: `https://xxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `TEST_USER_EMAIL` | E2E 로그인용 계정 |
| `TEST_USER_PASSWORD` | E2E 로그인용 비밀번호 |
| `SUPABASE_SERVICE_ROLE_KEY` | (선택) admin RPC 보안 검증용 — 미설정 시 해당 spec skip |

워크플로우는 빌드 → Playwright (chromium, desktop-chrome project) 순으로 실행되며, 실패 시 `playwright-report/` 가 아티팩트로 업로드됩니다.

# 오블리브 풋센터 CRM

종로 5층 문제성발톱클리닉 전용 CRM. 패키지 기반 시술 관리 + 이중 동선(신규/재진) 칸반.

> **2026-04-30 하드포크 완료**: Lovable 연동 해제 → GitHub → Cloudflare Pages 직접 배포로 전환(2026-07-16 canon).
> 상세: `2_Areas/204_오블리브_종로점오픈/풋센터_lovable_분리.md`

## Stack

- React 18 + TypeScript + Vite 5
- Supabase (Auth, DB, Realtime, Storage)
- shadcn/ui + Tailwind CSS
- @dnd-kit (칸반 DnD)
- **배포**: GitHub main → Cloudflare Pages 자동 배포 (정본, 2026-07-16 canon)

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
  → Cloudflare Pages: main 브랜치 자동 빌드 & 배포 (github-linked)
  → https://obliv-foot-crm.pages.dev   ← 정본(canonical) 라이브 URL
```

> ✅ **배포 검증·현장 안내는 반드시 `https://obliv-foot-crm.pages.dev` 단일 정본 URL로만 한다.**
> 배포 완료 확인(번들 해시·버전 등)은 이 URL 기준. 배포 판정: `pages.dev/version.json` 의 commit == origin/main HEAD.
> 현장 접속 경로: `https://obliv-foot-crm.pages.dev/admin`.

> ⚠️ **canon 전환 (2026-07-16, `T-20260716-meta-DEPLOY-PIPE-SSOT-CLOUDFLARE-CANON`):** 정본 파이프라인이
> **Vercel → Cloudflare Pages** 로 확정 전환됨. 이전 판(vercel=정본, pages.dev=금지)은 **폐기**됨.

> ⛔ **`obliv-foot-crm.vercel.app` (구 Vercel) — deprecated, 참조 금지(검증·현장 안내 모두).**
> 이 호스트는 canon 전환 후 갱신이 멈춘 **frozen/stale 빌드**를 서빙한다(마지막 빌드 2026-07-16 15:03, commit 2da30ee2).
> 여기서 검증/현장 안내를 하면 최신 배포가 "하나도 반영 안 됨"으로 오인된다(2026-07-17 4구역 결제미니창 field-soak FAIL 재발 RC).
> Vercel 프로젝트 최종 폐쇄(대시보드 처분)는 인프라 액션 — `T-20260717-foot-PAYMINI-4ZONE-LAYOUT-SPEC` FOLLOWUP 참조.
>
> ※ 참고: `foot-checkin.pages.dev` 는 별개의 **의도된** 셀프체크인 전용 앱(`soyursong/foot-checkin`)으로 무관하다.

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

### 착수 전 pg_proc PREFLIGHT (함수/RPC 마이그 필수 게이트)

*2026-07-11 발효 · T-20260711-ops-MIG-OVERLOAD-PGPROC-PREFLIGHT-GUARD · deploy_flow.md v2.2 §2-A G0 / deploy-precheck C10 로 supervisor 집행*

아래 유형의 마이그는 **착수 전(pre-impl) prod pg_proc 실덤프로 라이브 overload 를 확정**한 뒤에만 SQL 을 작성한다:

- SECDEF 핀 부여/제거, `EXECUTE GRANT`/`REVOKE`
- 함수 시그니처 / overload(arity) 변경
- `CREATE OR REPLACE FUNCTION` / `DROP FUNCTION`
- RPC 원장정합(ledger reconciliation) 판정 마이그

**덤프 4요소 전부 확보** (함수명의 전 overload 집합):
`proname` + `prosecdef`(SECDEF 여부) + `proconfig`(search_path) + `proargtypes`(arity/시그니처)

```bash
npx supabase db query --linked "SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, p.proargtypes \
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='<fn>';"
```

- **파일 lineage · 런타임 에러코드(42703 vs PGRST202) 추론 단독 신뢰 금지** — 에러코드는 보강증거일 뿐, overload 집합의 authority 는 pg_proc 실덤프뿐이다.
- **db_change=true 티켓의 `mig_ledger_check` evidence 에 pg_proc 덤프 결과를 반드시 포함**한다. 미포함 시 supervisor QA 에서 qa-fail `pgproc_preflight_missing` (deploy_flow §2-A G0).
- 근거: migration_ledger_reconciliation.md Case H(scalp) + Case I(body) — pre-impl 가설이 prod 실측에서 반증된 arity-shadow/overload 혼동 실증 2건.
- SSOT: `migration_ledger_reconciliation.md` (원칙 정본) / `deploy_flow.md` v2.2 §2-A G0 (게이트).

## 규정·근거 인용

- **급여(건강보험) 관련 계산 로직을 개발할 때는 `docs/citations/` 를 먼저 참조**한다 — 본인부담금 단수처리·환산지수·노인 정액제 등 규정 원문 근거 저장소. 급여 근거 모음: `docs/citations/health_insurance.md`.

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

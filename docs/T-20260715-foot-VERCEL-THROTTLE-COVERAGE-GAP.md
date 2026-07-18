# T-20260715-foot-VERCEL-THROTTLE-COVERAGE-GAP — 배포 트리거 인벤토리 & throttle 커버리지 보강

> 작성: agent-fdd-dev-foot · 2026-07-18
> 스코프: Vercel free-plan 일일 배포한도(api-deployments-free-per-day, >100/day) 소진 완화.
> **Pro 승격은 본 티켓 스코프 아님** — 필요성 근거만 §AC4 에 정리(구매 결정은 사람 게이트).
> 전략 해소는 `T-20260531-foot-CF-CUTOVER`(Cloudflare Pages 단독화, 2026-07-16 CF canon 확정)가 담당하며,
> 본 문서는 CF 컷오버 완료 전 Vercel 잔류 기간의 완화 조치다.

---

## AC1 — obliv-foot-crm 배포 트리거 인벤토리

Vercel 프로젝트 `obliv-foot-crm` (projectId `prj_21bYKGqC1OXW6FReVWKfKaxDqY8k`, org `team_hbeeUmQpSw3bwxkglZm37Ngw`)로 배포를 생성하는 경로:

| # | 트리거 경로 | 발화 조건 | free 쿼터 소비? | ignoreCommand(throttle) 적용? | 비고 |
|---|-------------|-----------|:--------------:|:-----------------------------:|------|
| 1 | **Git Integration — prod merge** | main push → Production 배포 | 예 (성공 시 1건) | 예 | 단, 현재 계정 GitHub 미연결로 permissions 차단(T-20260708). 복구 시 활성화. |
| 2 | **Git Integration — preview(브랜치·PR)** | 비-main 브랜치 push / PR open·synchronize | 예 (브랜치 push 매회 1건) | 예 (단, **기존엔 파일 판정만** → 런타임 변경 preview 는 PROCEED = 쿼터 소비) | ← **본 티켓이 지목한 커버리지 갭.** |
| 3 | **Deploy Hook (GitHub Actions)** | `.github/workflows/vercel-autodeploy.yml` — main push마다 `VERCEL_DEPLOY_HOOK_URL` POST | 예 (hook 매 발화 1건, 항상 main HEAD 빌드) | Hook 경로는 ignoreCommand 우회 여지 존재(문서상 재푸시/재빌드 강제) → **최대 소비원** | T-20260708 로 도입된 팀-소유 우회 경로. main push 횟수 = hook 발화 횟수. |
| 4 | **재푸시 / redeploy(rerun)** | 동일/신규 커밋 재푸시, 대시보드 Redeploy | 예 (재생성 매회 1건) | 부분 — 동일-tree 재푸시는 기존 스크립트가 PROCEED 처리(§AC2 참고) | preview 브랜치 재푸시가 특히 누적. |
| 5 | **Vercel CLI (`vercel`, `vercel --prod`)** | 로컬/수동 배포 | 예 | ignoreCommand 미적용(CLI 직접 빌드) | 운영 중 상시 사용 아님(수동 한정). |

### 최근 24h 배포 카운트 origin 분해 (관측)
- 촉발 사고(`T-20260715-foot-FAVICON-RESWAP`): **가시 Ready Production 배포 11건+** 관측 → `Resource limited, retry 24h`로 정상 prod 배포 차단.
- origin 분해상 **경로 3(deploy hook)**이 main push마다 무조건 1건을 생성하는 구조가 최대 소비원이며, 여기에 **경로 2(preview 런타임 변경)**가 파일 판정을 통과해 추가 소비.
- 결론: 100/day 쿼터는 "정상 prod 배포 과다"보다 **preview·hook 재빌드 누적**으로 소진됨. → 정상 prod 슬롯 고갈(2차 피해)이 favicon 티켓.

---

## AC2 — throttle 커버리지 확대 (구현)

### 기존 커버리지 (변경 전)
`scripts/vercel-ignore-build.sh`(ignoreCommand)는 **바뀐 파일이 런타임(Vite 번들)에 영향을 주는가**만 판정:
- 모든 변경이 non-runtime(docs/tickets/scripts/tests/supabase/.md 등) → `exit 0` SKIP (쿼터 미소비) ✅
- 하나라도 런타임 변경(src/·public/·index.html·설정) → `exit 1` PROCEED (배포) ✅
- **갭**: 이 판정은 production/preview 를 구분하지 않음. → 런타임 변경이 담긴 **preview 브랜치 push·PR·재푸시**도 PROCEED 되어 preview 배포 생성 = free 쿼터(공유 100/day) 소비 → prod 슬롯 잠식.

### 보강 (변경 후)
`vercel-ignore-build.sh` 최상단에 **production vs preview 게이트** 추가:
- `VERCEL_ENV != production`(= preview/development) → 파일 판정 이전에 **무조건 `exit 0` SKIP** → preview·재푸시 배포가 free 일일한도를 **미소비**.
- `VERCEL_ENV == production`(또는 판정 불가 시 fail-safe) → 기존 non-runtime 파일 판정으로 진행(prod 배포 로직 무변경).
- 판정 폴백: `VERCEL_ENV` 부재 시 `VERCEL_GIT_COMMIT_REF`(브랜치 ref = main/master) 로 보조 판정. 둘 다 부재 시 production 간주(fail-safe = 정상 prod 배포가 실수로 skip 되지 않음).

검증(로컬):

| VERCEL_ENV | ref | 결과 |
|-----------|-----|------|
| preview | feature/x | SKIP (exit 0) — 쿼터 미소비 ✓ |
| production | main | PROCEED → 파일 판정 ✓ |
| (unset) | main | PROCEED ✓ |
| (unset) | (unset) | fail-safe PROCEED ✓ |

> **경로 3(deploy hook)은 본 스크립트 스코프 밖**(ignoreCommand 우회 여지). 게이트만으로는 hook 소비를 못 막는다 → §AC4·후속 참조.

---

## AC3 — 정상 prod 배포 슬롯 보전 확인

보강 후 정상 prod 배포(main → production, 런타임 변경 포함) 경로:
1. production 게이트 통과(`VERCEL_ENV=production`) → 기존 파일 판정 진입.
2. 런타임 변경 존재 → `exit 1` PROCEED → **정상 배포 1건 생성**(종전과 동일, deploy_flow 8단계 무변경).
3. 커버리지 확대로 preview 배포가 더 이상 쿼터를 잠식하지 않으므로, **일일한도 내 prod 배포 슬롯이 보전**됨.

즉 이 변경은 preview 소비만 제거하고 prod 배포 동작은 그대로 유지한다(AC3 충족).

---

## AC4 — Pro 승격 필요성 근거 (planner 보고용, 구매는 사람 게이트)

- free 한도: **100 production+preview deployments / day** (공유).
- 일일 정상 **prod** 배포 필요 건수(추정): main merge 빈도 기준 통상 **5~15건/day** (급한 날 favicon류 핫픽스 포함 시 상단). → **prod 만으로는 100/day 미만**, 즉 free 한도 자체는 prod 수요를 감당 가능.
- 소진 실체: 한도를 넘긴 원인은 **preview 배포 + deploy-hook 재빌드 누적**(비-prod 소비). → 본 티켓의 커버리지 확대(preview SKIP)로 **비-prod 소비를 구조적으로 제거**하면, Pro 승격 없이도 정상 prod 슬롯 확보 가능.
- **판단**: 현 시점 **Pro 승격 불필요** — (a) 커버리지 확대로 preview 소비 제거, (b) `CF-CUTOVER`(2026-07-16 CF canon) 완료 시 Vercel free 제약 자체가 소멸. 단 deploy-hook(경로 3)이 main push마다 재빌드를 강제하는 구조가 잔존하면 push 폭주 시 여전히 한도 압박 가능 → 아래 후속 참조.

---

## 후속(planner FOLLOWUP 대상, 본 티켓 스코프 밖)
1. **Deploy hook(경로 3) 정리**: CF Pages 가 canon(2026-07-16)이 된 이상 `vercel-autodeploy.yml` 의 main-push 자동 hook 은 (a) 쿼터 최대 소비원이자 (b) CF 와 중복 prod 배포. → CF-CUTOVER 트랙에서 **workflow 제거/비활성 검토** 권고(본 워크플로 주석의 "복구 시 제거 검토"와 동일 취지). dev 자율 제거는 prod 자동배포 회귀 위험이 있어 planner/총괄 결정 게이트로 넘김.
2. **CF 단독화 우선순위 재평가**: CF-CUTOVER 완료 시 본 완화 조치·Vercel 트리거 전부 무의미해지므로, 잔류 기간을 최소화하는 것이 근본 해결.

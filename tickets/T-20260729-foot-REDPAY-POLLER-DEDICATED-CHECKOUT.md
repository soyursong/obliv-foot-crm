---
id: T-20260729-foot-REDPAY-POLLER-DEDICATED-CHECKOUT
domain: foot
priority: P3
status: in-progress
deploy-ready: false
build-passed: "N/A — 인프라 config(launchd plist + shell 관리 스크립트 + runbook). 앱 번들 빌드 무접촉. plutil -lint OK, bash -n OK, sync --verify PASS, cutover --dry PASS."
db-change: false
e2e-spec: "exempt (e2e_spec_exempt_reason=apk_only / infra_config_no_ui) — 폴러=macstudio launchd 인프라. FE E2E 무관. 검증=plutil lint + bash syntax + sync --verify shasum 대조 + cutover --dry."
summary: "결제 폴러 launchd WorkingDirectory 를 dev 피처 체크아웃(~/GitHub/obliv-foot-crm)과 물리 분리 → 전용 main-고정 checkout(~/GitHub/obliv-foot-crm-redpay-poller, git worktree --detach@origin/main). stale-hazard(T-20260728-AUTOSEED deploy_reflection_fail RC) 근본봉인. plist WorkingDirectory/ProgramArguments 재지정 + 매 사이클 인라인 best-effort FF(fetch+reset --hard origin/main) + sync/cutover 스크립트 + runbook. ★cutover(launchctl 재기동)는 AUTOSEED soak(2026-07-30 01:20) 종료 후 실행 권장 — 현재 Phase A(준비+커밋) 완료, Phase B(전환+연속성 evidence) 대기."
created: 2026-07-29
reporter: planner
parent: T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID
commit: PENDING_SUPERVISOR_MERGE
risk_verdict: GO
risk_reason: "변경 격리 = scripts/launchd/*.plist(1) + scripts/redpay_poller_checkout_sync.sh(신규) + scripts/redpay_poller_cutover.sh(신규) + docs/runbook(신규) + tickets/*.md. FE·DB·EF·앱코드 무접촉. 폴러 코드(redpay_macstudio_poller.mjs)·매처·뷰·스키마 전부 무변경 → 적재/매출 정확도 회귀 0. db-change=false(신규 컬럼·테이블·enum 0 → DA CONSULT 불요). 전용 checkout=detached worktree(dev main 체크아웃과 브랜치 충돌 없음). env/시크릿/registry/state 모두 절대경로(homedir·DB) → WorkingDirectory 무관 동일 해석(§AC4 검증). cutover 는 구 launchd 완전 unload 후 신 load(Label 동일 → 이중 실행 구조적 불가) + 멱등 upsert + heartbeat 로 유실0. ★Phase B cutover 는 AUTOSEED soak 종료 후 실행 권장(soak 중 폴러 재기동 최소화) → 현 커밋은 준비물만(런타임 무영향, 구 폴러 계속 가동)."
option_decision: "전용 checkout 구현 = git worktree --detach@origin/main 채택(vs 독립 clone). 근거: 폴러 외부 npm 의존 0 → node_modules 불요, detached 라 dev 의 main 체크아웃과 브랜치 미충돌, .git object store 공유로 디스크 절약. plist symlink 도 전용 checkout 의 plist 로 재지정 → plist 자체도 main-고정(plist drift 동시 봉인). 추가 방어=매 사이클 인라인 FF(self-heal)."
soak_coordination: "AUTOSEED soak field_soak_until 2026-07-30 01:20 — 본 티켓 Phase A(준비)는 런타임 무개입(구 폴러 계속 가동). Phase B cutover 는 soak 종료 후 실행 권장."
---

# T-20260729-foot-REDPAY-POLLER-DEDICATED-CHECKOUT

**출처**: supervisor FOLLOWUP MSG-20260729-012628-tpua ② → planner 발번. dev item2 권고 계승.
**부모/맥락**: T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID (본 티켓과 독립, soak 중).

## RC (실증)

결제 폴러 launchd(`com.obliv.foot.redpay-macstudio-poller`)의 `WorkingDirectory` 가 dev-foot 피처
체크아웃(`/Users/domas/GitHub/obliv-foot-crm`)과 공유됨. non-main 브랜치 체크아웃 시 폴러가 stale 코드로
실행. T-20260728-AUTOSEED 23:42 `deploy_reflection_fail` 의 확정 RC(WorkingDirectory 가
DOCDASH worktree@a9904286 = base poller parked). 이번엔 DOCFORM 커밋이 origin/main 되며 **우연**
자연수렴했을 뿐 구조결함 잔존.

> 착수 시점 라이브 재현: dev main-checkout HEAD=`56aafd0`(feature branch `ticket/...ENVSHADOW-4TH-LOCUS`)
> ≠ origin/main `4a817950`. 즉 폴러 WorkingDirectory 가 **지금** non-main 을 가리킬 수 있는 상태였음.

## 대책

폴러 실행체를 **전용 main-고정 checkout** 으로 분리.

- 전용 checkout: `/Users/domas/GitHub/obliv-foot-crm-redpay-poller` = `git worktree add --detach origin/main`.
- plist WorkingDirectory/ProgramArguments 재지정 + 매 사이클 진입 시 best-effort FF
  (`git fetch origin main && git reset --hard origin/main`) 인라인(self-heal).
- LaunchAgents symlink 도 전용 checkout 의 plist 로 재지정 → plist 자체도 main-고정.

## AC 커버리지

| AC | 내용 | 상태 |
|----|------|------|
| 1 | WorkingDirectory = 피처 체크아웃과 다른 main-고정 디렉토리 | ✅ plist 재지정(`/Users/domas/GitHub/obliv-foot-crm-redpay-poller`) |
| 2 | stale 불가 불변식 (on-disk shasum == origin/main HEAD, non-main 재현 실증) | ✅ dev=`56aafd0`(feature) vs 전용=`4a817950`(origin/main), poller shasum `b45076bc` == origin/main blob. sync --verify PASS |
| 3 | 무유실 전환 (멱등 재기동, 구/신 이중실행 방지, autoseed_*/tid_alarm_* 연속성) | ⏳ Phase B — cutover 스크립트 완성(구 unload→symlink→신 load→연속성 확인). soak 종료 후 실행 |
| 4 | env/시크릿(~/.env.redpay-foot)·registry canon 경로 신 WD 에서 동일 해석 | ✅ 전부 절대경로(homedir)·DB registry → WorkingDirectory 무관. runbook §3 |
| 5 | plist 변경 + 전용 checkout main sync runbook 문서화 | ✅ docs/REDPAY-POLLER-DEDICATED-CHECKOUT-RUNBOOK.md |

## Phase A (본 커밋) — 준비, 런타임 무개입

1. 전용 checkout 생성: `git worktree add --detach ~/GitHub/obliv-foot-crm-redpay-poller origin/main`.
2. plist 재지정: WorkingDirectory + ProgramArguments(인라인 FF) → 전용 checkout.
3. 관리 스크립트: `scripts/redpay_poller_checkout_sync.sh`(create/sync/verify) + `scripts/redpay_poller_cutover.sh`(무유실 전환/-dry).
4. runbook: `docs/REDPAY-POLLER-DEDICATED-CHECKOUT-RUNBOOK.md`.

검증: `plutil -lint` OK · `bash -n` OK · `sync --verify` PASS(shasum 일치) · `cutover --dry` PASS.
**구 폴러는 계속 가동 중(런타임 무영향)** — Phase A 는 파일/준비물만.

## Phase B — cutover (AUTOSEED soak 종료 후, supervisor/macstudio)

```bash
cd /Users/domas/GitHub/obliv-foot-crm-redpay-poller
bash scripts/redpay_poller_checkout_sync.sh --create   # 존재 시 sync
bash scripts/redpay_poller_cutover.sh --dry
bash scripts/redpay_poller_cutover.sh
```

deploy-ready 마킹은 Phase B 완료 + 전환 evidence(신 WorkingDirectory·shasum 일치·이중실행 방지·200 OK·
텔레메트리 연속성) 본문 첨부 후. **현재는 deploy-ready=false.**

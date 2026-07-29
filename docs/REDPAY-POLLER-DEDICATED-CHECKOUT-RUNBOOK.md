# RedPay 결제 폴러 전용 checkout Runbook

**티켓**: T-20260729-foot-REDPAY-POLLER-DEDICATED-CHECKOUT (P3)
**대상 launchd**: `com.obliv.foot.redpay-macstudio-poller` (맥스튜디오)
**작성**: dev-foot / 2026-07-29
**인접 SSOT**: `memory/1_Projects/201_메디빌더_AI도입/redpay_foot_terminal_registry.md`

---

## 1. 왜 (root cause)

결제 폴러 launchd 의 `WorkingDirectory` 가 dev-foot 피처 체크아웃(`/Users/domas/GitHub/obliv-foot-crm`)과
**공유**되어 있었다. dev 가 non-main 브랜치를 체크아웃한 순간 폴러가 **stale 코드**로 실행된다.

- 실증 RC: T-20260728-AUTOSEED 23:42 `deploy_reflection_fail` — WorkingDirectory 가 DOCDASH worktree@a9904286
  = base poller parked 상태로 폴러 실행. 이번엔 DOCFORM 커밋이 origin/main 되며 **우연** 자연수렴했을 뿐
  구조결함은 잔존.

## 2. 대책 (불변식)

폴러 실행체를 **전용 main-고정 checkout** 으로 분리한다.

| 항목 | 구(旧) | 신(新) |
|------|--------|--------|
| WorkingDirectory | `/Users/domas/GitHub/obliv-foot-crm` (dev 피처와 공유) | `/Users/domas/GitHub/obliv-foot-crm-redpay-poller` (전용, detached@origin/main) |
| plist symlink 원본 | dev 피처 체크아웃 내 plist | 전용 checkout 내 plist (plist 자체도 main-고정) |
| stale 가능성 | dev 브랜치 체크아웃 시 **가능** | **불가** (§AC2 불변식) |

**불변식 (§AC2)**: 전용 checkout 의 정지상태 = 항상 `origin/main` HEAD.
dev 가 어떤 브랜치를 체크아웃해도 이 디렉토리는 불변.
추가 방어: launchd `ProgramArguments` 가 **매 사이클 진입 시** best-effort FF
(`git fetch origin main && git reset --hard origin/main`)를 인라인 수행 → node 실행 직전 최신 main 으로 self-heal.
fetch 실패(네트워크 블립)여도 `;` 로 node 는 항상 실행되며, 전용 checkout 정지상태가 곧 origin/main 이므로 stale 불가.

전용 checkout 은 **git worktree(detached)** 로 구현 — dev 의 main 체크아웃과 브랜치 충돌 없음(detached=브랜치 미점유).
폴러는 외부 npm 의존 0(node builtins + `scripts/lib/redpay_wl_fingerprint.mjs` 로컬 1개)이라 `node_modules` 불필요.

## 3. env / 시크릿 / registry 경로 (§AC4)

전용 checkout 로 WorkingDirectory 를 바꿔도 아래는 **동일 해석**된다 (모두 절대경로 = `homedir()` 기반):

- `~/.env.redpay-foot` (풋 전용, 우선) / `~/.env.redpay` (fallback) — `join(homedir(), ...)`
- state: `~/.redpay-watchdog-foot-state.json` — `join(homedir(), ...)`
- slack: `~/scripts/slack_send.sh`
- registry SSOT = **DB 테이블** `redpay_terminal_registry(domain=foot,active)` — 파일경로 아님, WorkingDirectory 무관.

즉 시크릿·registry·state 는 WorkingDirectory 에 종속되지 않는다. WorkingDirectory 에 종속되는 것은
`scripts/redpay_macstudio_poller.mjs` + 로컬 import `./lib/redpay_wl_fingerprint.mjs` 뿐 → 전용 main-고정 checkout 로 완결.

## 4. 스크립트

| 스크립트 | 용도 |
|----------|------|
| `scripts/redpay_poller_checkout_sync.sh --create` | 전용 checkout 최초 생성(`git worktree add --detach origin/main`) + sync + 검증 |
| `scripts/redpay_poller_checkout_sync.sh` | FF sync (fetch + reset --hard origin/main). 멱등. |
| `scripts/redpay_poller_checkout_sync.sh --verify` | 검증(on-disk shasum == origin/main blob) |
| `scripts/redpay_poller_cutover.sh` | 무유실 구→신 전환(unload → symlink 재지정 → load → 연속성 확인) |
| `scripts/redpay_poller_cutover.sh --dry` | 전환 계획만 출력(미수행) |

## 5. 전환 절차 (supervisor / macstudio)

> ★ **AUTOSEED soak(field_soak_until 2026-07-30 01:20) 종료 후 실행 권장.** soak 중 폴러 재기동 최소화.

```bash
cd /Users/domas/GitHub/obliv-foot-crm-redpay-poller   # 전용 checkout (sync 로 origin/main)

# (1) 전용 checkout 생성·검증 — 최초 1회
bash scripts/redpay_poller_checkout_sync.sh --create

# (2) 무유실 전환 (구 unload → symlink 재지정 → 신 load → 연속성 확인)
bash scripts/redpay_poller_cutover.sh --dry    # 먼저 계획 확인
bash scripts/redpay_poller_cutover.sh          # 실전

# (3) 사후 확인
launchctl list | grep redpay-macstudio-poller
tail -20 ~/logs/redpay_macstudio_poller.out    # '✅ 레드페이 200 OK' + autoseed_*/tid_alarm_* 연속
ps aux | grep -c '[r]edpay_macstudio_poller'   # == 1 (이중 실행 아님)
```

**전환 안전 근거**
- 구 launchd 완전 unload 를 신 load 전에 강제 → Label 동일(`com.obliv.foot.redpay-macstudio-poller`)이므로
  구/신 이중 실행(중복 seed/write) 구조적 불가.
- 멱등 upsert(멱등키 `external_trxid,external_status,amount`) + `redpay_poller_state.last_incremental_to` heartbeat
  로 윈도 이어감 → 재기동 유실0.
- 전환 전/후 텔레메트리(`autoseed_*`/`tid_alarm_*`) + `200 OK` 를 로그에서 대조.

## 6. 롤백

전용 checkout 전환에 문제가 생기면 즉시 구 경로로 복귀:

```bash
launchctl unload -w ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller.plist
ln -sf ~/GitHub/obliv-foot-crm/scripts/launchd/com.obliv.foot.redpay-macstudio-poller.plist \
  ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller.plist
# (단, dev 피처 체크아웃이 non-main 이면 그 순간 stale — 롤백은 임시복구 전용, 즉시 재전환 권장)
launchctl load -w ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller.plist
```

## 7. 정기 sync

전용 checkout 은 launchd 인라인 FF(매 5분 사이클)로 자동 최신화되므로 별도 cron 불요.
수동/점검 시 `bash scripts/redpay_poller_checkout_sync.sh` (멱등). Git SSOT 5분 sync 와 정합 —
항상 `origin/main` FF 방향(로컬 커밋 없음, reset --hard 안전).

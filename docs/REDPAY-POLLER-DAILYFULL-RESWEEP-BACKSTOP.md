# 레드페이 폴러 저빈도 daily_full 재스윕 백스톱 — 설계·운영 노트

**티켓**: T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP (P1, P-fix1 remediation)
**부모/진단원**: T-20260803-foot-REDPAY-POLLER-0722-INGESTION-GAP-ROOTCAUSE (ROOTCAUSE(A), READ-ONLY 진단)
**성격**: forward 재발방지 전용. 이미 빠진 07-22 2건 소급 = 자매 C(SOP-ENVELOPE) 소관.
**db_change**: false (신규 테이블/컬럼/enum 0 — 기존 `redpay_raw_transactions` 멱등 upsert 재사용).

---

## 1. 문제(RC 요약)

증분 폴러(`com.obliv.foot.redpay-macstudio-poller`)는
- 사이클당 **단일 `business_no` 로만 fetch**(union 부재, `redpay_macstudio_poller.mjs` fetch 경로), 그리고
- **forward-only date-granular, 최대 2h lookback 증분커서**(`WINDOW_MAX_LOOKBACK_MS = 2h`)

로만 전진한다. 511→457 **bizno flip 이음매(seam)** 에서 07-22 종일 당시정본 511 로만 조회 → 511 feed 0행. 문제 2건은 457 버킷 → **수집 통째 누락**. 증분은 flip seam 을 한 번 건너뛰면 2h lookback 밖이라 그 창을 **영영 재조회하지 않는다**. 07-22 단발이나, 같은 빈틈은 **차기 bizno flip · KST 자정 걸친 정산지연 · 폴러 다운타임** 에서 재발할 systemic 잠재.

## 2. 처방 (AC-1) — daily_full 재스윕 백스톱

증분 폴러를 **그대로 1차**로 두고, `POLL_MODE=daily_full`(기존 존재) 을 **저빈도(1일 2회) launchd 인스턴스**로 뒤에 깔아 **그날치 전수 재스윕**으로 증분이 놓친 창을 뒤에서 메운다.

- **신규 인스턴스**: `com.obliv.foot.redpay-macstudio-poller-dailyfull`
  - `EnvironmentVariables: REDPAY_POLL_MODE=daily_full` (그 외 env·시크릿은 증분과 동일 `~/.env.redpay-foot` 공유 — 신규 시크릿 0).
  - `StartCalendarInterval` 05:10 / 17:10 KST (macstudio 로컬 TZ=KST). daily_full 기본 창 = "어제 00:00 KST ~ now"(코드상 KST→UTC 변환 여유로 실효 ~38h 롤링) → 각 재스윕이 24h 를 넘겨 겹침 → 임의 시점 seam/gap 은 ≤~12h 내 최소 1회 전수 재스윕에 포섭.
  - `RunAtLoad=false` + `KeepAlive` 미설정: 백스톱은 **스케줄 시각에만** 전수 조회(등록 즉시/크래시 루프로 레드페이 API 반복 타격 방지).
  - `WorkingDirectory` = 폴러 전용 checkout(AC-4, 아래 §5).
- **코드 변경 0**: `daily_full` 모드·기본 창 로직은 이미 존재(`redpay_macstudio_poller.mjs`). 본건은 **launchd 스케줄 1개 추가**뿐. → 이미 있는 기능에 스케줄만 하나 더.

### 2.1 재스윕이 07-22 유형(flip seam)을 실제로 메우는 원리

flip 이후 `~/.env.redpay-foot` 의 `REDPAY_BUSINESS_NO` 는 신 정본(457)으로 갱신된 상태다. daily_full 은 **현재 bizno(457)** 로 그날치를 전수 재조회하므로, 증분이 seam 에서 구 bizno(511)로만 훑다 놓친 **457 버킷 거래를 재스윕이 다시 fetch → 멱등 upsert 로 실 누락분만 적재**한다. 즉 "구→신 flip 후 신 bizno 로 그날치를 다시 전수로 훑는" 동작이 곧 seam 복구다.

- **커버 조건**: 재스윕 창(~38h)이 seam 날짜에 도달하는 동안(= flip 후 ~1일 내 env 갱신) 자동 복구. env 갱신이 창 밖으로 지연되는 극단은 `REDPAY_DAILY_FROM`(KST 날짜) 수동 override 로 확장 백필(자매 C SOP-ENVELOPE 경로, 이미 존재).

## 3. AC-3 — 멱등·부하 안전

### 3.1 멱등 무중복 실증 (이중 INSERT 0)

- **구조 증명**: `redpay_raw_transactions` 에 DB-강제 `CONSTRAINT redpay_raw_trx_unique UNIQUE (external_trxid, external_status, amount)` (mig `20260607190000_pay_recon_port.sql:81`) 실재 = 폴러 upsert 의 `on_conflict=external_trxid,external_status,amount` + `Prefer: resolution=merge-duplicates` 키와 정확히 동일 → **동일 튜플 재적재는 DB 레벨에서 구조적으로 중복 불가**.
- **관측 증명**: 증분 + daily_full 이 공존 적재해온 실 데이터에서 `(external_trxid, external_status, amount)` 중복 튜플 **0건** (probe: `dup_groups=0`, scanned=573). → evidence: `evidence/T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP_idempotency_evidence.json`.
- **재현 프로브**(read-only, 레드페이 API 무호출): `node scripts/T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP_idempotency_probe.mjs`.
- 결론: daily_full 전수 재스윕이 증분 적재분을 재조회해도 **신규 write 는 실 누락분만**, 이중 INSERT = 0.

### 3.2 레드페이 조회 API 부하·rate

- 빈도 = **1일 2회**(저빈도). 증분(5분·288회/일) 대비 무시할 수준의 추가 호출.
- daily_full 은 페이지 순회(`PAGE_SIZE` 단위) 전수 조회이나 하루 2회 한정 + `KeepAlive` 미설정으로 **크래시 재기동 루프 없음** → API 반복 타격 방지.
- 증분과 시각 분리(05:10/17:10, 증분은 5분 상시) — 동시 폭주 아님. 동일 raw 테이블 멱등 upsert 라 경합해도 무중복.

### 3.3 재스윕 실패 silent-miss 표면화

- daily_full 인스턴스는 전용 로그(`~/logs/redpay_macstudio_poller_dailyfull.{out,err}`)로 분리 → 실패 시각·사유 가시화.
- 성공 시 `updatePollerState('daily_full', …)` 가 **`last_daily_to`** 만 갱신(증분 heartbeat `last_incremental_to` 무접촉) → 재스윕 신선도(last_daily_to)의 정체를 워치독/모니터가 별도 신호로 감시 가능.
- 재스윕이 못 메운 창(예: env 갱신 지연으로 창 밖) 은 **자매 B(T-20260803-foot-REDPAY-NOTXN-SCAN-3STATE-MODEB-PERSIST)** 의 A12 HIGH 관측성으로 표면화(상보). 본 백스톱과 자매 B 는 reinforcing.

## 4. AC-2 — cross-bizno union 대안 평가 → **DEFER (설계 노트)**

flip 구간 동안 fetch 를 **양 business_no(구·신) union** 으로 조회하는 방식 평가.

| 축 | daily_full 백스톱(AC-1) | cross-bizno union(AC-2) |
|----|----|----|
| seam 커버 | 신 bizno 로 그날치 전수 재스윕 → 사후 복구 | flip 창 실시간 양 bizno 동시 조회 → 즉시 커버 |
| 상시 비용 | 1일 2회 전수(저빈도) | 매 사이클 2x fetch(구·신 유지 시) 또는 flip-window 게이팅 복잡도 |
| 상태 요구 | 없음(기존 창 로직) | 구 bizno 목록·flip 활성창 판정 상태 필요 |
| DDL | 없음 | 없음(순수 코드) 예상 |
| 잔여 gap | env 갱신이 재스윕 창 밖으로 지연되는 극단(수동 override 로 복구) | flip 시점 구 bizno 를 config 에 유지해야 커버(운영 부담) |

**판정**: **AC-1(daily_full 백스톱) 단독으로 systemic 케이스를 충분히 커버** → AC-2 는 **defer**.
- 근거: (1) 07-22 유형(flip seam)은 신 bizno 재스윕으로 사후 복구됨(§2.1). (2) bizno flip 은 저빈도 이벤트(511→457 1회)라 상시 2x fetch 의 상수비용이 이득 대비 과함. (3) flip 시점 미설정 bizno 는 **BIZNO-DEFAULT-FAILCLOSED(deployed)** 가 fail-closed 로 이미 별 leg 커버. (4) union 은 "구 bizno 를 언제까지 config 에 남길지" 라는 운영 상태를 상시 지고 가야 함(drift 위험).
- **재승격 트리거**: 향후 bizno flip 이 빈발화하거나, env 갱신 지연이 재스윕 창(~38h)을 반복 초과하는 사고가 재현되면 AC-2 를 flip-window 게이팅(구 bizno 를 flip 활성창에만 union, 순수 코드·no-DDL)으로 본건 후속 티켓화. 그때도 **최소·견고 조합**은 "daily_full 백스톱(상시) + union(flip 창 한정)".

## 5. AC-4 — launchd 안전 (DEDICATED-CHECKOUT 선례 준수)

- 신규 인스턴스 `WorkingDirectory` = `/Users/domas/GitHub/obliv-foot-crm-redpay-poller` (폴러 전용 checkout, detached·origin/main 고정) — 증분 플리스트(T-20260729-...-DEDICATED-CHECKOUT)와 동일.
- `ProgramArguments` 에 매 실행 진입 시 best-effort FF(`git fetch origin main && git reset --hard origin/main`) self-heal → dev 피처 체크아웃(`/Users/domas/GitHub/obliv-foot-crm`)이 어떤 브랜치든 백스톱 실행체는 origin/main 불변(stale 불가).
- env(`~/.env.redpay-foot`)·registry SSOT·state 파일 모두 절대경로(homedir) → WorkingDirectory 무관 동일 해석.
- 시크릿·전용 checkout 는 증분과 **공유**(신규 인프라 최소화). plist 자체도 전용 checkout 의 것으로 symlink → main-고정.

## 6. 배포 게이트

- **★supervisor gate 필수**: cron/launchd 인스턴스 신설 = 스케줄 등록 + 멱등 무중복 실증(§3.1) + 부하 확인(§3.2) + WorkingDirectory stale hazard 회피(§5). dev 설계 → supervisor 검증 → 배포(등록).
- **db_change=false 유지**: 커서/스윕 상태를 신규 테이블에 저장할 필요 없음(기존 raw 멱등 upsert + `last_daily_to` 만). 만약 향후 재스윕 커서 상태를 신규 테이블에 둬야 하면 즉시 **DA CONSULT 1차 게이트**로 승격.
- 결제·수납·매칭·취소 경로 불변. 증분 폴러 동작 자체 유지(백스톱은 추가만).

### 등록 절차(supervisor, macstudio) — plist 상단 주석 참조
```
ln -sf ~/GitHub/obliv-foot-crm-redpay-poller/scripts/launchd/com.obliv.foot.redpay-macstudio-poller-dailyfull.plist \
  ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller-dailyfull.plist
launchctl load -w ~/Library/LaunchAgents/com.obliv.foot.redpay-macstudio-poller-dailyfull.plist
launchctl kickstart -k gui/$(id -u)/com.obliv.foot.redpay-macstudio-poller-dailyfull   # 스모크 1회
tail -80 ~/logs/redpay_macstudio_poller_dailyfull.out   # mode=daily_full / upserted=N / last_daily_to 확인
node scripts/T-20260803-foot-REDPAY-POLLER-DAILYFULL-RESWEEP-BACKSTOP_idempotency_probe.mjs  # 무중복 재확인
```

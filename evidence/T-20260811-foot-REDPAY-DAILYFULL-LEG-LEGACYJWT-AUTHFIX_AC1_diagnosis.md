# T-20260811-foot-REDPAY-DAILYFULL-LEG-LEGACYJWT-AUTHFIX — AC-1 진단 (READ-ONLY)

- 티켓: T-20260811-foot-REDPAY-DAILYFULL-LEG-LEGACYJWT-AUTHFIX (P2, approved)
- 수행: dev-foot / 2026-08-11 (KST)
- 성격: READ-ONLY 진단 (prod write 0, 크리덴셜 rotation 0)
- 판정: **도메인 경계 위반 발견 → 착수 중단, planner FOLLOWUP(domain_boundary) 반환**

## 1. 관측 사실 (증거)

### 1.1 401 대상 leg = com.medibuilder.redpay-recon-daily / -recon
- `/tmp/redpay-recon-daily.log`: `Mon Aug 10 14:00:04 KST 2026` → `{"code":"UNAUTHORIZED_LEGACY_JWT","message":"Invalid JWT"}` (티켓 서술 일치)
- `/tmp/redpay-recon.log` (**주 5분 poller**): **08-10 08:30 KST 이후 401 무중단 streak** (현재까지 423건). 티켓의 "주 poller 08-11 00:52 200 OK·errors=0" 서술과 **불일치**.
- 두 plist(recon, recon-daily) 모두 `~/.env.redpay` 를 source → `Authorization: Bearer $SUPABASE_ANON_KEY` (**legacy JWT**) + `x-internal-cron`. 동일 크리덴셜 공유.

### 1.2 legacy-JWT 소재 확정 (AC-1)
- `~/.env.redpay` → `SUPABASE_ANON_KEY=eyJhbGciOiJI...` (legacy JWT, len=208)
- 이 anon JWT payload 의 `ref` claim = **`muvcfrgmxlwtidundlre`**, `SUPABASE_URL=https://muvcfrgmxlwtidundlre.supabase.co`
- 401 원인 = 해당 프로젝트가 legacy JWT 키 발급 방식을 만료(deprecate) → 게이트웨이가 legacy JWT 거부(`UNAUTHORIZED_LEGACY_JWT`). rotation 필요는 맞음.

### 1.3 ★크리덴셜 공유범위 / rotation 타깃 격리 (AC-1 핵심)
| 파이프라인 | LaunchAgent | env 파일 | 프로젝트 ref | 인증 방식 | 현재 상태 |
|---|---|---|---|---|---|
| **CRM/롱레 (happy-flow-queue)** | `com.medibuilder.redpay-recon`(주) + `-recon-daily`(일) | `~/.env.redpay` | **muvcfrgmxlwtidundlre** | Bearer=legacy anon JWT | **401 (양 leg 모두)** |
| **FOOT (obliv-foot-crm)** | `com.obliv.foot.redpay-macstudio-poller` + `-dailyfull` | `~/.env.redpay-foot` | **rxlomoozakkjesdqjtvd** | service_role=`sb_secret_…`(신규 포맷) | **200 OK · errors=0 (healthy)** |

- **rotation 타깃 = muvcfrgmxlwtidundlre (CRM/롱레) 프로젝트 크리덴셜.** foot 프로젝트(rxlomo…)와 **무관·비공유**.
- foot 자체 poller 는 신규 `sb_secret_` 서비스롤 키로 인증 → legacy-JWT 만료 **무영향**. (01:17 KST 200 OK·errors=0 / dailyfull 08-10 20:10 upserted=175·errors=0 실측)
- plist 헤더 명시: `com.medibuilder.redpay-recon*` = **"담당: dev-crm 단독 ETL / 티켓 T-20260520-crm-PAY-RECON-001"**.

## 2. 판정

1. **완전성 무영향 결론은 옳음** — 단, 근거는 티켓 서술("주 medibuilder poller 200 OK")이 아니라 **foot 전용 파이프라인(com.obliv.foot.* / rxlomo…)이 별개로 healthy** 하기 때문. 티켓은 medibuilder(muvc/CRM) 계열과 foot(rxlomo) 계열을 **혼동(conflate)** 함.
2. **rotation 대상 크리덴셜(`~/.env.redpay`, muvc/CRM 프로젝트)은 obliv-foot-crm 도메인 밖** → dev-foot 착수 시 §5 도메인 격리 + §S2 공통 금지(타 도메인 write) 위반.
3. 주 leg(`-recon`)도 동시 401 = 이건 daily redundancy 국소 문제가 아니라 **CRM 프로젝트의 공유 legacy-JWT 만료 사고** → rotation 은 dev-crm(또는 크로스CRM 배관이면 dev-meta) 소관.

## 3. 권고 (FOLLOWUP)

- 본 티켓 re-route → **dev-crm** (com.medibuilder.redpay-recon* = happy-flow-queue/muvc, dev-crm 단독 ETL) 또는 크로스CRM 인프라로 보면 **dev-meta**.
- rotation 내용(dev-crm/meta 수행 권고): `~/.env.redpay` 의 `SUPABASE_ANON_KEY`(및 필요시 service_role)를 muvc 프로젝트 **신규 키 포맷(`sb_publishable_`/`sb_secret_`)**으로 교체 → `launchctl kickstart -k gui/$UID/com.medibuilder.redpay-recon{,-daily}` 재가동 후 200 OK·errors=0 확인. (foot poller 가 이미 신규 포맷으로 이행 완료한 선례 준용 가능)
- **foot 측 조치 불요** — foot RedPay 파이프라인 healthy 확인 완료.

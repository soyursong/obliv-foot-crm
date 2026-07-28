---
id: T-20260728-foot-REDPAY-WATCHDOG-REVERSEMISS-COVERAGE-AUDIT
domain: foot
status: deploy-ready
qa_result: n/a (READ-ONLY audit — 코드/DDL/데이터 mutation 0)
deploy_commit: (audit commit SHA — 아래 signals 참조)
deployed_at: n/a (배포 대상 아님 — evidence 문서 산출만)
bundle_hash: n/a (audit_readonly — CF Pages bundle 무관)
e2e_spec_exempt: audit_readonly (감지로직 self-test 는 기존 poller/watchdog --self-test 로 기커버, 신규 spec 불요)
priority: P1
db_change: 없음 (조회 전용 — redpay_raw_transactions/registry read-only, service_role introspection)
da_consult: 불요 (신규 컬럼·테이블·enum 0. AC-3 membership-blind 대사는 '설계만', 구현·DDL 별건)
code_change: 없음 (READ-ONLY audit. 고칠 것은 별건 spinoff 제안)
---

# T-20260728-foot-REDPAY-WATCHDOG-REVERSEMISS-COVERAGE-AUDIT

**총괄(최필경) 문제제기(MSG-ha2n req1, ★최우선): "워치독을 '누락 없음'의 근거로 쓸 수 있는가."**

- 정방향(오탐: 등록됐는데 미등록 알람) = ENVSHADOW-REGUNION-FIX 봉인 중.
- ★역방향(미탐: 미등록 TID/merchant 를 등록·정상으로 보고 침묵) = 본 audit 전담.

READ-ONLY. mutation 0. 코드 인용·런타임 evidence(상태파일·launchd 로그·뷰 정의) 기반.

---

## 결론 (한 줄)

**워치독(+폴러 실시간 훅)은 '누락 없음'의 근거로 쓸 수 없다 — 신뢰 불가.**
자동 감지층은 *이미 적재된* "기등록 merchant 의 명단-밖 신 TID"(레지스트리 위생·인지창 단축)만 커버한다.
가장 치명적인 누락 클래스 — **① merchant 귀속 NULL 실거래, ② 미등록 merchant(이름에 '풋' 미포함) drop** — 은
감지·알람·대사뷰 **어느 층에서도 표면화되지 않고 완전 침묵**한다(코드경로 §AC-1). 확인된 물질적 누락(7/24 9건/475만,
0723 NULL-merchant 8.7M, 239 11.39M)은 전부 총괄 수동대사+조회API로 포착됐고, 자동 자력감지는 위생성 소수 건뿐이다.

---

## AC-1 — 소스 divergence 매핑 + 침묵경로 실현가능성 판정

### 두 소스의 admit/reference membership

| 축 | 폴러 admission (적재 여부 결정) | 워치독 reference (알람 여부 결정) |
|----|------|------|
| fetch scope | `business_no` 단일(env=457-23-00938) — `fetchRedpayPage` L401~408 | ① merchant-grain: `REDPAY_BUSINESS_NO` 단일(**DEFAULT=511**, env=457) — watchdog L108 / ④ TID-grain: `511∪457` union — watchdog L116~122 |
| admit/detect 권위 | **merchant_id 멤버십**(TID-agnostic). `filterToFootScope` L476~496: `keep = merchantOk \|\| (mid==null && tidOk)` | ① `registryMerchants.has(mid)` 여부 + `merchant.name.includes('풋')` / ④ `merchant∈registry AND tid∉membership(tid∪superseded)` |
| membership 소스 | `resolveWhitelists()` L291: env override > DB registry(SSOT) > 하드코딩 DEFAULT. **TID = env∪registry UNION**(ENVSHADOW-FIX) | `loadRegistry()` L210: registry active. membership = `tid ∪ unnest(superseded_tids)` (R3, L217) |

### 침묵경로(미탐) 실현가능 — 3개 확정

**침묵경로 A — merchant 귀속 NULL 실거래 (최고 severity, 확정 재현).**
`filterToFootScope` L482~486: `mid==null` 이면 `merchantOk=false` → tid 도 NULL 이면 drop(미적재).
워치독 ① L326 `if (mid == null) continue;` / ④ L356 동일 → **판정 자체에서 제외**. 폴러 실시간 훅도 drift(merchantOk 요구)에 안 걸림.
대사뷰 `v_redpay_reconciliation_daily` 는 `COALESCE(merchant.id, data.merchant_id) IN (registry)` 게이트 → NULL 은 view-drop.
⇒ **적재·알람·대사뷰 4층 모두 침묵.** 실증: `T-20260724-...-457-COUNT-RECONCILE_EVIDENCE.md` §b2 — 7/23 실거래 5건(8.7M 포함)이
merchant_id=NULL/tid=NULL 로 도착 → 뷰 드롭·무알람, **총괄 수동대사로만 포착**.
영향 TID class: RedPay payload 가 merchant/tid 를 채우지 못하는 경로(구 webhook/플랜B observe, 부분수신). "미등록 TID를 등록으로 보고 침묵"의 실체.

**침묵경로 B — 미등록 merchant + 이름에 '풋' 미포함.**
폴러: whitelist 밖 merchant → silent drop(미적재), 표면화는 stderr `[UNCLASSIFIED-MERCHANT]` 로그 + `v_redpay_unclassified_merchants` 뷰뿐(슬랙 알람 0).
워치독 ①: `classifyUnclassified` L320~342 — `is_foot = name.includes('풋')`. **'풋' 미포함이면 `other` 로 분기 → 정보성 로그만(슬랙 0)** (L491~496).
워치독 ④: `merchant∉registry` → 설계상 제외(①담당). ⇒ 이름에 '풋' 없는 신규 foot 단말 = **완전 침묵**.
실증: 7/28 폴러가 drop 한 미등록 band(277/279/280/281) 실재(피부·도수). 워치독은 이를 "타센터 12종" 정보성 로그로만 처리(무알람) — watchdog.out 7/28 `[UNCLASSIFIED-OTHER]`. 감지의 유일 신호가 **RedPay 가맹점명의 '풋' 토큰**임이 실증됨.

**침묵경로 C — ① fetch bizno DEFAULT=511 latent hazard.**
watchdog L108 `REDPAY_BUSINESS_NO` DEFAULT=`511-60-00988`. 7/23 flip 후 511=0건(457=189건, doc L39 실증). 현재 env=457 로 정상이나,
env 유실 시 ① merchant-grain 이 **511 전량 0건 → FALSE-CLEAN(신규 merchant 무한 침묵)**. ④ 는 union 이라 보호되나 ④ 는 미등록 merchant 를 안 봄.
⇒ env 단일점 의존. 영향: env drift 시 침묵경로 B 가 상시화.

**재현조건 요약**: A=merchant/tid NULL payload 1건이면 즉시(무조건). B=whitelist 밖 merchant 가 '풋' 없는 이름으로 거래. C=`REDPAY_BUSINESS_NO` env 유실/미주입.

---

## AC-2 — 커버리지 전수 대사 + 자력감지율

### GAP TID 감지주체 분류표 (evidence: `~/.redpay-watchdog-foot-state.json`, watchdog.out launchd, 457-COUNT doc)

| TID(1047538…) | merchant | 첫 알람시각(state) | 감지주체(evidence) | evidence |
|---|---|---|---|---|
| 538231 | 1777288004 유선 | 2026-07-28T01:58 | **폴러 실시간**(`source:"poller-realtime"`) | state alerted_tids |
| 538235 | 1777289003 멀티 | 2026-07-28T07:56 | **폴러 실시간** | state |
| 538236 | 1777288003 유선 | 2026-07-28T01:12 | **폴러 실시간** | state |
| 538239 | 1777289006 멀티 | 2026-07-27T04:18 | **폴러 실시간** | state |
| 538241 | 1777288006 유선 | 2026-07-28T02:38 | **폴러 실시간** | state |
| 538246 | 1777288008 유선 | 2026-07-28T05:50 | **폴러 실시간**(trx 2) | state |
| 538237 · 538245 | 288/289 | (state 부재) | **auto-release 완료**(registry seed → membership 편입 → alerted_tids 제거) | state 부재 + membership=38 |
| (0723 535xxx VAN 6종) | 285xxx | (7/23~24, 훅 이전) | **수동대사+조회API** | 457-COUNT doc §b1/§9 |
| (0723 NULL-merchant 8.7M·250K·260K·10K·20K) | NULL | — | **총괄 수동대사(자동 0)** | 457-COUNT doc §b2 |

### 워치독 *일배치* 자력감지 이력 (watchdog.out)

- 7/24 ② merchant-grain: `신규알림 1건`(신규 foot merchant 자력감지 → 슬랙) ← 유일한 merchant-grain 자력 슬랙.
- 7/26 ④ TID-grain: `신규알림 2건`(일배치 자력감지 — TID-grain 이 스스로 잡은 유일 사례).
- 7/25 ④=clean(0). 7/27 ④=`dedup억제 2건`. 7/28 ④=`dedup억제 1건`.

### reporter 주장("자력=246 1건") 검증 → **본질적으로 일치·강화**

- 폴러 실시간 훅은 **2026-07-27 신설**(LATENCY-CLOSE). 상태파일 6건이 전부 `source:"poller-realtime"`·first_alerted 7/27~28 인 것은,
  훅 신설 후 재출현분을 300s 주기로 재포착한 것이지 **원발견이 아니다**. 원발견(0723~0725 물질적 누락)은 훅 이전이라 **수동대사+조회API**가 잡음.
- 워치독 일배치의 순수 자력감지 = **②1(7/24) + ④2(7/26) = 총 3건**, 그나마 위생성(이미 적재된 registry-stale TID). 폴러 훅 신설 후 일배치는
  300s 폴러에 항상 선점당해 `dedup억제`로 수렴 → **일배치 자력감지율 사실상 0** (7/27·7/28 전부 억제).
- **★핵심**: 확인된 물질적 누락 — NULL-merchant 8.7M(경로 A) 및 미등록 merchant drop(경로 B) — 은 워치독이 **구조적으로 못 본다**(mid==null continue / '풋' 이름 게이트 / 뷰 membership 게이트).

### 판정: **'누락 없음' 근거로 워치독 사용 = 불가(신뢰 불가)**

자동층은 "적재는 됐으나 registry TID 만 stale" 케이스의 위생·인지창 도구다. **완전성(누락 0) 보증기가 아니다.**
누락의 상방(merchant-NULL·미등록-merchant)이 감지 사각에 있으므로, 워치독 clean = "누락 없음"으로 읽으면 위험.

---

## AC-3 — 잔존 gap + positive-detection 제안 (설계만)

### ENVSHADOW union 배포 후 역방향 gap 판정

- ENVSHADOW-REGUNION-FIX(env∪DB-registry, poller L278~288)는 **정방향 오탐(236류 false drift)** 봉인 = ✅ 유효.
- **역방향(미탐)은 미봉인**: union 은 tidWhitelist(belt-and-suspenders) 를 넓혀 오탐만 줄일 뿐, admit 권위는 여전히 merchant_id.
  경로 A(NULL)·B(미등록 merchant)·C(env)는 union 과 직교 — **잔존**.
- 대사뷰(2026-07-24 registry-driven 전환, `v_redpay_reconciliation_daily`)는 `merchant IN registry AND tid IN (tid∪superseded)` **이중 membership 게이트** = membership-blind 아님. 미등록·NULL 은 여전히 view-drop.

### 제안 — membership-blind 완전성 대사 (설계만, 구현 별건)

**목적**: membership(등록 여부)에 무관하게 "들어온 총량 ↔ 적재 총량"을 count/amount delta 로 대조해 **침묵누락을 표면화**.

```
일 1회(또는 폴러주기) — READ-ONLY:
  A. VAN/조회API total   = RedPay 무필터 전량(business_no 511∪457) 당일 count·sum(amount)   [membership 무관]
  B. CRM 적재 total      = redpay_raw_transactions 당일 count·sum(amount)                    [membership 무관, 필터 前]
  C. CRM 스코프 total     = v_redpay_reconciliation_daily 당일 count·sum                       [membership 게이트 後]
  delta1 = A − B  > 임계 → '적재 누락'(폴러 drop/미수신) 경보   ← 경로 B/부분수신 표면화
  delta2 = B − C  > 임계 → '뷰 드롭'(NULL/미등록 membership) 경보 ← 경로 A/미등록 표면화
```

- membership 을 판정에서 **완전히 제거** → '풋 이름'·registry 편입 여부와 무관하게 총량 불일치를 잡는다(경로 A·B·C 전부 커버).
- grain = 일자×(선택적 bizno). PHI 위생 = count/amount/시각만(개별 환자정보 제외, 457-COUNT doc 규약 계승).
- 구현·DDL·뷰 신설은 **별건 spinoff**(본 audit 스코프 밖). db_change 여부는 뷰/RPC 설계 시 DA CONSULT 게이트.

---

## 별건 spinoff 제안 (planner)

1. **P0/P1 — membership-blind 완전성 대사 구현**(AC-3 설계 → 뷰/RPC + 일배치 경보). 침묵누락 표면화의 유일한 구조적 처방.
2. **P1 — 경로 A(merchant/tid NULL) 표면화**: `mid==null` 실거래를 drop/skip 하지 말고 별도 quarantine + 알람(현 continue → 표면화). 236→ENVSHADOW 패턴.
3. **P2 — 경로 C(watchdog ① DEFAULT=511) 제거**: DEFAULT 를 457 로 갱신 또는 ④ 처럼 union 화(env 단일점 제거).
4. **(도메인外 통보)** 피부(derm)·도수(body) merchant 가 457 공유피드에 실거래(피부7 유선 20건/일) — 각 도메인 CRM 적재 여부 별도 확인 필요(cross-domain).

## ★에스컬레이션 판정: **미발동**

audit 중 스캔한 7/28 라이브 drop merchant(277/279/280/281)는 전부 '피부'/'도수' 명칭 = 정상 타센터 배제.
**현시점 confirmed foot silent-miss 없음** → P0 승격·긴급알림 미발동. 단 경로 A/B 는 상시 잠재 → AC-3 구현으로 봉인 권고.

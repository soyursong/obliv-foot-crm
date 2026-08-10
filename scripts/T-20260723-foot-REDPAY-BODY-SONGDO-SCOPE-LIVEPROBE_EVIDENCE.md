# T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE-FLIP — live-probe 증거 (READ-ONLY)

- **date(re-verify)**: 2026-08-10 KST — conductor KICK(MSG-20260810-140557-vsps) 재실측. 원 probe 2026-07-23.
- **by**: dev-foot
- **method**: `scripts/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE.mjs` (RedPay GET only, DB write 0, env 미변경)
- **range**: 2026-07-19 ~ 2026-07-23, business_no 457 & 506 전건 순회 (tid 필터 없음 = 전 단말 관측)
- **SSOT**: `memory/1_Projects/201_메디빌더_AI도입/da_consult_reply_redpay_bizno_remap_506_authority_20260723.md`

---

## 1. 실측 결과 (가맹점명 기준 = 결정적 근거) — 2026-08-10 재실측

### 457-23-00938 = **오블리브 서울오리진점(종로)**
| 도메인(가맹점명) | merchant | 비고 |
|---|---|---|
| 종로 도수 | **1777269002**(도수2 VAN)·**1777269007**(도수7 VAN)·**1777276003**(도수 무선)·**1777275007/008**(도수 멀티) | 도수 9건 — ★현 body registry(1777274-276)가 **269 VAN band 미포함** → 일부 drop |
| 종로 풋 | 1777285xxx·1777288xxx·1777289xxx | foot 레인(457 단독) |
| 롱래 tid 2074000004 | — | **0건** (롱레 457 부재 재확인) |

### 506-60-03455 = **오블리브송도점(신법인)**
| 도메인(가맹점명) | merchant | tid | 건수/Y합 |
|---|---|---|---|
| **송도 도수2** | **1777540751** | 2074000005 | **192건 / ₩46,250,800** ★대량(본 gap 핵심) |
| 송도 도수1 | **1777540842** | 2074000003 | 1건 / ₩44,000 |
| 송도 도수2-VAN | **1779768020** | 2C29430313 | 1건 / ₩200,000 |
| 송도 도수1-VAN | **1779768019** | 2C29430297 | 1건 / ₩0 |
| **송도점N-도수2(VAN)** | **1785123002** | 2C29383784 | 9건 / ₩907,700 ★2026-08-10 신규 표면화(07-23 evidence 미포함) |
| 송도 풋 1~10·N-풋 | 1777540215/313/558·1780901xxx·1785123(N)·1781228xxx·1779768xxx | 2074000006~08·66~70 등 | ~1,100건 |
| 송도 롱래스팅 | 1777540911·1777885237·1777526419·1779768018 | 2074000004 등 | 137건 |
| 송도 피부 | 1777539xxx·1785123(N 피부)·1779768026 | 2074000009~12 등 | ~55건 |

> probe 분류기 롤업이 506 "도수 0건"으로 표기되는 건 분류기 band 상수(1777274-276)가 송도 도수 merchant를 모르기 때문 — **가맹점명(오블리브송도점-도수*)이 결정 근거**. 위 표가 정본.

---

## 2. 판정 (decision-grade)

1. **도수 = 종로(457) + 송도(506) 두 물리운영 이분** 재확증. Q1(DA §Q4, 2026-07-25) = **양쪽(457+506) pull 확정**.
2. **body merchant whitelist 는 27종 필요** (종로 도수 269 VAN 8 + 274~276 15 + 송도 도수 506 5). 현 DB registry(domain=body)=**14종(1777274-276)만** → 269 VAN·506 전량 누락.
3. ★**핵심 재발견 — 순수 env flip 로도, whitelist 교체로도, 지금은 recon 복구 불가.**
   - 07-24 배포된 **XDOMAIN-CONTAM-GUARD**(DOSU-CONTAM-FIX)가 `domain=body`+clinic slug=`jongno-foot`(현 body 기본 slug) 조합을 **fetch 루프 진입 前에 fail-closed(return, 적재 0)** 시킨다. 즉 body 폴러는 현재 **fetch 자체를 하지 않고** 가드에서 종료.
   - ∴ REDPAY_BUSINESS_NO_BODY(457+506)·REDPAY_MERCHANT_WHITELIST_BODY(27종)를 넣어도 **가드가 fetch 이전에 막아** 적재 0 = env atom 은 **inert(무효과)**.
   - **하드 선행조건 = 전용 body clinic**(예: `jongno-dosu`/송도 도수 clinic)이 clinics 테이블에 존재 + `REDPAY_CLINIC_SLUG` 를 그 slug 로 지정. = **T-20260729-body-REDPAY-DEDICATED-PIPE-NEED**(현 P2/blocked).
4. **songdo-foot leg**: Q2(김주연 총괄, 2026-07-23) = **No**. foot 조회=종로 457 단독 유지. → 본 티켓 착수대상 제외(송도 풋 506 leg 미추가).

---

## 3. dev-foot 조치 (본 커밋)

- ✅ **live-probe(read-only) 재실측 완료** — 본 문서 + `/tmp` 콘솔 매트릭스.
- ✅ **코드 (도메인 스코프화 + 멀티-bizno + whitelist prep)** — `redpay_macstudio_poller.mjs`:
  - `REDPAY_BUSINESS_NO` → `domainScopedOverride` 로 도메인 스코프화. body=스코프키 미설정 시 **457 상속 없이 fail-closed**(task ②).
  - `REDPAY_BUSINESS_NO_LIST` 콤마 리스트 지원 → body=양쪽(457+506) 사업자별 순회 fetch. **foot=단일 457 회귀 0**(self-test 증적).
  - `DOHSU_MERCHANT_WHITELIST_DEFAULT` += 269 VAN band + 506 송도 도수 5종(fail-safe prep. 실 권위=env override→DB registry).
  - self-test §bizno-scope 5종 + node --check 통과.
- ⛔ **env 원자 미적용** = supervisor secrets 게이트. **그리고 dedicated clinic 선행 전엔 env atom inert**(위 §2-3) → 지금 적용 무의미.
- ⛔ **backfill 미착수** = landing 자체가 sealed. 전용 clinic 선행 후에만 ADDITIVE raw-only 착수.

## 4. 게이트 / 하드 선행조건 (supervisor·planner 결정)

**env atom (dedicated clinic 확보 後에만 유효):**
- `REDPAY_BUSINESS_NO_BODY` = `457-23-00938,506-60-03455`
- `REDPAY_MERCHANT_WHITELIST_BODY` = 27종:
  `1777269001,1777269002,1777269003,1777269004,1777269005,1777269006,1777269007,1777269008,1777274001,1777275001,1777275002,1777275003,1777275004,1777275005,1777275006,1777275007,1777275008,1777276001,1777276002,1777276003,1777276004,1777276005,1777540751,1777540842,1779768019,1779768020,1785123002`
- `REDPAY_CLINIC_SLUG` = **전용 body clinic slug** (T-20260729-body-REDPAY-DEDICATED-PIPE-NEED 산출 — clinics 행 선존 필수)

**시퀀싱**: ① DEDICATED-PIPE-NEED(전용 clinic+slug) → ② 본 코드 merge + 위 env atom 원자 적용(supervisor) → ③ 도수 gap backfill(ADDITIVE·멱등·rowcheck·dry-run, DA §4 pre-remap raw freeze).

# T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE-FLIP — live-probe 증거 (READ-ONLY)

- **date**: 2026-07-23 KST
- **by**: dev-foot
- **method**: `scripts/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE.mjs` (RedPay GET only, DB write 0, env 미변경)
- **range**: 2026-07-19 ~ 2026-07-23, business_no 457 & 506 전건 순회 (tid 필터 없음 = 전 단말 관측)
- **SSOT**: `memory/1_Projects/201_메디빌더_AI도입/da_consult_reply_redpay_bizno_remap_506_authority_20260723.md`
- **parent 준용**: supervisor LONGRE live-verify(probe 9건, MSG-20260723-193139-5bbt)

---

## 1. 실측 결과 (가맹점명 기준 = 결정적 근거)

### 457-23-00938 = **오블리브 서울오리진점(종로)** — 65건
| 도메인(가맹점명) | merchant band | 대표 tid | 비고 |
|---|---|---|---|
| 종로 풋 (풋1~7·무선·멀티) | 1777285xxx, 1777289xxx | 1047535xxx | 27건 — **parent LOOKUP-BIZNO-511TO457(457) 정합 ✅** |
| 종로 도수 (도수2/3/7 VAN·무선) | **1777269xxx**, 1777276003 | 1047535754·1047479115 | 11건. ★대부분 1777269 = **body 폴러 whitelist(1777274-276) 밖** → 이미 drop |
| 종로 피부 | 1777277·279·281 | — | 27건 (풋/도수 도메인 아님) |
| 롱래 tid 2074000004 | — | — | **0건** (롱레 457 부재 재확인) |

### 506-60-03455 = **오블리브송도점(송도 신법인)** — 1,041건
| 도메인(가맹점명) | merchant | tid | 건수/Y합 |
|---|---|---|---|
| **송도 도수2** | 1777540751 | 2074000005 | **191건 / ₩46,240,800** ★대량 |
| 송도 도수1 | 1777540842 | 2074000003 | 1건 |
| 송도 도수1/2-VAN | 1779768019·1779768020 | 2C29430297·2C29430313 | 2건 |
| 송도 풋 1~9 | 1777540215·313·558, 1780901637·711·752·789, 1781228001~3, 1779768019~23, 1781153458 | 2074000006~08·66~70, 2C294xxx | ~700건 |
| 송도 롱래스팅 | 1777540911 | **2074000004** | 112건 / ₩25,619,600 (DA probe J=80건, 범위차) |
| 송도 피부 | 1777539xxx, 1779768026 | 2074000009~12 | ~30건 |

---

## 2. 판정 (decision-grade)

1. **DA §2-2 "body=506 추정"은 부분 정정 필요.** 도수는 **두 물리 운영**으로 갈라져 있다:
   - **종로 도수** = 457 (merchant 1777269·1777276). body 폴러 whitelist(1777274-276)가 부분매칭(무선 1777276003)뿐 → 실효 near-zero.
   - **송도 도수** = 506 (merchant 1777540751 등, ₩46.2M/191건 대량). body whitelist(1777274-276)와 **merchant 교집합 0**.

2. **∴ 순수 env 457→506 flip 만으로는 도수 recon 복구 불가.** 506 으로 flip 해도 body whitelist(1777274-276)가 송도 도수 merchant(1777540751/842·1779768019/020)와 무교집 → 여전히 near-zero. **business_no flip + merchant whitelist 동반 교체**가 동시에 필요(DA §2-3 "멀티-merchant/인스턴스 분리" 구조항목과 동형).

3. **body 확정 스코프 = dev 결정 불가 = 게이트.** "body/도수 CRM(obliv-body-crm)이 종로 도수(457)를 담나 / 송도 도수(506)를 담나 / 양쪽인가"는 **송도 신법인 귀속(DA §5 finance human gate + CEO INFO)** + 제품 스코프 결정. → planner FOLLOWUP.

4. **songdo-foot leg (task #3)**: 송도 풋 단말은 **506에 live**(송도점 풋1~9, ~700건). songdo-foot(clinics business_no=NULL)이 이 단말을 담을 CRM이면 → **별도 506 leg 필요(멀티-merchant)**. dormant 아님 = gap 실재. 단 이는 롱레/도수와 동일한 506-신법인 귀속 게이트 하위.

5. **tid 격리 (task #4)**: 506=공유 merchant 확증(송도 도수+풋+롱래+피부 동거). 도수 leg 확정 시 도수 merchant/tid(1777540751→2074000005, 1777540842→2074000003, 1779768019/020→2C29430297/313)로만 narrowing — 롱래(2074000004)·송도풋·피부 오수집 금지.

6. **backfill (task #5)**: 도수 gap backfill 은 **스코프 확정 후에만** 착수(ADDITIVE raw-only, 멱등·rowcheck·dry-run). 현재는 대상셋 미확정 → **보류**.

---

## 3. dev-foot 조치 (본 티켓 범위 내)

- ✅ **live-probe(read-only) 완료** — 본 문서 = 증거.
- ✅ **코드 구조 방어(457 상속 차단)**: `redpay_macstudio_poller.mjs` — business_no 를 whitelist 와 동일 `domainScopedOverride` 로 도메인 스코프화. body=default 없음 → 미설정 시 **fail-closed**(457 조용한 상속 봉인). foot=457 무영향(시뮬 검증).
- ⛔ **env 원자 적용 안 함** = supervisor secrets 게이트(REDPAY_BUSINESS_NO_BODY 또는 body plist). dev 단독 커밋 금지 준수.
- ⛔ **backfill 안 함** = 스코프 미확정. 파괴적 정정 0(ADDITIVE only, DA §4 준수 — 기적재 raw 무접촉).
- → **planner FOLLOWUP**: body 도수 스코프 확정(종로 457 / 송도 506 / 양쪽) + whitelist 동반갱신 + songdo-foot leg 귀속 = 송도 신법인 finance/CEO 게이트 연계.

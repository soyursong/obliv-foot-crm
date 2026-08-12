# T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE-FLIP — evidence (현 main 위 재구현)

- **date**: 2026-08-13 KST (재발행 GO / MSG-20260813-065005-2r9r · planner)
- **by**: dev-foot
- **artifact_class**: db_only (E2E 면제 — poller 로직 = raw 적재 write-path. self-test = ef_only 재현 대체 + live-probe)
- **base**: 현 main `02b6101c` 위 재구현. **스테일 브랜치 `5cd8f378`(foot-redpay-poller-comment-457-20260723) 폐기** (main 8+ 커밋 드리프트 — BIZNO-DEFAULT-FAILCLOSED / DEADBAND-VERIFY / RESWEEP-LOOKBACK 위에 재작성).
- **method**: `scripts/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE.mjs` (RedPay GET only, DB write 0, env 미변경) + poller `--self-test`(무네트워크 로드타임 불변식)
- **probe capture**: `evidence/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE-LIVEPROBE_probe_20260813.txt`
- **selftest capture**: `evidence/T-20260723-foot-REDPAY-BODY-SONGDO-SCOPE_selftest_20260813.txt` (95 assert ALL PASS)

---

## 1. live-probe 재실측 (2026-08-13, 07-19~07-23 range) — 티켓 still-live 확증

### 506-60-03455 = 오블리브송도점 (전건 1129) — 도수 merchant (name= 결정근거)
| merchant | name | cnt | Y합 | whitelist 처리 |
|---|---|---|---|---|
| **1777540751** | 오블리브송도점-**도수2** | **192** | **₩46,250,800** | ★**편입**(도수, 대량) |
| **1777540842** | 오블리브송도점-**도수1** | 1 | ₩44,000 | ★**편입**(도수, unambiguous) |
| 1779768020 | 오블리브송도점-도수2-VAN | 1 | ₩200,000 | ⛔**제외**(송도풋 1779768018~23 collision) |
| 1779768019 | 오블리브송도점-도수1-VAN | 1 | ₩0 | ⛔**제외**(collision) |
| 1785123002 | 오블리브송도점N-도수2(VAN) | 9 | ₩907,700 | ⛔제외(N-band 도수-VAN, tid-scoped 후속) |
| 1777540911 | 오블리브송도점-**롱래스팅** | 112 | ₩25,619,600 | ⛔**제외**(롱래 tid 2074000004 — 오수집 금지 §519) |
| 1777540215/313/558 등 | 송도**풋**1~9 | ~700 | — | ⛔제외(송도풋 — Q2=No, whitelist 밖) |
| 1777539xxx | 송도**피부** | ~40 | — | ⛔제외(피부) |
| ─ 롱래 tid 2074000004 대조 | | **112건** | ₩25,619,600 | 격리 대조용 — whitelist 밖 확인 |

### 457-23-00938 = 오블리브 서울오리진점(종로) — 도수 9건
- 종로 도수 = band **1777275xxx**(예: 1777275007/008 "도수(멀티)") — **기존 DOHSU whitelist 에 이미 존재**.
- ∴ **양쪽 pull 필수**: 종로 도수(457, band 1777275) + 송도 도수(506, 1777540751/842). 어느 한쪽 single-pull 도 도수 recon 미완.

### 판정 롤업 (probe 자체 출력)
```
457-23-00938: 도수 9건 / 송도풋후보 38 / 롱래 0 / 전건 100
506-60-03455: 도수 0건(*) / 송도풋후보 1129 / 롱래 112 / 전건 1129
```
(*) probe classifier 의 DOHSU_MERCHANT_BAND 는 1777274/275/276 prefix 만 앎(송도 1777540 미인지) → 506 을 전부 '기타'로 롤업. **name= 필드가 결정근거**(도수2/도수1 명시) — whitelist 는 name-verified. classifier prefix 한계는 코스메틱(판정 무영향).

---

## 2. 코드 변경 (`scripts/redpay_macstudio_poller.mjs`) — 현 main 위 재구현

1. **(a) business_no 도메인스코프화** — `domainScopedOverride("REDPAY_BUSINESS_NO")` 적용(whitelist 와 동일 패턴). 비-스코프 `REDPAY_BUSINESS_NO` = **native foot 만** 상속, non-foot(body) = 스코프키 `REDPAY_BUSINESS_NO_BODY` 필요.
   - ★**드리프트 재조정(핵심)**: 스테일 브랜치의 `DOMAIN_BUSINESS_NO_DEFAULTS={foot:"457-23-00938"}` **미도입**. main 의 `BIZNO-DEFAULT-FAILCLOSED`(하드값 default 제거) 불변식 보존 — foot 은 env 파일(457 SSOT)에서 상속, body 는 미설정 시 `""` → **fail-closed**(457 조용한 상속 봉인). "명시 전까지 정지 > 틀린 값 오수집".
2. **(b) body dual-bizno pull(457+506)** — domain-scoped 값을 콤마 다중값 파싱(`parseBusinessNoList`) → `REDPAY_BUSINESS_NO_LIST`. `fetchRedpayPage(...,businessNo)` param 추가 + main() 수집 루프를 `for (businessNo of LIST)` × 페이지 순회로 래핑. foot=1-element(하위호환 무영향).
3. **(c) 506 송도 도수 merchant whitelist 동반교체** — `DOHSU_MERCHANT_WHITELIST_DEFAULT` 에 `1777540751`·`1777540842` 추가(종로 band 1777274-276 유지). body 기존 whitelist ∩ 506 도수 = ∅ → **whitelist 교체 없이는 recon 미복구**(self-test 로 확증).
4. **(d) §519 오수집 금지** — 롱래(1777540911/tid 2074000004)·송도풋(1777540215 등)·피부(1777539xxx)·collision-VAN(1779768019/020)은 whitelist 밖 → admit=merchant_id 1차권위(서버측 tid= narrowing 旣제거)로 **구조적 배제**.

### 회귀 안전 (foot 무영향)
- foot 도메인: `domainScopedOverride("REDPAY_BUSINESS_NO")` = 비-스코프 env(457) 그대로 → `LIST=["457"]` 1-element → 기존 단일 pull 과 byte-동치. DOHSU/506 은 body 전용 → foot 미유입.
- fail-closed 경로(main() `isBiznoReadFail`) 무변경 — 빈 리스트 → 대표값 `""` → read-fail 경보(기존 그대로).

---

## 3. 검증

- **self-test (무네트워크, ef_only 재현 대체)**: `node scripts/redpay_macstudio_poller.mjs --self-test` → **95 assert ALL PASS**. 신규 15 assert = parseBusinessNoList(양쪽/단일/trim/dedup/공란/fail-closed) + DOHSU whitelist(506 편입·종로 유지·롱래/송도풋/collision 제외·무교집).
- **live-probe (RedPay GET only)**: §1 = 티켓 문제 미해소 재확증(506 도수 1777540751 192건 ₩46.25M live) + whitelist 정확성 name-verified.
- **`node --check`**: poller + probe 양쪽 SYNTAX OK.
- **파일 변경**: `scripts/redpay_macstudio_poller.mjs` (재구현) + `scripts/T-...-LIVEPROBE.mjs` (read-only 프로브 포팅) + evidence 2종.
- **caller grep**: `REDPAY_BUSINESS_NO` 참조 = 동일 파일 내(모듈 상수). 외부 import 없음(스탠드얼론 폴러). `fetchRedpayPage` 호출부 = main() 루프 1곳(업데이트 완료).

---

## 4. 게이트 (미완 — supervisor 원자 조율 대기)

- ⛔ **env 원자 적용 = supervisor secrets 게이트(§🔒 secrets-gate)**. body 폴러 fail-closed 이므로 **3개 동시적용 필수**:
  1. 코드 커밋 merge
  2. body 인스턴스 env `REDPAY_BUSINESS_NO_BODY = "457-23-00938,506-60-03455"` (457 상속 금지 — 명시 지정)
  3. body 도수 merchant whitelist 교체(`REDPAY_MERCHANT_WHITELIST_BODY` 또는 DB registry domain=body seed)
  - **단독 merge 시**: 가동중 body 폴러 `REDPAY_BUSINESS_NO` 미설정 → 즉시 fail-closed(정지). ∴ dev 단독 merge 금지 준수, supervisor codeploy 페어 원자 번들.
- ⛔ **backfill 안 함(step 3, post-apply)** — 송도 도수 gap backfill = ADDITIVE raw-only·멱등·rowcheck·dry-run. **파괴적 정정 금지(DA §4)**: 기적재 raw 무접촉, **flip 착수 前 pre-remap raw 스냅샷 1회 export** 선행. 스코프 반영 배포 후 별건.
- **범위 경계**: 본 작업 = raw 수집 복구(원천 보존)이지 집계 봉합 완료 아님. 매출귀속/VAT(송도 506 별법인)=DEBIZREG canonical 별도 blocked(본 티켓 스코프 제외). pull 복구는 귀속에 선행 가능.

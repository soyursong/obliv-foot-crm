# T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC — 서버 access-log 포렌식 슬라이스 (READ-ONLY, mutation 0)

**작성**: dev-foot / 2026-07-18
**슬라이스**: human_pending 해소분 — 원 포렌식 §2 "호출자 앱 신원=레포 밖" 공백을 Supabase 로그 레이어에서 규명
**프로브**: `scripts/T-20260715-foot-PHONE-WRITEPATH-SOURCE-FORENSIC_logprobe.mjs` (Management Analytics Logs API, Logflare, READ-ONLY)
**데이터소스**: `edge_logs`(Kong API gateway) · `postgres_logs` · `auth_logs` via `GET /v1/projects/{ref}/analytics/endpoints/logs.all`
**PHI off-git**: IP/UA는 인프라 메타(비-PHI). phone/name 실값 미조회.

---

## 🟢 결론 — **결과 분기 (a): 내부 test/simulation 하네스 잔재** (외부 운영 연동 아님)

현장(김주연 총괄)이 "시스템적으로 확인해봐야" 했던 **외부 자동등록 경로는 존재하지 않는다.** 4건은
**내부 E2E/시뮬레이션 테스트 하네스**가 남긴 teardown 잔재다. 근거는 아래 access-log 지문(전부 재현 가능).

| 조사 항목 | 규명 결과 |
|-----------|-----------|
| **호출자 IP** | `118.223.62.127` (KR, cloudflare cf_ipcountry=KR) — 단일 오리진. 비-클라우드(오피스/ISP) 대역 = 상주 개발 머신 정황 |
| **User-Agent(앱)** | `node` — 브라우저 아님(키오스크 아님) |
| **x-client-info** | `supabase-js-node/2.103.3` — supabase-js **Node(서버측) SDK**. 라이브 키오스크는 `supabase-js-web` |
| **API key role** | **`service_role`** (JWT `role: service_role`, sig prefix `ijD9Am`, issued≈2026-04-19, exp≈2036) — **anon 아님** |
| **Referer / Origin** | `null` / (헤더 부재) — 브라우저 오리진 없음 = 프로그래매틱 클라이언트 확정 |
| **경로** | `POST /rest/v1/customers → 201` (PostgREST **직접 테이블 INSERT**) — 키오스크 RPC `fn_selfcheckin_upsert...` **미경유** |
| **로그 보존** | ✅ **유지** — 07-14 전일 edge_logs 2,473,840행, 배치창 143행. rotate-out 아님(분기 c 배제) |

### created_by=null / is_simulation=false 재해석
- `created_by=null`: 원 포렌식은 "anon"으로 추정했으나 실제는 **service_role** 호출 → `auth.uid()` 없음 → NULL. (anon도 service_role도 uid 없음. 로그가 service_role로 확정.)
- `is_simulation=false`: 하네스가 직접 `.insert()` 하며 `is_simulation` 미세팅 → 컬럼 DEFAULT(false). **하네스 버그**(sim 행을 sim으로 표시 안 함)이지 실데이터 증거 아님.

---

## 1) 타임스탬프 정합 — HTTP 요청 ↔ 4건 PK

배치창 tight(12:11:10~35) `POST /rest/v1/customers` 6건, 전부 `118.223.62.127 / node / supabase-js-node / service_role`:

| HTTP req ts (UTC) | 대응 customers PK (created_at) | 처리 |
|---|---|---|
| 12:11:18.698 | **a939ec01** (12:11:18.72) | 생존(잔재) |
| 12:11:19.352 | **2db50bad** (12:11:19.36) | 생존(잔재) |
| 12:11:19.964 | (teardown DELETE 대상) | 삭제됨 |
| 12:11:30.230 | **a22437a5** (12:11:30.23) | 생존(잔재) |
| 12:11:30.809 | **7fe8dbdd** (12:11:30.81) | 생존(잔재) |
| 12:11:31.429 | (teardown DELETE 대상) | 삭제됨 |

`POST customers = 10 − DELETE customers = 6 = 4 잔재` → **정확히 대상 4건**. teardown 불완전이 원인.

## 2) simulation 지문 — full-journey seed→teardown

배치창(12:10~12:13) 같은 오리진이 **환자 여정 전체를 CRUD 후 철거**:
- `POST customers(10)` + `DELETE customers(6)`
- `POST payments(4)` + `DELETE payments(4)`
- `POST check_ins` + `DELETE check_ins` + `PATCH check_ins`
- `POST packages` + `DELETE packages` + `PATCH packages`, `POST/DELETE package_payments`
- `POST /auth/v1/token(3)`(로그인) + 다수 `OPTIONS` preflight + `GET`

일방향 임포트/제휴 sync는 **자기가 만든 행을 즉시 삭제하지 않고, 결제·패키지·체크인 전 여정을 seed하지 않는다.** → **E2E/시뮬레이션 하네스**로 확정.

## 3) 광역 빈도 — 이건 이상현상이 아니라 상시 내부 트래픽

`POST /rest/v1/customers`의 **압도적 다수가 `node`(programmatic)**, 브라우저는 하루 ~5건:

| 날짜 | node POST customers | 브라우저(Mozilla) | Deno(Edge Fn) |
|---|---|---|---|
| 07-14 | 765 | 5 | 35 |
| 07-15 | 238 | ~10 | 22 |
| 07-16 | 332 | ~7 | 26 |
| 07-17 | 624 | ~9 | 20 |
| 07-18(~14h) | 69 | 2 | 5 |

- 오피스 IP `118.223.62.127`가 매일 상주(108/54/60/166건) + 다수 **Azure 클라우드 IP**(20.x/52.x/48.x/4.x)가 ~6건 버스트 = **CI/자동 테스트 러너**. Azure 버스트 spot-check role = `service_role` 확인.
- 즉 4건은 이 상시 내부 test/sim/CI 트래픽의 **teardown 누락 잔재** 1건. 배치창에 **브라우저(키오스크) customer 생성 0건** = 실사용 활동 아님.

## 4) Step1(DB CHECK) 배포 영향 — 재확인

| 경로 | phone 정규화 | Step1 후 | 현장 영향 |
|---|---|---|---|
| FE 키오스크(브라우저, anon, `supabase-js-web`) | FE 클라 E.164 | ✅ 통과 | 무영향 |
| dopamine 예약인입 EF(`upsert_reservation_from_source`) | `normalize_phone(+82)` | ✅ 통과 | 무영향 |
| **내부 node/service_role 직접 INSERT(=4건 소스, test/sim/CI)** | 없음(raw `010…`) | ❌ 22023 fail-close | **현장 무관**(내부 dev 도구) |

- **field-safe**: Step1은 실사용 키오스크·예약인입을 깨지 않는다(정규화 경유). 깨지는 건 **내부 test/sim/CI 하네스뿐** = 환자 미등록 현장 놀람 **없음**.
- 단, 하네스가 raw `010…`을 계속 쓰면 Step1 후 sim/E2E/CI가 **대량 fail**(하루 수백 write) → **dev 파이프라인 파손**. 이건 현장이 아니라 우리 쪽 도구 위생 문제.

---

## 결과 분기 판정 (티켓 §"결과 분기")

- ✅ **(a) 폐기/테스트 잔재** — 채택. 호출자 = 내부 E2E/시뮬레이션/CI 하네스(service_role, node, 오피스+Azure IP). 외부 제휴/임포트 연동 **부존재**.
  - → **Step1(DB CHECK) 자유 배포 = field fail-close 무해.** 4건 잔재는 `T-20260715-foot-RCPT-SPURIOUS-DELETE`(별도 DB-GATE)가 이미 처리 중.
  - → `T-20260714-foot-ANON-WRITE-SWEEP-REVOKE` 연계: 단 **revoke 대상은 anon-EXECUTE가 아니라 service_role 직접 INSERT 경로**임을 정정. (호출자는 anon이 아니라 service_role. anon GRANT sweep은 이 4건과 무관 — planner 재조준 필요.)
- ❌ **(b) 운영 중 외부 연동** — 배제. 외부 파트너 sync는 service_role 키를 갖지 않고(External Partner Read-only Grant 표준상 scoped RO grant), 자기 seed를 teardown하지 않으며, 오피스/Azure-CI 대역에서 오지 않음.
- ❌ **(c) 로그 부재** — 배제. 07-14 로그 완전 보존(2.47M행).

## 후속 권고 (planner 판단용, 본 슬라이스 mutation 0)
1. **Step1 자유 배포 진행** — field 무해 확정. normalize-before-write(spawned `UPSERT-RPC-NORMALIZE-BEFORE-WRITE`) 선배포는 **field blocker 아님**. 단, 내부 dev 파이프라인 보호 차원에서 defense-in-depth로 유효.
2. **하네스 위생(신규 티켓 후보)**: 내부 test/sim/CI가 `POST /rest/v1/customers` 시 (i) `is_simulation=true` 세팅 + (ii) phone E.164(또는 DUMMY-) 사용. 이게 근본 재발방지(RCPT-SPURIOUS-DELETE 근인 = 하네스 teardown 누락 + 비정규화 write).
3. **ANON-WRITE-SWEEP-REVOKE 재조준**: 본 4건은 **service_role 직접 테이블 INSERT**이지 anon-RPC 아님 → anon GRANT revoke로는 이 경로 차단 불가. service_role 키는 revoke 불가(운영 필수). 방어는 Step1 CHECK(경로 무관 table-level)가 정본.

## 5) mutation 0 확인
전부 Analytics Logs API SELECT(edge_logs/postgres_logs/auth_logs 조회). DB DDL·DML·GRANT 무접점. 대상 CRM 레포 코드 변경 0.

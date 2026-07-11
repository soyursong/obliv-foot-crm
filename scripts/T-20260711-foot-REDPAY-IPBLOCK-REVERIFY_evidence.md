# T-20260711-foot-REDPAY-IPBLOCK-REVERIFY — 재검증 증거 리포트

**대표 반론**: "레드페이가 특정 IP를 차단하지 않을 것 같다(가정집 인터넷에서도 호출됨). 안 해봤거나
정확한 실행이 안 된 걸 넘겨짚었을 가능성." → 기존 결론(403 근본원인 = 레드페이 WAF의
클라우드/데이터센터 IP 차단, 근거 net._http_response id 93444/93573) 재검증.

실행: 2026-07-11 macstudio(한국 일반 IP). 실제 payments.php 실호출(DRY_RUN 아님). 키·PHI 마스킹.

---

## AC-1 가이드 규격 ↔ 실제 요청 대조

| 항목 | API 스펙(벤더/최필경 §1) | 우리 실제 요청(폴러·EF 코드) | 일치 |
|------|--------------------------|------------------------------|------|
| 엔드포인트 | `https://redpay.kr/api/partner/payments.php` | 동일 (`payments.php` 포함) | ✅ |
| 메서드 | GET | GET | ✅ |
| 인증 | `X-API-KEY` 헤더 | `X-API-KEY` 헤더 | ✅ |
| 파라미터 | `from`,`to`,`business_no`,`page`,`limit`,`tid`(콤마) | 동일 (`tid` 17종) | ✅ |
| business_no | `511-60-00988` | `511-60-00988` | ✅ |

⚠ 표기 불일치 1건: 대표/팀장 가이드 **산문**에 파라미터가 `start_date`/`end_date`로 적힌 대목이
있으나, **실제 API 스펙과 코드는 `from`/`to`**. 코드가 정답(아래 200 OK로 실증). → 가이드 산문
오탈자일 뿐, 우리 요청 규격 결함 아님.

## AC-2 / AC-3 실호출 재현 (한국 IP = macstudio)

| 변형 | URL | status | Content-Type | 결과 |
|------|-----|--------|--------------|------|
| A. 가이드-정확(tid 없음) | `…/payments.php?from&to&business_no&page&limit` | **200** | application/json | `success:true` 거래목록 |
| B. 폴러-실제(tid 17 콤마) | `…/payments.php?…&tid=1047479255,…(17)` | **200** | application/json | `success:true` |
| C. 디렉터리(payments.php 탈락) | `…/api/partner/?…` | **403** | text/html; iso-8859-1 | `Forbidden — access /api/partner/` |
| D. 키 없음(대조) | `…/payments.php?…` (헤더 없음) | **401** | application/json | `"API KEY가 없습니다."` |

- 라이브 폴러(macstudio, 5분 주기)도 payments.php 연속 **200 OK** 적재 중(fetched≥0, errors=0).
- 원문 로그: `scripts/T-20260711-foot-REDPAY-IPBLOCK-REVERIFY_probe.mjs` 실행 산출.

## AC-4 실패 지점 근거화 — "403"의 정체

1. **레드페이는 키/권한 문제에 403이 아니라 401(JSON)을 반환**한다(변형 D). 즉 **403은 결코
   키·권한 문제일 수 없다**.
2. 과거 "403"의 응답 원문 = **Apache 디렉터리 접근거부 HTML**(`text/html; iso-8859-1`,
   "You don't have permission to access /api/partner/"). 이는 **URL에서 `payments.php`가
   탈락**해 요청이 디렉터리로 갈 때 뜨는 웹서버 레벨 거부(변형 C에서 한국 IP로도 그대로 재현) —
   **발신 IP와 무관**.
3. 정식 `payments.php` 호출은 한국 IP에서 정상 200. 벤더패킷이 기록한 cloud 403도 동일한
   디렉터리-거부 HTML 시그니처였고, 그 재현 시점엔 URL 수정(c930c423)이 prod 미배포 상태였음
   (dev-foot 07-10 21:15 FOLLOWUP) → **"cloud가 payments.php 정확 URL로도 403"이라는 전제가
   깨끗이 실증된 적 없음**.

## AC-3 cloud-IP 축 — fresh 재호출은 인프라 장애로 미완(정직 고지)

한국 IP 축은 완결(위). **cloud-egress fresh 재호출**은 아래 4경로 전부 현재 툴링/권한 장애로 차단:
- `net.http_get`(pg_net) via PostgREST RPC → `exec_sql`/`exec_sql_readonly` 함수 미노출(PGRST202)
- pg_net via psql 직접 → DB 비밀번호 미보유(스크립트는 런타임 주입 전제)
- 진단용 신규 EF 배포(Deno Deploy = id 93444 경로) → Supabase 번들러 API 오류(`Effect.tryPromise`,
  단일 함수 격리 배포에서도 재현 = 프로젝트/CLI 인프라 이슈, 코드 무관)
- 기존 `redpay-reconcile` EF invoke → 401(EF 주입 service_role ≠ 현재 키, management API 키로도 401)
- `net._http_response`(id 93444/93573) 원문 재판독 → net 스키마 PostgREST 미노출

→ 이 잔여 항목은 sibling 티켓 `T-20260711-foot-REDPAY-WAF-WHITELIST-REQUEST`로 이월.

## AC-5 판정

**② 오진(misdiagnosis) 우세 — 대표 판단 지지.**
- "403 = 특정 IP 차단"은 실증된 적 없다. 관측된 403은 **`payments.php` 탈락 시 뜨는 IP-무관
  디렉터리 거부**였고, 정식 호출은 (한국 IP에서) 200. 키 문제는 401이지 403 아님.
- 잔여 불확실성: cloud-IP에서 **정식 payments.php** fresh 재호출은 인프라로 미완 → "cloud
  파일레벨 차단" 100% 배제는 아님. 단 정황상 IP-차단 가능성은 낮음. 실질 ②.
- Path A(맥스튜디오 폴러)는 라이브 실적재 정상 → 우회로 유지(REDEFINITION-GUARD 준수, 철거 금지).

## 벤더 요청 문장 (필요 시)
> (현재 벤더 조치 불요) 저희 요청은 규격 정상이며 한국 IP에서 200으로 정상 조회됩니다. 만약
> 데이터센터/클라우드 IP 대역에 대한 접근 제한이 걸려 있다면, merchant_id `1777284978` /
> 사업자번호 `511-60-00988`의 파트너 조회 API(`payments.php`)를 호출하는 서버 IP를
> 화이트리스트에 추가해 주실 수 있는지만 확인 부탁드립니다. (그 외 키·권한은 정상)

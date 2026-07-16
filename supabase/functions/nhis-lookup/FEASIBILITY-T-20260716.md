# NHIS 자격조회 REST API — Feasibility / Prep 결과

- **티켓**: T-20260716-foot-CHART2-NHIS-LOOKUP-ENABLE
- **단계**: feasibility / prep (⚠ prod 실활성 아님)
- **작성**: dev-foot · 2026-07-16
- **결론 요약**: ❌ **cert-mtls(공동인증서 client-cert 전송계층 mTLS)는 현재 Supabase Edge(Deno) 런타임에서 활성화 불가.** → planner 재스코핑 필요 (women/body 파급).

---

## 1. 접수 값 (대표 프로토콜 결정)

| 항목 | 값 | 상태 |
|------|----|----|
| transport | **REST** | 확정 (SOAP/EDI-XML 소거) |
| 요양기관번호 | `13328581` | 확정 (INSTNUM 정본 일치) |
| 베이스 호스트 | `api.nhic.or.kr` | 확정 |
| 엔드포인트 경로 | `/xxxx` | ⚠ 미확정 |
| 포트 | 1443 \| 1444 \| 1454 중 1 | ⚠ 미확정 (과장님 확인 대기) |
| API 인증키 | 별도 없음 (요양기관번호로만 인증 '추정') | ⚠ 현장 비기술 추정 |
| 수령 자산 | KICA 공동인증서 (signCert.der / signPri.key 등) | 확정 |

---

## 2. 핵심 divergence — "값만 꽂으면 됨" 가정 반증

기존 EF는 `Authorization: Bearer ${NHIS_API_KEY}` (Open API 키) auth를 전제한다.
그러나 접수 실체는:

- API **인증키가 없다**,
- 대신 **KICA 공동인증서**(cert+key)를 수령했고,
- 포트가 **EDI형 프록시 포트**(1443/1444/1454)다.

→ 이 조합은 Bearer-key auth가 아니라 **공동인증서 기반 auth**를 강하게 시사한다.
공동인증서 auth는 두 갈래로 갈린다:

| 후보 | 정의 | Deno Edge 실현성 |
|------|------|------------------|
| **(A) cert-mTLS** | 전송계층에서 client certificate로 상호 TLS 핸드셰이크 | ❌ **불가** (§3) |
| **(B) message-sign** | 표준 HTTPS 위에 요청 페이로드/헤더를 인증서로 전자서명 | ✅ 가능 (WebCrypto), 단 서명규격 미확정 |

**어느 쪽인지 아직 미확정** — 포트/엔드포인트/인증방식 모두 현장 확인 대기.

---

## 3. feasibility 핵심: Deno Edge 의 mTLS client-cert 지원 여부 → **미지원**

outbound mTLS client-cert 를 Deno 에서 하려면 유일 경로가
`Deno.createHttpClient({ certChain, privateKey })` + `fetch(url, { client })` 이다.

조사 결과:
1. `Deno.createHttpClient` 는 **unstable API** 다 (`--unstable` 플래그 필요).
2. **Deno Deploy 런타임 = Deno CLI 와 다른 제한 런타임**이며, unstable API 인
   `Deno.createHttpClient` 를 **노출하지 않는다** (호출 시 `is not a function`).
3. **Supabase Edge Runtime 은 Deno Deploy 런타임과 동일한 API 서브셋**을 노출한다.
   → Edge Function 에서 `Deno.createHttpClient` 사용 불가.
4. edge-runtime 에 unstable 플래그를 열어달라는 요청(**issue #205**)은
   **"not planned" 으로 close** 됐다. `DENO_CERT` 환경변수도 무효.

**결론: (A) cert-mTLS 경로는 현재 hosted Supabase Edge Functions 에서 활성화 불가.**
이것이 티켓 prep §1의 "불가/중량이면 착수 前 planner FOLLOWUP" 게이트에 해당 → FOLLOWUP 발행.

> 출처:
> - Supabase Discussion #14604 (Deno unstable flag on Edge Functions)
> - Supabase edge-runtime **Issue #205** — closed "not planned"
> - Supabase Discussion #36035 (createHttpClient CA 문제, 미해결)
> - Deno Issue #10516 / #26911 (fetch TLS client cert)
> - Deno.createHttpClient API 문서 (certChain/privateKey = unstable)

---

## 4. 대안 (planner 판단용 — 코드 착수 前)

- **(B) message-sign 이 실체라면** → Deno WebCrypto/`node:crypto` 로 EF 내 서명 구현 가능.
  transport client-cert 불필요. auth 모드 `message-sign` scaffold 를 이번에 심어둠(§5).
  → **서명 규격(무엇을·어떤 알고리즘으로·어디에 실어) 확정이 선결**.
- **(A) cert-mTLS 가 실체라면** → Edge Function 이 아닌 대체 런타임 필요:
  - mTLS 지원 프록시/사이드카(예: Node 컨테이너·Cloud Run·nginx client-cert proxy)를
    앞단에 두고 EF → 프록시 → 공단.
  - 또는 청구 SW/전용 클라이언트 경유(전통 EDI 방식) — REST 확정과 상충하므로 재확인 필요.
- 어느 경우든 **포트+엔드포인트+인증방식 3자 확정**이 활성화 선결 조건.

---

## 5. 이번 prep 에서 실제로 심은 것 (코드)

EF `nhis-lookup/index.ts` — 모두 ADDITIVE, prod 무변화(아무것도 설정 안 됨 → 503 graceful):

1. **엔드포인트 파라미터화** `resolveNhisEndpoint()`
   - `NHIS_API_URL`(완성 URL, 최우선) 또는 `NHIS_API_HOST`+`NHIS_API_PORT`+`NHIS_API_PATH` 조합.
   - **포트 확정 시 `NHIS_API_PORT` 한 값 교체만으로 활성** (티켓 §3 충족).
2. **인증 모델 pluggable** `resolveAuthMode()` + divergence guard
   - `NHIS_AUTH_MODE`: `bearer`(기본, 하위호환) | `cert-mtls` | `message-sign`.
   - `cert-mtls` 요청 시 → **503 `NHIS_AUTH_MTLS_UNSUPPORTED`** (오인 Bearer 호출 방지).
   - `message-sign` 요청 시 → **501 `NHIS_AUTH_SIGN_NOT_IMPL`** (규격 확정 후 구현).
3. **503 graceful 유지** — 엔드포인트/포트/인증 미확정 → `NHIS_NOT_CONFIGURED`.
4. **PHI 준수 유지** — RRN 마스킹(maskRrnInRaw)·decrypt-gate(rrn_decrypt RPC)·IDOR 가드 무변.
5. 단위테스트 8건 추가(resolveNhisEndpoint/resolveAuthMode) — 총 32 passed.

**secret 취급**: 공동인증서 5종+비밀번호는 macbook(domas) 로컬. prod Secrets 전송은
**supervisor deploy 게이트 경유**, git 커밋·로그 노출 금지(본 커밋에 cert 자산 미포함).

---

## 6. 파급 (planner 보고 대상)

feasibility 결과(특히 Deno mTLS 미지원)는 아래 재스코핑 트리거:
- **women** — NHIS-CREDS-WIRE
- **body** — INS-NHIS-EDGE-DEFER

동일 Deno Edge 런타임 제약을 공유하므로, cert-mTLS 전제라면 세 도메인 모두
"Edge Function 단독 활성 불가 → 대체 런타임/서명방식 재설계" 로 수렴.

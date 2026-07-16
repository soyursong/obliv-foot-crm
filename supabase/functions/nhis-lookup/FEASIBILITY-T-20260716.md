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

---

## 7. 포트 축(axis) 반전 — 프록시/포트는 "공단 지정값"이 아니라 "우리 접속모드 판별값" (2026-07-16 추가)

배경: 과장님이 공단과 통화 중 "우리가 프록시를 어떻게 셋팅했는지" 확인 요청받음.
공단이 프록시 종류 = **1443 / 1444 / 1454 중 하나**라고 안내.
→ 포트는 공단이 우리에게 배정하는 값이 아니라, **우리 접속(보안)모드에 따라 우리가 골라야 하는 값**이다.
아래 3개 항목은 read-only 조사이며 **prod 실활성 아님**.

### 7.1 항목① — 현재 EF/config 에 프록시·포트 설정이 실재하는가 → **없음 (사실 보고)**

레포 전수 조사(`supabase/`, `src/`, `config.toml`) 결과:

| 확인 대상 | 실재 여부 | 근거 |
|-----------|-----------|------|
| 아웃바운드 프록시(사이드카/HTTPS_PROXY 등) | ❌ 없음 | 프록시 설정·코드 전무 |
| `NHIS_API_PORT` 값 | ❌ 미설정 | 파라미터(`resolveNhisEndpoint`)만 존재, 값 없음 |
| `NHIS_API_URL` / `NHIS_API_HOST` / `NHIS_API_PATH` | ❌ 미설정 | 동상 |
| config.toml NHIS 섹션 | ❌ 없음 | 관련 항목 0건 |
| 커밋된 시크릿 값 | ❌ 없음 (정상) | 자산 노출 0 |

- 유일한 `1443` 문자열 = index.ts 주석의 **예시 URL** (`예: https://api.nhic.or.kr:1443/xxxx`) 뿐 — 실제 설정값 아님.
- 유일한 "proxy" 매치 = `user-lookup-by-email` EF의 Supabase auth scoped-proxy 패턴으로 NHIS와 무관.
- **귀결**: 현재 우리 셋팅은 **프록시·포트가 비어 있는 상태** → 조회 시 항상 `NHIS_NOT_CONFIGURED`(503). 즉 "우리가 프록시를 어떻게 셋팅했나"에 대한 사실적 답 = **"아직 설정한 것이 없다."**

### 7.2 항목② — 1443 / 1444 / 1454 각 포트의 접속 보안모드 + 우리 auth 기준 정답 포트 판별

우리 auth 실체(§1·§2) = **KICA 요양기관 공동인증서(client cert + private key) 수령** = 전송계층 상호인증(mTLS) 또는 메시지 전자서명 자산.
→ 정답 포트 = 공단 자격조회 접속 규격에서 **"요양기관 공동인증서 상호인증(양방향 SSL / client-cert mTLS)"** 전용으로 지정된 포트.

**단, 1443·1444·1454 중 어느 번호가 그 모드인지 공개 규격문서로 특정 불가.**
- 공개 검색(공단 EDI·요양기관정보마당·HIRA 등) — 세 포트의 보안모드 대조표 미공개(내부 기술문서/담당부서 소관).
- 근거: [국민건강보험 EDI](https://edi.nhis.or.kr/homeapp/wep/o/serviceGuide.do) · [요양기관정보마당](https://medicare.nhis.or.kr/) · [공동인증서 등록](https://edi.nhis.or.kr/homeapp/wep/o/certificateReg.do) — 공동인증서 접속은 확인되나 포트별 규격 미기재.
- **게이트 준수**: 포트 번호를 근거 없이 단정하지 않는다. 방향(공동인증서 → 양방향 SSL 전용 포트)만 확정, 번호 특정은 **공단 "수진자 자격조회 접속 규격문서" 필요**.

⚠ **더 중요한 상위 제약(§3 연결)**: 정답 포트가 client-cert mTLS 전용이라면, 그 번호가 무엇으로 확정되든 **Deno Edge 런타임이 client-cert 핸드셰이크 자체를 못 함**(§3 미지원). → 포트 확정만으로 EF 단독 활성 불가, 대체 런타임/프록시 사이드카가 여전히 선결. (message-sign 방식이면 포트는 표준 TLS여도 되나 서명규격 미확정 §4.)

### 7.3 항목③ — 과장님 공단 회신용 1줄 결론 (초안)

> **"저희 쪽은 아직 접속 포트를 정하지 않았습니다(현재 자격조회 연결 설정 자체가 비어 있는 상태입니다). 공동인증서로 접속하는 방식이라 세 개 중 '기관 공동인증서로 서로 확인하는(양방향) 전용 포트'가 저희에게 맞는 값입니다. 다만 1443·1444·1454 중 어느 번호가 그 방식인지는 공단의 '수진자 자격조회 접속 규격문서'로 최종 확인이 필요합니다 — 규격문서를 받을 수 있을까요?"**

(현장 발송은 responder 경유. 개발 용어 없음.)

### 7.4 잔여 외부확정 (responder 추적 중, 변동 없음)

1. 실엔드포인트 경로(`NHIS_API_PATH`) — 미확정
2. ~~포트~~ → 본 조사로 feasibility 산출물 재분류(외부확정 → 규격문서 확인건)
3. 자격조회 규격문서(= 항목② 번호 특정의 유일 근거) — 미수령

### 7.5 cross-product 전파

포트 축 반전 + "번호는 규격문서 필요" 결론은 **women / body 동일 전파** (§6 재스코핑 라인과 합류).

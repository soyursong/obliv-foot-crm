# 풋센터 CRM — 조회 전용 API OpenAPI 스펙

외부 파트너(doAI/월E) 연동용 **조회 전용(Read-only)** Edge Function OpenAPI 3.0 스펙 모음.

| 파일 | 대상 EF | 용도 |
|------|---------|------|
| `reservations-read-api.openapi.yaml` | `reservations-read-api` | 예약 조회 |
| `foot-calendar-read.openapi.yaml`    | `foot-calendar-read`    | 캘린더(예약) 조회 |

## 성격
- 티켓: `T-20260712-foot-READONLY-EXTERNAL-GRANT-APIDOC-BUILD` (Track A / Phase A)
  - 상위: `T-20260712-foot-DOAI-READONLY-API-OPENAPI`
- 각 EF 소스(`supabase/functions/{name}/index.ts`) 상단 JSDoc 헤더를 정규 OpenAPI 3.0 스펙으로 이관한 것.
- Scalar 등 API 문서 뷰어에 그대로 로드 가능. (호스팅은 월E 측 자체 진행 — 우리는 스펙 파일까지)

## Scalar 발행 (참고)
- [Scalar](https://scalar.com/) 등 OpenAPI 뷰어에 YAML 파일을 그대로 import 하면 문서가 렌더된다.
- 파일당 1개 API 문서.

## ⚠ 보안 스코프 (중요)
1. **PostgREST 자동생성 OpenAPI(`/rest/v1/`)는 외부 공유 금지.**
   테이블 직결 REST는 PHI 테이블 전체 스키마를 노출한다. 외부에는 본 커스텀 EF 스펙만 공유한다.
2. **server.url 의 `project_ref` 및 시크릿 실제 값은 이 스펙에 포함하지 않는다.**
   실제 URL·키 안전공유는 Phase B(data-architect CONSULT + CEO 게이트) 통과 후에만.
   스펙의 `servers[].variables.project_ref.default` 는 플레이스홀더(`YOUR_PROJECT_REF`)다.
3. **마스킹 기본 ON.** 두 EF 모두 고객명 첫 글자+`**`, 전화 끝 4자리(또는 완전 제거)만 노출한다.
4. `reservations-read-api` 의 내부 전용 파라미터 `include_full_pii`(전체 PII 반환)는
   **외부 계약 스펙에서 의도적으로 제외**했다. 외부 발급 시크릿으로 이 플래그가 동작하지 않도록
   서버측 게이트를 두는 것을 Phase B 권고사항으로 planner에 보고했다.

## 시크릿 헤더 (물리 분리)
| EF | 조회 헤더 | 비고 |
|----|-----------|------|
| reservations-read-api | `X-ReadAPI-Secret` | 쓰기 시크릿(`DOPAMINE_CALLBACK_SECRET`)과 분리 |
| foot-calendar-read    | `X-Foot-Read-Secret` | 쓰기 계열 시크릿과 분리 |

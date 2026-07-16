---
id: T-20260716-foot-CHART2-NHIS-LOOKUP-ENABLE
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
stage: feasibility-prep
prod_activation: blocked
created: 2026-07-16 13:32
completed: 2026-07-16
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 8
commit: pending
spec: supabase/functions/nhis-lookup/nhis-lookup.test.ts
build: pass
feasibility_verdict: cert-mtls_unsupported_on_deno_edge
followup: planner (mTLS 미지원 → women/body 재스코핑 트리거)
---

# T-20260716-foot-CHART2-NHIS-LOOKUP-ENABLE

NHIS 자격조회 REST API — feasibility / prep stage. **⚠ prod 실활성 아님.**

## 산출

- **feasibility 보고서**: `supabase/functions/nhis-lookup/FEASIBILITY-T-20260716.md`
- **EF prep 코드**: `supabase/functions/nhis-lookup/index.ts`
  - 엔드포인트 파라미터화(`resolveNhisEndpoint`) — 포트 확정 시 `NHIS_API_PORT` 1값 교체로 활성
  - 인증 모델 pluggable(`resolveAuthMode`) + divergence guard(cert-mtls→503, message-sign→501)
  - 503 graceful 유지 · RRN 마스킹/decrypt-gate/IDOR 가드 무변
- **단위테스트**: resolveNhisEndpoint/resolveAuthMode 8건 추가 (deno test 32 passed)

## feasibility 결론 (요약)

❌ **cert-mTLS (공동인증서 client-cert 전송계층 mTLS)는 Supabase Edge(Deno) 런타임에서 활성화 불가.**
- `Deno.createHttpClient`(unstable) 이 Deno Deploy/Edge Runtime 서브셋에 미노출.
- edge-runtime unstable 플래그 요청(issue #205) "not planned" close.
- → 대체 런타임(mTLS 프록시/사이드카) 또는 message-sign 방식 확인 필요.

상세: FEASIBILITY-T-20260716.md

## prod 실활성 게이트 (미충족)

포트+엔드포인트 확정(responder→planner) + auth 방식 확정 + feasibility 통과
+ 실환자 자격조회 1건 성공 → supervisor deploy 게이트.

## db_change

없음 (insurance_cert_no ADDITIVE 재사용). DA CONSULT 불요, 대표게이트 면제(autonomy §3.1), supervisor 게이트만.

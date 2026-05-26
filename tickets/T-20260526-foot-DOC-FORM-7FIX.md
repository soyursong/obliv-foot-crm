---
id: T-20260526-foot-DOC-FORM-7FIX
title: "풋센터 서류 양식 7종 누락·오류 수정 — 납입증명서 병원장 정보+날짜 완결"
domain: foot
priority: P2
status: in_progress
deploy_ready: false
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260526-foot-DOC-FORM-7FIX.spec.ts
commit: d23d8a7
created_at: 2026-05-26
completed_at: 2026-05-26
hotfix: false
deadline: 2026-06-02
reporter: 김주연 총괄
risk_verdict: GO_WARN
risk_reason: "2/5 — BL(주민번호 하이픈 포맷팅·도장 위치 로직 변경 — 의료서류 정확성 직결)"
qa_result: fail
qa_fail_reason: spec_missing
qa_fail_phase: precheck
related_tickets:
  - T-20260526-foot-DOC-FORM-REVISE
---

## 구현 요약

DOC-FORM-REVISE(8c65e8d) 후속 — 납입증명서 AC-7 잔여 2항목 완결.

### AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-7 ④ | 납입증명서 병원장 행 — `{{doctor_name}} {{doctor_seal_html}}` 추가. "병원장 : 문지은 (인)" 자동 표시 | ✅ |
| AC-7 ⑤ | 납입증명서 면책 문구 날짜 — "20   년   월" → `{{year}}년 {{month}}월` 자동기입 | ✅ |
| `npm run build` | 에러 0 (3.30s) | ✅ |

### 주요 변경 파일

- `src/lib/autoBindContext.ts` — buildAutoBindValues()에 month 바인딩 키 추가
- `src/lib/htmlFormTemplates.ts` — PAYMENT_CERT_HTML 병원장 행 + 날짜 수정

### 전체 AC 커버리지 (DOC-FORM-REVISE + DOC-FORM-7FIX 합산)

- AC-A (공통) 주민번호 하이픈: ✅ (8c65e8d)
- AC-B (공통) 도장 위치: ✅ (8c65e8d)
- AC-1 소견서 기입칸 5배: ✅ (8c65e8d)
- AC-2 통원확인서 필드 복원: ✅ (8c65e8d)
- AC-3 진료비계산서 수가+(인): ✅ (8c65e8d)
- AC-4 진료확인서 병명 정정: ✅ (8c65e8d)
- AC-5 진료의뢰서 4필드 자동기입: ✅ (8c65e8d)
- AC-6 진단서 병명 정정: ✅ (8c65e8d)
- AC-7 납입증명서 전항: ✅ (8c65e8d + d23d8a7)

---

## 후속 업데이트 — 2026-05-26 supervisor QA

### QA 결과: NO-GO (qa_fail_reason: spec_missing)

**검증 일시**: 2026-05-26 19:1x KST  
**검증자**: agent-fdd-supervisor

| 항목 | 결과 | 비고 |
|------|------|------|
| C1 env 매트릭스 | PASS | VITE_SUPABASE_URL / ANON_KEY 기존 변수만 사용, 신규 없음 |
| C2 E2E spec | **NO-GO** | `tests/e2e/T-20260526-foot-DOC-FORM-7FIX.spec.ts` 파일 부재, `e2e_spec_exempt_reason` null |
| C3 RLS/DB | N/A | db_change: false |
| C4 Cross-CRM | N/A | db_change: false |
| C5 빌드 | PASS | `✓ built in 3.40s` — 독립 검증 |
| C6 Lovable | N/A | Vercel 도메인 |
| C7 알림 큐 | PASS | C0ATE5P6JTH 확인 |
| Runtime Safety | PASS | formatRrn() null guard ✓, split()[1] ?? '' ✓, clinicDoctor?.seal_image_url ✓ |

**차단 사유**: DOC-FORM-7FIX 티켓 frontmatter에 `spec_file: tests/e2e/T-20260526-foot-DOC-FORM-7FIX.spec.ts` 선언됨.  
실제 파일 없음 (`ls` 확인). `e2e_spec_exempt_reason` 없음(null). deploy-precheck C2 NO-GO 규약 적용.

**FIX-REQUEST 발행**: dev-foot MQ → spec 작성 후 deploy-ready 재마킹 요청.

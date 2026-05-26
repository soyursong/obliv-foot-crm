---
id: T-20260526-foot-DOC-FORM-7FIX
title: "풋센터 서류 양식 7종 누락·오류 수정 — 납입증명서 병원장 정보+날짜 완결"
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
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

---
id: T-20260526-foot-DOC-FORM-REVISE
title: "풋센터 의료서류 7종 양식 수정 (주민번호 하이픈·도장 위치·개별 누락 수정)"
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260526-foot-DOC-FORM-REVISE.spec.ts
commit: 8c65e8d
created_at: 2026-05-26
completed_at: 2026-05-26
hotfix: false
deadline: 2026-06-02
reporter: 김주연 총괄
risk_verdict: GO_WARN
risk_reason: "2/5 — BL(주민번호 하이픈 포맷팅·도장 위치 로직 변경 — 의료서류 정확성 직결)"
related_tickets:
  - T-20260526-foot-DOC-FORM-7FIX
  - T-20260525-foot-DOC-AUTOBIND-REGRESS
---

## 구현 요약

의료서류 7종 양식 수정 (공통 2건 + 개별 7건) 완료.

### AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-C1 | 주민번호 하이픈 자동삽입 `123456-1234567` — formatRrn() 추가, 전 양식 적용 | ✅ |
| AC-C2 | 도장 위치 → 의사 성명 (인) 인라인 삽입 — doctor_seal_html 변수 | ✅ |
| AC-1 | 소견서: 소견 기입칸 min-height 100px → 500px (5배) | ✅ |
| AC-2 | 통원확인서: 병명 라벨 정정 + visit_days 자동 바인딩 복원 | ✅ |
| AC-3 | 진료비 계산서·영수증: (인) 네모칸 버그 → doctor_seal_html | ✅ |
| AC-4 | 진료확인서: "명명" → "병명" 라벨 정정 | ✅ |
| AC-5 | 진료의뢰서: referral_year/month/day, dept_name, referring_doctor 자동 바인딩 | ✅ |
| AC-6 | 진단서: "명명" → "병명" 라벨 정정 | ✅ |
| AC-7 (partial) | 납입증명서: 타이틀 중앙정렬, 상단 기입칸 제거, NO→진료과+dept_name | ✅ |
| `npm run build` | 에러 0 (3.30s) | ✅ |

### 주요 변경 파일

- `src/lib/autoBindContext.ts` — formatRrn(), rrn_front/rrn_back, visit_days, year 바인딩 추가
- `src/lib/htmlFormTemplates.ts` — 7종 양식 HTML 수정 (도장 인라인, 라벨 정정, 레이아웃 변경)

### Note
AC-7 나머지 (병원장 정보+날짜) → T-20260526-foot-DOC-FORM-7FIX (d23d8a7) 에서 완결.

---
id: T-20260607-foot-PROGRESS-TIMELINE-AUTHOR
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260607-foot-PROGRESS-TIMELINE-AUTHOR.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-07
deadline: 2026-06-14
reporter: 문지은 대표원장 (C0ATE5P6JTH / U0ALGAAAJAV)
---

# T-20260607-foot-PROGRESS-TIMELINE-AUTHOR — 경과타임라인 작성 의사명 표시

현장(문지은 대표원장): "좌측탭에 경과타임라인에도 작성한 의사가 다 보였으면해".
8-A(T-20260606-foot-MEDCHART-RECORDER-NAME, FE 배포됨)의 작성자(recorder/author) 소스를
재사용하는 read-only 표시 작업.

## AC-0 (검증 게이트)
경과 항목(medical_charts)에 작성자 식별자 저장 확인 → **있음**(`created_by` 이메일 + 8-A `created_by_name` 스냅샷).
→ DB 무변경, 표시만 추가. 작성자 필드 부재 아님 → FOLLOWUP 불요.
과거 무작성자(created_by NULL) 레코드는 recorder=null → 빈값(미렌더) 처리.

## 구현
- 8-A는 경과 타임라인 **collapsed 헤더**(MedicalChartPanel L1734 recorder / L1779)에만 기록자 표시 →
  **펼침(아코디언 expanded) 상세**(L1800~)엔 누락 상태였음.
- 펼침 상세 하단에 작성 의사 라인 추가(`data-testid=timeline-expanded-recorder`),
  8-A 표시규칙 동일 재사용: `recorder = created_by_name || recorderName(created_by)`.

## 검증
- build OK (3.51s)
- E2E: S1(AC-0 DB 식별자 조회) + S2 4케이스(우선/폴백/로컬파트/빈값 가드) — 6 passed
- DB변경: 없음 (FE read-only)
- commit e5121c5

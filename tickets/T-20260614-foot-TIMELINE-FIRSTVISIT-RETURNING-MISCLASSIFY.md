---
id: T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: d33c5c0c0d92
deployed_at: 2026-06-14T15:56:40+09:00
bundle_hash: pending-vercel
risk: GO_WARN
db_change: false
requester: 김주연 총괄 (스크린샷 F0BB8MJ7XEC)
owner: agent-fdd-dev-foot
deploy-ready: true
---

# 통합 시간표 초진 환자 재진 구역 오분류 교정

## 현상
초진 접수 환자가 통합 시간표(Timeline)에서 재진 구역에 표시 (스크린샷 F0BB8MJ7XEC, 김주연 총괄).

## AC-1 [선행 게이트] 근본 시나리오 확정 — 시나리오 A (데이터 증거)
READ-ONLY 진단(`scripts/T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY_diag.mjs`), 종로 최근 14일 실측:
- **시나리오 A: 7건** — `check_ins.visit_type='new'` 인데 매칭 `reservation.visit_type='returning'`.
  타임라인 routing(Dashboard.tsx 예약 루프)이 `r.visit_type` 우선 → 초진 체크인을 재진 구역에 배치.
  최신건: 김철수 2026-06-14(오늘, 스크린샷 시점 일치), 안서준 06-09, 복숭아 06-06 등.
- 시나리오 B: 4건은 역방향(ci=returning ↔ r=new)으로 버그 리포트("초진→재진")와 무관한 별개 케이스.
- 시나리오 C(예약 자체 오설정=DB 정합) **아님**: 체크인의 'new'가 현장 접수 시점의 권위 분류.
  예약 데이터 변경 불필요 → db_change=false.

## AC-2 Fix (Option A, 표시 routing only)
- `src/lib/timeline-routing.ts` — `timelineVisitType(ci?.visit_type, r.visit_type)` 순수 함수 신규.
- `Dashboard.tsx` 예약 루프: `effVisitType = timelineVisitType(ci?.visit_type, r.visit_type)`.
  매칭 체크인 있으면 ci.visit_type 우선, 없으면 r.visit_type 폴백(기존 동작 유지).
- 워크인 분기(이미 `ci.visit_type` 사용)와 동일 기준 → 매칭/워크인 일관.
- DB 변경 없음.

## AC-3 회귀 0
- 정상 재진(ci=returning) 재진 구역 유지. 정상 초진(ci=new, r=new) 초진 구역 유지.
- 체크인 없는 예약(셀프접수 전): r.visit_type 폴백 유지.
- experience(체험): 기존 2분기(else=재진측) 동작 보존.

## AC-4 E2E
`tests/e2e/T-20260614-foot-TIMELINE-FIRSTVISIT-RETURNING-MISCLASSIFY.spec.ts`
4조합(초진/재진 × 매칭/워크인) + 일관성 + 폴백 + experience 회귀 + 라이브 렌더 스모크 = **9 PASS**.

## 빌드/배포
- `npm run build` OK. 분류 spec 8 PASS + 라이브 스모크 1 PASS.
- commit d33c5c0c0d92 → main push → Vercel 자동 배포.

## 게이트 노트
- db_change=false (Option A 표시 routing). 시나리오 C 아님 확정 → supervisor db-gate 재판정 불요.
- 리스크 GO_WARN.

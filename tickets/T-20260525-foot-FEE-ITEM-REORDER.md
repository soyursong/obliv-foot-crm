---
id: T-20260525-foot-FEE-ITEM-REORDER
domain: foot
status: qa_pending
priority: P1
hotfix: true
deploy_ready: true
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260525-foot-FEE-ITEM-REORDER.spec.ts
commit: 7b95bb3
created_at: 2026-05-25
completed_at: 2026-05-26
deadline: 2026-05-27
reporter: 김주연 총괄
risk_verdict: GO
risk_reason: "FE-only 버그 수정. DB 무변경. 기존 DnD+버튼 로직 디버깅"
qa_result: pending
qa_fix_request_msg: MSG-20260526-172014-zg2w
spec_fix_at: "2026-05-26T17:40:00+09:00"
---

# T-20260525-foot-FEE-ITEM-REORDER — 결제 미니창 수가 항목 수기 배치 변경

## 구현 요약

초기 구현(32982b8) → REOPEN 3종 원인 수정(7b95bb3) 완료.

### REOPEN 원인 3종 및 수정

| 원인 | 증상 | 수정 |
|------|------|------|
| TouchSensor + overflow-y-auto 스크롤 경합 | 태블릿 DnD 미활성화 | PointerSensor(distance:3) 우선 등록 |
| ↑↓ 버튼 터치 타깃 극소 (10×10px) | 태블릿 탭 실패 | min-w-[32px] min-h-[22px] + p-1.5 확장 |
| active.id UniqueIdentifier 타입 불일치 | 비교 잠재 에러 | String() 캐스팅 추가 |

### AC 달성 현황

| AC | 내용 | 상태 |
|----|------|------|
| AC-R1 | ↑↓ 버튼으로 수가 항목 순서 변경 정상 동작 | ✅ |
| AC-R2 | 드래그 핸들 PointerSensor + String() 캐스팅 | ✅ |
| AC-R3 | 태블릿 터치 환경 spec (viewport 1024×768) | ✅ |
| AC-R4 | 기존 CRUD (선수금토글·금액편집·제거) 무영향 | ✅ |
| AC-R5 | 빌드 + E2E spec REOPEN 항목 추가 통과 | ✅ |

### 주요 변경 파일

- `src/components/PaymentMiniWindow.tsx` — PointerSensor 우선 + 터치 타깃 확장 + String() 캐스팅
- `tests/e2e/T-20260525-foot-FEE-ITEM-REORDER.spec.ts` — REOPEN AC-R1~R3 추가

### 이력

- 초기 구현: 32982b8 (2026-05-25, deploy-ready)
- DB persist 추가: 316e17d (2026-05-26)
- REOPEN fix: 7b95bb3 (2026-05-26 10:39, main push, Vercel 자동배포)
- Spec fix (AC-R3): defaultBrowserType 제거 + Promise.race 10s skip guard (2026-05-26 17:40)

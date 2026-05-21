---
id: T-20260522-foot-RESV-TREAT-HISTORY
title: "재진 예약 등록 팝업 — 고객 선택 시 시술내역 표시"
status: deployed
deploy-ready: true
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-28
completed_at: 2026-05-22
commit_sha: 878c79b
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260522-foot-RESV-TREAT-HISTORY.spec.ts
risk: GO
assignee: dev-foot
source: planner MSG-20260522-024512-x24t
reporter: 김주연 총괄 (U0ATDB587PV)
---

# T-20260522-foot-RESV-TREAT-HISTORY

재진 예약 등록 팝업에서 기존 고객 선택 시 구매패키지 시술내역(패키지명·회차·치료명·시술일) 요약 표시.
전화 통화 중 예약창만 보고 바로 답변 가능하도록.

## AC 체크리스트

- [x] AC-1: 고객 선택 시 시술내역 영역 즉시 표시 (신규 등록 시 미표시)
- [x] AC-2: 패키지명|회차(N/M)|치료명|시술일 4컬럼. 시술일 내림차순. 최근 10건+더보기
- [x] AC-3: 기존 시술내역과 동일 소스 (package_sessions + packages 재사용)
- [x] AC-4: 로딩 스피너 + 이력 없음 안내 문구
- [x] AC-5: 예약 저장·초진/재진 토글·예약메모 회귀 없음

## 구현 내역

- `Reservations.tsx` L1162: TreatHistoryRow interface 추가
- L1198~1201: treatHistory / treatHistoryLoading / treatHistoryShowAll state
- L1334~: selectedCustomerId useEffect — package_sessions + packages 조인 쿼리
- L1759~: JSX 시술내역 섹션 (로딩 스피너·빈 목록 안내·최근 10건+더보기 toggle)
- E2E spec: tests/e2e/T-20260522-foot-RESV-TREAT-HISTORY.spec.ts (250줄)

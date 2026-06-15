---
id: T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP
title: "[진료대시보드] 이름 아래 메모 텍스트 제거 → 상태셀 빨간 종 아이콘 + hover 전문 툴팁"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 08ce14a4
created: 2026-06-15
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-154359-ydzr
risk_verdict: GO
slack_channel: foot
slack_thread_ts: "1781502656.774439"
slack_mention_user: U0ALGAAAJAV
---

# T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP

## 증상 / 요청
진료대시보드(DoctorCallDashboard) 환자 행에서 이름 아래에 전달사항 메모가 텍스트로 길게
노출되어 행 높이를 키우고 가독성을 해침. 메모가 있다는 사실만 미니멀하게 알리고, 전문은
hover 시에만 보이도록 정리 요청.

> ⚠ 필드 명칭: reporter는 "예약메모"라 불렀으나 이름 아래 현재 노출 중인 건
> `doctor_call_memo`(전달사항 메모)다. 이것이 작업 대상. `booking_memo`(DoctorPatientList의
> 메모 컬럼)는 다른 화면이라 미접촉.

## 수정
`src/components/doctor/DoctorCallDashboard.tsx` (CallFeedRow):
- 이름 셀 아래 `📋 {checkIn.doctor_call_memo}` 텍스트 노출 제거 (AC4)
- 신규 `MemoBell` 컴포넌트: 빨간 미니멀 종(`<Bell className="text-red-500">`) + hover 시
  group-hover CSS 툴팁(`whitespace-pre-wrap`, `max-w-[18rem]`)으로 메모 전문 잘림 없이 표시
- 상태 셀(✋ HandToggle / 진료완료 텍스트 옆) span 말미에 `checkIn.doctor_call_memo && <MemoBell .../>`
  조건부 렌더 → 메모 有 행만 아이콘, 無 행 미표시 (AC1/AC3/AC5, active·inactive 공통 분기)
- 신규 의존성 0 (`Bell`은 기존 lucide-react import 재사용)

## 비범위 (불변)
- DB / SELECT 컬럼 (`doctor_call_memo` SELECT 그대로) — 메모 소스 불변
- ✋ HandToggle / 진료완료 버튼 동작 — 시각 추가만, 로직 불변
- DoctorPatientList `booking_memo` 미접촉
- foot 전용

## AC 검증
- AC1 메모 有 → 상태셀(✋)옆 빨간 종: ✅ S1 실DOM + S3 소스 가드
- AC2 hover → 메모 전문 툴팁(잘림 0): ✅ S1 실 Chromium hover 토글 + whitespace-pre-wrap + scrollWidth 미초과
- AC3 메모 無 → 아이콘 미표시: ✅ S2 실DOM (count 0)
- AC4 이름 아래 텍스트 제거: ✅ S3 (📋 라인 잔존 0)
- AC5 진료완료(inactive) 동일 규칙: ✅ 상태 span 공통 말미 렌더
- AC6 실브라우저 렌더: ✅ page.setContent 실 Chromium hover 토글 동작 검증 (빌드/lint 외)

## 테스트
- `tests/e2e/T-20260615-foot-DOCDASH-MEMO-ICON-TOOLTIP.spec.ts` (unit 프로젝트, 7 PASS)
- `npm run build` ✓ built (green)

## 배포 후
- 배포: main 08ce14a4 push → Vercel 자동
- field-soak: supervisor GO 후 #foot thread 1781502656.774439 reporter(U0ALGAAAJAV) 멘션 회신

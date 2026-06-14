---
ticket_id: T-20260614-foot-THEME-MONOCHROME-RECOLOR
domain: foot
priority: P2
status: awaiting-field-confirm
requester: 김주연 총괄 (U0ATDB587PV)
thread: C0ATE5P6JTH / 1781364123.025179
risk: GO_WARN
owner: agent-fdd-dev-foot
stage_done: [StepA, StepB]
stage_pending: [StepC-field-confirm, StepD-apply]
deploy-ready: false
---

# 전역 색상 테마 모노톤 리컬러

풋센터 CRM 전역 색상을 모노톤(화이트/그레이/블랙) + 베이지/브라운 포인트로 리컬러.

## StepA — 토큰 위치 + 하드코딩 green 전수 리스트업 (완료)

### 토큰 정의 위치
- `tailwind.config.js` — primary/secondary/accent/muted 등은 `var(--*)` CSS 변수 참조 (단일출처)
- `src/index.css` `:root` — **이미 모노톤**(oklch chroma 0). `.theme-brown`(셀프체크인용)·`.dark`는 브라운 톤 존재.
- ⚠ **현장이 보는 "초록"은 토큰이 아니라 하드코딩된 Tailwind 유틸 클래스**(`text-teal-600` 등). 토큰 단일출처 교체만으로는 사라지지 않음 → 클래스 sweep 필요.

### 하드코딩 green-family 전수 (src/, *.tsx/ts/css)
| 색상군 | 건수 | 파일수 | 성격 |
|--------|------|--------|------|
| teal-* | 1042 | 102 | 브랜드 메인(대부분 장식: text/bg/border/hover/focus) |
| emerald-* | 147 | 44 | 일부 브랜드 + 일부 의미색(레이저·재진·success 뱃지) |
| green-* | ~105 | — | 대부분 의미색(선체험 플래그·치료사 역할칩·완료) |
| lime-* | 0 | 0 | 없음 |

shade 분포 top: teal-600(404) · teal-700(364) · teal-50(305) · teal-500(132) · teal-100(110) · teal-800(87) · teal-200(85) · emerald-700(75) · teal-400/300(67)
prefix 분포(teal): text 614 · bg 394 · border 343 · hover:bg 164 · focus:ring 29 · ring 20 → **압도적으로 장식 용도**

### ⚠ AC4 충돌 지점 (의미색으로 carve-out 필요)
`src/lib/status.ts`:
- `STATUS_COLOR.treatment_waiting` = teal-100/800, `.preconditioning` = teal-400, `.laser` = emerald-500 — **칸반 11단계 레인보우의 일부**
- `VISIT_TYPE_COLOR.returning` = emerald (재진 구분)
- `STATUS_FLAG.green` = '선체험' (플래그 이름 자체가 green)
- `STAFF_ROLE_CARD_CLASS.therapist` = green (역할칩)
`src/components/ui/badge.tsx`: `success`=emerald, `teal` variant

→ 이들을 전부 brown으로 바꾸면 단계/유형 구분이 무너짐(AC4 위반). **브랜드 장식 teal/emerald만 리컬러, 의미색 레인보우는 유지** 권장.

## StepB — 베이지/브라운 팔레트 제안 (확정 아님, 컨펌 요청)

레퍼런스 #C4A882 / #8B6F47 앵커한 50~900 warm 램프:

| shade | HEX | 용도 |
|-------|-----|------|
| 50  | #FAF6F0 | 연한 배경 (teal-50 대체) |
| 100 | #F1E9DD | 연한 뱃지/배경 |
| 200 | #E3D5C0 | 보더/구분선 |
| 300 | #D2BD9F | 보조 보더 |
| 400 ★ | #C4A882 | 보조 포인트(밝은 강조) |
| 500 | #AB8C63 | 중간 톤 |
| 600 ★ | #8B6F47 | **주 포인트**(활성탭·CTA·강조) — teal-600 대체 |
| 700 | #6F583A | 강조 텍스트/hover |
| 800 | #54432C | 진한 텍스트 |
| 900 | #3A2E1E | 최진 강조 |

모노톤 베이스(이미 토큰화·유지): White #FFFFFF · Gray100 #F5F5F5 · Gray200 #E5E5E5 · Gray400 #A3A3A3 · Gray600 #525252 · Gray800 #262626 · Near-Black #171717

포인트 절제(AC2): 활성탭·CTA·핵심뱃지·강조링크만 brown, 그 외 모노톤.

스샷: `evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR/palette-proposal-stepB.png`

## StepC — 김주연 총괄 컨펌 게이트 (대기 중)
컨펌받을 항목:
1. 베이지/브라운 램프 HEX 확정 (위 표 그대로? 또는 600/400 조정?)
2. 의미색 레인보우(칸반 단계·재진·선체험 플래그) **유지 동의** 여부 — 포함 원하면 별도 매핑 필요
**컨펌 전 StepD 전역배포 금지.**

## StepD — 확정 HEX 적용 (미착수)
- brand 토큰(`brand-50..900`) 추가 → teal-*/emerald-*(장식분) sweep 치환
- 의미색 carve-out 유지
- 하드코딩 green 잔존 0 검증 (AC3)
- 주요화면 실브라우저 스샷 (AC5)

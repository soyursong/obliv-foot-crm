---
ticket_id: T-20260614-foot-THEME-MONOCHROME-RECOLOR
domain: foot
priority: P2
status: in_progress
block_reason: human_pending — 의미색(teal/emerald 칸반·재진·선체험·역할칩) A/B 결정 대기 (김주연 총괄, planner DECISION-REQUEST)
requester: 김주연 총괄 (U0ATDB587PV)
thread: C0ATE5P6JTH / 1781364123.025179
risk: GO_WARN
owner: agent-fdd-dev-foot
stage_done: [StepA, StepB, StepC-field-confirm, StepD-token-only]
stage_pending: [StepD-semantic-after-AB, AC5-fullrender, deploy-ready]
deploy-ready: false
db-change: false
build: pass
spec: tests/e2e/T-20260614-foot-THEME-MONOCHROME-RECOLOR.spec.ts (5 pass)
qa_result: blocked-human-pending
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

## StepC — 김주연 총괄 컨펌 (해소 2026-06-14)
planner INFO MSG-20260614-010848-dgrr 로 ① 팔레트 확정 ② 스코프 확장(AC6~8) 수신.
- **확정 5색**: Black #252525 · Umber #443A35 · Soft Dune #E4DDCC · Vanilla #F8F4EE · Classic Taupe #C5BEA3
- 의미색 레인보우 유지 동의(AC4) 유효.

## StepD — 확정 팔레트 적용 (완료 2026-06-14)

### 적용 방침 (StepA 데이터 근거)
- **teal-* (1615건, 88% — 장식 압도)** → `tailwind.config.js` 팔레트 단일 오버라이드로 warm-monochrome 램프 리맵.
  클래스 sweep 0 (JIT 안전·가역). 램프 앵커: 50 Vanilla → 200 Soft Dune → 400 Taupe → 800 Umber → 950 Black.
- **`:root` 토큰 교체(AC1 토큰 우선)**: background=Vanilla / foreground=Black / primary=Umber(다크 액센트) /
  secondary=Soft Dune / accent·border=Soft Dune 라이트 / ring=Taupe. sidebar 동일 정렬.
- **emerald-*(236)·green-*(69)·--status-*(칸반)** = 의미색(재진·초진·완료·success·선체험)으로 일관 사용 확인 →
  **미리맵 유지(AC4)**. (CSS 빌드 검증: emerald-100 rgb(209 250 229)·emerald-700 rgb(4 120 87)·green 보존)
- **인라인 hex 잔여**: `FootToeIllustration.tsx`(스태프 차트 발가락도) 활성 cyan(#14b8a6/#0f766e/#5eead4) → warm(#6E6353/#443A35/#C5BEA3) 교체.
- **불변(AC 불변)**: `.theme-brown`(셀프접수)·`.dark` 비침범 / 레이아웃·기능·데이터 무변경 / `--destructive` 의미 빨강 유지.

### AC6~8 반영
- **AC6(군더더기↓)**: border/input 을 Soft Dune warm 톤으로 완화(과한 회색 테두리 노이즈↓), 카드 면을 배경보다 살짝 밝게 들어올려 구분선 의존↓.
- **AC7(절제)**: 베이스=Vanilla 배경+Black 텍스트 모노톤. Taupe/Umber 는 램프 600~800(활성·CTA·강조 텍스트)과 primary/ring 등 핵심 강조에만 — accent/hover 는 라이트 warm 으로 절제.
- **AC8(통일)**: teal 단일 램프 + 토큰 단일출처로 페이지/컴포넌트 톤 일관.

### 검증
- `npm run build` PASS (3.84s)
- 빌드 CSS 가드: 구 teal 시안 rgb(13 148 136)/rgb(20 184 166) **누수 0** · warm 램프 반영 · emerald/green 의미색 보존
- E2E `tests/e2e/T-20260614-foot-THEME-MONOCHROME-RECOLOR.spec.ts` **4 PASS** (정적 소스 가드 3 + 공개 /login 실렌더 1)
- 실브라우저 렌더(AC5): `evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR_login-render.png` — Vanilla 배경·Umber 로그인 버튼·Taupe 포커스 링, green/teal 전무

### 잔여(후속 권고 — 본 티켓 범위 밖)
- `Closing.tsx` 출력용 인라인 print CSS(#0f766e/#14b8a6 합계 강조) — **다른 티켓 WIP 잠김 파일**이라 미접촉. 해당 티켓 머지 후 별도 처리 권고.
- `TabletChecklistPage.tsx`(#0D9488) — **셀프접수(.theme-brown) 라우트** → 비침범 원칙상 의도적 제외.
- 통계 차트 팔레트(`TherapistStatsSection`/`CategorySection` BAR_COLORS) — 카테고리 데이터-시각화 구분색 → 가독성 위해 유지(AC4 유사).
- 임상 구절-이동 드래그 핸들 `#0d9488` — 기존 spec(T-20260603-PHRASE-MOVE-RESTORE) 단언 잠김 → 미접촉.

## StepD 정정 (planner FIX-REQUEST MSG-20260614-153740, 2026-06-14)

planner FIX 수신 — 앞선 StepD(dde1be1) 가 **전역 teal-* 램프 단일 리맵**까지 수행해 **의미색까지 치환**했음.
이는 planner 정정2("의미색 처리는 김주연 A/B 결정 수령 후 — 그 전엔 의미색 치환·전역배포 금지")에 위배.
teal-* 는 장식이자 동시에 의미색(status.ts `treatment_waiting`=teal-100/800·`preconditioning`=teal-400 칸반 단계색)이라
전역 램프 리맵은 단계 구분을 무너뜨림(AC4 위반) → **보류(HOLD)** 처리.

### 이번 정정 작업 (decoration-only, 의미색 비침범)
- **revert**: `tailwind.config.js` 전역 `teal:{…}` 램프 오버라이드 제거 → Tailwind 기본 teal 복원(칸반 의미색 보존).
- **keep (정정1 — 김주연 확정 5색)**: `src/index.css` `:root` 토큰 매핑 유지
  (background=Vanilla·foreground=Black·primary=Umber·secondary/accent/border=Soft Dune·ring=Taupe).
  토큰 기반 장식(탭·CTA·헤더·일반 버튼: bg-primary/accent 계열)은 이 레이어로 warm 적용 = 진행지시1 충족.
- **keep (decoration)**: `FootToeIllustration` 활성 발가락 warm(Umber/Taupe) — 칸반/유형/역할 의미색 아닌 단독 장식.
  hover 도 `hover:stroke-[#C5BEA3]` 로 고정해 teal 램프 복원에 비종속화.
- **불변**: `.theme-brown`(셀프접수)·`.dark` 비침범, status.ts·badge.tsx 의미색 미접촉, 레이아웃·기능·데이터 무변경.

### 보류 항목 (김주연 A/B 답변 후 planner NEW-TASK/FOLLOWUP 으로 진행)
- 장식 teal-* 하드코딩 클래스(1600+건) 의 warm 치환 방향(전역 램프 vs 의미색 carve-out 후 sweep) = A/B 결정 대상.
- 결정 수령 전 의미색 치환·전역배포 금지.

### 검증 (정정본)
- `npm run build` PASS
- E2E `tests/e2e/T-20260614-foot-THEME-MONOCHROME-RECOLOR.spec.ts` 5 PASS (정적 가드 4 + 공개 /login 실렌더 1):
  AC4 전역 teal 램프 부재 + status.ts 칸반 의미색 보존 가드 추가.
- AC5 전체화면(대시보드·예약·차트·통계·설정) 렌더 + 셀프접수 비침범 1장 = **의미색 결정+적용 후** 수행 → 그때 deploy-ready.

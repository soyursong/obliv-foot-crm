---
id: T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 55df0b98
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
summary: "예약관리 day-view '실시간 반영'(현재시각 컬럼 isNow) 표현 2종. 순수 FE/CSS, DB 무변경. [건1·버그] 노란 ring-amber-400(box-shadow)이 부모 overflow-x-auto(→overflow-y auto 계산)에 좌·하단 짤림(10:00=첫 컬럼). RC=box-shadow ring은 overflow 조상에 클립됨 → ring 제거, border(박스모델 내부, 절대 비클립)로 전환해 근본 해소. [건2·UX] 노랑 제거 → 실버 #BBBBBB border + 테두리 깜빡임(@keyframes live-border-pulse: border-color #BBBBBB↔#E5E7EB 1.4s ease-in-out, motion-safe 폴백). 헤더 bg-amber-50 → bg-slate-100. 충돌확인: isNow=ring-amber/bg-amber, 힐러=bg-healer-50(#FFFDE7) → 클래스 완전 분리(분리 케이스) → 힐러 미접촉. border-color만 애니메이션(box-shadow 아님)이라 부모 overflow 클립 비유발. build 5.34s OK. spec 3종(S1 ring-amber 0건/S2 실버#BBBBBB+pulse+헤더 slate, amber 잔재0/S3 힐러 bg=rgb(255,253,231) 불변+콘솔에러0) PASS. 동일영역 회귀 6/6 PASS."
created: 2026-06-30
assignee: dev-foot
---

# T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX — 예약관리 실시간 반영 실버·펄스 + 짤림 해소

## 현장
김주연 총괄(C0ATE5P6JTH 풋센터, 2026-06-30, 스크린샷 F0BEVLJN7TJ): 예약관리 day-view
"실시간 반영"(현 노란색) 2건. (1) 10시 타임슬롯에서 색상 짤림(overflow). (2) 노란색 →
실버/그레이 + 레이아웃 테두리에 깜빡깜빡(pulse). FE-only, DB 무변경.

## 현상 확인 (스크린샷 F0BEVLJN7TJ — 봇 다운로드)
- "실시간 반영" = day-view에서 **현재 시각 컬럼(isNow)** 의 노란 테두리.
- 10:00 컬럼(첫 컬럼)의 노란 ring이 좌·하단에서 짤려 보임.

## 충돌 확인 (착수 전 필수 — 완료)
- 실시간 indicator(isNow): `Reservations.tsx` L1955 `ring-1 ring-amber-400` + 헤더 L1965 `bg-amber-50`.
- 힐러 노랑: `bg-healer-50`(#FFFDE7, healer 토큰, T-20260625 carve-out) — **별개 클래스**.
- → **분리 케이스**: 실시간 indicator만 실버 교체, 힐러 `#FFFDE7` 미접촉 가능. (CSS 클래스 공유 0)

## 근본원인 (건1·짤림)
- isNow 컬럼은 `ring-1 ring-amber-400`(= box-shadow 기반 ring). 부모 `resv-day-xaxis`가
  `overflow-x-auto` → CSS 규칙상 overflow-y가 `auto`로 계산됨. box-shadow(ring)는 overflow 조상에
  의해 **클립됨** → 첫 컬럼(10:00) 좌측 + 컬럼 하단의 ring이 잘림.

## 작업
1. **건1·건2 동시 해소**: isNow `ring-1 ring-amber-400` → `border-2 border-[#BBBBBB]`
   - ring(box-shadow, 클립 대상) → border(박스모델 내부, 절대 비클립) 전환 = 짤림 근본 해소.
   - box-sizing:border-box(preflight)라 `w-[90px]` 외곽폭 불변(border-2가 내부 1px 점유).
   - `full && 'border-red-200'` → `full && !isNow` 로 우선순위 정리(현재시각 indicator 우선).
2. **건2·실버 펄스**: tailwind `@keyframes live-border-pulse`(border-color `#BBBBBB`↔`#E5E7EB`,
   1.4s ease-in-out infinite) 신설 + `motion-safe:animate-live-border-pulse` 적용.
   - reduced-motion 환경: 정적 실버 `#BBBBBB` border 폴백.
   - border-color만 애니메이션(box-shadow 아님) → 부모 overflow 클립 **비유발**.
3. **헤더 실버**: 현재시각 헤더 `bg-amber-50` → `bg-slate-100`.

### 변경 파일
- `tailwind.config.js`: keyframes/animation에 `live-border-pulse` 추가.
- `src/pages/Reservations.tsx`: day-view 컬럼 isNow border 전환(L1955) + 헤더 bg(L1965).
- `tests/e2e/T-20260630-foot-RESVMGMT-LIVEINDICATOR-SILVER-PULSE-CLIPFIX.spec.ts`: 신규 회귀 spec.

## 검증 (desktop-chrome, 실백엔드 인증)
- S1 ✓ 클립해소: day 시간 컬럼에 `ring-amber-400`(짤림 유발 box-shadow) 클래스 **0건**.
- S2 ✓ 실버·펄스: 현재시각 컬럼 `border-[#BBBBBB]` + `animate-live-border-pulse` 보유, amber 잔재 0,
  헤더 `bg-slate-100`(`bg-amber-50` 잔재 0). (현재시각=영업시간 내 today, 컬럼 실재 검증됨)
- S3 ✓ 힐러보존: `.bg-healer-50` 실제 배경 = `rgb(255,253,231)`(#FFFDE7) 불변 + 그리드 정상 + 콘솔에러 0.
- 회귀 ✓ 동일영역 6건(CANCELNAME-REGISTRANT-2FIX, DAILY-DEFAULT-HORIZ) PASS.
- build 5.34s OK.

## AC 대응
- ①10시 슬롯 짤림 없음 → ring→border 전환(box-shadow 클립 제거).
- ②실버(노랑 제거)·힐러와 명확 구분 → `#BBBBBB`/`bg-slate-100` vs 힐러 `#FFFDE7`(별개 토큰).
- ③테두리 pulse 동작 → `animate-live-border-pulse`(border-color blink).
- ④힐러 `#FFFDE7` 미접촉 → healer 토큰 무변경(S3 색상 invariant).
- ⑤콘솔에러0·회귀없음 → S3 콘솔 0 + 회귀 6/6 PASS.

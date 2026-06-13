---
id: T-20260614-foot-CALLLIST-DOCCALL-3FIX
title: "[진료콜] 명단 중복 위치배지 제거 + 지정콜/전체콜 버튼 정리 3건"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 1399473
created: 2026-06-14
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260614-011004-mblw
risk_verdict: GO
---

# T-20260614-foot-CALLLIST-DOCCALL-3FIX

## 핵심 결론
진료콜 명단 위젯(DoctorCallListBar) 현장 피드백 3건을 FE 렌더 레이어에서 정리. DB 무변경.
스크린샷: ~/file_inbox/20260614/005830_direct_20260614_005316.png

## 변경 내역
| # | 유형 | 내용 | 구현 |
|---|------|------|------|
| 1 | 버그 | 위치 배지 중복 "📍 치료실·C1" + "🏛 C1" 동시 → 배지 1개 | standalone 방 배지(`doctor-call-room`) 제거. 위치 배지(`doctor-call-location`)가 입실 단계에서 `getCurrentLocationLabel`='치료실 · C1'로 방번호 단독 운반 |
| 2 | UI | 환자 행 우측 전화기(📞) 아이콘 제거 + 핸들러 dead code 정리 | `doctor-call-select`(지정콜) 버튼 제거 + onSelect prop 제거 |
| 3 | UI | 상단 우측 '전체콜' 버튼 제거(숨기기/펼침 화살표 유지) | `doctor-call-all` 버튼 제거 (+ 무용해진 `doctor-call-clear` '해제' 동반 제거) |

### dead code 정리 (#2·#3 파생)
- #2·#3로 콜 하이라이트 메커니즘의 두 진입점(전체콜·지정콜)이 모두 소멸 → `allCall`/`selectedId` state·관련 useEffect·`highlighted` prop·"호출 중"(`doctor-call-calling`) 표시가 dead code화 → 일괄 정리.
- 미사용 import 제거: `Phone`, `X`, `DoorOpen` (lucide), `getAssignedSlotName` (checkin-slot, 이 파일 직접 사용처 소멸 — `getCurrentLocationLabel` 내부에서만 호출).

### 충돌 처리 (planner ⚠ 직렬 게이트)
- in_progress T-20260611-foot-CALLLIST-ROOM-LABEL과 **동일 배지 렌더 경로**. ROOM-LABEL이 그린 standalone 방 배지가 위치 배지의 방번호와 중복 → 본 티켓이 ROOM-LABEL 결과 위에서 dedup, **standalone 방 배지를 제거**해 최종 위치 배지 정확히 1개로 수렴.
- ROOM-LABEL의 핵심 의도(치료실 방번호 노출)는 `getCurrentLocationLabel`의 `치료실 · C1` 폴딩이 그대로 충족 → 기능 손실 없음.

## 불변(무회귀)
명단 자동 표시·메모 저장/조회·이름→차트·위치/힐러/재진 배지·행 숨김(자동 재노출)·드래그 위치·접기/펼치기·전체숨기기 전부 불변.

## 검증
- `npm run build` PASS (3.94s)
- `tsc -b` (noUnusedLocals/noUnusedParameters true) PASS — 미사용 잔존 0
- E2E spec: 신규 `T-20260614-foot-CALLLIST-DOCCALL-3FIX.spec.ts`(#1 로직 폴딩 1회 + #1·#2·#3 DOM 부재/잔존 가드) + 회귀 갱신 3종(ROOM-LABEL dedup, VERTICAL-FULLNAME 콜버튼 부재, ROW-HIDE 전체콜 부재). `playwright --list` 20 tests 정상 발견.
- DB변경: 없음 (FE 렌더만, 신규 컬럼/테이블/enum 0 → CONSULT §S2.4·DB게이트 불요)

commit 1399473 → main push (Vercel 자동배포)

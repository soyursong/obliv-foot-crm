---
id: T-20260610-foot-CALLLIST-DRAGGABLE-POSITION
domain: foot
priority: P1
status: deploy-ready
title: 진료콜 명단 팝업 드래그 자유배치 + 위치 영속 (위치 정책 canonical)
created: 2026-06-10
assignee: dev-foot
reporter: 김주연 총괄
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260610-foot-CALLLIST-DRAGGABLE-POSITION.spec.ts
spec_file: tests/e2e/T-20260610-foot-CALLLIST-DRAGGABLE-POSITION.spec.ts
commit_sha: 4ae026d
converges-with: [T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS]
supersedes-policy: [T-20260609-foot-CALLLIST-VERTICAL-FULLNAME(top-4 위치 앵커 정책)]
---

# T-20260610-foot-CALLLIST-DRAGGABLE-POSITION — 진료콜 명단 팝업 드래그 이동

## 배경 / 현장 요청 (김주연 총괄, 긴급)
`DoctorCallListBar` 팝업이 `fixed top-4 right-4`(VERTICAL-FULLNAME deployed)로 **우상단 액션 버튼들을 가림**.
요구: **위치 고정 폐기 → 개인이 헤더를 잡고 드래그로 자유 배치 + 위치 영속**.

## ⚠️ Convergence (중요 — planner 합치 필요)
본 티켓의 요구 구현은 **이미 라이브 배포됨**: `T-20260610-foot-CALLLIST-TOP-COVERS-BUTTONS` **Phase 2**
(commit `4ae026d`). 당시 TOP-COVERS-BUTTONS 티켓이 "별도 DRAGGABLE 티켓 없이 본 티켓 Phase 2로 흡수"로
드래그를 흡수해 배포했기 때문. 본 DRAGGABLE-POSITION 티켓은 planner가 **위치 정책의 canonical 소유 티켓**으로
세운 것 → **코드 신규 변경 없이** (1) canonical 추적 주석 + (2) 시나리오 3종 전용 spec 추가로 충족.
같은 파일 동시 2-티켓 금지 준수: 드래그 *구현*은 TOP-COVERS-BUTTONS가 소유(회귀 spec), 본 티켓은 *위치 정책*
명세 소유(canonical spec). 무중복.

## 구현 (DoctorCallListBar.tsx, DB 무변경 — 기배포 구현 재사용)
- 헤더("원장님 진료콜 명단" Stethoscope 영역) = 드래그 핸들. 네이티브 pointer events
  (onPointerDown/Move/Up + setPointerCapture) — 신규 npm 라이브러리 없음.
- `fixed` 유지 + left/top 인라인 좌표 제어. 저장값 없으면 CSS 앵커(기본 우하단 `bottom-4 right-4`, 버튼 비가림).
- 위치 = localStorage `foot.doctorCallList.pos.v1` per-browser 영속(try/catch, 파싱실패→기본값).
- `clampPos` 뷰포트 clamp(헤더 화면 내 잔존) + 리사이즈 재clamp → 화면 밖 유실 방지.
- 헤더 '위치 초기화'(reset-pos) → 저장값 삭제 + 기본 앵커 복귀(드래그/저장 좌표 있을 때만 노출).
- 버튼/토글(전체콜·해제·접기·reset)은 헤더 내 `closest('button')` 가드 또는 `onPointerDown stopPropagation`로
  드래그 미발동. 메모·이름→차트는 헤더 밖(행)이라 드래그 핸들 영역 무관 → 본문 동작 무간섭.
- 정렬/배지/콜로직/메모/ack/max-h 스크롤 전부 불변(무파괴).

> ⚠️ localStorage 키: 티켓 가이드는 `foot.doctorCallList.pos`였으나, 기배포 구현이 버전드 키
> `foot.doctorCallList.pos.v1`로 이미 운영 중 → **키 변경 시 현장 저장 위치 유실** 위험으로 `.v1` 유지(의도적).

## AC
- AC-1 드래그+영속: 헤더 드래그 → fixed 앵커 폐기·dragged 모드·인라인 left/top·localStorage 저장·reload 복원.
- AC-2 본문 무간섭: 접기 토글/지정콜/이름→차트/메모는 드래그 미발동(위치 불변) + 본문 동작 보존.
- AC-3 클램프+초기화: 화면 밖으로 끌어도 헤더 화면 내 clamp + reset-pos → 기본 앵커 복귀·localStorage 제거.
- AC-4 무파괴: 정렬·배지·콜(전체/지정)·메모·ack·max-h 스크롤 불변.

## 시나리오 (E2E) — tests/e2e/T-20260610-foot-CALLLIST-DRAGGABLE-POSITION.spec.ts
- S1 드래그+영속 / S2 본문 무간섭 / S3 클램프+초기화. 데이터/인증 없으면 graceful skip.

## 선례 참고
- `T-20260523-body-CHART-POPUP-DRAG`(body CRM, done) 드래그 팝업 패턴.

## 결과
- build OK (vite ✓). 드래그 구현은 commit 4ac... TOP-COVERS-BUTTONS Phase 2(4ae026d)로 라이브.
- 본 티켓 산출: canonical 추적 주석 + 전용 spec 3종(위치 정책 명세 고정).

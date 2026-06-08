---
id: T-20260608-foot-FIRSTVISIT-MEMO-EMPTYSTATE
domain: foot
priority: P3
status: deploy-ready
title: 초진상담차트 있는데 '기록메모없음' 표시 — 원인 규명·수정
created: 2026-06-08
assignee: dev-foot
reporter: 문지은 대표원장
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260608-foot-FIRSTVISIT-MEMO-EMPTYSTATE.spec.ts
---

# T-20260608-foot-FIRSTVISIT-MEMO-EMPTYSTATE — 상담 메모 빈상태 규명

## AC-0 (read-only, 필수 선행) — 메모 필드/실데이터 점검 + 분기 판정
진단 스크립트: `scripts/_diag_firstvisit_memo_20260608.mjs` (READ-ONLY, 초진 158건 전수).

**조회 정본**: ConsultRecordTab 메모 = `notesText(check_ins.notes)` = `notes.text`(JSONB). "기록 메모 없음"은 `(!memo && !treatmentSummary && !consultant)`일 때만 노출.

**DB 실측**:
- `notes.text`(비어있지않음) 보유 = **0/158건** — 본 탭이 읽던 단일 키가 사실상 비어있음.
- `notes.memo`에 **실제 초진 상담 메모 존재**: "초진 상담. 무지외반증 및 발뒤꿈치 각질 복합 케어 희망. 패키지 12회권 계약." → `notesText()`가 `.text`만 읽어 **숨겨짐(=데이터 있는데 미표시)**. 활성 쓰기경로 없음(레거시/임포트 추정).
- 그 외 "기록 메모 없음" 다수(104/158)는 `lead_source` 등 메타데이터만 보유 = **실제 상담 메모 미입력**.

**분기 판정**: **B 확정(데이터 연결 버그)** + A(실제 빈 데이터) 공존. → 맹목 문구수정 금지 충족(데이터 연결 수정 동반).

## AC-2 (분기 B) — 조회 수정(읽기 경로 확장)
`ConsultRecordTab.notesText()`: `notes.text` 우선, 비면 `notes.memo` 폴백. 쓰기/스키마 무변경, 타 기능 무영향(읽기 한정).

## AC-1 (분기 A) — 문구/UX 정리
빈 상태 문구 "기록 메모 없음"(시스템 오류로 오해 소지·"원인 모호") → **"입력된 상담 메모 없음"**(이 방문에 상담 메모 미입력임을 명확화). `data-testid=consult-record-no-memo`.

## 변경
- `src/components/ConsultRecordTab.tsx`: notesText memo 폴백 + 빈상태 문구.
- DB·스키마 무변경. 신규 패키지 없음.

## 검증
- build OK. 신규 E2E 10/10(폴백·우선순위·공백·메타키 제외·문구). 상담탭 회귀 통과.

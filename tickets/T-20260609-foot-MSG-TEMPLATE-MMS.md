---
id: T-20260609-foot-MSG-TEMPLATE-MMS
domain: foot
priority: P2
status: in-progress
deploy-ready: false
build-passed: true
db-change: true
e2e-spec: true
summary: "풋CRM 메시징 확장 3덩어리. A(템플릿 CRUD)+C(문자모달 textarea 2배)=FE-only 완료·배포 가능 증분. B(MMS/이미지)=인프라(스키마+버킷+EF) 준비물 작성 후 supervisor 이관·FOLLOWUP 분리."
hotfix: false
created: 2026-06-09
reporter: 김주연 총괄
risk_verdict: GO_WARN
risk_reason: "①DB스키마(image_path 컬럼)→supervisor 이관 ②solapi MMS 단가/규격 SMS와 상이 ③storage 업로드 보안. textarea 2배·템플릿 CRUD(RLS 기존 admin/manager/director FOR ALL)는 무/저위험."
deploy_scope: "A(템플릿 CRUD) + C(textarea 2배) — FE-only, 스키마 무변경"
pending_scope: "B(MMS 이미지): migration 20260609200000(image_path + message-images 버킷) supervisor 적용 + send-notification EF MMS 보강(아래 설계) + FE 이미지 첨부 UI. 총괄 승인·접근 후 후속."
---

# T-20260609-foot-MSG-TEMPLATE-MMS — 풋 메시징 확장

## A. 템플릿 관리 CRUD (완료, FE-only)
- `src/pages/AdminSettings.tsx` ③ 템플릿 관리 재작성.
- 예약 자동발송 템플릿(reserved 4종): 종전대로 본문 수정/등록.
- **사용자 정의 템플릿** 블록 신규: 추가 / 수정 / 삭제(CRUD).
  - 이름(=event_type) + 본문 입력. reserved slug 이름 금지, 40자 제한, UNIQUE 충돌 친절 메시지.
  - RLS `notif_tmpl_write` (admin/manager/director, clinic 격리) FOR ALL 이미 존재 → INSERT/DELETE 동작. 스키마 무변경.
  - 사용자 정의 템플릿은 대시보드 우클릭 [문자] 드롭다운(SendSmsDialog)에 그대로 노출됨(기존 로직 재사용).
- AC1~AC4 충족.

## C. 문자 모달 textarea 2배 (완료, FE-only)
- `src/components/SendSmsDialog.tsx` 본문 textarea `rows 5→10` + `min-h-[220px]`, resize-y.
- AC10 충족. 무위험.

## B. MMS(이미지 첨부) — 인프라 준비물 (supervisor 이관 + FOLLOWUP)

### B-1. DB/Storage (migration 작성 완료, 적용 미시행)
- `supabase/migrations/20260609200000_notification_templates_image_mms.sql`
  - `notification_templates.image_path TEXT` 추가 (NULL=SMS/LMS, 값=MMS).
  - storage 버킷 `message-images`(private) + clinic 격리 RLS(경로 1st 세그먼트=clinic_id).
- rollback SQL 동봉. **운영 적용은 supervisor.**

### B-2. send-notification EF MMS 보강 설계 (미배포)
현 EF `sendSolapi()`는 SMS/LMS 전용(`type: SMS|LMS`). MMS는 2-step 필요:
1. **파일 업로드**: `POST https://api.solapi.com/storage/v4/files`
   body `{ file: <base64>, name, type: "MMS" }`, HMAC-SHA256 동일 인증 → `{ fileId }`.
2. **발송**: message 에 `{ type: "MMS", imageId: fileId, subject?, text }` 포함.
- 이미지 소스: FE가 `message-images` 버킷에 업로드 → storage path 전달 → EF가 service_role 로 download → base64 → solapi 업로드.
- **solapi MMS 규격 가드(EF+FE 양쪽)**: JPG only, ≤ 200KB, 권장 ≤ 1500×1440px. 초과 시 발송 거부 + 안내.
- `getChannel()` 분기: `image_path` 존재 시 MMS 경로, 없으면 종전. 하위호환(이미지 없으면 100% 동일).
- `notification_logs.channel`='mms' 기록.
- ⚠ **MMS 단가가 SMS/LMS와 상이** → 총괄 단가 확인 필요(FOLLOWUP 항목).

### B-3. FE 이미지 첨부 UI (미구현 — B-1/B-2 적용 후)
- AdminSettings 템플릿 편집 다이얼로그: 이미지 업로드(약도/약국지도) → message-images 버킷 → image_path 저장.
- SendSmsDialog: 이미지 첨부(템플릿 image_path 자동 + 즉석 첨부) + MMS 미리보기.
- 확장자/용량 클라 가드 + 미리보기.

### FOLLOWUP 질의 (planner→총괄)
1. MMS 단가 승인(SMS 대비 상이). 2. 이미지 규격(JPG/200KB) 현장 사용 이미지(약도·약국지도) 호환 확인.
3. EF·스키마 supervisor 이관 GO. → 확정 시 B-2/B-3 후속 티켓으로 즉시 구현.

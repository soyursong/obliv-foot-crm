---
name: TM Module
description: Telemarketing module for outbound call campaigns, lead management, call logging, recall alerts
type: feature
---
- Routes: /tm (TmMain), /tm/register (TmRegister)
- Components: TmCallSheet (call result input), TmRecallAlert (1min polling + browser notification), TmCallHistoryTab (customer detail tab)
- Nav: TM button in AdminLayout, visible to admin/tm/manager roles
- Tables used: leads, tm_call_logs, call_type_codes, lead_assignments, reservations, customers, services
- Priority sort: recall_due > new > retry > preventive (D-1/2) > noshow
- Call results: reservation_done, recall_promise, no_answer, wrong_number, no_response, phone_off, rejected, scheduling, text_only, other
- "예약완료" creates reservation + customer if needed
- "재통화약속" sets recall_at on call log
- Bulk lead upload via SheetJS (xlsx) with duplicate detection
- CustomerDetail sheet has "콜 이력" tab using TmCallHistoryTab

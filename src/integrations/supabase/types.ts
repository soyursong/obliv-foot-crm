export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aicc_reservations: {
        Row: {
          aicc_created_at: string | null
          aicc_created_by: string | null
          aicc_updated_at: string | null
          call_memo: string | null
          call_seq: number | null
          campaign_cd: string | null
          campaign_nm: string | null
          care_call_flag: string | null
          clinic_id: string | null
          clinic_nm: string | null
          created_at: string | null
          created_user_nm: string | null
          cust_id: number | null
          cust_nm: string | null
          id: string
          matched_customer_id: string | null
          matched_reservation_id: string | null
          phone: string
          prod_nm: string | null
          raw_data: Json | null
          reserv_memo: string | null
          reservation_date: string | null
          reservation_seq: number
          reservation_time: string | null
          reservation_yn: string | null
          synced_at: string | null
          updated_at: string | null
          visit_call_flag: string | null
          visit_date: string | null
          visit_yn: string | null
        }
        Insert: {
          aicc_created_at?: string | null
          aicc_created_by?: string | null
          aicc_updated_at?: string | null
          call_memo?: string | null
          call_seq?: number | null
          campaign_cd?: string | null
          campaign_nm?: string | null
          care_call_flag?: string | null
          clinic_id?: string | null
          clinic_nm?: string | null
          created_at?: string | null
          created_user_nm?: string | null
          cust_id?: number | null
          cust_nm?: string | null
          id?: string
          matched_customer_id?: string | null
          matched_reservation_id?: string | null
          phone: string
          prod_nm?: string | null
          raw_data?: Json | null
          reserv_memo?: string | null
          reservation_date?: string | null
          reservation_seq: number
          reservation_time?: string | null
          reservation_yn?: string | null
          synced_at?: string | null
          updated_at?: string | null
          visit_call_flag?: string | null
          visit_date?: string | null
          visit_yn?: string | null
        }
        Update: {
          aicc_created_at?: string | null
          aicc_created_by?: string | null
          aicc_updated_at?: string | null
          call_memo?: string | null
          call_seq?: number | null
          campaign_cd?: string | null
          campaign_nm?: string | null
          care_call_flag?: string | null
          clinic_id?: string | null
          clinic_nm?: string | null
          created_at?: string | null
          created_user_nm?: string | null
          cust_id?: number | null
          cust_nm?: string | null
          id?: string
          matched_customer_id?: string | null
          matched_reservation_id?: string | null
          phone?: string
          prod_nm?: string | null
          raw_data?: Json | null
          reserv_memo?: string | null
          reservation_date?: string | null
          reservation_seq?: number
          reservation_time?: string | null
          reservation_yn?: string | null
          synced_at?: string | null
          updated_at?: string | null
          visit_call_flag?: string | null
          visit_date?: string | null
          visit_yn?: string | null
        }
        Relationships: []
      }
      call_type_codes: {
        Row: {
          category: string
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          subcategory: string
        }
        Insert: {
          category: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          subcategory: string
        }
        Update: {
          category?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          subcategory?: string
        }
        Relationships: []
      }
      check_in_services: {
        Row: {
          check_in_id: string | null
          created_at: string | null
          id: string
          original_price: number | null
          price: number
          service_id: string | null
          service_name: string
        }
        Insert: {
          check_in_id?: string | null
          created_at?: string | null
          id?: string
          original_price?: number | null
          price?: number
          service_id?: string | null
          service_name: string
        }
        Update: {
          check_in_id?: string | null
          created_at?: string | null
          id?: string
          original_price?: number | null
          price?: number
          service_id?: string | null
          service_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_in_services_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          anesthesia_at: string | null
          called_at: string | null
          checked_in_at: string | null
          clinic_id: string | null
          completed_at: string | null
          consultant_id: string | null
          created_by: string | null
          created_date: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string
          id: string
          language: string | null
          lidocaine_at: string | null
          notes: string | null
          priority_flag: string | null
          queue_number: number
          referral_source: string | null
          reservation_id: string | null
          room_number: number | null
          sort_order: number | null
          staff_id: string | null
          status: string | null
          technician_id: string | null
          tm_staff: string | null
          treatment_memo: Json | null
          treatment_photos: string[] | null
          ultracaine_at: string | null
        }
        Insert: {
          anesthesia_at?: string | null
          called_at?: string | null
          checked_in_at?: string | null
          clinic_id?: string | null
          completed_at?: string | null
          consultant_id?: string | null
          created_by?: string | null
          created_date?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          language?: string | null
          lidocaine_at?: string | null
          notes?: string | null
          priority_flag?: string | null
          queue_number: number
          referral_source?: string | null
          reservation_id?: string | null
          room_number?: number | null
          sort_order?: number | null
          staff_id?: string | null
          status?: string | null
          technician_id?: string | null
          tm_staff?: string | null
          treatment_memo?: Json | null
          treatment_photos?: string[] | null
          ultracaine_at?: string | null
        }
        Update: {
          anesthesia_at?: string | null
          called_at?: string | null
          checked_in_at?: string | null
          clinic_id?: string | null
          completed_at?: string | null
          consultant_id?: string | null
          created_by?: string | null
          created_date?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          language?: string | null
          lidocaine_at?: string | null
          notes?: string | null
          priority_flag?: string | null
          queue_number?: number
          referral_source?: string | null
          reservation_id?: string | null
          room_number?: number | null
          sort_order?: number | null
          staff_id?: string | null
          status?: string | null
          technician_id?: string | null
          tm_staff?: string | null
          treatment_memo?: Json | null
          treatment_photos?: string[] | null
          ultracaine_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_consultant_perf"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "check_ins_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_technician_perf"
            referencedColumns: ["technician_id"]
          },
          {
            foreignKeyName: "check_ins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "check_ins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_consultant_perf"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "check_ins_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_technician_perf"
            referencedColumns: ["technician_id"]
          },
          {
            foreignKeyName: "check_ins_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_consultant_perf"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "check_ins_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_technician_perf"
            referencedColumns: ["technician_id"]
          },
        ]
      }
      clinic_holidays: {
        Row: {
          clinic_id: string | null
          holiday_date: string
          id: string
          memo: string | null
        }
        Insert: {
          clinic_id?: string | null
          holiday_date: string
          id?: string
          memo?: string | null
        }
        Update: {
          clinic_id?: string | null
          holiday_date?: string
          id?: string
          memo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_holidays_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_schedules: {
        Row: {
          clinic_id: string | null
          close_time: string | null
          day_of_week: number
          id: string
          is_closed: boolean | null
          open_time: string | null
        }
        Insert: {
          clinic_id?: string | null
          close_time?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean | null
          open_time?: string | null
        }
        Update: {
          clinic_id?: string | null
          close_time?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean | null
          open_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_schedules_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          close_time: string | null
          consultation_rooms: number | null
          created_at: string | null
          deleted_at: string | null
          id: string
          max_per_slot: number | null
          name: string
          open_time: string | null
          room_names: Json | null
          slot_interval: number | null
          slots: string[] | null
          slug: string
          treatment_rooms: number | null
        }
        Insert: {
          close_time?: string | null
          consultation_rooms?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          max_per_slot?: number | null
          name: string
          open_time?: string | null
          room_names?: Json | null
          slot_interval?: number | null
          slots?: string[] | null
          slug: string
          treatment_rooms?: number | null
        }
        Update: {
          close_time?: string | null
          consultation_rooms?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          max_per_slot?: number | null
          name?: string
          open_time?: string | null
          room_names?: Json | null
          slot_interval?: number | null
          slots?: string[] | null
          slug?: string
          treatment_rooms?: number | null
        }
        Relationships: []
      }
      consultation_notes: {
        Row: {
          clinic_id: string
          content: string
          created_at: string | null
          created_by: string | null
          customer_id: string
          id: string
          note_date: string
          updated_at: string | null
        }
        Insert: {
          clinic_id: string
          content?: string
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          id?: string
          note_date?: string
          updated_at?: string | null
        }
        Update: {
          clinic_id?: string
          content?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          id?: string
          note_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultation_notes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "consultation_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          clinic_id: string | null
          created_at: string | null
          created_by: string | null
          encrypted_rrn: string | null
          id: string
          lead_id: string | null
          lead_source: string | null
          memo: string | null
          name: string
          phone: string | null
          resident_id: string | null
          tm_memo: string | null
          updated_at: string | null
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string | null
          created_by?: string | null
          encrypted_rrn?: string | null
          id?: string
          lead_id?: string | null
          lead_source?: string | null
          memo?: string | null
          name: string
          phone?: string | null
          resident_id?: string | null
          tm_memo?: string | null
          updated_at?: string | null
        }
        Update: {
          clinic_id?: string | null
          created_at?: string | null
          created_by?: string | null
          encrypted_rrn?: string | null
          id?: string
          lead_id?: string | null
          lead_source?: string | null
          memo?: string | null
          name?: string
          phone?: string | null
          resident_id?: string | null
          tm_memo?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_closings: {
        Row: {
          actual_card_total: number | null
          actual_cash_total: number | null
          clinic_id: string | null
          close_date: string
          closed_at: string | null
          created_at: string | null
          difference: number | null
          id: string
          memo: string | null
          status: string | null
          system_card_total: number | null
          system_cash_total: number | null
        }
        Insert: {
          actual_card_total?: number | null
          actual_cash_total?: number | null
          clinic_id?: string | null
          close_date: string
          closed_at?: string | null
          created_at?: string | null
          difference?: number | null
          id?: string
          memo?: string | null
          status?: string | null
          system_card_total?: number | null
          system_cash_total?: number | null
        }
        Update: {
          actual_card_total?: number | null
          actual_cash_total?: number | null
          clinic_id?: string | null
          close_date?: string
          closed_at?: string | null
          created_at?: string | null
          difference?: number | null
          id?: string
          memo?: string | null
          status?: string | null
          system_card_total?: number | null
          system_cash_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_closings_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assigned_by: string | null
          assigned_from: string | null
          assigned_to: string | null
          assignment_type: string | null
          clinic_id: string | null
          created_at: string | null
          id: string
          lead_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          assignment_type?: string | null
          clinic_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          assignment_type?: string | null
          clinic_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_assigned_from_fkey"
            columns: ["assigned_from"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          clinic_id: string | null
          created_at: string | null
          customer_id: string | null
          duplicate_of: string | null
          id: string
          interested_treatment: string | null
          is_duplicate: boolean | null
          memo: string | null
          name: string
          phone: string
          source: string
          source_detail: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          clinic_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          duplicate_of?: string | null
          id?: string
          interested_treatment?: string | null
          is_duplicate?: boolean | null
          memo?: string | null
          name: string
          phone: string
          source?: string
          source_detail?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          clinic_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          duplicate_of?: string | null
          id?: string
          interested_treatment?: string | null
          is_duplicate?: boolean | null
          memo?: string | null
          name?: string
          phone?: string
          source?: string
          source_detail?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      naver_talk_raw: {
        Row: {
          body: Json
          created_at: string
          error_message: string | null
          headers: Json | null
          id: string
          parsed_at: string | null
          parsed_status: string | null
          received_at: string
          reservation_id: string | null
          source_ip: string | null
        }
        Insert: {
          body: Json
          created_at?: string
          error_message?: string | null
          headers?: Json | null
          id?: string
          parsed_at?: string | null
          parsed_status?: string | null
          received_at?: string
          reservation_id?: string | null
          source_ip?: string | null
        }
        Update: {
          body?: Json
          created_at?: string
          error_message?: string | null
          headers?: Json | null
          id?: string
          parsed_at?: string | null
          parsed_status?: string | null
          received_at?: string
          reservation_id?: string | null
          source_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "naver_talk_raw_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          check_in_id: string | null
          id: string
          message: string | null
          sent_at: string | null
          status: string | null
          template: string | null
          type: string
        }
        Insert: {
          check_in_id?: string | null
          id?: string
          message?: string | null
          sent_at?: string | null
          status?: string | null
          template?: string | null
          type: string
        }
        Update: {
          check_in_id?: string | null
          id?: string
          message?: string | null
          sent_at?: string | null
          status?: string | null
          template?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          check_in_id: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          installment: number | null
          memo: string | null
          method: string
          payment_type: string | null
        }
        Insert: {
          amount: number
          check_in_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          installment?: number | null
          memo?: string | null
          method: string
          payment_type?: string | null
        }
        Update: {
          amount?: number
          check_in_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          installment?: number | null
          memo?: string | null
          method?: string
          payment_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_logs: {
        Row: {
          action: string
          created_at: string | null
          created_by: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          reservation_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reservation_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_logs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          clinic_id: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          id: string
          lead_id: string | null
          memo: string | null
          referral_source: string | null
          reservation_date: string
          reservation_time: string
          reservation_type: string | null
          reservation_type_etc: string | null
          service_id: string | null
          status: string | null
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          memo?: string | null
          referral_source?: string | null
          reservation_date: string
          reservation_time: string
          reservation_type?: string | null
          reservation_type_etc?: string | null
          service_id?: string | null
          status?: string | null
        }
        Update: {
          clinic_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string
          lead_id?: string | null
          memo?: string | null
          referral_source?: string | null
          reservation_date?: string
          reservation_time?: string
          reservation_type?: string | null
          reservation_type_etc?: string | null
          service_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      room_assignments: {
        Row: {
          clinic_id: string | null
          id: string
          room_number: number
          room_type: string
          staff_id: string | null
          work_date: string | null
        }
        Insert: {
          clinic_id?: string | null
          id?: string
          room_number: number
          room_type: string
          staff_id?: string | null
          work_date?: string | null
        }
        Update: {
          clinic_id?: string | null
          id?: string
          room_number?: number
          room_type?: string
          staff_id?: string | null
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_assignments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_consultant_perf"
            referencedColumns: ["consultant_id"]
          },
          {
            foreignKeyName: "room_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "v_monthly_technician_perf"
            referencedColumns: ["technician_id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean | null
          category: string | null
          clinic_id: string | null
          created_at: string | null
          discount_price: number | null
          duration_min: number | null
          id: string
          name: string
          price: number
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          clinic_id?: string | null
          created_at?: string | null
          discount_price?: number | null
          duration_min?: number | null
          id?: string
          name: string
          price?: number
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          clinic_id?: string | null
          created_at?: string | null
          discount_price?: number | null
          duration_min?: number | null
          id?: string
          name?: string
          price?: number
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "services_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean | null
          clinic_id: string | null
          created_at: string | null
          id: string
          name: string
          role: string | null
        }
        Insert: {
          active?: boolean | null
          clinic_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          role?: string | null
        }
        Update: {
          active?: boolean | null
          clinic_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      status_transitions: {
        Row: {
          changed_by: string | null
          check_in_id: string
          clinic_id: string
          from_status: string | null
          id: string
          room_id: string | null
          to_status: string
          transitioned_at: string | null
        }
        Insert: {
          changed_by?: string | null
          check_in_id: string
          clinic_id: string
          from_status?: string | null
          id?: string
          room_id?: string | null
          to_status: string
          transitioned_at?: string | null
        }
        Update: {
          changed_by?: string | null
          check_in_id?: string
          clinic_id?: string
          from_status?: string | null
          id?: string
          room_id?: string | null
          to_status?: string
          transitioned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_transitions_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_transitions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      tm_call_logs: {
        Row: {
          call_category: string | null
          call_direction: string | null
          call_ended_at: string | null
          call_result: string | null
          call_started_at: string | null
          call_subcategory: string | null
          caller_id: string
          clinic_id: string | null
          created_at: string | null
          customer_id: string | null
          duration_seconds: number | null
          id: string
          lead_id: string | null
          memo: string | null
          recall_at: string | null
          recall_done: boolean | null
          reservation_id: string | null
        }
        Insert: {
          call_category?: string | null
          call_direction?: string | null
          call_ended_at?: string | null
          call_result?: string | null
          call_started_at?: string | null
          call_subcategory?: string | null
          caller_id: string
          clinic_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          memo?: string | null
          recall_at?: string | null
          recall_done?: boolean | null
          reservation_id?: string | null
        }
        Update: {
          call_category?: string | null
          call_direction?: string | null
          call_ended_at?: string | null
          call_result?: string | null
          call_started_at?: string | null
          call_subcategory?: string | null
          caller_id?: string
          clinic_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          memo?: string | null
          recall_at?: string | null
          recall_done?: boolean | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tm_call_logs_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tm_call_logs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tm_call_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "aicc_crm_phone_match"
            referencedColumns: ["crm_customer_id"]
          },
          {
            foreignKeyName: "tm_call_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tm_call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tm_call_logs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          active: boolean | null
          approved: boolean | null
          clinic_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          role: string
        }
        Insert: {
          active?: boolean | null
          approved?: boolean | null
          clinic_id?: string | null
          created_at?: string | null
          email: string
          id: string
          name: string
          role?: string
        }
        Update: {
          active?: boolean | null
          approved?: boolean | null
          clinic_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      aicc_crm_phone_match: {
        Row: {
          aicc_id: string | null
          aicc_name: string | null
          aicc_phone: string | null
          clinic_id: string | null
          crm_customer_id: string | null
          crm_name: string | null
          crm_phone: string | null
          reservation_date: string | null
          reservation_seq: number | null
          visit_yn: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_avg_spend: {
        Row: {
          avg_spend: number | null
          clinic_id: string | null
          dt: string | null
          paid_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_consult_wait: {
        Row: {
          avg_wait_min: number | null
          clinic_id: string | null
          dt: string | null
          sample_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_revenue: {
        Row: {
          clinic_id: string | null
          dt: string | null
          gross_revenue: number | null
          net_revenue: number | null
          refund_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_stay_duration: {
        Row: {
          avg_stay_min: number | null
          clinic_id: string | null
          dt: string | null
          sample_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_visit_rate: {
        Row: {
          checkin_count: number | null
          clinic_id: string | null
          dt: string | null
          total_reservations: number | null
          visit_rate_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_daily_visits: {
        Row: {
          clinic_id: string | null
          dt: string | null
          visit_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_monthly_consultant_perf: {
        Row: {
          avg_spend: number | null
          clinic_id: string | null
          consult_count: number | null
          consultant_id: string | null
          consultant_name: string | null
          month: string | null
          net_revenue: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_monthly_technician_perf: {
        Row: {
          avg_stay_min: number | null
          clinic_id: string | null
          month: string | null
          net_revenue: number | null
          procedure_count: number | null
          technician_id: string | null
          technician_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      v_monthly_tm_perf: {
        Row: {
          avg_spend: number | null
          checkin_count: number | null
          clinic_id: string | null
          month: string | null
          net_revenue: number | null
          tm_name: string | null
          total_reservations: number | null
          visit_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_list_user_profiles: {
        Args: never
        Returns: {
          active: boolean
          approved: boolean
          clinic_id: string
          clinic_name: string
          created_at: string
          email: string
          id: string
          name: string
          role: string
        }[]
      }
      admin_reset_user_password: {
        Args: { new_password: string; target_id: string }
        Returns: undefined
      }
      admin_update_user_profile: {
        Args: {
          new_active?: boolean
          new_approved?: boolean
          new_clinic_id?: string
          new_name?: string
          new_role?: string
          target_id: string
        }
        Returns: undefined
      }
      cleanup_daily_check_ins: { Args: never; Returns: undefined }
      find_customer_by_phone: {
        Args: { p_clinic_id: string; p_phone: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      find_upcoming_reservations: {
        Args: { p_customer_id: string; p_today: string }
        Returns: {
          id: string
          reservation_date: string
          reservation_time: string
        }[]
      }
      get_checkin_data: {
        Args: { p_check_in_id: string }
        Returns: {
          clinic_id: string
          clinic_name: string
          customer_name: string
          id: string
          language: string
          queue_number: number
          status: string
        }[]
      }
      get_queue_summary: {
        Args: { p_clinic_id: string; p_queue_number: number }
        Returns: {
          ahead_count: number
          consultation_count: number
          treatment_count: number
          waiting_count: number
        }[]
      }
      get_today_reservations: {
        Args: { p_clinic_id: string; p_date: string }
        Returns: {
          customer_id: string
          customer_name: string
          customer_phone: string
          id: string
          reservation_time: string
        }[]
      }
      match_reservation_for_checkin: {
        Args: { p_customer_id: string; p_date: string }
        Returns: {
          id: string
        }[]
      }
      next_queue_number: { Args: { p_clinic_id: string }; Returns: number }
      ose_execute: { Args: { query_text: string }; Returns: Json }
      ose_query: { Args: { query_text: string }; Returns: Json }
      reservation_to_checkin: {
        Args: {
          p_clinic_id: string
          p_created_by?: string
          p_customer_id: string
          p_customer_name: string
          p_customer_phone: string
          p_reservation_id: string
        }
        Returns: string
      }
      rrn_decrypt: { Args: { customer_uuid: string }; Returns: string }
      rrn_encrypt: {
        Args: { customer_uuid: string; plain_rrn: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

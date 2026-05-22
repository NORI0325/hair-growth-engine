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
      ab_test_assignments: {
        Row: {
          ab_test_id: string
          booked_at: string | null
          clicked_at: string | null
          created_at: string
          customer_id: string
          id: string
          opened_at: string | null
          scheduled_job_id: string | null
          sent_at: string | null
          variant: string
        }
        Insert: {
          ab_test_id: string
          booked_at?: string | null
          clicked_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          opened_at?: string | null
          scheduled_job_id?: string | null
          sent_at?: string | null
          variant: string
        }
        Update: {
          ab_test_id?: string
          booked_at?: string | null
          clicked_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          opened_at?: string | null
          scheduled_job_id?: string | null
          sent_at?: string | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "ab_test_assignments_ab_test_id_fkey"
            columns: ["ab_test_id"]
            isOneToOne: false
            referencedRelation: "ab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_tests: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          location_id: string | null
          name: string
          owner_id: string
          split_ratio: number
          started_at: string
          status: string
          template_key: string
          updated_at: string
          variant_a: Json
          variant_b: Json
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          owner_id: string
          split_ratio?: number
          started_at?: string
          status?: string
          template_key: string
          updated_at?: string
          variant_a: Json
          variant_b: Json
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          owner_id?: string
          split_ratio?: number
          started_at?: string
          status?: string
          template_key?: string
          updated_at?: string
          variant_a?: Json
          variant_b?: Json
        }
        Relationships: []
      }
      booking_tokens: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          token: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          token?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          booking_time: string
          campaign_id: string | null
          cancelled_at: string | null
          cancelled_source: string | null
          coupon_id: string | null
          created_at: string
          customer_id: string
          external_reservation_id: string | null
          external_source: string | null
          id: string
          is_nominated: boolean
          is_test: boolean
          last_sync_error: string | null
          last_synced_at: string | null
          location_id: string | null
          menu: string
          menus: string[] | null
          needs_manual_review: boolean
          notes: string | null
          owner_id: string
          revenue: number | null
          salonboard_alert_sent_at: string | null
          source_channel: string | null
          source_job_id: string | null
          source_template: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          sync_attempt_count: number
          sync_error_message: string | null
          sync_status: string
          total_duration_minutes: number | null
          total_price: number | null
          updated_at: string
        }
        Insert: {
          booking_date: string
          booking_time: string
          campaign_id?: string | null
          cancelled_at?: string | null
          cancelled_source?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id: string
          external_reservation_id?: string | null
          external_source?: string | null
          id?: string
          is_nominated?: boolean
          is_test?: boolean
          last_sync_error?: string | null
          last_synced_at?: string | null
          location_id?: string | null
          menu: string
          menus?: string[] | null
          needs_manual_review?: boolean
          notes?: string | null
          owner_id: string
          revenue?: number | null
          salonboard_alert_sent_at?: string | null
          source_channel?: string | null
          source_job_id?: string | null
          source_template?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          sync_attempt_count?: number
          sync_error_message?: string | null
          sync_status?: string
          total_duration_minutes?: number | null
          total_price?: number | null
          updated_at?: string
        }
        Update: {
          booking_date?: string
          booking_time?: string
          campaign_id?: string | null
          cancelled_at?: string | null
          cancelled_source?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id?: string
          external_reservation_id?: string | null
          external_source?: string | null
          id?: string
          is_nominated?: boolean
          is_test?: boolean
          last_sync_error?: string | null
          last_synced_at?: string | null
          location_id?: string | null
          menu?: string
          menus?: string[] | null
          needs_manual_review?: boolean
          notes?: string | null
          owner_id?: string
          revenue?: number | null
          salonboard_alert_sent_at?: string | null
          source_channel?: string | null
          source_job_id?: string | null
          source_template?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          sync_attempt_count?: number
          sync_error_message?: string | null
          sync_status?: string
          total_duration_minutes?: number | null
          total_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_logs: {
        Row: {
          booking_id: string
          channel: string
          customer_id: string
          error: string | null
          id: string
          owner_id: string
          sent_at: string
          staff_id: string
          status: string
        }
        Insert: {
          booking_id: string
          channel: string
          customer_id: string
          error?: string | null
          id?: string
          owner_id: string
          sent_at?: string
          staff_id: string
          status?: string
        }
        Update: {
          booking_id?: string
          channel?: string
          customer_id?: string
          error?: string | null
          id?: string
          owner_id?: string
          sent_at?: string
          staff_id?: string
          status?: string
        }
        Relationships: []
      }
      broadcast_segments: {
        Row: {
          conditions: Json
          created_at: string
          description: string | null
          id: string
          location_id: string | null
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_sends: {
        Row: {
          booked_at: string | null
          campaign_id: string
          clicked_at: string | null
          created_at: string
          customer_id: string
          email_error: string | null
          email_sent: boolean
          id: string
          opened_at: string | null
          sms_error: string | null
          sms_sent: boolean
        }
        Insert: {
          booked_at?: string | null
          campaign_id: string
          clicked_at?: string | null
          created_at?: string
          customer_id: string
          email_error?: string | null
          email_sent?: boolean
          id?: string
          opened_at?: string | null
          sms_error?: string | null
          sms_sent?: boolean
        }
        Update: {
          booked_at?: string | null
          campaign_id?: string
          clicked_at?: string | null
          created_at?: string
          customer_id?: string
          email_error?: string | null
          email_sent?: boolean
          id?: string
          opened_at?: string | null
          sms_error?: string | null
          sms_sent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_sends_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          coupon_id: string | null
          created_at: string
          email_body: string
          email_subject: string
          id: string
          location_id: string | null
          owner_id: string
          scheduled_at: string | null
          send_email: boolean
          send_sms: boolean
          sent_at: string | null
          sms_body: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          target_segment: Database["public"]["Enums"]["customer_segment"] | null
          title: string
          total_recipients: number
          updated_at: string
        }
        Insert: {
          coupon_id?: string | null
          created_at?: string
          email_body: string
          email_subject: string
          id?: string
          location_id?: string | null
          owner_id: string
          scheduled_at?: string | null
          send_email?: boolean
          send_sms?: boolean
          sent_at?: string | null
          sms_body?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          target_segment?:
            | Database["public"]["Enums"]["customer_segment"]
            | null
          title: string
          total_recipients?: number
          updated_at?: string
        }
        Update: {
          coupon_id?: string | null
          created_at?: string
          email_body?: string
          email_subject?: string
          id?: string
          location_id?: string | null
          owner_id?: string
          scheduled_at?: string | null
          send_email?: boolean
          send_sms?: boolean
          sent_at?: string | null
          sms_body?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          target_segment?:
            | Database["public"]["Enums"]["customer_segment"]
            | null
          title?: string
          total_recipients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_integrations: {
        Row: {
          allow_unmapped_booking: boolean
          channel: string
          connection_status: string
          created_at: string
          default_rsv_route_id: string
          enabled: boolean
          failure_count: number
          id: string
          last_error: string | null
          last_login_at: string | null
          last_status: string | null
          last_success_at: string | null
          last_synced_at: string | null
          live_enabled_at: string | null
          location_id: string | null
          note: string | null
          owner_id: string
          storage_state_path: string | null
          sync_enabled: boolean
          test_cancel_passed_at: string | null
          test_create_passed_at: string | null
          test_update_passed_at: string | null
          updated_at: string
        }
        Insert: {
          allow_unmapped_booking?: boolean
          channel: string
          connection_status?: string
          created_at?: string
          default_rsv_route_id?: string
          enabled?: boolean
          failure_count?: number
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          last_status?: string | null
          last_success_at?: string | null
          last_synced_at?: string | null
          live_enabled_at?: string | null
          location_id?: string | null
          note?: string | null
          owner_id: string
          storage_state_path?: string | null
          sync_enabled?: boolean
          test_cancel_passed_at?: string | null
          test_create_passed_at?: string | null
          test_update_passed_at?: string | null
          updated_at?: string
        }
        Update: {
          allow_unmapped_booking?: boolean
          channel?: string
          connection_status?: string
          created_at?: string
          default_rsv_route_id?: string
          enabled?: boolean
          failure_count?: number
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          last_status?: string | null
          last_success_at?: string | null
          last_synced_at?: string | null
          live_enabled_at?: string | null
          location_id?: string | null
          note?: string | null
          owner_id?: string
          storage_state_path?: string | null
          sync_enabled?: boolean
          test_cancel_passed_at?: string | null
          test_create_passed_at?: string | null
          test_update_passed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      channel_menu_options: {
        Row: {
          active: boolean
          channel: string
          created_at: string
          external_menu_id: string
          fetched_at: string
          id: string
          location_id: string | null
          menu_category_cd: string | null
          menu_id: string | null
          menu_name: string
          net_coupon_id: string | null
          owner_id: string
          price: number | null
          raw_payload: Json | null
          rsv_term: number | null
          setmenu_id: string | null
          source_type: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          channel?: string
          created_at?: string
          external_menu_id: string
          fetched_at?: string
          id?: string
          location_id?: string | null
          menu_category_cd?: string | null
          menu_id?: string | null
          menu_name: string
          net_coupon_id?: string | null
          owner_id: string
          price?: number | null
          raw_payload?: Json | null
          rsv_term?: number | null
          setmenu_id?: string | null
          source_type?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          channel?: string
          created_at?: string
          external_menu_id?: string
          fetched_at?: string
          id?: string
          location_id?: string | null
          menu_category_cd?: string | null
          menu_id?: string | null
          menu_name?: string
          net_coupon_id?: string | null
          owner_id?: string
          price?: number | null
          raw_payload?: Json | null
          rsv_term?: number | null
          setmenu_id?: string | null
          source_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      channel_staff_options: {
        Row: {
          active: boolean
          channel: string
          created_at: string
          display_name: string
          external_staff_id: string
          fetched_at: string
          id: string
          is_no_designation: boolean
          location_id: string | null
          owner_id: string
          raw_payload: Json | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          channel?: string
          created_at?: string
          display_name: string
          external_staff_id: string
          fetched_at?: string
          id?: string
          is_no_designation?: boolean
          location_id?: string | null
          owner_id: string
          raw_payload?: Json | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          channel?: string
          created_at?: string
          display_name?: string
          external_staff_id?: string
          fetched_at?: string
          id?: string
          is_no_designation?: boolean
          location_id?: string | null
          owner_id?: string
          raw_payload?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      chart_treatments: {
        Row: {
          after_photo_url: string | null
          before_photo_url: string | null
          booking_id: string | null
          color_recipe: Json | null
          created_at: string
          customer_id: string
          customer_reaction: string | null
          duration_minutes: number | null
          extra_photo_urls: string[] | null
          id: string
          location_id: string | null
          menu_summary: string | null
          next_suggestion: string | null
          owner_id: string
          perm_recipe: Json | null
          products_used: Json | null
          staff_id: string | null
          staff_notes: string | null
          treatment_date: string
          updated_at: string
        }
        Insert: {
          after_photo_url?: string | null
          before_photo_url?: string | null
          booking_id?: string | null
          color_recipe?: Json | null
          created_at?: string
          customer_id: string
          customer_reaction?: string | null
          duration_minutes?: number | null
          extra_photo_urls?: string[] | null
          id?: string
          location_id?: string | null
          menu_summary?: string | null
          next_suggestion?: string | null
          owner_id: string
          perm_recipe?: Json | null
          products_used?: Json | null
          staff_id?: string | null
          staff_notes?: string | null
          treatment_date?: string
          updated_at?: string
        }
        Update: {
          after_photo_url?: string | null
          before_photo_url?: string | null
          booking_id?: string | null
          color_recipe?: Json | null
          created_at?: string
          customer_id?: string
          customer_reaction?: string | null
          duration_minutes?: number | null
          extra_photo_urls?: string[] | null
          id?: string
          location_id?: string | null
          menu_summary?: string | null
          next_suggestion?: string | null
          owner_id?: string
          perm_recipe?: Json | null
          products_used?: Json | null
          staff_id?: string | null
          staff_notes?: string | null
          treatment_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: string
          location_id: string | null
          owner_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          location_id?: string | null
          owner_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: string
          location_id?: string | null
          owner_id?: string
          title?: string
        }
        Relationships: []
      }
      customer_ai_insights: {
        Row: {
          created_at: string
          customer_id: string
          generated_at: string
          id: string
          location_id: string | null
          next_visit_suggestion: string | null
          owner_id: string
          preferred_tone: string | null
          recommendations: Json | null
          risks: Json | null
          summary: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          generated_at?: string
          id?: string
          location_id?: string | null
          next_visit_suggestion?: string | null
          owner_id: string
          preferred_tone?: string | null
          recommendations?: Json | null
          risks?: Json | null
          summary?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          generated_at?: string
          id?: string
          location_id?: string | null
          next_visit_suggestion?: string | null
          owner_id?: string
          preferred_tone?: string | null
          recommendations?: Json | null
          risks?: Json | null
          summary?: string | null
        }
        Relationships: []
      }
      customer_charts: {
        Row: {
          allergies: string | null
          created_at: string
          customer_id: string
          damage_level: number | null
          hair_density: string | null
          hair_thickness: string | null
          hair_type: string | null
          has_diamine_allergy: boolean
          id: string
          internal_notes: string | null
          is_pregnant: boolean
          location_id: string | null
          medical_notes: string | null
          ng_keywords: string | null
          owner_id: string
          preferred_scent: string | null
          preferred_style: string | null
          preferred_talk_level: number | null
          pregnancy_due_date: string | null
          scalp_condition: string | null
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          created_at?: string
          customer_id: string
          damage_level?: number | null
          hair_density?: string | null
          hair_thickness?: string | null
          hair_type?: string | null
          has_diamine_allergy?: boolean
          id?: string
          internal_notes?: string | null
          is_pregnant?: boolean
          location_id?: string | null
          medical_notes?: string | null
          ng_keywords?: string | null
          owner_id: string
          preferred_scent?: string | null
          preferred_style?: string | null
          preferred_talk_level?: number | null
          pregnancy_due_date?: string | null
          scalp_condition?: string | null
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          created_at?: string
          customer_id?: string
          damage_level?: number | null
          hair_density?: string | null
          hair_thickness?: string | null
          hair_type?: string | null
          has_diamine_allergy?: boolean
          id?: string
          internal_notes?: string | null
          is_pregnant?: boolean
          location_id?: string | null
          medical_notes?: string | null
          ng_keywords?: string | null
          owner_id?: string
          preferred_scent?: string | null
          preferred_style?: string | null
          preferred_talk_level?: number | null
          pregnancy_due_date?: string | null
          scalp_condition?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customer_communication_state: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          last_channel: string | null
          last_sent_at: string | null
          last_template_key: string | null
          location_id: string | null
          monthly_count: number
          monthly_period_start: string
          owner_id: string
          total_sent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          last_channel?: string | null
          last_sent_at?: string | null
          last_template_key?: string | null
          location_id?: string | null
          monthly_count?: number
          monthly_period_start?: string
          owner_id: string
          total_sent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          last_channel?: string | null
          last_sent_at?: string | null
          last_template_key?: string | null
          location_id?: string | null
          monthly_count?: number
          monthly_period_start?: string
          owner_id?: string
          total_sent?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_line_link_tokens: {
        Row: {
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          owner_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          expires_at?: string
          id?: string
          owner_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          owner_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      customer_message_templates: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          kind: string
          location_id: string | null
          owner_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          kind?: string
          location_id?: string | null
          owner_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          kind?: string
          location_id?: string | null
          owner_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_tag_assignments: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          owner_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          owner_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          owner_id?: string
          tag_id?: string
        }
        Relationships: []
      }
      customer_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          activated_at: string | null
          birthday: string | null
          created_at: string
          email: string | null
          first_imported_at: string | null
          full_name: string
          gender: Database["public"]["Enums"]["customer_gender"]
          id: string
          imported_from: string | null
          info_request_last_sent_at: string | null
          info_request_pending: Json | null
          is_test: boolean
          last_imported_at: string | null
          last_visit_date: string | null
          line_unfollowed_at: string | null
          line_user_id: string | null
          location_id: string | null
          name_kana: string | null
          notes: string | null
          opt_out_at: string | null
          opt_out_automation: boolean
          opt_out_reason: string | null
          owner_id: string
          phone: string | null
          quiet_until: string | null
          referred_by: string | null
          salonboard_customer_id: string | null
          salonboard_customer_no: string | null
          total_spent: number
          updated_at: string
          visit_count: number
        }
        Insert: {
          activated_at?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          first_imported_at?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["customer_gender"]
          id?: string
          imported_from?: string | null
          info_request_last_sent_at?: string | null
          info_request_pending?: Json | null
          is_test?: boolean
          last_imported_at?: string | null
          last_visit_date?: string | null
          line_unfollowed_at?: string | null
          line_user_id?: string | null
          location_id?: string | null
          name_kana?: string | null
          notes?: string | null
          opt_out_at?: string | null
          opt_out_automation?: boolean
          opt_out_reason?: string | null
          owner_id: string
          phone?: string | null
          quiet_until?: string | null
          referred_by?: string | null
          salonboard_customer_id?: string | null
          salonboard_customer_no?: string | null
          total_spent?: number
          updated_at?: string
          visit_count?: number
        }
        Update: {
          activated_at?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          first_imported_at?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["customer_gender"]
          id?: string
          imported_from?: string | null
          info_request_last_sent_at?: string | null
          info_request_pending?: Json | null
          is_test?: boolean
          last_imported_at?: string | null
          last_visit_date?: string | null
          line_unfollowed_at?: string | null
          line_user_id?: string | null
          location_id?: string | null
          name_kana?: string | null
          notes?: string | null
          opt_out_at?: string | null
          opt_out_automation?: boolean
          opt_out_reason?: string | null
          owner_id?: string
          phone?: string | null
          quiet_until?: string | null
          referred_by?: string | null
          salonboard_customer_id?: string | null
          salonboard_customer_no?: string | null
          total_spent?: number
          updated_at?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      extension_download_consents: {
        Row: {
          consent_proper_use: boolean
          consent_risk_self_responsibility: boolean
          consent_unofficial: boolean
          created_at: string
          id: string
          ip: string | null
          tenant_id: string | null
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_proper_use?: boolean
          consent_risk_self_responsibility?: boolean
          consent_unofficial?: boolean
          created_at?: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_proper_use?: boolean
          consent_risk_self_responsibility?: boolean
          consent_unofficial?: boolean
          created_at?: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      extension_download_logs: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string
          version: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id: string
          version?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
      external_reservation_logs: {
        Row: {
          created_at: string
          created_booking_id: string | null
          error: string | null
          id: string
          idempotency_key: string | null
          inbound_message_id: string | null
          location_id: string | null
          matched_customer_id: string | null
          owner_id: string | null
          parsed_data: Json | null
          raw_from: string | null
          raw_subject: string | null
          raw_text: string | null
          raw_to: string | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          created_booking_id?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          location_id?: string | null
          matched_customer_id?: string | null
          owner_id?: string | null
          parsed_data?: Json | null
          raw_from?: string | null
          raw_subject?: string | null
          raw_text?: string | null
          raw_to?: string | null
          source: string
          status?: string
        }
        Update: {
          created_at?: string
          created_booking_id?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string | null
          inbound_message_id?: string | null
          location_id?: string | null
          matched_customer_id?: string | null
          owner_id?: string | null
          parsed_data?: Json | null
          raw_from?: string | null
          raw_subject?: string | null
          raw_text?: string | null
          raw_to?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      help_article_feedback: {
        Row: {
          article_slug: string
          comment: string | null
          created_at: string
          helpful: boolean
          id: string
          user_id: string
        }
        Insert: {
          article_slug: string
          comment?: string | null
          created_at?: string
          helpful: boolean
          id?: string
          user_id: string
        }
        Update: {
          article_slug?: string
          comment?: string | null
          created_at?: string
          helpful?: boolean
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      help_articles: {
        Row: {
          body: string
          category: string
          cover_image_url: string | null
          created_at: string
          helpful_no: number
          helpful_yes: number
          id: string
          keywords: string[] | null
          published: boolean
          reading_minutes: number
          related_routes: string[] | null
          related_slugs: string[]
          slug: string
          sort_order: number
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          body: string
          category: string
          cover_image_url?: string | null
          created_at?: string
          helpful_no?: number
          helpful_yes?: number
          id?: string
          keywords?: string[] | null
          published?: boolean
          reading_minutes?: number
          related_routes?: string[] | null
          related_slugs?: string[]
          slug: string
          sort_order?: number
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          body?: string
          category?: string
          cover_image_url?: string | null
          created_at?: string
          helpful_no?: number
          helpful_yes?: number
          id?: string
          keywords?: string[] | null
          published?: boolean
          reading_minutes?: number
          related_routes?: string[] | null
          related_slugs?: string[]
          slug?: string
          sort_order?: number
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      incentives: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          estimated_cost: number | null
          id: string
          kind: string
          location_id: string | null
          owner_id: string
          sort_order: number
          target_segment: string | null
          terms: string | null
          title: string
          updated_at: string
          usage_limit: number | null
          used_count: number
          valid_until: string | null
          value_label: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          kind?: string
          location_id?: string | null
          owner_id: string
          sort_order?: number
          target_segment?: string | null
          terms?: string | null
          title: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_until?: string | null
          value_label?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          kind?: string
          location_id?: string | null
          owner_id?: string
          sort_order?: number
          target_segment?: string | null
          terms?: string | null
          title?: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_until?: string | null
          value_label?: string | null
        }
        Relationships: []
      }
      line_field_detections: {
        Row: {
          applied: Json
          created_at: string
          customer_id: string | null
          detected: Json
          id: string
          line_user_id: string
          needs_confirmation: boolean
          owner_id: string
          raw_text: string
        }
        Insert: {
          applied: Json
          created_at?: string
          customer_id?: string | null
          detected: Json
          id?: string
          line_user_id: string
          needs_confirmation?: boolean
          owner_id: string
          raw_text: string
        }
        Update: {
          applied?: Json
          created_at?: string
          customer_id?: string | null
          detected?: Json
          id?: string
          line_user_id?: string
          needs_confirmation?: boolean
          owner_id?: string
          raw_text?: string
        }
        Relationships: []
      }
      line_inbound_messages: {
        Row: {
          ai_error: string | null
          ai_processed: boolean
          created_at: string
          customer_id: string | null
          display_name: string | null
          handled: boolean
          handled_at: string | null
          id: string
          intent: string | null
          line_user_id: string
          location_id: string | null
          message_text: string
          owner_id: string
          suggested_action: string | null
          summary: string | null
          urgency: string
        }
        Insert: {
          ai_error?: string | null
          ai_processed?: boolean
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          handled?: boolean
          handled_at?: string | null
          id?: string
          intent?: string | null
          line_user_id: string
          location_id?: string | null
          message_text: string
          owner_id: string
          suggested_action?: string | null
          summary?: string | null
          urgency?: string
        }
        Update: {
          ai_error?: string | null
          ai_processed?: boolean
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          handled?: boolean
          handled_at?: string | null
          id?: string
          intent?: string | null
          line_user_id?: string
          location_id?: string | null
          message_text?: string
          owner_id?: string
          suggested_action?: string | null
          summary?: string | null
          urgency?: string
        }
        Relationships: []
      }
      line_message_log: {
        Row: {
          broadcast_id: string | null
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          job_type: string
          line_user_id: string | null
          location_id: string | null
          message: string
          owner_id: string
          status: string
          template_key: string | null
        }
        Insert: {
          broadcast_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          job_type: string
          line_user_id?: string | null
          location_id?: string | null
          message: string
          owner_id: string
          status?: string
          template_key?: string | null
        }
        Update: {
          broadcast_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          job_type?: string
          line_user_id?: string | null
          location_id?: string | null
          message?: string
          owner_id?: string
          status?: string
          template_key?: string | null
        }
        Relationships: []
      }
      line_pending_friends: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          last_message: string | null
          line_user_id: string
          location_id: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          last_message?: string | null
          line_user_id: string
          location_id?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          last_message?: string | null
          line_user_id?: string
          location_id?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_registration_logs: {
        Row: {
          action: string
          created_at: string
          customer_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          line_user_id: string | null
          location_id: string | null
          owner_id: string
          phone_masked: string | null
          raw_event_id: string | null
          success: boolean
        }
        Insert: {
          action: string
          created_at?: string
          customer_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          line_user_id?: string | null
          location_id?: string | null
          owner_id: string
          phone_masked?: string | null
          raw_event_id?: string | null
          success?: boolean
        }
        Update: {
          action?: string
          created_at?: string
          customer_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          line_user_id?: string | null
          location_id?: string | null
          owner_id?: string
          phone_masked?: string | null
          raw_event_id?: string | null
          success?: boolean
        }
        Relationships: []
      }
      line_templates: {
        Row: {
          category: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          id: string
          image_url: string | null
          location_id: string | null
          message: string
          owner_id: string
          title: string
          updated_at: string
          use_count: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          id?: string
          image_url?: string | null
          location_id?: string | null
          message: string
          owner_id: string
          title: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          id?: string
          image_url?: string | null
          location_id?: string | null
          message?: string
          owner_id?: string
          title?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: []
      }
      location_members: {
        Row: {
          created_at: string
          id: string
          location_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_members_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          close_time: string | null
          created_at: string
          google_review_url: string | null
          id: string
          inbound_key: string | null
          is_primary: boolean
          line_add_friend_url: string | null
          line_channel_access_token: string | null
          line_channel_secret: string | null
          line_rich_menu_id: string | null
          name: string
          open_time: string | null
          owner_notification_email: string | null
          public_slug: string | null
          reminder_enabled: boolean
          reminder_hour: number
          tenant_id: string
          test_mode: boolean
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          google_review_url?: string | null
          id?: string
          inbound_key?: string | null
          is_primary?: boolean
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          line_rich_menu_id?: string | null
          name: string
          open_time?: string | null
          owner_notification_email?: string | null
          public_slug?: string | null
          reminder_enabled?: boolean
          reminder_hour?: number
          tenant_id: string
          test_mode?: boolean
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          google_review_url?: string | null
          id?: string
          inbound_key?: string | null
          is_primary?: boolean
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          line_rich_menu_id?: string | null
          name?: string
          open_time?: string | null
          owner_notification_email?: string | null
          public_slug?: string | null
          reminder_enabled?: boolean
          reminder_hour?: number
          tenant_id?: string
          test_mode?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_channel_mappings: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          external_id: string | null
          external_name: string | null
          external_setmenu_id: string | null
          id: string
          location_id: string | null
          menu_category_cd: string | null
          menu_id: string
          net_coupon_id: string | null
          owner_id: string
          rsv_term: number | null
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          external_id?: string | null
          external_name?: string | null
          external_setmenu_id?: string | null
          id?: string
          location_id?: string | null
          menu_category_cd?: string | null
          menu_id: string
          net_coupon_id?: string | null
          owner_id: string
          rsv_term?: number | null
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          external_id?: string | null
          external_name?: string | null
          external_setmenu_id?: string | null
          id?: string
          location_id?: string | null
          menu_category_cd?: string | null
          menu_id?: string
          net_coupon_id?: string | null
          owner_id?: string
          rsv_term?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_channel_mappings_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          active: boolean
          buffer_minutes: number
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          image_url: string | null
          location_id: string | null
          name: string
          owner_id: string
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          buffer_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          image_url?: string | null
          location_id?: string | null
          name: string
          owner_id: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          buffer_minutes?: number
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          image_url?: string | null
          location_id?: string | null
          name?: string
          owner_id?: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      point_redemption_items: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          kind: string
          location_id: string | null
          name: string
          owner_id: string
          points_cost: number
          sort_order: number
          stock: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          location_id?: string | null
          name: string
          owner_id: string
          points_cost: number
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          location_id?: string | null
          name?: string
          owner_id?: string
          points_cost?: number
          sort_order?: number
          stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      point_redemptions: {
        Row: {
          applied_at: string | null
          booking_id: string | null
          cancelled_at: string | null
          created_at: string
          customer_id: string
          id: string
          item_id: string
          item_name_snapshot: string
          owner_id: string
          points_used: number
          status: string
        }
        Insert: {
          applied_at?: string | null
          booking_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          item_id: string
          item_name_snapshot: string
          owner_id: string
          points_used: number
          status?: string
        }
        Update: {
          applied_at?: string | null
          booking_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          item_id?: string
          item_name_snapshot?: string
          owner_id?: string
          points_used?: number
          status?: string
        }
        Relationships: []
      }
      point_transactions: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          kind: string
          location_id: string | null
          note: string | null
          owner_id: string
          points: number
          reference_booking_id: string | null
          reference_redemption_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          kind: string
          location_id?: string | null
          note?: string | null
          owner_id: string
          points: number
          reference_booking_id?: string | null
          reference_redemption_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          kind?: string
          location_id?: string | null
          note?: string | null
          owner_id?: string
          points?: number
          reference_booking_id?: string | null
          reference_redemption_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aftercare_delay_days: number
          allow_customer_cancel: boolean
          approval_mode: string
          approval_required_templates: string[]
          auto_reply_enabled: boolean
          auto_reply_message: string | null
          auto_reply_use_ai: boolean
          birthday_discount_percent: number
          birthday_enabled: boolean
          booking_lead_time_hours: number
          booking_max_days_ahead: number
          cancel_deadline_hours: number
          close_time: string | null
          created_at: string
          frequency_cap_days: number
          frequency_cap_per_month: number
          full_name: string | null
          google_review_url: string | null
          id: string
          import_quiet_days: number
          inbound_key: string | null
          info_collection_append_to_thanks: boolean
          info_collection_enabled: boolean
          line_add_friend_url: string | null
          line_booking_paused: boolean
          line_booking_paused_message: string | null
          line_channel_access_token: string | null
          line_channel_secret: string | null
          line_reservation_auto_reply: string | null
          line_reservation_enabled: boolean
          line_reservation_outside_hours_reply: string | null
          line_rich_menu_id: string | null
          notification_recipients: Json
          onboarding_completed_at: string | null
          onboarding_progress: Json
          open_time: string | null
          owner_notification_email: string | null
          points_earn_rate_percent: number
          points_enabled: boolean
          points_signup_bonus: number
          public_menus: string[] | null
          public_slug: string | null
          reactivation_enabled: boolean
          reactivation_stages: Json
          reminder_enabled: boolean
          reminder_hour: number
          salon_name: string | null
          test_mode: boolean
          thank_you_delay_days: number
          tour_completed: boolean
          updated_at: string
        }
        Insert: {
          aftercare_delay_days?: number
          allow_customer_cancel?: boolean
          approval_mode?: string
          approval_required_templates?: string[]
          auto_reply_enabled?: boolean
          auto_reply_message?: string | null
          auto_reply_use_ai?: boolean
          birthday_discount_percent?: number
          birthday_enabled?: boolean
          booking_lead_time_hours?: number
          booking_max_days_ahead?: number
          cancel_deadline_hours?: number
          close_time?: string | null
          created_at?: string
          frequency_cap_days?: number
          frequency_cap_per_month?: number
          full_name?: string | null
          google_review_url?: string | null
          id: string
          import_quiet_days?: number
          inbound_key?: string | null
          info_collection_append_to_thanks?: boolean
          info_collection_enabled?: boolean
          line_add_friend_url?: string | null
          line_booking_paused?: boolean
          line_booking_paused_message?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          line_reservation_auto_reply?: string | null
          line_reservation_enabled?: boolean
          line_reservation_outside_hours_reply?: string | null
          line_rich_menu_id?: string | null
          notification_recipients?: Json
          onboarding_completed_at?: string | null
          onboarding_progress?: Json
          open_time?: string | null
          owner_notification_email?: string | null
          points_earn_rate_percent?: number
          points_enabled?: boolean
          points_signup_bonus?: number
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reactivation_stages?: Json
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          thank_you_delay_days?: number
          tour_completed?: boolean
          updated_at?: string
        }
        Update: {
          aftercare_delay_days?: number
          allow_customer_cancel?: boolean
          approval_mode?: string
          approval_required_templates?: string[]
          auto_reply_enabled?: boolean
          auto_reply_message?: string | null
          auto_reply_use_ai?: boolean
          birthday_discount_percent?: number
          birthday_enabled?: boolean
          booking_lead_time_hours?: number
          booking_max_days_ahead?: number
          cancel_deadline_hours?: number
          close_time?: string | null
          created_at?: string
          frequency_cap_days?: number
          frequency_cap_per_month?: number
          full_name?: string | null
          google_review_url?: string | null
          id?: string
          import_quiet_days?: number
          inbound_key?: string | null
          info_collection_append_to_thanks?: boolean
          info_collection_enabled?: boolean
          line_add_friend_url?: string | null
          line_booking_paused?: boolean
          line_booking_paused_message?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          line_reservation_auto_reply?: string | null
          line_reservation_enabled?: boolean
          line_reservation_outside_hours_reply?: string | null
          line_rich_menu_id?: string | null
          notification_recipients?: Json
          onboarding_completed_at?: string | null
          onboarding_progress?: Json
          open_time?: string | null
          owner_notification_email?: string | null
          points_earn_rate_percent?: number
          points_enabled?: boolean
          points_signup_bonus?: number
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reactivation_stages?: Json
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          thank_you_delay_days?: number
          tour_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      reactivation_segment_templates: {
        Row: {
          body: string | null
          created_at: string
          cta_label: string | null
          discount_percent: number | null
          enabled: boolean
          id: string
          owner_id: string
          segment: Database["public"]["Enums"]["retention_segment"]
          subject: string | null
          tone: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          cta_label?: string | null
          discount_percent?: number | null
          enabled?: boolean
          id?: string
          owner_id: string
          segment: Database["public"]["Enums"]["retention_segment"]
          subject?: string | null
          tone?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          cta_label?: string | null
          discount_percent?: number | null
          enabled?: boolean
          id?: string
          owner_id?: string
          segment?: Database["public"]["Enums"]["retention_segment"]
          subject?: string | null
          tone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reservation_action_tokens: {
        Row: {
          action: string
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          recipient_line_user_id: string | null
          request_id: string
          token_hash: string
          used_at: string | null
          used_ip: string | null
          used_ua: string | null
        }
        Insert: {
          action: string
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          recipient_line_user_id?: string | null
          request_id: string
          token_hash: string
          used_at?: string | null
          used_ip?: string | null
          used_ua?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          recipient_line_user_id?: string | null
          request_id?: string
          token_hash?: string
          used_at?: string | null
          used_ip?: string | null
          used_ua?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_action_tokens_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "reservation_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_ai_logs: {
        Row: {
          ai_confidence: number | null
          ai_extracted: Json | null
          ai_is_reservation: boolean | null
          ai_summary: string | null
          created_at: string
          customer_id: string | null
          decided_at: string | null
          false_positive: boolean | null
          final_action: string | null
          final_corrected: boolean | null
          id: string
          keyword_score: number | null
          needs_clarification_fields: string[] | null
          owner_id: string
          raw_message: string
          request_id: string | null
          staff_feedback: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_extracted?: Json | null
          ai_is_reservation?: boolean | null
          ai_summary?: string | null
          created_at?: string
          customer_id?: string | null
          decided_at?: string | null
          false_positive?: boolean | null
          final_action?: string | null
          final_corrected?: boolean | null
          id?: string
          keyword_score?: number | null
          needs_clarification_fields?: string[] | null
          owner_id: string
          raw_message: string
          request_id?: string | null
          staff_feedback?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_extracted?: Json | null
          ai_is_reservation?: boolean | null
          ai_summary?: string | null
          created_at?: string
          customer_id?: string | null
          decided_at?: string | null
          false_positive?: boolean | null
          final_action?: string | null
          final_corrected?: boolean | null
          id?: string
          keyword_score?: number | null
          needs_clarification_fields?: string[] | null
          owner_id?: string
          raw_message?: string
          request_id?: string | null
          staff_feedback?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_ai_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "reservation_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_requests: {
        Row: {
          ai_confidence: number
          ai_model: string | null
          ai_parsed: Json
          approved_at: string | null
          approved_by: string | null
          auto_reply_sent_at: string | null
          confirmed_date: string | null
          confirmed_menu: string | null
          confirmed_staff_id: string | null
          confirmed_time: string | null
          created_at: string
          customer_id: string | null
          desired_date_candidates: Json
          desired_menu: string | null
          desired_menu_items: string[] | null
          desired_staff_id: string | null
          desired_staff_name: string | null
          display_name: string | null
          id: string
          line_user_id: string | null
          location_id: string | null
          needs_clarification_fields: string[]
          outside_hours_notified: boolean
          owner_id: string
          raw_message: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          salonboard_transfer_text: string | null
          salonboard_transferred_at: string | null
          staff_memo: string | null
          staff_notification_status: string | null
          staff_notified_at: string | null
          status: Database["public"]["Enums"]["reservation_request_status"]
          updated_at: string
        }
        Insert: {
          ai_confidence?: number
          ai_model?: string | null
          ai_parsed?: Json
          approved_at?: string | null
          approved_by?: string | null
          auto_reply_sent_at?: string | null
          confirmed_date?: string | null
          confirmed_menu?: string | null
          confirmed_staff_id?: string | null
          confirmed_time?: string | null
          created_at?: string
          customer_id?: string | null
          desired_date_candidates?: Json
          desired_menu?: string | null
          desired_menu_items?: string[] | null
          desired_staff_id?: string | null
          desired_staff_name?: string | null
          display_name?: string | null
          id?: string
          line_user_id?: string | null
          location_id?: string | null
          needs_clarification_fields?: string[]
          outside_hours_notified?: boolean
          owner_id: string
          raw_message: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          salonboard_transfer_text?: string | null
          salonboard_transferred_at?: string | null
          staff_memo?: string | null
          staff_notification_status?: string | null
          staff_notified_at?: string | null
          status?: Database["public"]["Enums"]["reservation_request_status"]
          updated_at?: string
        }
        Update: {
          ai_confidence?: number
          ai_model?: string | null
          ai_parsed?: Json
          approved_at?: string | null
          approved_by?: string | null
          auto_reply_sent_at?: string | null
          confirmed_date?: string | null
          confirmed_menu?: string | null
          confirmed_staff_id?: string | null
          confirmed_time?: string | null
          created_at?: string
          customer_id?: string | null
          desired_date_candidates?: Json
          desired_menu?: string | null
          desired_menu_items?: string[] | null
          desired_staff_id?: string | null
          desired_staff_name?: string | null
          display_name?: string | null
          id?: string
          line_user_id?: string | null
          location_id?: string | null
          needs_clarification_fields?: string[]
          outside_hours_notified?: boolean
          owner_id?: string
          raw_message?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          salonboard_transfer_text?: string | null
          salonboard_transferred_at?: string | null
          staff_memo?: string | null
          staff_notification_status?: string | null
          staff_notified_at?: string | null
          status?: Database["public"]["Enums"]["reservation_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      salon_hours: {
        Row: {
          close_time: string
          closed: boolean
          created_at: string
          id: string
          location_id: string | null
          open_time: string
          owner_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          close_time?: string
          closed?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          open_time?: string
          owner_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          close_time?: string
          closed?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          open_time?: string
          owner_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      salon_parking_settings: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          owner_id: string
          parking_description: string | null
          parking_fee_note: string | null
          parking_full_notice: string | null
          parking_landmark: string | null
          parking_map_url: string | null
          parking_photo_url: string | null
          parking_reply_template: string | null
          parking_spaces: number | null
          parking_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          owner_id: string
          parking_description?: string | null
          parking_fee_note?: string | null
          parking_full_notice?: string | null
          parking_landmark?: string | null
          parking_map_url?: string | null
          parking_photo_url?: string | null
          parking_reply_template?: string | null
          parking_spaces?: number | null
          parking_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          owner_id?: string
          parking_description?: string | null
          parking_fee_note?: string | null
          parking_full_notice?: string | null
          parking_landmark?: string | null
          parking_map_url?: string | null
          parking_photo_url?: string | null
          parking_reply_template?: string | null
          parking_spaces?: number | null
          parking_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      salonboard_credentials: {
        Row: {
          cookie_session_encrypted: string | null
          created_at: string
          id: string
          last_error: string | null
          last_login_at: string | null
          login_id_encrypted: string
          login_status: string
          password_encrypted: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cookie_session_encrypted?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          login_id_encrypted: string
          login_status?: string
          password_encrypted: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cookie_session_encrypted?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          login_id_encrypted?: string
          login_status?: string
          password_encrypted?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salonboard_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      salonboard_import_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          inserted_count: number
          location_id: string | null
          meta: Json | null
          owner_id: string
          reservations_received: number
          skipped_count: number
          source: string
          status: string
          total_received: number
          updated_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          inserted_count?: number
          location_id?: string | null
          meta?: Json | null
          owner_id: string
          reservations_received?: number
          skipped_count?: number
          source?: string
          status?: string
          total_received?: number
          updated_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          inserted_count?: number
          location_id?: string | null
          meta?: Json | null
          owner_id?: string
          reservations_received?: number
          skipped_count?: number
          source?: string
          status?: string
          total_received?: number
          updated_count?: number
          user_id?: string
        }
        Relationships: []
      }
      salonboard_sessions: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_login_at: string | null
          location_id: string | null
          login_id_encrypted: string | null
          login_status: string
          owner_id: string
          password_encrypted: string | null
          storage_state_encrypted: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          location_id?: string | null
          login_id_encrypted?: string | null
          login_status?: string
          owner_id: string
          password_encrypted?: string | null
          storage_state_encrypted?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_login_at?: string | null
          location_id?: string | null
          login_id_encrypted?: string | null
          login_status?: string
          owner_id?: string
          password_encrypted?: string | null
          storage_state_encrypted?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      salonboard_sync_jobs: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          operation: string
          payload: Json
          reservation_id: string | null
          salonboard_reservation_id: string | null
          scheduled_at: string
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          operation: string
          payload?: Json
          reservation_id?: string | null
          salonboard_reservation_id?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          operation?: string
          payload?: Json
          reservation_id?: string | null
          salonboard_reservation_id?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salonboard_sync_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_jobs: {
        Row: {
          approval_status: Database["public"]["Enums"]["job_approval_status"]
          approved_at: string | null
          approved_by: string | null
          booking_id: string | null
          created_at: string
          customer_id: string
          error: string | null
          id: string
          job_type: string
          location_id: string | null
          owner_id: string
          payload: Json | null
          rejected_reason: string | null
          scheduled_date: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["job_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          booking_id?: string | null
          created_at?: string
          customer_id: string
          error?: string | null
          id?: string
          job_type: string
          location_id?: string | null
          owner_id: string
          payload?: Json | null
          rejected_reason?: string | null
          scheduled_date?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["job_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          booking_id?: string | null
          created_at?: string
          customer_id?: string
          error?: string | null
          id?: string
          job_type?: string
          location_id?: string | null
          owner_id?: string
          payload?: Json | null
          rejected_reason?: string | null
          scheduled_date?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      sms_message_log: {
        Row: {
          campaign_id: string | null
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          job_type: string | null
          location_id: string | null
          message: string
          metadata: Json
          normalized_phone: string | null
          owner_id: string
          phone: string
          provider: string
          provider_sid: string | null
          scheduled_job_id: string | null
          sent_at: string | null
          source: string
          status: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          job_type?: string | null
          location_id?: string | null
          message: string
          metadata?: Json
          normalized_phone?: string | null
          owner_id: string
          phone: string
          provider?: string
          provider_sid?: string | null
          scheduled_job_id?: string | null
          sent_at?: string | null
          source: string
          status: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          job_type?: string | null
          location_id?: string | null
          message?: string
          metadata?: Json
          normalized_phone?: string | null
          owner_id?: string
          phone?: string
          provider?: string
          provider_sid?: string | null
          scheduled_job_id?: string | null
          sent_at?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          active: boolean
          bookable: boolean
          created_at: string
          display_color: string
          id: string
          location_id: string | null
          name: string
          note: string | null
          owner_id: string
          pin_code: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          bookable?: boolean
          created_at?: string
          display_color?: string
          id?: string
          location_id?: string | null
          name: string
          note?: string | null
          owner_id: string
          pin_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          bookable?: boolean
          created_at?: string
          display_color?: string
          id?: string
          location_id?: string | null
          name?: string
          note?: string | null
          owner_id?: string
          pin_code?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      staff_channel_mappings: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          external_id: string | null
          external_name: string | null
          id: string
          is_no_designation: boolean
          location_id: string | null
          owner_id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          external_id?: string | null
          external_name?: string | null
          id?: string
          is_no_designation?: boolean
          location_id?: string | null
          owner_id: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          external_id?: string | null
          external_name?: string | null
          id?: string
          is_no_designation?: boolean
          location_id?: string | null
          owner_id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_channel_mappings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_commission_rules: {
        Row: {
          active: boolean
          base_salary: number
          created_at: string
          free_tech_rate: number
          id: string
          location_id: string | null
          monthly_target: number
          nominated_tech_rate: number
          owner_id: string
          retail_rate: number
          staff_id: string
          target_bonus: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_salary?: number
          created_at?: string
          free_tech_rate?: number
          id?: string
          location_id?: string | null
          monthly_target?: number
          nominated_tech_rate?: number
          owner_id: string
          retail_rate?: number
          staff_id: string
          target_bonus?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_salary?: number
          created_at?: string
          free_tech_rate?: number
          id?: string
          location_id?: string | null
          monthly_target?: number
          nominated_tech_rate?: number
          owner_id?: string
          retail_rate?: number
          staff_id?: string
          target_bonus?: number
          updated_at?: string
        }
        Relationships: []
      }
      staff_schedules: {
        Row: {
          active: boolean
          created_at: string
          end_time: string
          id: string
          location_id: string | null
          owner_id: string
          staff_id: string
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_time?: string
          id?: string
          location_id?: string | null
          owner_id: string
          staff_id: string
          start_time?: string
          updated_at?: string
          weekday: number
        }
        Update: {
          active?: boolean
          created_at?: string
          end_time?: string
          id?: string
          location_id?: string | null
          owner_id?: string
          staff_id?: string
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_time_off: {
        Row: {
          created_at: string
          end_at: string
          id: string
          location_id: string | null
          owner_id: string
          reason: string | null
          staff_id: string
          start_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          id?: string
          location_id?: string | null
          owner_id: string
          reason?: string | null
          staff_id: string
          start_at: string
        }
        Update: {
          created_at?: string
          end_at?: string
          id?: string
          location_id?: string | null
          owner_id?: string
          reason?: string | null
          staff_id?: string
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_time_off_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          locked_at: string | null
          owner_id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          locked_at?: string | null
          owner_id: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          locked_at?: string | null
          owner_id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      support_chat_messages: {
        Row: {
          content: string
          context_route: string | null
          created_at: string
          id: string
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          content: string
          context_route?: string | null
          created_at?: string
          id?: string
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          content?: string
          context_route?: string | null
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          ai_chat_history: Json | null
          context_data: Json | null
          context_route: string | null
          created_at: string
          id: string
          message: string
          owner_id: string
          status: string
          subject: string
          updated_at: string
          user_email: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          ai_chat_history?: Json | null
          context_data?: Json | null
          context_route?: string | null
          created_at?: string
          id?: string
          message: string
          owner_id: string
          status?: string
          subject: string
          updated_at?: string
          user_email: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          ai_chat_history?: Json | null
          context_data?: Json | null
          context_route?: string | null
          created_at?: string
          id?: string
          message?: string
          owner_id?: string
          status?: string
          subject?: string
          updated_at?: string
          user_email?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_diff_snapshots: {
        Row: {
          booking_id: string | null
          channel: string
          checked_at: string
          checked_by: string | null
          created_at: string
          diff: Json | null
          external_payload: Json | null
          external_reservation_id: string | null
          id: string
          local_payload: Json | null
          location_id: string | null
          owner_id: string
          reason: string | null
          result: string
        }
        Insert: {
          booking_id?: string | null
          channel?: string
          checked_at?: string
          checked_by?: string | null
          created_at?: string
          diff?: Json | null
          external_payload?: Json | null
          external_reservation_id?: string | null
          id?: string
          local_payload?: Json | null
          location_id?: string | null
          owner_id: string
          reason?: string | null
          result: string
        }
        Update: {
          booking_id?: string | null
          channel?: string
          checked_at?: string
          checked_by?: string | null
          created_at?: string
          diff?: Json | null
          external_payload?: Json | null
          external_reservation_id?: string | null
          id?: string
          local_payload?: Json | null
          location_id?: string | null
          owner_id?: string
          reason?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_diff_snapshots_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          error_type: string | null
          id: string
          job_type: string
          location_id: string | null
          owner_id: string
          request_payload: Json | null
          reservation_id: string | null
          response_payload: Json | null
          retry_count: number
          status: string
          target_channel: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          id?: string
          job_type: string
          location_id?: string | null
          owner_id: string
          request_payload?: Json | null
          reservation_id?: string | null
          response_payload?: Json | null
          retry_count?: number
          status?: string
          target_channel: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          id?: string
          job_type?: string
          location_id?: string | null
          owner_id?: string
          request_payload?: Json | null
          reservation_id?: string | null
          response_payload?: Json | null
          retry_count?: number
          status?: string
          target_channel?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          channel: string | null
          created_at: string
          id: string
          level: string
          message: string
          metadata: Json | null
          owner_id: string
          reservation_id: string | null
          sync_job_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string
          id?: string
          level?: string
          message: string
          metadata?: Json | null
          owner_id: string
          reservation_id?: string | null
          sync_job_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          owner_id?: string
          reservation_id?: string | null
          sync_job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_sync_job_id_fkey"
            columns: ["sync_job_id"]
            isOneToOne: false
            referencedRelation: "sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      template_overrides: {
        Row: {
          body: string | null
          channel: string
          coupon_id: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          enabled: boolean
          greeting: string | null
          id: string
          incentive_id: string | null
          location_id: string | null
          owner_id: string
          signature: string | null
          subject: string | null
          template_key: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          channel: string
          coupon_id?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          enabled?: boolean
          greeting?: string | null
          id?: string
          incentive_id?: string | null
          location_id?: string | null
          owner_id: string
          signature?: string | null
          subject?: string | null
          template_key: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          channel?: string
          coupon_id?: string | null
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          enabled?: boolean
          greeting?: string | null
          id?: string
          incentive_id?: string | null
          location_id?: string | null
          owner_id?: string
          signature?: string | null
          subject?: string | null
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          location_ids: string[] | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          location_ids?: string[] | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          location_ids?: string[] | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          accepted_at: string
          created_at: string
          invited_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          invited_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          invited_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tenant_usage_counters: {
        Row: {
          emails_sent: number
          line_sent: number
          location_id: string | null
          owner_id: string
          period_start: string
          sms_sent: number
          updated_at: string
        }
        Insert: {
          emails_sent?: number
          line_sent?: number
          location_id?: string | null
          owner_id: string
          period_start: string
          sms_sent?: number
          updated_at?: string
        }
        Update: {
          emails_sent?: number
          line_sent?: number
          location_id?: string | null
          owner_id?: string
          period_start?: string
          sms_sent?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          location_quota: number
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_quota?: number
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_quota?: number
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      worker_request_logs: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          id: string
          kind: string
          latency_ms: number | null
          location_id: string | null
          owner_id: string
          request_payload: Json | null
          response_body: Json | null
          response_status: number | null
          success: boolean
        }
        Insert: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          kind: string
          latency_ms?: number | null
          location_id?: string | null
          owner_id: string
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          success?: boolean
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          kind?: string
          latency_ms?: number | null
          location_id?: string | null
          owner_id?: string
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          success?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      customer_delivery_timeline: {
        Row: {
          channel: string | null
          customer_id: string | null
          error: string | null
          id: string | null
          owner_id: string | null
          recipient: string | null
          sent_at: string | null
          status: string | null
          template_key: string | null
        }
        Relationships: []
      }
      customer_point_balances: {
        Row: {
          balance: number | null
          customer_id: string | null
          last_activity_at: string | null
          owner_id: string | null
        }
        Relationships: []
      }
      delivery_daily_summary: {
        Row: {
          day: string | null
          failed_count: number | null
          owner_id: string | null
          sent_count: number | null
          suppressed_count: number | null
          template_name: string | null
          total_count: number | null
        }
        Relationships: []
      }
      delivery_upcoming_view: {
        Row: {
          approval_status:
            | Database["public"]["Enums"]["job_approval_status"]
            | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string | null
          job_type: string | null
          location_id: string | null
          opt_out_automation: boolean | null
          owner_id: string | null
          payload: Json | null
          scheduled_for: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_segment: {
        Args: { last_visit: string }
        Returns: Database["public"]["Enums"]["customer_segment"]
      }
      calculate_vip_tier: {
        Args: { _total_spent: number; _visit_count: number }
        Returns: string
      }
      can_access_location: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_location: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      can_send_to_customer: {
        Args: {
          _cap_days?: number
          _cap_per_month?: number
          _customer_id: string
        }
        Returns: Json
      }
      cancel_orphan_reactivation_jobs: {
        Args: { _owner_id: string }
        Returns: number
      }
      classify_customer_segment: {
        Args: { _customer_id: string }
        Returns: Database["public"]["Enums"]["retention_segment"]
      }
      create_anniversary_jobs_for_today: { Args: never; Returns: number }
      create_birthday_jobs_for_month: { Args: never; Returns: number }
      create_holiday_notice_jobs: {
        Args: {
          _end_date?: string
          _notice_body: string
          _notice_title: string
          _start_date?: string
        }
        Returns: Json
      }
      create_reactivation_jobs: { Args: never; Returns: number }
      current_tenant_id: { Args: never; Returns: string }
      default_location_for_owner: {
        Args: { p_owner_id: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_test_data: { Args: { _owner_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_customer_by_normalized_phone: {
        Args: { p_owner_id: string; p_phone: string }
        Returns: {
          full_name: string
          id: string
          line_user_id: string
          location_id: string
          phone: string
        }[]
      }
      get_available_slots: {
        Args: { _date: string; _duration_minutes: number; _salon_slug: string }
        Returns: {
          available_staff_count: number
          slot_time: string
        }[]
      }
      get_available_slots_by_staff: {
        Args: {
          _date: string
          _duration_minutes: number
          _salon_slug: string
          _staff_id?: string
        }
        Returns: {
          available_staff_ids: string[]
          slot_time: string
        }[]
      }
      get_customer_bookings: {
        Args: { _token: string }
        Returns: {
          booking_date: string
          booking_time: string
          can_cancel: boolean
          cancel_deadline_hours: number
          id: string
          menu: string
          staff_name: string
          status: string
          total_duration_minutes: number
          total_price: number
        }[]
      }
      get_customer_point_summary: { Args: { _token: string }; Returns: Json }
      get_my_member_locations: {
        Args: never
        Returns: {
          id: string
          is_primary: boolean
          name: string
          tenant_id: string
        }[]
      }
      get_tenant_members_detail: {
        Args: { _tenant_id: string }
        Returns: {
          accepted_at: string
          email: string
          full_name: string
          location_ids: string[]
          location_names: string[]
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      has_location_role: {
        Args: {
          _location_id: string
          _min_role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _min_role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_location_accessible: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      is_salonboard_live: {
        Args: { _location_id: string; _owner_id: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      last_sent_at: { Args: { _customer_id: string }; Returns: string }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      public_create_booking: {
        Args: {
          _booking_date: string
          _booking_time: string
          _email: string
          _full_name: string
          _menu: string
          _notes: string
          _phone: string
          _salon_slug: string
        }
        Returns: Json
      }
      public_create_booking_v2: {
        Args: {
          _booking_date: string
          _booking_time: string
          _email: string
          _full_name: string
          _menus: string[]
          _notes: string
          _phone: string
          _salon_slug: string
        }
        Returns: Json
      }
      public_create_booking_v3: {
        Args: {
          _booking_date: string
          _booking_time: string
          _email: string
          _full_name: string
          _menus: string[]
          _notes: string
          _phone: string
          _salon_slug: string
          _staff_id?: string
        }
        Returns: Json
      }
      public_create_booking_v4: {
        Args: {
          _booking_date: string
          _booking_time: string
          _email: string
          _full_name: string
          _full_name_kana: string
          _menus: string[]
          _notes: string
          _phone: string
          _salon_slug: string
          _staff_id?: string
        }
        Returns: Json
      }
      public_create_booking_v5: {
        Args: {
          _booking_date: string
          _booking_time: string
          _email: string
          _full_name: string
          _full_name_kana: string
          _menus: string[]
          _notes: string
          _phone: string
          _salon_slug: string
          _staff_id?: string
        }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recompute_channel_status: {
        Args: { _location_id: string; _owner_id: string }
        Returns: string
      }
      record_customer_communication: {
        Args: {
          _channel: string
          _customer_id: string
          _location_id: string
          _owner_id: string
          _template_key: string
        }
        Returns: undefined
      }
      redeem_customer_points: {
        Args: { _item_id: string; _token: string }
        Returns: Json
      }
      user_tenant_id: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role: "owner" | "staff" | "manager" | "super_admin"
      booking_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
        | "pending_sync"
      campaign_status: "draft" | "sending" | "sent" | "failed"
      customer_gender: "female" | "male" | "other" | "unknown"
      customer_segment: "active" | "at_risk" | "dormant" | "new"
      job_approval_status: "auto" | "pending_approval" | "approved" | "rejected"
      reservation_request_status:
        | "pending_clarification"
        | "awaiting_approval"
        | "approved"
        | "rejected"
        | "completed"
        | "expired"
      retention_segment:
        | "cold_1"
        | "warm_mid"
        | "loyal_risk"
        | "lost_1"
        | "churned"
        | "vip_lost"
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
    Enums: {
      app_role: ["owner", "staff", "manager", "super_admin"],
      booking_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
        "pending_sync",
      ],
      campaign_status: ["draft", "sending", "sent", "failed"],
      customer_gender: ["female", "male", "other", "unknown"],
      customer_segment: ["active", "at_risk", "dormant", "new"],
      job_approval_status: ["auto", "pending_approval", "approved", "rejected"],
      reservation_request_status: [
        "pending_clarification",
        "awaiting_approval",
        "approved",
        "rejected",
        "completed",
        "expired",
      ],
      retention_segment: [
        "cold_1",
        "warm_mid",
        "loyal_risk",
        "lost_1",
        "churned",
        "vip_lost",
      ],
    },
  },
} as const

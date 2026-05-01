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
          coupon_id: string | null
          created_at: string
          customer_id: string
          external_reservation_id: string | null
          external_source: string | null
          id: string
          is_test: boolean
          location_id: string | null
          menu: string
          menus: string[] | null
          notes: string | null
          owner_id: string
          revenue: number | null
          source_job_id: string | null
          source_template: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_duration_minutes: number | null
          total_price: number | null
          updated_at: string
        }
        Insert: {
          booking_date: string
          booking_time: string
          campaign_id?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id: string
          external_reservation_id?: string | null
          external_source?: string | null
          id?: string
          is_test?: boolean
          location_id?: string | null
          menu: string
          menus?: string[] | null
          notes?: string | null
          owner_id: string
          revenue?: number | null
          source_job_id?: string | null
          source_template?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_duration_minutes?: number | null
          total_price?: number | null
          updated_at?: string
        }
        Update: {
          booking_date?: string
          booking_time?: string
          campaign_id?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id?: string
          external_reservation_id?: string | null
          external_source?: string | null
          id?: string
          is_test?: boolean
          location_id?: string | null
          menu?: string
          menus?: string[] | null
          notes?: string | null
          owner_id?: string
          revenue?: number | null
          source_job_id?: string | null
          source_template?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
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
      customers: {
        Row: {
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_test: boolean
          last_visit_date: string | null
          line_user_id: string | null
          location_id: string | null
          notes: string | null
          owner_id: string
          phone: string | null
          referred_by: string | null
          total_spent: number
          updated_at: string
          visit_count: number
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_test?: boolean
          last_visit_date?: string | null
          line_user_id?: string | null
          location_id?: string | null
          notes?: string | null
          owner_id: string
          phone?: string | null
          referred_by?: string | null
          total_spent?: number
          updated_at?: string
          visit_count?: number
        }
        Update: {
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_test?: boolean
          last_visit_date?: string | null
          line_user_id?: string | null
          location_id?: string | null
          notes?: string | null
          owner_id?: string
          phone?: string | null
          referred_by?: string | null
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
      external_reservation_logs: {
        Row: {
          created_at: string
          created_booking_id: string | null
          error: string | null
          id: string
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
      profiles: {
        Row: {
          aftercare_delay_days: number
          allow_customer_cancel: boolean
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
          full_name: string | null
          google_review_url: string | null
          id: string
          inbound_key: string | null
          line_add_friend_url: string | null
          line_channel_access_token: string | null
          line_channel_secret: string | null
          onboarding_completed_at: string | null
          onboarding_progress: Json
          open_time: string | null
          owner_notification_email: string | null
          public_menus: string[] | null
          public_slug: string | null
          reactivation_enabled: boolean
          reactivation_stages: Json
          reminder_enabled: boolean
          reminder_hour: number
          salon_name: string | null
          test_mode: boolean
          thank_you_delay_days: number
          updated_at: string
        }
        Insert: {
          aftercare_delay_days?: number
          allow_customer_cancel?: boolean
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
          full_name?: string | null
          google_review_url?: string | null
          id: string
          inbound_key?: string | null
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          onboarding_completed_at?: string | null
          onboarding_progress?: Json
          open_time?: string | null
          owner_notification_email?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reactivation_stages?: Json
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          thank_you_delay_days?: number
          updated_at?: string
        }
        Update: {
          aftercare_delay_days?: number
          allow_customer_cancel?: boolean
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
          full_name?: string | null
          google_review_url?: string | null
          id?: string
          inbound_key?: string | null
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          onboarding_completed_at?: string | null
          onboarding_progress?: Json
          open_time?: string | null
          owner_notification_email?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reactivation_stages?: Json
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          thank_you_delay_days?: number
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
      scheduled_jobs: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_id: string
          error: string | null
          id: string
          job_type: string
          location_id: string | null
          owner_id: string
          payload: Json | null
          scheduled_for: string
          sent_at: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_id: string
          error?: string | null
          id?: string
          job_type: string
          location_id?: string | null
          owner_id: string
          payload?: Json | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string
          error?: string | null
          id?: string
          job_type?: string
          location_id?: string | null
          owner_id?: string
          payload?: Json | null
          scheduled_for?: string
          sent_at?: string | null
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
          sort_order?: number
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
    }
    Views: {
      [_ in never]: never
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
      cancel_orphan_reactivation_jobs: {
        Args: { _owner_id: string }
        Returns: number
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_test_data: { Args: { _owner_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
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
      campaign_status: "draft" | "sending" | "sent" | "failed"
      customer_segment: "active" | "at_risk" | "dormant" | "new"
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
      ],
      campaign_status: ["draft", "sending", "sent", "failed"],
      customer_segment: ["active", "at_risk", "dormant", "new"],
    },
  },
} as const

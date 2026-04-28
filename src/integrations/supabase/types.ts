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
          id: string
          is_test: boolean
          menu: string
          notes: string | null
          owner_id: string
          revenue: number | null
          source_job_id: string | null
          source_template: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          booking_date: string
          booking_time: string
          campaign_id?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_test?: boolean
          menu: string
          notes?: string | null
          owner_id: string
          revenue?: number | null
          source_job_id?: string | null
          source_template?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          booking_date?: string
          booking_time?: string
          campaign_id?: string | null
          coupon_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_test?: boolean
          menu?: string
          notes?: string | null
          owner_id?: string
          revenue?: number | null
          source_job_id?: string | null
          source_template?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
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
          owner_id?: string
          title?: string
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
          notes: string | null
          owner_id: string
          phone: string | null
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
          notes?: string | null
          owner_id: string
          phone?: string | null
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
          notes?: string | null
          owner_id?: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
          visit_count?: number
        }
        Relationships: []
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
      line_templates: {
        Row: {
          category: string | null
          created_at: string
          cta_label: string | null
          cta_url: string | null
          id: string
          image_url: string | null
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
          message?: string
          owner_id?: string
          title?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          close_time: string | null
          created_at: string
          full_name: string | null
          google_review_url: string | null
          id: string
          line_add_friend_url: string | null
          line_channel_access_token: string | null
          line_channel_secret: string | null
          open_time: string | null
          owner_notification_email: string | null
          public_menus: string[] | null
          public_slug: string | null
          reactivation_enabled: boolean
          reminder_enabled: boolean
          reminder_hour: number
          salon_name: string | null
          test_mode: boolean
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          full_name?: string | null
          google_review_url?: string | null
          id: string
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          open_time?: string | null
          owner_notification_email?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          full_name?: string | null
          google_review_url?: string | null
          id?: string
          line_add_friend_url?: string | null
          line_channel_access_token?: string | null
          line_channel_secret?: string | null
          open_time?: string | null
          owner_notification_email?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          reactivation_enabled?: boolean
          reminder_enabled?: boolean
          reminder_hour?: number
          salon_name?: string | null
          test_mode?: boolean
          updated_at?: string
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
          owner_id?: string
          payload?: Json | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
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
          owner_id?: string
          signature?: string | null
          subject?: string | null
          template_key?: string
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
      create_birthday_jobs_for_month: { Args: never; Returns: number }
      create_reactivation_jobs: { Args: never; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_test_data: { Args: { _owner_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "owner" | "staff"
      booking_status: "pending" | "confirmed" | "completed" | "cancelled"
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
      app_role: ["owner", "staff"],
      booking_status: ["pending", "confirmed", "completed", "cancelled"],
      campaign_status: ["draft", "sending", "sent", "failed"],
      customer_segment: ["active", "at_risk", "dormant", "new"],
    },
  },
} as const

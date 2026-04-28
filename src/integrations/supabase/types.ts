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
          menu: string
          notes: string | null
          owner_id: string
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
          menu: string
          notes?: string | null
          owner_id: string
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
          menu?: string
          notes?: string | null
          owner_id?: string
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
          last_visit_date: string | null
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
          last_visit_date?: string | null
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
          last_visit_date?: string | null
          notes?: string | null
          owner_id?: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
          visit_count?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          close_time: string | null
          created_at: string
          full_name: string | null
          id: string
          open_time: string | null
          public_menus: string[] | null
          public_slug: string | null
          salon_name: string | null
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          open_time?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          salon_name?: string | null
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          open_time?: string | null
          public_menus?: string[] | null
          public_slug?: string | null
          salon_name?: string | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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

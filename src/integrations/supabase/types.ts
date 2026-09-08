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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          automation_id: string
          contact_id: string | null
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          log: Json
          mode: Database["public"]["Enums"]["run_mode"]
          organization_id: string
          started_at: string
          status: string
        }
        Insert: {
          automation_id: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          mode?: Database["public"]["Enums"]["run_mode"]
          organization_id: string
          started_at?: string
          status?: string
        }
        Update: {
          automation_id?: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          mode?: Database["public"]["Enums"]["run_mode"]
          organization_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_versions: {
        Row: {
          automation_id: string
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          organization_id: string
          version: number
        }
        Insert: {
          automation_id: string
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          organization_id: string
          version: number
        }
        Update: {
          automation_id?: string
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          organization_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_versions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          current_version: number
          description: string | null
          id: string
          is_demo: boolean
          last_run_at: string | null
          name: string
          organization_id: string
          runs_error: number
          runs_success: number
          runs_total: number
          status: Database["public"]["Enums"]["automation_status"]
          steps: Json
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          description?: string | null
          id?: string
          is_demo?: boolean
          last_run_at?: string | null
          name: string
          organization_id: string
          runs_error?: number
          runs_success?: number
          runs_total?: number
          status?: Database["public"]["Enums"]["automation_status"]
          steps?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version?: number
          description?: string | null
          id?: string
          is_demo?: boolean
          last_run_at?: string | null
          name?: string
          organization_id?: string
          runs_error?: number
          runs_success?: number
          runs_total?: number
          status?: Database["public"]["Enums"]["automation_status"]
          steps?: Json
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          ghl_contact_id: string | null
          ghl_synced_at: string | null
          ghl_synced_version: string | null
          id: string
          is_demo: boolean
          last_interaction_at: string | null
          next_action: string | null
          next_action_at: string | null
          notes: string | null
          organization_id: string
          owner_name: string | null
          phone: string | null
          phone_normalized: string | null
          source: string | null
          stage_key: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          ghl_contact_id?: string | null
          ghl_synced_at?: string | null
          ghl_synced_version?: string | null
          id?: string
          is_demo?: boolean
          last_interaction_at?: string | null
          next_action?: string | null
          next_action_at?: string | null
          notes?: string | null
          organization_id: string
          owner_name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          source?: string | null
          stage_key?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          ghl_contact_id?: string | null
          ghl_synced_at?: string | null
          ghl_synced_version?: string | null
          id?: string
          is_demo?: boolean
          last_interaction_at?: string | null
          next_action?: string | null
          next_action_at?: string | null
          notes?: string | null
          organization_id?: string
          owner_name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          source?: string | null
          stage_key?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: Database["public"]["Enums"]["channel_type"]
          contact_id: string | null
          created_at: string
          ghl_conversation_id: string | null
          id: string
          intent: string | null
          is_demo: boolean
          last_message_at: string | null
          organization_id: string
          priority: string | null
          sentiment: string | null
          summary: string | null
          unread: boolean
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_type"]
          contact_id?: string | null
          created_at?: string
          ghl_conversation_id?: string | null
          id?: string
          intent?: string | null
          is_demo?: boolean
          last_message_at?: string | null
          organization_id: string
          priority?: string | null
          sentiment?: string | null
          summary?: string | null
          unread?: boolean
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_type"]
          contact_id?: string | null
          created_at?: string
          ghl_conversation_id?: string | null
          id?: string
          intent?: string | null
          is_demo?: boolean
          last_message_at?: string | null
          organization_id?: string
          priority?: string | null
          sentiment?: string | null
          summary?: string | null
          unread?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_connections: {
        Row: {
          api_base_url: string
          api_version: string
          calendar_id: string | null
          created_at: string
          default_pipeline_id: string | null
          id: string
          last_sync_at: string | null
          last_test_at: string | null
          last_test_message: string | null
          location_id: string | null
          mode: string
          organization_id: string
          status: string
          updated_at: string
          write_enabled: boolean
        }
        Insert: {
          api_base_url?: string
          api_version?: string
          calendar_id?: string | null
          created_at?: string
          default_pipeline_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          location_id?: string | null
          mode?: string
          organization_id: string
          status?: string
          updated_at?: string
          write_enabled?: boolean
        }
        Update: {
          api_base_url?: string
          api_version?: string
          calendar_id?: string | null
          created_at?: string
          default_pipeline_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          location_id?: string | null
          mode?: string
          organization_id?: string
          status?: string
          updated_at?: string
          write_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ghl_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_location_bindings: {
        Row: {
          created_at: string
          location_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          location_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          location_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_location_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_stages: {
        Row: {
          color: string
          created_at: string
          ghl_pipeline_id: string | null
          ghl_stage_id: string | null
          id: string
          key: string
          name: string
          organization_id: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          ghl_pipeline_id?: string | null
          ghl_stage_id?: string | null
          id?: string
          key: string
          name: string
          organization_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          ghl_pipeline_id?: string | null
          ghl_stage_id?: string | null
          id?: string
          key?: string
          name?: string
          organization_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          id: string
          is_demo: boolean
          language: string
          name: string
          organization_id: string
          stage_key: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          id?: string
          is_demo?: boolean
          language?: string
          name: string
          organization_id: string
          stage_key?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          id?: string
          is_demo?: boolean
          language?: string
          name?: string
          organization_id?: string
          stage_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_name: string | null
          body: string
          channel: Database["public"]["Enums"]["channel_type"]
          conversation_id: string
          created_at: string
          direction: string
          external_id: string | null
          id: string
          is_demo: boolean
          organization_id: string
          sent_at: string
        }
        Insert: {
          author_name?: string | null
          body: string
          channel?: Database["public"]["Enums"]["channel_type"]
          conversation_id: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          is_demo?: boolean
          organization_id: string
          sent_at?: string
        }
        Update: {
          author_name?: string | null
          body?: string
          channel?: Database["public"]["Enums"]["channel_type"]
          conversation_id?: string
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          is_demo?: boolean
          organization_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          contact_id: string | null
          created_at: string
          ghl_opportunity_id: string | null
          id: string
          is_demo: boolean
          monetary_value: number | null
          name: string
          organization_id: string
          pipeline_id: string | null
          stage_id: string | null
          stage_key: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          ghl_opportunity_id?: string | null
          id?: string
          is_demo?: boolean
          monetary_value?: number | null
          name: string
          organization_id: string
          pipeline_id?: string | null
          stage_id?: string | null
          stage_key?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          ghl_opportunity_id?: string | null
          id?: string
          is_demo?: boolean
          monetary_value?: number | null
          name?: string
          organization_id?: string
          pipeline_id?: string | null
          stage_id?: string | null
          stage_key?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_inbox: {
        Row: {
          attempts: number
          contact_id: string | null
          created_at: string
          error_message: string | null
          event_id: string | null
          event_type: string | null
          id: string
          idempotency_key: string
          location_id: string | null
          locked_at: string | null
          organization_id: string | null
          payload: Json
          processed_at: string | null
          signature_valid: boolean
          source_version: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          idempotency_key: string
          location_id?: string | null
          locked_at?: string | null
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          signature_valid?: boolean
          source_version?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          idempotency_key?: string
          location_id?: string | null
          locked_at?: string | null
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          signature_valid?: boolean
          source_version?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_inbox_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_inbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_org_id: { Args: never; Returns: string }
      ghl_apply_contact_event: {
        Args: {
          _email: string
          _event_type: string
          _full_name: string
          _ghl_contact_id: string
          _inbox_id: string
          _last_interaction: string
          _org: string
          _phone: string
          _phone_normalized: string
          _source: string
          _source_version: string
          _tags: string[]
        }
        Returns: Json
      }
      ghl_apply_contact_event_v2: {
        Args: {
          _email: string
          _event_type: string
          _fence: number
          _full_name: string
          _ghl_contact_id: string
          _inbox_id: string
          _last_interaction: string
          _org: string
          _phone: string
          _phone_normalized: string
          _source: string
          _source_version: string
          _tags: string[]
        }
        Returns: Json
      }
      ghl_claim_delivery: {
        Args: {
          _content_fallback: boolean
          _event_id: string
          _event_type: string
          _ghl_contact_id: string
          _key: string
          _location: string
          _lock_timeout_seconds?: number
          _org: string
          _payload: Json
          _source_version: string
        }
        Returns: Json
      }
      ghl_mark_delivery_failed: {
        Args: {
          _fence: number
          _inbox_id: string
          _message: string
          _org: string
        }
        Returns: boolean
      }
      ghl_record_failed_receive: {
        Args: {
          _event_id: string
          _event_type: string
          _key: string
          _location: string
          _message: string
          _org: string
          _payload: Json
        }
        Returns: string
      }
      has_org_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["app_role"]
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
      pedido_de_cliente: { Args: never; Returns: boolean }
      tem_papel: {
        Args: { _papeis: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "administrador" | "gestor" | "comercial" | "visualizador"
      automation_status: "rascunho" | "ativa" | "pausada"
      channel_type: "whatsapp" | "instagram" | "facebook" | "email" | "sms"
      run_mode: "simulacao" | "real"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["administrador", "gestor", "comercial", "visualizador"],
      automation_status: ["rascunho", "ativa", "pausada"],
      channel_type: ["whatsapp", "instagram", "facebook", "email", "sms"],
      run_mode: ["simulacao", "real"],
    },
  },
} as const

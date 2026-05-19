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
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  inventory: {
    Tables: {
      abc_classification: {
        Row: {
          analysis_end_date: string
          analysis_start_date: string
          annual_usage_qty: number
          annual_usage_value: number
          catalog_item_id: string
          classification: string
          classification_method: string
          created_at: string
          created_by: string | null
          cumulative_value_pct: number | null
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          usage_rank: number | null
          value_rank: number | null
        }
        Insert: {
          analysis_end_date: string
          analysis_start_date: string
          annual_usage_qty?: number
          annual_usage_value?: number
          catalog_item_id: string
          classification: string
          classification_method: string
          created_at?: string
          created_by?: string | null
          cumulative_value_pct?: number | null
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          usage_rank?: number | null
          value_rank?: number | null
        }
        Update: {
          analysis_end_date?: string
          analysis_start_date?: string
          annual_usage_qty?: number
          annual_usage_value?: number
          catalog_item_id?: string
          classification?: string
          classification_method?: string
          created_at?: string
          created_by?: string | null
          cumulative_value_pct?: number | null
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          usage_rank?: number | null
          value_rank?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
        ]
      }
      asset_assignments: {
        Row: {
          asset_id: string
          assigned_at: string
          assigned_by_user_id: string | null
          assigned_to_id: string
          assigned_to_type: string
          created_at: string
          id: string
          last_event_id: string
          notes: string | null
          return_condition: string | null
          returned_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          asset_id: string
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_id: string
          assigned_to_type: string
          created_at?: string
          id?: string
          last_event_id: string
          notes?: string | null
          return_condition?: string | null
          returned_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          asset_id?: string
          assigned_at?: string
          assigned_by_user_id?: string | null
          assigned_to_id?: string
          assigned_to_type?: string
          created_at?: string
          id?: string
          last_event_id?: string
          notes?: string | null
          return_condition?: string | null
          returned_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_events: {
        Row: {
          actor_user_id: string | null
          asset_id: string
          created_at: string
          event_type: string
          id: string
          last_event_id: string
          occurred_at: string
          payload: Json
          source_system: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          asset_id: string
          created_at?: string
          event_type: string
          id?: string
          last_event_id: string
          occurred_at?: string
          payload: Json
          source_system?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          asset_id?: string
          created_at?: string
          event_type?: string
          id?: string
          last_event_id?: string
          occurred_at?: string
          payload?: Json
          source_system?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      asset_state: {
        Row: {
          asset_id: string
          assigned_to_ref: Json | null
          current_location_id: string | null
          current_status: string
          id: string
          last_movement_at: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_id: string
          assigned_to_ref?: Json | null
          current_location_id?: string | null
          current_status: string
          id: string
          last_movement_at?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_id?: string
          assigned_to_ref?: Json | null
          current_location_id?: string | null
          current_status?: string
          id?: string
          last_movement_at?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_state_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_state_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_tag: string
          catalog_item_id: string | null
          created_at: string
          created_by: string | null
          home_location_id: string | null
          id: string
          last_event_id: string | null
          location_id: string | null
          purchase_cost: number | null
          purchase_date: string | null
          serial_number: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vin: string | null
          warranty_expires: string | null
        }
        Insert: {
          asset_tag: string
          catalog_item_id?: string | null
          created_at?: string
          created_by?: string | null
          home_location_id?: string | null
          id?: string
          last_event_id?: string | null
          location_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vin?: string | null
          warranty_expires?: string | null
        }
        Update: {
          asset_tag?: string
          catalog_item_id?: string | null
          created_at?: string
          created_by?: string | null
          home_location_id?: string | null
          id?: string
          last_event_id?: string | null
          location_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vin?: string | null
          warranty_expires?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "assets_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "assets_home_location_id_fkey"
            columns: ["home_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          active: boolean | null
          barcode: string | null
          base_uom: string | null
          base_sku: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by_user_id: string | null
          deprecated: boolean | null
          description: string | null
          hazard_flags: Json | null
          id: string
          issue_uom: string | null
          last_event_id: string | null
          lead_time_days: number | null
          max_stock_level: number | null
          min_stock_level: number | null
          name: string
          pack_size: number | null
          preferred_vendor_id: string | null
          purch_uom: string | null
          reorder_point: number | null
          reorder_qty: number | null
          seasonal: boolean | null
          sku: string
          target_level: number | null
          tenant_id: string
          tracking_mode: string
          uom: string | null
          uom_term_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean | null
          barcode?: string | null
          base_uom?: string | null
          base_sku?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          deprecated?: boolean | null
          description?: string | null
          hazard_flags?: Json | null
          id?: string
          issue_uom?: string | null
          last_event_id?: string | null
          lead_time_days?: number | null
          max_stock_level?: number | null
          min_stock_level?: number | null
          name: string
          pack_size?: number | null
          preferred_vendor_id?: string | null
          purch_uom?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          seasonal?: boolean | null
          sku: string
          target_level?: number | null
          tenant_id: string
          tracking_mode: string
          uom?: string | null
          uom_term_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean | null
          barcode?: string | null
          base_uom?: string | null
          base_sku?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by_user_id?: string | null
          deprecated?: boolean | null
          description?: string | null
          hazard_flags?: Json | null
          id?: string
          issue_uom?: string | null
          last_event_id?: string | null
          lead_time_days?: number | null
          max_stock_level?: number | null
          min_stock_level?: number | null
          name?: string
          pack_size?: number | null
          preferred_vendor_id?: string | null
          purch_uom?: string | null
          reorder_point?: number | null
          reorder_qty?: number | null
          seasonal?: boolean | null
          sku?: string
          target_level?: number | null
          tenant_id?: string
          tracking_mode?: string
          uom?: string | null
          uom_term_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_vendor_performance_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_lines: {
        Row: {
          auto_approved: boolean | null
          catalog_item_id: string
          counted_at: string | null
          created_at: string
          created_by: string | null
          cycle_count_id: string
          id: string
          last_event_id: string
          line_number: number
          location_id: string
          notes: string | null
          qty_counted: number | null
          qty_expected: number | null
          requires_approval: boolean | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          variance: number | null
          variance_pct: number | null
          variance_qty: number | null
        }
        Insert: {
          auto_approved?: boolean | null
          catalog_item_id: string
          counted_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_count_id: string
          id?: string
          last_event_id: string
          line_number: number
          location_id: string
          notes?: string | null
          qty_counted?: number | null
          qty_expected?: number | null
          requires_approval?: boolean | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          variance?: number | null
          variance_pct?: number | null
          variance_qty?: number | null
        }
        Update: {
          auto_approved?: boolean | null
          catalog_item_id?: string
          counted_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_count_id?: string
          id?: string
          last_event_id?: string
          line_number?: number
          location_id?: string
          notes?: string | null
          qty_counted?: number | null
          qty_expected?: number | null
          requires_approval?: boolean | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          variance?: number | null
          variance_pct?: number | null
          variance_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_count_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "cycle_count_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "cycle_count_lines_cycle_count_id_fkey"
            columns: ["cycle_count_id"]
            isOneToOne: false
            referencedRelation: "cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_count_lines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_count_variance_thresholds: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          id: string
          item_category_id: string | null
          last_event_id: string
          location_id: string | null
          max_variance_pct: number | null
          max_variance_qty: number | null
          priority: number
          requires_approval: boolean
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          id?: string
          item_category_id?: string | null
          last_event_id: string
          location_id?: string | null
          max_variance_pct?: number | null
          max_variance_qty?: number | null
          priority?: number
          requires_approval?: boolean
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          id?: string
          item_category_id?: string | null
          last_event_id?: string
          location_id?: string | null
          max_variance_pct?: number | null
          max_variance_qty?: number | null
          priority?: number
          requires_approval?: boolean
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_variance_threshold_catalog_item"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_variance_threshold_catalog_item"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "fk_variance_threshold_catalog_item"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "fk_variance_threshold_item_category"
            columns: ["item_category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_variance_threshold_location"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_counts: {
        Row: {
          approval_notes: string | null
          approval_required: boolean | null
          approved_at: string | null
          approved_by_user_id: string | null
          auto_approved: boolean | null
          completed_at: string | null
          count_number: string
          counted_by_user_id: string | null
          created_at: string
          created_by: string | null
          id: string
          last_event_id: string
          location_id: string | null
          notes: string | null
          scheduled_for: string
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_notes?: string | null
          approval_required?: boolean | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          auto_approved?: boolean | null
          completed_at?: string | null
          count_number: string
          counted_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id: string
          location_id?: string | null
          notes?: string | null
          scheduled_for: string
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_notes?: string | null
          approval_required?: boolean | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          auto_approved?: boolean | null
          completed_at?: string | null
          count_number?: string
          counted_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string
          location_id?: string | null
          notes?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_asset_metrics: {
        Row: {
          activity_date: string
          asset_type: string | null
          category_id: string | null
          count_assigned: number
          count_available: number
          count_in_repair: number
          count_out_of_service: number
          downtime_hours: number | null
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          utilization_rate: number | null
        }
        Insert: {
          activity_date: string
          asset_type?: string | null
          category_id?: string | null
          count_assigned?: number
          count_available?: number
          count_in_repair?: number
          count_out_of_service?: number
          downtime_hours?: number | null
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          utilization_rate?: number | null
        }
        Update: {
          activity_date?: string
          asset_type?: string | null
          category_id?: string | null
          count_assigned?: number
          count_available?: number
          count_in_repair?: number
          count_out_of_service?: number
          downtime_hours?: number | null
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          utilization_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_asset_metrics_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_item_activity: {
        Row: {
          activity_date: string
          catalog_item_id: string
          id: string
          location_id: string | null
          net_change: number | null
          qty_adjusted: number
          qty_issued: number
          qty_received: number
          qty_transferred_in: number
          qty_transferred_out: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_date: string
          catalog_item_id: string
          id?: string
          location_id?: string | null
          net_change?: number | null
          qty_adjusted?: number
          qty_issued?: number
          qty_received?: number
          qty_transferred_in?: number
          qty_transferred_out?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_date?: string
          catalog_item_id?: string
          id?: string
          location_id?: string | null
          net_change?: number | null
          qty_adjusted?: number
          qty_issued?: number
          qty_received?: number
          qty_transferred_in?: number
          qty_transferred_out?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_item_activity_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_item_activity_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "daily_item_activity_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "daily_item_activity_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_widgets: {
        Row: {
          created_at: string
          created_by: string | null
          dashboard_id: string
          id: string
          layout: Json
          query_def: Json
          refresh_mode: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
          visual_def: Json
          widget_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dashboard_id: string
          id?: string
          layout: Json
          query_def: Json
          refresh_mode?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          visual_def: Json
          widget_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dashboard_id?: string
          id?: string
          layout?: Json
          query_def?: Json
          refresh_mode?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          visual_def?: Json
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_dashboard_id_fkey"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean | null
          name: string
          owner_user_id: string | null
          role_key: string | null
          scope: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          owner_user_id?: string | null
          role_key?: string | null
          scope: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          owner_user_id?: string | null
          role_key?: string | null
          scope?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      events_outbox: {
        Row: {
          actor_user_id: string | null
          aggregate_id: string
          aggregate_type: string
          created_at: string
          error_message: string | null
          event_name: string | null
          event_type: string
          event_version: number | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          last_retry_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_retries: number | null
          metadata: Json | null
          next_attempt_at: string | null
          payload: Json
          published_at: string | null
          retry_count: number
          scope: string
          status: string
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          aggregate_id: string
          aggregate_type: string
          created_at?: string
          error_message?: string | null
          event_name?: string | null
          event_type: string
          event_version?: number | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_retry_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_retries?: number | null
          metadata?: Json | null
          next_attempt_at?: string | null
          payload: Json
          published_at?: string | null
          retry_count?: number
          scope: string
          status?: string
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          aggregate_id?: string
          aggregate_type?: string
          created_at?: string
          error_message?: string | null
          event_name?: string | null
          event_type?: string
          event_version?: number | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_retry_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_retries?: number | null
          metadata?: Json | null
          next_attempt_at?: string | null
          payload?: Json
          published_at?: string | null
          retry_count?: number
          scope?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      identifiers: {
        Row: {
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          id_type: string
          is_primary: boolean | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          id_type: string
          is_primary?: boolean | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          id_type?: string
          is_primary?: boolean | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      inventory_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          last_event_id: string
          occurred_at: string
          payload: Json
          source_system: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          last_event_id: string
          occurred_at?: string
          payload: Json
          source_system?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          last_event_id?: string
          occurred_at?: string
          payload?: Json
          source_system?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      item_categories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_event_id: string | null
          name: string
          parent_category_id: string | null
          sku_mode: string | null
          sku_prefix: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string | null
          name: string
          parent_category_id?: string | null
          sku_mode?: string | null
          sku_prefix?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string | null
          name?: string
          parent_category_id?: string | null
          sku_mode?: string | null
          sku_prefix?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_categories_parent_category_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_levels: {
        Row: {
          catalog_item_id: string
          created_at: string
          current_stock: number
          id: string
          lead_time_days: number | null
          location_id: string
          reorder_point: number | null
          safety_stock: number | null
          target_stock: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          current_stock?: number
          id?: string
          lead_time_days?: number | null
          location_id: string
          reorder_point?: number | null
          safety_stock?: number | null
          target_stock?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          current_stock?: number
          id?: string
          lead_time_days?: number | null
          location_id?: string
          reorder_point?: number | null
          safety_stock?: number | null
          target_stock?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      item_location_par_levels: {
        Row: {
          active: boolean | null
          catalog_item_id: string
          created_at: string
          id: string
          location_id: string
          max_qty: number | null
          min_qty: number
          notes: string | null
          reorder_point: number | null
          safety_stock: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          catalog_item_id: string
          created_at?: string
          id?: string
          location_id: string
          max_qty?: number | null
          min_qty?: number
          notes?: string | null
          reorder_point?: number | null
          safety_stock?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          catalog_item_id?: string
          created_at?: string
          id?: string
          location_id?: string
          max_qty?: number | null
          min_qty?: number
          notes?: string | null
          reorder_point?: number | null
          safety_stock?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_location_par_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_settings: {
        Row: {
          category_id: string
          id: string
          next_sequence: number
          separator: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          id?: string
          next_sequence?: number
          separator?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          id?: string
          next_sequence?: number
          separator?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_settings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "item_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      item_substitutions: {
        Row: {
          active: boolean | null
          conversion_factor: number
          created_at: string
          id: string
          item_id: string
          notes: string | null
          priority: number
          substitute_item_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          conversion_factor?: number
          created_at?: string
          id?: string
          item_id: string
          notes?: string | null
          priority?: number
          substitute_item_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          conversion_factor?: number
          created_at?: string
          id?: string
          item_id?: string
          notes?: string | null
          priority?: number
          substitute_item_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_substitutions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_substitutions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_substitutions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_substitutions_substitute_item_id_fkey"
            columns: ["substitute_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_substitutions_substitute_item_id_fkey"
            columns: ["substitute_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_substitutions_substitute_item_id_fkey"
            columns: ["substitute_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean | null
          address: string | null
          created_at: string
          created_by: string | null
          external_ref: Json | null
          id: string
          last_event_id: string | null
          location_type: string
          location_type_id: string
          name: string
          parent_location_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          created_at?: string
          created_by?: string | null
          external_ref?: Json | null
          id?: string
          last_event_id?: string | null
          location_type: string
          location_type_id: string
          name: string
          parent_location_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          created_at?: string
          created_by?: string | null
          external_ref?: Json | null
          id?: string
          last_event_id?: string | null
          location_type?: string
          location_type_id?: string
          name?: string
          parent_location_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_location_type_id_fkey"
            columns: ["location_type_id"]
            isOneToOne: false
            referencedRelation: "location_types"
            referencedColumns: ["id"]
          },
        ]
      }
      location_types: {
        Row: {
          active: boolean | null
          code: string
          created_at: string
          created_by_user_id: string | null
          description: string | null
          id: string
          last_event_id: string | null
          name: string
          tenant_id: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          active?: boolean | null
          code: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          last_event_id?: string | null
          name: string
          tenant_id: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          active?: boolean | null
          code?: string
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          last_event_id?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: []
      }
      reorder_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          catalog_item_id: string
          created_at: string
          created_by: string | null
          current_qty: number
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_reason: string | null
          id: string
          location_id: string
          min_stock_level: number | null
          priority: string
          reorder_point: number | null
          status: string
          suggested_order_qty: number | null
          target_level: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          catalog_item_id: string
          created_at?: string
          created_by?: string | null
          current_qty: number
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          id?: string
          location_id: string
          min_stock_level?: number | null
          priority?: string
          reorder_point?: number | null
          status?: string
          suggested_order_qty?: number | null
          target_level?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          catalog_item_id?: string
          created_at?: string
          created_by?: string | null
          current_qty?: number
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          id?: string
          location_id?: string
          min_stock_level?: number | null
          priority?: string
          reorder_point?: number | null
          status?: string
          suggested_order_qty?: number | null
          target_level?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reorder_alerts_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reorder_alerts_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reorder_alerts_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reorder_alerts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          allocation_type: string | null
          cancelled_by_user_id: string | null
          catalog_item_id: string
          created_at: string
          created_by: string | null
          expiration_date: string | null
          external_order_ref: string | null
          fulfilled_at: string | null
          fulfilled_by_user_id: string | null
          id: string
          job_ref: Json | null
          last_event_id: string
          location_id: string
          needed_by: string | null
          qty: number
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allocation_type?: string | null
          cancelled_by_user_id?: string | null
          catalog_item_id: string
          created_at?: string
          created_by?: string | null
          expiration_date?: string | null
          external_order_ref?: string | null
          fulfilled_at?: string | null
          fulfilled_by_user_id?: string | null
          id?: string
          job_ref?: Json | null
          last_event_id: string
          location_id: string
          needed_by?: string | null
          qty: number
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allocation_type?: string | null
          cancelled_by_user_id?: string | null
          catalog_item_id?: string
          created_at?: string
          created_by?: string | null
          expiration_date?: string | null
          external_order_ref?: string | null
          fulfilled_at?: string | null
          fulfilled_by_user_id?: string | null
          id?: string
          job_ref?: Json | null
          last_event_id?: string
          location_id?: string
          needed_by?: string | null
          qty?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          catalog_item_id: string
          id: string
          location_id: string
          qty_available: number | null
          qty_on_hand: number
          qty_reserved: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          catalog_item_id: string
          id?: string
          location_id: string
          qty_available?: number | null
          qty_on_hand?: number
          qty_reserved?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string
          id?: string
          location_id?: string
          qty_available?: number | null
          qty_on_hand?: number
          qty_reserved?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          catalog_item_id: string
          correlation_id: string | null
          created_at: string
          created_by_user_id: string | null
          currency: string | null
          id: string
          last_event_id: string
          location_id: string
          movement_type: string
          notes: string | null
          occurred_at: string
          posting_status: string | null
          quantity_delta: number
          reason: string | null
          reversal_ref_id: string | null
          source_ref_id: string | null
          source_ref_type: string | null
          tenant_id: string
          unit_cost: number | null
        }
        Insert: {
          catalog_item_id: string
          correlation_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string | null
          id?: string
          last_event_id: string
          location_id: string
          movement_type: string
          notes?: string | null
          occurred_at?: string
          posting_status?: string | null
          quantity_delta: number
          reason?: string | null
          reversal_ref_id?: string | null
          source_ref_id?: string | null
          source_ref_type?: string | null
          tenant_id: string
          unit_cost?: number | null
        }
        Update: {
          catalog_item_id?: string
          correlation_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string | null
          id?: string
          last_event_id?: string
          location_id?: string
          movement_type?: string
          notes?: string | null
          occurred_at?: string
          posting_status?: string | null
          quantity_delta?: number
          reason?: string | null
          reversal_ref_id?: string | null
          source_ref_id?: string | null
          source_ref_type?: string | null
          tenant_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reversal_ref_id_fkey"
            columns: ["reversal_ref_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_lines: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          last_event_id: string
          line_number: number
          qty: number
          qty_received: number | null
          qty_shipped: number | null
          tenant_id: string
          transfer_id: string
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          last_event_id: string
          line_number: number
          qty: number
          qty_received?: number | null
          qty_shipped?: number | null
          tenant_id: string
          transfer_id: string
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          last_event_id?: string
          line_number?: number
          qty?: number
          qty_received?: number | null
          qty_shipped?: number | null
          tenant_id?: string
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "transfer_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          from_location_id: string
          id: string
          initiated_at: string | null
          initiated_by_user_id: string | null
          last_event_id: string
          notes: string | null
          received_by_user_id: string | null
          status: string
          tenant_id: string
          to_location_id: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          from_location_id: string
          id?: string
          initiated_at?: string | null
          initiated_by_user_id?: string | null
          last_event_id: string
          notes?: string | null
          received_by_user_id?: string | null
          status?: string
          tenant_id: string
          to_location_id: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          from_location_id?: string
          id?: string
          initiated_at?: string | null
          initiated_by_user_id?: string | null
          last_event_id?: string
          notes?: string | null
          received_by_user_id?: string | null
          status?: string
          tenant_id?: string
          to_location_id?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mv_asset_utilization: {
        Row: {
          asset_count: number | null
          asset_type: string | null
          currently_assigned: number | null
          refreshed_at: string | null
          status: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      mv_inventory_summary: {
        Row: {
          negative_balance_count: number | null
          refreshed_at: string | null
          tenant_id: string | null
          total_items: number | null
          total_locations: number | null
          total_qty_available: number | null
          total_qty_on_hand: number | null
          total_qty_reserved: number | null
          zero_balance_count: number | null
        }
        Relationships: []
      }
      mv_low_stock_summary: {
        Row: {
          catalog_item_id: string | null
          location_count: number | null
          min_stock_level: number | null
          name: string | null
          refreshed_at: string | null
          reorder_point: number | null
          sku: string | null
          tenant_id: string | null
          total_available: number | null
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          last_event_id: string | null
          line_number: number | null
          notes: string | null
          po_id: string | null
          qty_ordered: number | null
          qty_received: number | null
          status: string | null
          tenant_id: string | null
          unit_cost: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          line_number?: number | null
          notes?: string | null
          po_id?: string | null
          qty_ordered?: number | null
          qty_received?: number | null
          status?: string | null
          tenant_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          line_number?: number | null
          notes?: string | null
          po_id?: string | null
          qty_ordered?: number | null
          qty_received?: number | null
          status?: string | null
          tenant_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by_user_id: string | null
          created_at: string | null
          created_by_user_id: string | null
          delivery_location_id: string | null
          expected_delivery_date: string | null
          id: string | null
          last_event_id: string | null
          notes: string | null
          order_date: string | null
          po_number: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
          vendor_location_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          delivery_location_id?: string | null
          expected_delivery_date?: string | null
          id?: string | null
          last_event_id?: string | null
          notes?: string | null
          order_date?: string | null
          po_number?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          vendor_location_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string | null
          created_by_user_id?: string | null
          delivery_location_id?: string | null
          expected_delivery_date?: string | null
          id?: string | null
          last_event_id?: string | null
          notes?: string | null
          order_date?: string | null
          po_number?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          vendor_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_delivery_location_id_fkey"
            columns: ["delivery_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_location_id_fkey"
            columns: ["vendor_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_lines: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          last_event_id: string | null
          line_number: number | null
          po_line_id: string | null
          qty_received: number | null
          receipt_id: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          line_number?: number | null
          po_line_id?: string | null
          qty_received?: number | null
          receipt_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          line_number?: number | null
          po_line_id?: string | null
          qty_received?: number | null
          receipt_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "receipt_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          last_event_id: string | null
          location_id: string | null
          notes: string | null
          po_id: string | null
          receipt_number: string | null
          received_at: string | null
          received_by_user_id: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          location_id?: string | null
          notes?: string | null
          po_id?: string | null
          receipt_number?: string | null
          received_at?: string | null
          received_by_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          last_event_id?: string | null
          location_id?: string | null
          notes?: string | null
          po_id?: string | null
          receipt_number?: string | null
          received_at?: string | null
          received_by_user_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_assets_assigned: {
        Row: {
          asset_id: string | null
          asset_tag: string | null
          assigned_at: string | null
          assigned_by_user_id: string | null
          assigned_to_id: string | null
          assigned_to_type: string | null
          days_assigned: number | null
          item_name: string | null
          notes: string | null
          serial_number: string | null
          sku: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      v_available_by_item_location: {
        Row: {
          catalog_item_id: string | null
          last_movement_at: string | null
          location_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_reserved: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_core_quantities: {
        Row: {
          catalog_item_id: string | null
          earliest_expected_date: string | null
          inventory_position: number | null
          item_name: string | null
          last_movement_at: string | null
          location_id: string | null
          location_name: string | null
          po_count: number | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_on_order: number | null
          qty_reserved: number | null
          reservation_count: number | null
          sku: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_current_abc_classification: {
        Row: {
          analysis_end_date: string | null
          annual_usage_qty: number | null
          annual_usage_value: number | null
          catalog_item_id: string | null
          classification: string | null
          classification_method: string | null
          cumulative_value_pct: number | null
          item_name: string | null
          management_strategy: string | null
          review_frequency: string | null
          sku: string | null
          tenant_id: string | null
          usage_rank: number | null
          value_rank: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "abc_classification_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
        ]
      }
      v_events_pending: {
        Row: {
          age_seconds: number | null
          check_status: string | null
          created_at: string | null
          event_type: string | null
          id: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          age_seconds?: never
          check_status?: never
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          age_seconds?: never
          check_status?: never
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      v_events_stuck: {
        Row: {
          age_minutes: number | null
          created_at: string | null
          error_message: string | null
          event_type: string | null
          health_status: string | null
          id: string | null
          last_retry_at: string | null
          max_retries: number | null
          retry_count: number | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          age_minutes?: never
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          health_status?: never
          id?: string | null
          last_retry_at?: string | null
          max_retries?: number | null
          retry_count?: number | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          age_minutes?: never
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          health_status?: never
          id?: string | null
          last_retry_at?: string | null
          max_retries?: number | null
          retry_count?: number | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      v_idempotency_coverage: {
        Row: {
          compliance_status: string | null
          has_last_event_id: boolean | null
          has_tenant_id: boolean | null
          has_unique_constraint: boolean | null
          table_name: unknown
        }
        Relationships: []
      }
      v_idempotency_summary: {
        Row: {
          coverage_pct: number | null
          rows_missing_event_id: number | null
          rows_with_event_id: number | null
          table_name: string | null
          total_rows: number | null
        }
        Relationships: []
      }
      v_inventory_position: {
        Row: {
          catalog_item_id: string | null
          earliest_expected_date: string | null
          inventory_position: number | null
          last_movement_at: string | null
          location_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_on_order: number | null
          qty_reserved: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
      v_item_status_summary: {
        Row: {
          active_items: number | null
          deprecated_items: number | null
          inactive_items: number | null
          items_with_reorder_point: number | null
          seasonal_items: number | null
          tenant_id: string | null
          total_items: number | null
        }
        Relationships: []
      }
      v_items_below_par: {
        Row: {
          catalog_item_id: string | null
          location_id: string | null
          location_name: string | null
          max_qty: number | null
          min_qty: number | null
          name: string | null
          qty_available: number | null
          qty_below_min: number | null
          qty_on_hand: number | null
          reorder_point: number | null
          safety_stock: number | null
          sku: string | null
          status: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_location_par_levels_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "item_location_par_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_items_needing_reorder: {
        Row: {
          alert_priority: string | null
          alert_type: string | null
          catalog_item_id: string | null
          inventory_position: number | null
          item_name: string | null
          lead_time_days: number | null
          location_id: string | null
          location_name: string | null
          min_stock_level: number | null
          preferred_vendor_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_on_order: number | null
          qty_reserved: number | null
          reorder_point: number | null
          reorder_qty: number | null
          sku: string | null
          suggested_order_qty: number | null
          target_level: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_vendor_performance_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_balances_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ledger_balance_reconciliation: {
        Row: {
          balance_qty: number | null
          catalog_item_id: string | null
          item_name: string | null
          ledger_qty: number | null
          location_id: string | null
          location_name: string | null
          sku: string | null
          status: string | null
          tenant_id: string | null
          variance: number | null
        }
        Relationships: []
      }
      v_on_hand_by_item_location: {
        Row: {
          catalog_item_id: string | null
          last_movement_at: string | null
          location_id: string | null
          qty_on_hand: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_movements_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_on_order_by_item_location: {
        Row: {
          catalog_item_id: string | null
          earliest_expected_date: string | null
          location_id: string | null
          po_count: number | null
          qty_on_order: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "purchase_orders_delivery_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_po_status_summary: {
        Row: {
          po_count: number | null
          status: string | null
          tenant_id: string | null
          total_lines: number | null
          total_qty_ordered: number | null
          total_qty_outstanding: number | null
          total_qty_received: number | null
        }
        Relationships: []
      }
      v_reorder_suggestions: {
        Row: {
          catalog_item_id: string | null
          estimated_unit_cost: number | null
          inventory_position: number | null
          lead_time_days: number | null
          location_id: string | null
          name: string | null
          next_expected_receipt: string | null
          pack_size: number | null
          preferred_vendor_id: string | null
          preferred_vendor_name: string | null
          qty_on_hand: number | null
          qty_on_order: number | null
          qty_reserved: number | null
          reorder_point: number | null
          reorder_qty: number | null
          sku: string | null
          suggested_order_qty: number | null
          target_level: number | null
          tenant_id: string | null
          vendor_sku: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_vendor_performance_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "catalog_items_preferred_vendor_fk"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reservation_integrity: {
        Row: {
          balance_reserved: number | null
          calculated_reserved: number | null
          catalog_item_id: string | null
          item_name: string | null
          location_id: string | null
          location_name: string | null
          qty_on_hand: number | null
          sku: string | null
          status: string | null
          tenant_id: string | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reservation_status_summary: {
        Row: {
          overdue_count: number | null
          reservation_count: number | null
          status: string | null
          tenant_id: string | null
          total_qty_reserved: number | null
        }
        Relationships: []
      }
      v_reservations_expired: {
        Row: {
          catalog_item_id: string | null
          days_overdue: number | null
          expiration_date: string | null
          external_order_ref: string | null
          id: string | null
          item_name: string | null
          job_ref: Json | null
          location_id: string | null
          location_name: string | null
          qty: number | null
          sku: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reserved_by_item_location: {
        Row: {
          catalog_item_id: string | null
          location_id: string | null
          qty_reserved: number | null
          reservation_count: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_rls_coverage: {
        Row: {
          policy_count: number | null
          rls_enabled: boolean | null
          schemaname: unknown
          tablename: unknown
        }
        Relationships: []
      }
      v_table_bloat: {
        Row: {
          dead_tuple_percent: number | null
          dead_tuples: number | null
          indexes_size: string | null
          last_autovacuum: string | null
          last_vacuum: string | null
          live_tuples: number | null
          schemaname: unknown
          table_size: string | null
          tablename: unknown
          total_size: string | null
        }
        Relationships: []
      }
      v_vendor_performance_summary: {
        Row: {
          avg_days_late: number | null
          disputes_last_90_days: number | null
          is_active: boolean | null
          on_time_delivery_rate: number | null
          overall_rating: number | null
          pos_last_90_days: number | null
          quality_score: number | null
          spend_last_90_days: number | null
          tenant_id: string | null
          vendor_code: string | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Relationships: []
      }
      vendor_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string | null
          currency: string | null
          id: string | null
          is_preferred: boolean | null
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          pack_size: number | null
          tenant_id: string | null
          unit_cost: number | null
          updated_at: string | null
          vendor_id: string | null
          vendor_sku: string | null
          vendor_uom_term_id: string | null
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          pack_size?: number | null
          tenant_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          vendor_sku?: string | null
          vendor_uom_term_id?: string | null
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          pack_size?: number | null
          tenant_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          vendor_sku?: string | null
          vendor_uom_term_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "mv_low_stock_summary"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "vendor_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_suggestions"
            referencedColumns: ["catalog_item_id"]
          },
          {
            foreignKeyName: "vendor_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_vendor_performance_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_performance_metrics: {
        Row: {
          avg_lead_time_days: number | null
          cancelled_pos_count: number | null
          cancelled_pos_value: number | null
          created_at: string | null
          defect_rate: number | null
          disputes_count: number | null
          disputes_value: number | null
          id: string | null
          last_event_id: string | null
          late_deliveries: number | null
          on_time_deliveries: number | null
          on_time_delivery_rate: number | null
          overall_rating: number | null
          period_end: string | null
          period_start: string | null
          quality_score: number | null
          rejected_items: number | null
          tenant_id: string | null
          total_amount_paid: number | null
          total_items_received: number | null
          total_pos_count: number | null
          total_pos_value: number | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          avg_lead_time_days?: number | null
          cancelled_pos_count?: number | null
          cancelled_pos_value?: number | null
          created_at?: string | null
          defect_rate?: number | null
          disputes_count?: number | null
          disputes_value?: number | null
          id?: string | null
          last_event_id?: string | null
          late_deliveries?: number | null
          on_time_deliveries?: number | null
          on_time_delivery_rate?: number | null
          overall_rating?: number | null
          period_end?: string | null
          period_start?: string | null
          quality_score?: number | null
          rejected_items?: number | null
          tenant_id?: string | null
          total_amount_paid?: number | null
          total_items_received?: number | null
          total_pos_count?: number | null
          total_pos_value?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          avg_lead_time_days?: number | null
          cancelled_pos_count?: number | null
          cancelled_pos_value?: number | null
          created_at?: string | null
          defect_rate?: number | null
          disputes_count?: number | null
          disputes_value?: number | null
          id?: string | null
          last_event_id?: string | null
          late_deliveries?: number | null
          on_time_deliveries?: number | null
          on_time_delivery_rate?: number | null
          overall_rating?: number | null
          period_end?: string | null
          period_start?: string | null
          quality_score?: number | null
          rejected_items?: number | null
          tenant_id?: string | null
          total_amount_paid?: number | null
          total_items_received?: number | null
          total_pos_count?: number | null
          total_pos_value?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_performance_metrics_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_vendor_performance_summary"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_performance_metrics_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          active: boolean | null
          code: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string | null
          name: string | null
          notes: string | null
          payment_terms: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          payment_terms?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          payment_terms?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_test_stock: {
        Args: {
          p_catalog_item_id: string
          p_location_id: string
          p_qty: number
          p_tenant_id: string
        }
        Returns: string
      }
      check_variance_approval: {
        Args: {
          p_catalog_item_id: string
          p_expected_qty: number
          p_item_category_id: string
          p_location_id: string
          p_tenant_id: string
          p_variance_qty: number
        }
        Returns: boolean
      }
      create_test_item: {
        Args: {
          p_item_type?: string
          p_name?: string
          p_sku?: string
          p_tenant_id: string
        }
        Returns: string
      }
      create_test_location: {
        Args: { p_location_name?: string; p_tenant_id: string }
        Returns: string
      }
      create_test_tenant: { Args: { p_tenant_name?: string }; Returns: string }
      expire_old_reservations: {
        Args: { p_tenant_id?: string }
        Returns: number
      }
      generate_reorder_alerts: {
        Args: never
        Returns: {
          alerts_auto_dismissed: number
          alerts_created: number
          alerts_updated: number
        }[]
      }
      get_failed_events: {
        Args: { p_limit?: number; p_tenant_id?: string }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          created_at: string
          event_type: string
          id: string
          last_error: string
          retry_count: number
          tenant_id: string
        }[]
      }
      get_outbox_stats: {
        Args: { p_tenant_id?: string }
        Returns: {
          avg_processing_time_seconds: number
          failed_events: number
          oldest_pending_age_seconds: number
          pending_events: number
          published_events: number
          tenant_id: string
          total_events: number
        }[]
      }
      get_substitutes: {
        Args: { p_item_id: string; p_tenant_id: string }
        Returns: {
          conversion_factor: number
          name: string
          priority: number
          qty_available: number
          sku: string
          substitute_item_id: string
        }[]
      }
      insert_asset_event: {
        Args: {
          p_actor_user_id: string
          p_asset_id: string
          p_event_type: string
          p_last_event_id: string
          p_occurred_at: string
          p_payload: Json
          p_source_system: string
          p_tenant_id: string
        }
        Returns: string
      }
      insert_inventory_event: {
        Args: {
          p_actor_user_id: string
          p_event_type: string
          p_last_event_id: string
          p_occurred_at: string
          p_payload: Json
          p_source_system: string
          p_tenant_id: string
        }
        Returns: string
      }
      insert_stock_movement: {
        Args: {
          p_catalog_item_id: string
          p_correlation_id: string
          p_created_by_user_id: string
          p_last_event_id: string
          p_location_id: string
          p_movement_type: string
          p_notes: string
          p_occurred_at: string
          p_quantity_delta: number
          p_reason: string
          p_source_ref_id: string
          p_source_ref_type: string
          p_tenant_id: string
          p_unit_cost: number
        }
        Returns: string
      }
      is_hazardous: { Args: { p_catalog_item_id: string }; Returns: boolean }
      move_to_dead_letter: { Args: { p_event_id: string }; Returns: undefined }
      publish_event:
        | {
            Args: {
              p_aggregate_id: string
              p_aggregate_type: string
              p_event_name: string
              p_event_version?: number
              p_metadata?: Json
              p_payload: Json
              p_scope: string
              p_tenant_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_aggregate_id: string
              p_aggregate_type: string
              p_event_type: string
              p_metadata?: Json
              p_payload?: Json
              p_scope: string
              p_tenant_id: string
            }
            Returns: string
          }
      refresh_dashboard_views: {
        Args: never
        Returns: {
          refresh_time_ms: number
          row_count: number
          view_name: string
        }[]
      }
      retry_failed_event: { Args: { p_event_id: string }; Returns: boolean }
      rpc_acknowledge_alert: {
        Args: { p_alert_id: string }
        Returns: undefined
      }
      rpc_adjust_inventory: {
        Args: {
          p_catalog_item_id: string
          p_location_id: string
          p_new_qty: number
          p_notes: string
          p_reason: string
        }
        Returns: Json
      }
      rpc_calculate_abc_classification: {
        Args: { p_end_date?: string; p_method?: string; p_start_date?: string }
        Returns: {
          class_a_count: number
          class_b_count: number
          class_c_count: number
          class_d_count: number
          items_classified: number
        }[]
      }
      rpc_dismiss_alert: {
        Args: { p_alert_id: string; p_reason: string }
        Returns: undefined
      }
      rpc_inv_asset_assign: {
        Args: {
          p_asset_id: string
          p_assigned_by_user_id: string
          p_assigned_to_id: string
          p_assigned_to_type: string
          p_last_event_id?: string
          p_notes?: string
          p_tenant_id: string
        }
        Returns: string
      }
      rpc_inv_asset_return: {
        Args: {
          p_asset_id: string
          p_last_event_id?: string
          p_notes?: string
          p_return_condition?: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      rpc_inv_cycle_count_approve: {
        Args: {
          p_approval_notes?: string
          p_approved_by_user_id: string
          p_cycle_count_id: string
          p_last_event_id?: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      rpc_inv_cycle_count_record: {
        Args: {
          p_catalog_item_id: string
          p_counted_qty: number
          p_cycle_count_id: string
          p_last_event_id?: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      rpc_inv_cycle_count_start: {
        Args: {
          p_catalog_item_ids?: string[]
          p_count_type: string
          p_counted_by_user_id?: string
          p_item_category_id?: string
          p_last_event_id?: string
          p_location_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      rpc_inv_fulfill_reservation_issue: {
        Args: {
          p_fulfilled_by_user_id: string
          p_last_event_id?: string
          p_reservation_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      rpc_inv_receive: {
        Args: {
          p_lines: Json
          p_location_id: string
          p_notes?: string
          p_po_id?: string
          p_receipt_number: string
          p_received_at?: string
        }
        Returns: Json
      }
      rpc_inv_release_reservation: {
        Args: {
          p_cancelled_by_user_id: string
          p_last_event_id?: string
          p_reservation_id: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      rpc_inv_reserve: {
        Args: {
          p_allocation_type?: string
          p_catalog_item_id: string
          p_expiration_date?: string
          p_external_order_ref?: string
          p_job_ref?: Json
          p_last_event_id?: string
          p_location_id: string
          p_needed_by?: string
          p_qty: number
          p_tenant_id: string
        }
        Returns: string
      }
      rpc_inv_transfer_cancel: {
        Args: {
          p_cancellation_reason: string
          p_cancelled_by_user_id: string
          p_tenant_id: string
          p_transfer_id: string
        }
        Returns: boolean
      }
      rpc_inv_transfer_create: {
        Args: {
          p_from_location_id: string
          p_initiated_by_user_id: string
          p_last_event_id?: string
          p_lines: Json
          p_notes?: string
          p_tenant_id: string
          p_to_location_id: string
        }
        Returns: string
      }
      rpc_inv_transfer_execute: {
        Args: {
          p_last_event_id?: string
          p_received_by_user_id: string
          p_tenant_id: string
          p_transfer_id: string
        }
        Returns: boolean
      }
      rpc_issue_inventory: {
        Args: {
          p_issued_to_ref?: string
          p_issued_to_type?: string
          p_items: Json
          p_location_id: string
          p_notes?: string
          p_reason?: string
        }
        Returns: Json
      }
      rpc_mark_alert_ordered: {
        Args: { p_alert_id: string }
        Returns: undefined
      }
      rpc_reverse_stock_movement: {
        Args: {
          p_last_event_id?: string
          p_movement_id: string
          p_reason: string
          p_tenant_id: string
          p_user_id?: string
        }
        Returns: string
      }
      setup_test_scenario: {
        Args: never
        Returns: {
          item1_id: string
          item2_id: string
          location_id: string
          tenant_id: string
        }[]
      }
      soft_delete_catalog_item: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: boolean
      }
      verify_quantity_integrity: {
        Args: { p_tenant_id: string }
        Returns: {
          check_name: string
          details: string
          status: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      dashboard_widgets: {
        Row: {
          config: Json
          created_at: string
          dashboard_id: string
          id: string
          layout: Json
          refresh_seconds: number
          tenant_id: string
          title: string | null
          updated_at: string
          widget_key: string
        }
        Insert: {
          config?: Json
          created_at?: string
          dashboard_id: string
          id?: string
          layout?: Json
          refresh_seconds?: number
          tenant_id: string
          title?: string | null
          updated_at?: string
          widget_key: string
        }
        Update: {
          config?: Json
          created_at?: string
          dashboard_id?: string
          id?: string
          layout?: Json
          refresh_seconds?: number
          tenant_id?: string
          title?: string | null
          updated_at?: string
          widget_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_dashboard_id_fkey"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dashboard_widgets_dashboard"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          owner_user_id: string | null
          role_key: string | null
          scope: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          owner_user_id?: string | null
          role_key?: string | null
          scope?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          owner_user_id?: string | null
          role_key?: string | null
          scope?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_consumers: {
        Row: {
          active: boolean | null
          consumer_name: string
          consumer_type: string
          created_at: string
          description: string | null
          endpoint_url: string | null
          event_name: string
          id: string
        }
        Insert: {
          active?: boolean | null
          consumer_name: string
          consumer_type: string
          created_at?: string
          description?: string | null
          endpoint_url?: string | null
          event_name: string
          id?: string
        }
        Update: {
          active?: boolean | null
          consumer_name?: string
          consumer_type?: string
          created_at?: string
          description?: string | null
          endpoint_url?: string | null
          event_name?: string
          id?: string
        }
        Relationships: []
      }
      event_definitions: {
        Row: {
          created_at: string
          deprecated_at: string | null
          deprecation_reason: string | null
          description: string
          event_name: string
          example_payload: Json | null
          id: string
          payload_schema: Json | null
          producer: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          deprecated_at?: string | null
          deprecation_reason?: string | null
          description: string
          event_name: string
          example_payload?: Json | null
          id?: string
          payload_schema?: Json | null
          producer: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          deprecated_at?: string | null
          deprecation_reason?: string | null
          description?: string
          event_name?: string
          example_payload?: Json | null
          id?: string
          payload_schema?: Json | null
          producer?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      events_dead_letter: {
        Row: {
          created_at: string
          dead_lettered_at: string
          event_type: string
          final_error: string | null
          id: string
          original_actor_user_id: string | null
          original_aggregate_id: string | null
          original_aggregate_type: string | null
          original_event_id: string
          original_metadata: Json | null
          original_scope: string | null
          payload: Json
          tenant_id: string
          total_attempts: number
        }
        Insert: {
          created_at: string
          dead_lettered_at?: string
          event_type: string
          final_error?: string | null
          id?: string
          original_actor_user_id?: string | null
          original_aggregate_id?: string | null
          original_aggregate_type?: string | null
          original_event_id: string
          original_metadata?: Json | null
          original_scope?: string | null
          payload: Json
          tenant_id: string
          total_attempts: number
        }
        Update: {
          created_at?: string
          dead_lettered_at?: string
          event_type?: string
          final_error?: string | null
          id?: string
          original_actor_user_id?: string | null
          original_aggregate_id?: string | null
          original_aggregate_type?: string | null
          original_event_id?: string
          original_metadata?: Json | null
          original_scope?: string | null
          payload?: Json
          tenant_id?: string
          total_attempts?: number
        }
        Relationships: []
      }
      processed_events: {
        Row: {
          delivery_id: string
          event_type: string
          id: string
          payload: Json | null
          processed_at: string
          tenant_id: string | null
        }
        Insert: {
          delivery_id: string
          event_type: string
          id?: string
          payload?: Json | null
          processed_at?: string
          tenant_id?: string | null
        }
        Update: {
          delivery_id?: string
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      summit_config: {
        Row: {
          config: Json | null
          created_at: string
          environment: string
          id: string
          last_poll_event_count: number | null
          last_polled_at: string | null
          polling_enabled: boolean | null
          protocol_version: string
          publisher_id: string
          service_name: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          environment?: string
          id?: string
          last_poll_event_count?: number | null
          last_polled_at?: string | null
          polling_enabled?: boolean | null
          protocol_version?: string
          publisher_id?: string
          service_name?: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          environment?: string
          id?: string
          last_poll_event_count?: number | null
          last_polled_at?: string | null
          polling_enabled?: boolean | null
          protocol_version?: string
          publisher_id?: string
          service_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          address: Json | null
          created_at: string
          id: string
          industry: string | null
          last_event_id: string | null
          metadata: Json | null
          name: string
          slug: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          address?: Json | null
          created_at?: string
          id: string
          industry?: string | null
          last_event_id?: string | null
          metadata?: Json | null
          name: string
          slug?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          address?: Json | null
          created_at?: string
          id?: string
          industry?: string | null
          last_event_id?: string | null
          metadata?: Json | null
          name?: string
          slug?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      widget_registry: {
        Row: {
          allowed_filters: Json
          created_at: string
          default_config: Json
          default_height: number
          default_width: number
          description: string | null
          domain: string
          is_enabled: boolean
          name: string
          updated_at: string
          widget_key: string
        }
        Insert: {
          allowed_filters?: Json
          created_at?: string
          default_config?: Json
          default_height?: number
          default_width?: number
          description?: string | null
          domain: string
          is_enabled?: boolean
          name: string
          updated_at?: string
          widget_key: string
        }
        Update: {
          allowed_filters?: Json
          created_at?: string
          default_config?: Json
          default_height?: number
          default_width?: number
          description?: string | null
          domain?: string
          is_enabled?: boolean
          name?: string
          updated_at?: string
          widget_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      event_catalog: {
        Row: {
          created_at: string | null
          deprecated_at: string | null
          deprecation_reason: string | null
          description: string | null
          event_key: string | null
          event_name: string | null
          event_version: number | null
          example_payload: Json | null
          payload_schema: Json | null
          producer: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deprecated_at?: string | null
          deprecation_reason?: string | null
          description?: string | null
          event_key?: string | null
          event_name?: string | null
          event_version?: number | null
          example_payload?: Json | null
          payload_schema?: Json | null
          producer?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deprecated_at?: string | null
          deprecation_reason?: string | null
          description?: string | null
          event_key?: string | null
          event_name?: string | null
          event_version?: number | null
          example_payload?: Json | null
          payload_schema?: Json | null
          producer?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      events_outbox: {
        Row: {
          attempts: number | null
          created_at: string | null
          error_message: string | null
          event_type: string | null
          id: string | null
          last_attempt_at: string | null
          locked_at: string | null
          locked_by: string | null
          next_attempt_at: string | null
          payload: Json | null
          published_at: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          id?: string | null
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          payload?: Json | null
          published_at?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          event_type?: string | null
          id?: string | null
          last_attempt_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string | null
          payload?: Json | null
          published_at?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      emit_event: {
        Args: {
          p_type: string
          p_payload: Json
          p_tenant_id?: string
          p_actor_id?: string
          p_trace_id?: string
          p_correlation_id?: string
          p_aggregate_id?: string
        }
        Returns: string
      }
      get_event_catalog_stats: {
        Args: never
        Returns: {
          event_name: string
          failed_count: number
          last_emitted_at: string
          pending_count: number
          published_count: number
          status: string
          total_emitted: number
          version: number
        }[]
      }
      register_event: {
        Args: {
          p_key: string
          p_name: string
          p_desc: string
          p_example: Json
          p_schema?: Json
          p_agg_type?: string
        }
        Returns: undefined
      }
      set_session_context: {
        Args: { p_role: string; p_tenant_id: string; p_user_id: string }
        Returns: undefined
      }
      validate_event_in_catalog: {
        Args: { p_event_name: string; p_event_version?: number }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  supply_chain: {
    Tables: {
      accounting_expenses: {
        Row: {
          amount: number
          created_at: string
          currency: string | null
          description: string | null
          expense_date: string
          id: string
          invoice_number: string | null
          last_event_id: string
          matched_at: string | null
          po_id: string | null
          receipt_url: string | null
          status: string
          tenant_id: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_date: string
          id?: string
          invoice_number?: string | null
          last_event_id: string
          matched_at?: string | null
          po_id?: string | null
          receipt_url?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          invoice_number?: string | null
          last_event_id?: string
          matched_at?: string | null
          po_id?: string | null
          receipt_url?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_expenses_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          last_event_id: string
          occurred_at: string
          payload: Json
          po_id: string | null
          source_system: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          last_event_id: string
          occurred_at?: string
          payload: Json
          po_id?: string | null
          source_system?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          last_event_id?: string
          occurred_at?: string
          payload?: Json
          po_id?: string | null
          source_system?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          catalog_item_id: string
          created_at: string
          created_by: string | null
          id: string
          last_event_id: string
          line_number: number
          notes: string | null
          po_id: string
          qty_ordered: number
          qty_received: number
          status: string
          tenant_id: string
          unit_cost: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id: string
          line_number: number
          notes?: string | null
          po_id: string
          qty_ordered: number
          qty_received?: number
          status?: string
          tenant_id: string
          unit_cost?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string
          line_number?: number
          notes?: string | null
          po_id?: string
          qty_ordered?: number
          qty_received?: number
          status?: string
          tenant_id?: string
          unit_cost?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          delivery_location_id: string | null
          expected_delivery_date: string | null
          id: string
          last_event_id: string
          notes: string | null
          order_date: string
          po_number: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vendor_location_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivery_location_id?: string | null
          expected_delivery_date?: string | null
          id?: string
          last_event_id: string
          notes?: string | null
          order_date: string
          po_number: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vendor_location_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivery_location_id?: string | null
          expected_delivery_date?: string | null
          id?: string
          last_event_id?: string
          notes?: string | null
          order_date?: string
          po_number?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vendor_location_id?: string | null
        }
        Relationships: []
      }
      receipt_lines: {
        Row: {
          catalog_item_id: string
          created_at: string
          created_by: string | null
          id: string
          last_event_id: string | null
          line_number: number
          po_line_id: string | null
          qty_received: number
          receipt_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string | null
          line_number: number
          po_line_id?: string | null
          qty_received: number
          receipt_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string | null
          line_number?: number
          po_line_id?: string | null
          qty_received?: number
          receipt_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_event_id: string
          location_id: string
          notes: string | null
          po_id: string | null
          receipt_number: string
          received_at: string
          received_by_user_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id: string
          location_id: string
          notes?: string | null
          po_id?: string | null
          receipt_number: string
          received_at?: string
          received_by_user_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_event_id?: string
          location_id?: string
          notes?: string | null
          po_id?: string | null
          receipt_number?: string
          received_at?: string
          received_by_user_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_items: {
        Row: {
          catalog_item_id: string
          created_at: string
          currency: string | null
          id: string
          is_preferred: boolean | null
          last_event_id: string | null
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          pack_size: number | null
          tenant_id: string
          unit_cost: number | null
          updated_at: string
          vendor_id: string
          vendor_sku: string
          vendor_uom_term_id: string | null
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          currency?: string | null
          id?: string
          is_preferred?: boolean | null
          last_event_id?: string | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          pack_size?: number | null
          tenant_id: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id: string
          vendor_sku: string
          vendor_uom_term_id?: string | null
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          is_preferred?: boolean | null
          last_event_id?: string | null
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          pack_size?: number | null
          tenant_id?: string
          unit_cost?: number | null
          updated_at?: string
          vendor_id?: string
          vendor_sku?: string
          vendor_uom_term_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_performance_events: {
        Row: {
          actual_date: string | null
          amount: number | null
          created_at: string
          created_by: string | null
          days_late: number | null
          event_date: string
          event_type: string
          expected_date: string | null
          id: string
          metadata: Json | null
          po_id: string | null
          quantity: number | null
          receipt_id: string | null
          tenant_id: string
          vendor_id: string
        }
        Insert: {
          actual_date?: string | null
          amount?: number | null
          created_at?: string
          created_by?: string | null
          days_late?: number | null
          event_date?: string
          event_type: string
          expected_date?: string | null
          id?: string
          metadata?: Json | null
          po_id?: string | null
          quantity?: number | null
          receipt_id?: string | null
          tenant_id: string
          vendor_id: string
        }
        Update: {
          actual_date?: string | null
          amount?: number | null
          created_at?: string
          created_by?: string | null
          days_late?: number | null
          event_date?: string
          event_type?: string
          expected_date?: string | null
          id?: string
          metadata?: Json | null
          po_id?: string | null
          quantity?: number | null
          receipt_id?: string | null
          tenant_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_performance_events_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_performance_events_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_performance_events_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_performance_metrics: {
        Row: {
          avg_lead_time_days: number | null
          cancelled_pos_count: number
          cancelled_pos_value: number
          created_at: string
          defect_rate: number | null
          disputes_count: number
          disputes_value: number
          id: string
          last_event_id: string | null
          late_deliveries: number
          on_time_deliveries: number
          on_time_delivery_rate: number | null
          overall_rating: number | null
          period_end: string
          period_start: string
          quality_score: number | null
          rejected_items: number
          tenant_id: string
          total_amount_paid: number
          total_items_received: number
          total_pos_count: number
          total_pos_value: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          avg_lead_time_days?: number | null
          cancelled_pos_count?: number
          cancelled_pos_value?: number
          created_at?: string
          defect_rate?: number | null
          disputes_count?: number
          disputes_value?: number
          id?: string
          last_event_id?: string | null
          late_deliveries?: number
          on_time_deliveries?: number
          on_time_delivery_rate?: number | null
          overall_rating?: number | null
          period_end: string
          period_start: string
          quality_score?: number | null
          rejected_items?: number
          tenant_id: string
          total_amount_paid?: number
          total_items_received?: number
          total_pos_count?: number
          total_pos_value?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          avg_lead_time_days?: number | null
          cancelled_pos_count?: number
          cancelled_pos_value?: number
          created_at?: string
          defect_rate?: number | null
          disputes_count?: number
          disputes_value?: number
          id?: string
          last_event_id?: string | null
          late_deliveries?: number
          on_time_deliveries?: number
          on_time_delivery_rate?: number | null
          overall_rating?: number | null
          period_end?: string
          period_start?: string
          quality_score?: number | null
          rejected_items?: number
          tenant_id?: string
          total_amount_paid?: number
          total_items_received?: number
          total_pos_count?: number
          total_pos_value?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_performance_metrics_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          active: boolean | null
          code: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          last_event_id: string | null
          lead_time_days: number | null
          name: string
          notes: string | null
          payment_terms: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          last_event_id?: string | null
          lead_time_days?: number | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          last_event_id?: string | null
          lead_time_days?: number | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_reorder_pos: {
        Args: { p_tenant_id: string }
        Returns: {
          items_count: number
          location_id: string
          total_estimated_cost: number
          vendor_id: string
        }[]
      }
      poll_pending_events: {
        Args: { p_batch_size?: number; p_max_attempts?: number }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          created_at: string
          event_type: string
          id: string
          last_error: string
          metadata: Json
          payload: Json
          retry_count: number
          scope: string
          status: string
          tenant_id: string
        }[]
      }
      process_stock_receipt: {
        Args: {
          p_last_event_id: string
          p_location_id: string
          p_po_id: string
          p_received_by_user_id: string
          p_received_items: Json
          p_tenant_id: string
        }
        Returns: string
      }
      rpc_calculate_vendor_metrics: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          on_time_rate: number
          overall_rating: number
          quality_score: number
          vendor_id: string
          vendor_name: string
        }[]
      }
      rpc_create_purchase_order: {
        Args: {
          p_delivery_location_id: string
          p_expected_delivery_date?: string
          p_lines: Json
          p_notes?: string
          p_po_number: string
          p_vendor_id: string
        }
        Returns: Json
      }
      rpc_create_receipt: {
        Args: {
          p_auto_post?: boolean
          p_lines: Json
          p_location_id: string
          p_notes?: string
          p_po_id?: string
          p_receipt_number: string
          p_received_at?: string
        }
        Returns: Json
      }
      rpc_match_expense_to_po: {
        Args: {
          p_expense_id: string
          p_po_id: string
          p_tenant_id: string
          p_user_id?: string
        }
        Returns: boolean
      }
      rpc_post_receipt_to_inventory: {
        Args: { p_actor_user_id?: string; p_receipt_id: string }
        Returns: Json
      }
      rpc_reverse_receipt_from_inventory: {
        Args: {
          p_actor_user_id?: string
          p_reason: string
          p_receipt_id: string
        }
        Returns: Json
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
  graphql_public: {
    Enums: {},
  },
  inventory: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  supply_chain: {
    Enums: {},
  },
} as const

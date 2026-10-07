// Database types in `supabase gen types typescript` format.
// Regenerate after every migration:  npm run db:types
// (Hand-written for Phase 1 to match supabase/migrations; replace with the
// generated output once a project is linked.)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5";
  };
  public: {
    Tables: {
      addresses: {
        Row: {
          additional_instructions: string | null;
          apartment: string | null;
          area: string | null;
          building: string | null;
          city: string;
          country_code: string;
          created_at: string;
          full_name: string;
          id: string;
          is_default: boolean;
          label: string | null;
          phone: string;
          postal_code: string | null;
          state_region: string | null;
          street: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          additional_instructions?: string | null;
          apartment?: string | null;
          area?: string | null;
          building?: string | null;
          city: string;
          country_code: string;
          created_at?: string;
          full_name: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          phone: string;
          postal_code?: string | null;
          state_region?: string | null;
          street?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          additional_instructions?: string | null;
          apartment?: string | null;
          area?: string | null;
          building?: string | null;
          city?: string;
          country_code?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          phone?: string;
          postal_code?: string | null;
          state_region?: string | null;
          street?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          image_path: string | null;
          image_url: string | null;
          is_active: boolean;
          name: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          name: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          name?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory: {
        Row: {
          created_at: string;
          id: string;
          low_stock_threshold: number;
          product_id: string;
          quantity: number;
          reserved_quantity: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          product_id: string;
          quantity?: number;
          reserved_quantity?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          product_id?: string;
          quantity?: number;
          reserved_quantity?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_adjustments: {
        Row: {
          adjustment_quantity: number;
          adjustment_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at: string;
          created_by: string | null;
          id: string;
          inventory_id: string;
          notes: string | null;
          product_id: string;
          quantity_after: number;
          quantity_before: number;
          reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
        };
        Insert: {
          adjustment_quantity: number;
          adjustment_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inventory_id: string;
          notes?: string | null;
          product_id: string;
          quantity_after: number;
          quantity_before: number;
          reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
        };
        Update: {
          adjustment_quantity?: number;
          adjustment_type?: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inventory_id?: string;
          notes?: string | null;
          product_id?: string;
          quantity_after?: number;
          quantity_before?: number;
          reason?: Database["public"]["Enums"]["inventory_adjustment_reason"];
        };
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_adjustments_inventory_id_fkey";
            columns: ["inventory_id"];
            isOneToOne: false;
            referencedRelation: "inventory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          currency_code: string;
          id: string;
          order_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          sku: string;
          total_price: number;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          currency_code: string;
          id?: string;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          sku: string;
          total_price: number;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          currency_code?: string;
          id?: string;
          order_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          sku?: string;
          total_price?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_fkey";
            columns: ["order_id", "currency_code"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "currency_code"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          billing_address_snapshot: Json | null;
          created_at: string;
          currency_code: string;
          discount: number;
          id: string;
          order_number: number;
          shipping: number;
          shipping_address_snapshot: Json;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          tax: number;
          total: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          billing_address_snapshot?: Json | null;
          created_at?: string;
          currency_code: string;
          discount?: number;
          id?: string;
          order_number?: never;
          shipping?: number;
          shipping_address_snapshot: Json;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          tax?: number;
          total: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          billing_address_snapshot?: Json | null;
          created_at?: string;
          currency_code?: string;
          discount?: number;
          id?: string;
          order_number?: never;
          shipping?: number;
          shipping_address_snapshot?: Json;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          alt_text: string | null;
          created_at: string;
          id: string;
          is_primary: boolean;
          product_id: string;
          public_url: string | null;
          sort_order: number;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          product_id: string;
          public_url?: string | null;
          sort_order?: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          product_id?: string;
          public_url?: string | null;
          sort_order?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          category_id: string | null;
          compare_at_price: number | null;
          created_at: string;
          currency_code: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          price: number;
          short_description: string | null;
          sku: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          compare_at_price?: number | null;
          created_at?: string;
          currency_code: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          price: number;
          short_description?: string | null;
          sku: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          compare_at_price?: number | null;
          created_at?: string;
          currency_code?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          price?: number;
          short_description?: string | null;
          sku?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      inventory_overview: {
        Row: {
          available_quantity: number | null;
          category_id: string | null;
          category_name: string | null;
          image_url: string | null;
          inventory_id: string | null;
          low_stock_threshold: number | null;
          name: string;
          product_active: boolean;
          product_id: string;
          quantity: number | null;
          reserved_quantity: number | null;
          sku: string;
          stock_status: "in_stock" | "low_stock" | "out_of_stock" | "unconfigured";
          updated_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      adjust_inventory: {
        Args: {
          p_product_id: string;
          p_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          p_quantity: number;
          p_reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
          p_notes?: string | null;
          p_expected_quantity?: number | null;
        };
        Returns: Database["public"]["Tables"]["inventory"]["Row"];
      };
      initialize_inventory: {
        Args: { p_product_id?: string | null };
        Returns: number;
      };
      inventory_summary: {
        Args: { p_include_inactive?: boolean };
        Returns: {
          total_products: number;
          in_stock: number;
          low_stock: number;
          out_of_stock: number;
          unconfigured: number;
          total_units: number;
          reserved_units: number;
        }[];
      };
      delete_product_image: {
        Args: { p_image_id: string };
        Returns: string;
      };
      reorder_product_images: {
        Args: { p_product_id: string; p_image_ids: string[] };
        Returns: undefined;
      };
      set_primary_product_image: {
        Args: { p_image_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      inventory_adjustment_reason:
        | "stock_received"
        | "stock_count_correction"
        | "damaged"
        | "lost"
        | "returned"
        | "manual_correction"
        | "other";
      inventory_adjustment_type: "increase" | "decrease" | "set";
      order_status:
        "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
      user_role: "ADMIN" | "CUSTOMER";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

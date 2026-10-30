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
      currencies: {
        Row: {
          code: string;
          symbol: string;
          decimals: number;
          is_active: boolean;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          symbol: string;
          decimals: number;
          is_active?: boolean;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          symbol?: string;
          decimals?: number;
          is_active?: boolean;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      country_currency: {
        Row: {
          country_code: string;
          currency_code: string;
        };
        Insert: {
          country_code: string;
          currency_code: string;
        };
        Update: {
          country_code?: string;
          currency_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "country_currency_currency_code_fkey";
            columns: ["currency_code"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
      shipping_countries: {
        Row: {
          country_code: string;
          currency_code: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          country_code: string;
          currency_code: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          country_code?: string;
          currency_code?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_countries_currency_fkey";
            columns: ["country_code", "currency_code"];
            isOneToOne: true;
            referencedRelation: "country_currency";
            referencedColumns: ["country_code", "currency_code"];
          },
        ];
      };
      shipping_methods: {
        Row: {
          id: string;
          country_code: string;
          code: Database["public"]["Enums"]["shipping_method_code"];
          rate_type: Database["public"]["Enums"]["shipping_rate_type"];
          is_active: boolean;
          free_shipping_threshold: number | null;
          min_delivery_days: number;
          max_delivery_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          country_code: string;
          code: Database["public"]["Enums"]["shipping_method_code"];
          rate_type?: Database["public"]["Enums"]["shipping_rate_type"];
          is_active?: boolean;
          free_shipping_threshold?: number | null;
          min_delivery_days: number;
          max_delivery_days: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          country_code?: string;
          code?: Database["public"]["Enums"]["shipping_method_code"];
          rate_type?: Database["public"]["Enums"]["shipping_rate_type"];
          is_active?: boolean;
          free_shipping_threshold?: number | null;
          min_delivery_days?: number;
          max_delivery_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_methods_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "shipping_countries";
            referencedColumns: ["country_code"];
          },
        ];
      };
      shipping_rates: {
        Row: {
          id: string;
          method_id: string;
          min_value: number;
          max_value: number | null;
          amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          method_id: string;
          min_value?: number;
          max_value?: number | null;
          amount: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          method_id?: string;
          min_value?: number;
          max_value?: number | null;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_rates_method_id_fkey";
            columns: ["method_id"];
            isOneToOne: false;
            referencedRelation: "shipping_methods";
            referencedColumns: ["id"];
          },
        ];
      };
      product_prices: {
        Row: {
          id: string;
          product_id: string;
          variant_id: string | null;
          currency_code: string;
          price: number;
          sale_price: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          variant_id?: string | null;
          currency_code: string;
          price: number;
          sale_price?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          variant_id?: string | null;
          currency_code?: string;
          price?: number;
          sale_price?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_prices_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_prices_currency_code_fkey";
            columns: ["currency_code"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
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
      attribute_values: {
        Row: {
          attribute_id: string;
          color_hex: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          sort_order: number;
          updated_at: string;
          value: string;
        };
        Insert: {
          attribute_id: string;
          color_hex?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          sort_order?: number;
          updated_at?: string;
          value: string;
        };
        Update: {
          attribute_id?: string;
          color_hex?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          sort_order?: number;
          updated_at?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attribute_values_attribute_id_fkey";
            columns: ["attribute_id"];
            isOneToOne: false;
            referencedRelation: "attributes";
            referencedColumns: ["id"];
          },
        ];
      };
      attributes: {
        Row: {
          allows_multiple: boolean;
          code: string;
          creates_variants: boolean;
          created_at: string;
          data_type: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          unit: string | null;
          updated_at: string;
        };
        Insert: {
          allows_multiple?: boolean;
          code: string;
          creates_variants?: boolean;
          created_at?: string;
          data_type: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          unit?: string | null;
          updated_at?: string;
        };
        Update: {
          allows_multiple?: boolean;
          code?: string;
          creates_variants?: boolean;
          created_at?: string;
          data_type?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          unit?: string | null;
          updated_at?: string;
        };
        Relationships: [];
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
          parent_id: string | null;
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
          parent_id?: string | null;
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
          parent_id?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      hero_slides: {
        Row: {
          image_path: string;
          image_url: string;
          position: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          image_path: string;
          image_url: string;
          position: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          image_path?: string;
          image_url?: string;
          position?: number;
          updated_at?: string;
          updated_by?: string | null;
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
          order_id: string | null;
          adjustment_quantity: number;
          adjustment_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at: string;
          created_by: string | null;
          id: string;
          inventory_id: string | null;
          notes: string | null;
          product_id: string;
          quantity_after: number;
          quantity_before: number;
          reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
          variant_id: string | null;
          variant_sku: string | null;
        };
        Insert: {
          order_id?: string | null;
          adjustment_quantity: number;
          adjustment_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inventory_id?: string | null;
          notes?: string | null;
          product_id: string;
          quantity_after: number;
          quantity_before: number;
          reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
          variant_id?: string | null;
          variant_sku?: string | null;
        };
        Update: {
          order_id?: string | null;
          adjustment_quantity?: number;
          adjustment_type?: Database["public"]["Enums"]["inventory_adjustment_type"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          inventory_id?: string | null;
          notes?: string | null;
          product_id?: string;
          quantity_after?: number;
          quantity_before?: number;
          reason?: Database["public"]["Enums"]["inventory_adjustment_reason"];
          variant_id?: string | null;
          variant_sku?: string | null;
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
            foreignKeyName: "inventory_adjustments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_adjustments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_adjustments_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
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
          stock_deducted: boolean;
          billing_address_snapshot: Json | null;
          checkout_key: string | null;
          created_at: string;
          currency_code: string;
          discount: number;
          id: string;
          order_number: number;
          shipping: number;
          shipping_address_snapshot: Json;
          shipping_method: Database["public"]["Enums"]["shipping_method_code"] | null;
          shipping_method_id: string | null;
          shipping_snapshot: Json | null;
          status: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          tax: number;
          total: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          stock_deducted?: boolean;
          billing_address_snapshot?: Json | null;
          checkout_key?: string | null;
          created_at?: string;
          currency_code: string;
          discount?: number;
          id?: string;
          order_number?: never;
          shipping?: number;
          shipping_address_snapshot: Json;
          shipping_method?: Database["public"]["Enums"]["shipping_method_code"] | null;
          shipping_method_id?: string | null;
          shipping_snapshot?: Json | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal: number;
          tax?: number;
          total: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          stock_deducted?: boolean;
          billing_address_snapshot?: Json | null;
          checkout_key?: string | null;
          created_at?: string;
          currency_code?: string;
          discount?: number;
          id?: string;
          order_number?: never;
          shipping?: number;
          shipping_address_snapshot?: Json;
          shipping_method?: Database["public"]["Enums"]["shipping_method_code"] | null;
          shipping_method_id?: string | null;
          shipping_snapshot?: Json | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_shipping_method_id_fkey";
            columns: ["shipping_method_id"];
            isOneToOne: false;
            referencedRelation: "shipping_methods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      product_attributes: {
        Row: {
          attribute_id: string;
          attribute_value_id: string | null;
          created_at: string;
          id: string;
          product_id: string;
          value_boolean: boolean | null;
          value_number: number | null;
          value_text: string | null;
        };
        Insert: {
          attribute_id: string;
          attribute_value_id?: string | null;
          created_at?: string;
          id?: string;
          product_id: string;
          value_boolean?: boolean | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Update: {
          attribute_id?: string;
          attribute_value_id?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string;
          value_boolean?: boolean | null;
          value_number?: number | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_attributes_attribute_id_fkey";
            columns: ["attribute_id"];
            isOneToOne: false;
            referencedRelation: "attributes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_attributes_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_attributes_value_fkey";
            columns: ["attribute_id", "attribute_value_id"];
            isOneToOne: false;
            referencedRelation: "attribute_values";
            referencedColumns: ["attribute_id", "id"];
          },
        ];
      };
      product_categories: {
        Row: {
          category_id: string;
          created_at: string;
          id: string;
          product_id: string;
        };
        Insert: {
          category_id: string;
          created_at?: string;
          id?: string;
          product_id: string;
        };
        Update: {
          category_id?: string;
          created_at?: string;
          id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_categories_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
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
      product_tags: {
        Row: {
          created_at: string;
          product_id: string;
          tag_id: string;
        };
        Insert: {
          created_at?: string;
          product_id: string;
          tag_id: string;
        };
        Update: {
          created_at?: string;
          product_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_tags_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_type_attributes: {
        Row: {
          attribute_id: string;
          created_at: string;
          is_required: boolean;
          product_type_id: string;
          sort_order: number;
        };
        Insert: {
          attribute_id: string;
          created_at?: string;
          is_required?: boolean;
          product_type_id: string;
          sort_order?: number;
        };
        Update: {
          attribute_id?: string;
          created_at?: string;
          is_required?: boolean;
          product_type_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_type_attributes_attribute_id_fkey";
            columns: ["attribute_id"];
            isOneToOne: false;
            referencedRelation: "attributes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_type_attributes_product_type_id_fkey";
            columns: ["product_type_id"];
            isOneToOne: false;
            referencedRelation: "product_types";
            referencedColumns: ["id"];
          },
        ];
      };
      product_types: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          weight_grams: number | null;
          combination_key: string;
          compare_at_price: number | null;
          created_at: string;
          id: string;
          image_id: string | null;
          is_active: boolean;
          price: number;
          product_id: string;
          sku: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          weight_grams?: number | null;
          combination_key: string;
          compare_at_price?: number | null;
          created_at?: string;
          id?: string;
          image_id?: string | null;
          is_active?: boolean;
          price: number;
          product_id: string;
          sku: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          weight_grams?: number | null;
          combination_key?: string;
          compare_at_price?: number | null;
          created_at?: string;
          id?: string;
          image_id?: string | null;
          is_active?: boolean;
          price?: number;
          product_id?: string;
          sku?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_variants_image_fkey";
            columns: ["product_id", "image_id"];
            isOneToOne: false;
            referencedRelation: "product_images";
            referencedColumns: ["product_id", "id"];
          },
        ];
      };
      products: {
        Row: {
          weight_grams: number | null;
          category_id: string | null;
          compare_at_price: number | null;
          created_at: string;
          currency_code: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          price: number;
          product_type_id: string | null;
          short_description: string | null;
          sku: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          weight_grams?: number | null;
          category_id?: string | null;
          compare_at_price?: number | null;
          created_at?: string;
          currency_code: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          price: number;
          product_type_id?: string | null;
          short_description?: string | null;
          sku: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          weight_grams?: number | null;
          category_id?: string | null;
          compare_at_price?: number | null;
          created_at?: string;
          currency_code?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          price?: number;
          product_type_id?: string | null;
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
          {
            foreignKeyName: "products_product_type_id_fkey";
            columns: ["product_type_id"];
            isOneToOne: false;
            referencedRelation: "product_types";
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
      variant_attribute_values: {
        Row: {
          attribute_id: string;
          attribute_value_id: string;
          variant_id: string;
        };
        Insert: {
          attribute_id: string;
          attribute_value_id: string;
          variant_id: string;
        };
        Update: {
          attribute_id?: string;
          attribute_value_id?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_attribute_values_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_attribute_values_attribute_id_fkey";
            columns: ["attribute_id"];
            isOneToOne: false;
            referencedRelation: "attributes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_attribute_values_value_fkey";
            columns: ["attribute_id", "attribute_value_id"];
            isOneToOne: false;
            referencedRelation: "attribute_values";
            referencedColumns: ["attribute_id", "id"];
          },
        ];
      };
      variant_inventory: {
        Row: {
          created_at: string;
          id: string;
          low_stock_threshold: number;
          product_id: string;
          quantity: number;
          reserved_quantity: number;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          product_id: string;
          quantity?: number;
          reserved_quantity?: number;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          low_stock_threshold?: number;
          product_id?: string;
          quantity?: number;
          reserved_quantity?: number;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_inventory_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: true;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_inventory_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      store_settings: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          allow_customer_cancellation: boolean;
          business_hours: Json | null;
          city: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          contact_published: boolean;
          contact_whatsapp: string | null;
          country_code: string;
          currency_code: string;
          default_locale: string;
          delivery_max_days: number;
          delivery_min_days: number;
          free_shipping_threshold: number | null;
          id: boolean;
          logo_path: string | null;
          logo_url: string | null;
          max_quantity_per_item: number;
          min_order_amount: number | null;
          notification_email: string | null;
          notify_low_stock: boolean;
          notify_new_order: boolean;
          notify_order_cancelled: boolean;
          postal_code: string | null;
          prices_include_tax: boolean;
          shipping_fee: number;
          social_facebook: string | null;
          social_instagram: string | null;
          social_snapchat: string | null;
          social_tiktok: string | null;
          social_x: string | null;
          social_youtube: string | null;
          state_region: string | null;
          store_name: string;
          tax_enabled: boolean;
          tax_rate: number;
          tax_registration_number: string | null;
          timezone: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          allow_customer_cancellation?: boolean;
          business_hours?: Json | null;
          city?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          contact_published?: boolean;
          contact_whatsapp?: string | null;
          country_code: string;
          currency_code: string;
          default_locale: string;
          delivery_max_days?: number;
          delivery_min_days?: number;
          free_shipping_threshold?: number | null;
          id?: boolean;
          logo_path?: string | null;
          logo_url?: string | null;
          max_quantity_per_item?: number;
          min_order_amount?: number | null;
          notification_email?: string | null;
          notify_low_stock?: boolean;
          notify_new_order?: boolean;
          notify_order_cancelled?: boolean;
          postal_code?: string | null;
          prices_include_tax?: boolean;
          shipping_fee?: number;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_snapchat?: string | null;
          social_tiktok?: string | null;
          social_x?: string | null;
          social_youtube?: string | null;
          state_region?: string | null;
          store_name: string;
          tax_enabled?: boolean;
          tax_rate?: number;
          tax_registration_number?: string | null;
          timezone: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          allow_customer_cancellation?: boolean;
          business_hours?: Json | null;
          city?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          contact_published?: boolean;
          contact_whatsapp?: string | null;
          country_code?: string;
          currency_code?: string;
          default_locale?: string;
          delivery_max_days?: number;
          delivery_min_days?: number;
          free_shipping_threshold?: number | null;
          id?: boolean;
          logo_path?: string | null;
          logo_url?: string | null;
          max_quantity_per_item?: number;
          min_order_amount?: number | null;
          notification_email?: string | null;
          notify_low_stock?: boolean;
          notify_new_order?: boolean;
          notify_order_cancelled?: boolean;
          postal_code?: string | null;
          prices_include_tax?: boolean;
          shipping_fee?: number;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_snapchat?: string | null;
          social_tiktok?: string | null;
          social_x?: string | null;
          social_youtube?: string | null;
          state_region?: string | null;
          store_name?: string;
          tax_enabled?: boolean;
          tax_rate?: number;
          tax_registration_number?: string | null;
          timezone?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "store_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      inventory_overview: {
        Row: {
          allocated_quantity: number;
          unallocated_quantity: number | null;
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
          variant_alerts: number;
          variant_count: number;
          variant_low_stock: number;
          variant_out_of_stock: number;
          variant_skus: string | null;
        };
        Relationships: [];
      };
      variant_inventory_overview: {
        Row: {
          available_quantity: number | null;
          combination_key: string;
          compare_at_price: number | null;
          currency_code: string;
          image_id: string | null;
          image_url: string | null;
          inventory_id: string | null;
          is_active: boolean;
          label: string | null;
          low_stock_threshold: number | null;
          price: number;
          product_active: boolean;
          product_id: string;
          quantity: number | null;
          reserved_quantity: number | null;
          sku: string;
          sort_order: number;
          stock_status: "in_stock" | "low_stock" | "out_of_stock" | "unconfigured";
          stock_updated_at: string | null;
          updated_at: string;
          variant_id: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      adjust_stock_batch: {
        Args: {
          p_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          p_reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
          p_notes: string | null;
          p_items: Json;
        };
        Returns: number;
      };
      add_shipping_country: {
        Args: { p_country_code: string };
        Returns: undefined;
      };
      save_shipping_country: {
        Args: {
          p_country_code: string;
          p_updated_at: string | null;
          p_is_active: boolean;
          p_methods: Json;
        };
        Returns: string;
      };
      set_default_currency: {
        Args: { p_code: string };
        Returns: undefined;
      };
      set_product_prices: {
        Args: { p_product_id: string; p_prices: Json };
        Returns: undefined;
      };
      import_product_prices: {
        Args: { p_rows: Json };
        Returns: number;
      };
      store_contact: {
        Args: Record<PropertyKey, never>;
        Returns: {
          store_name: string;
          contact_email: string | null;
          contact_phone: string | null;
          contact_whatsapp: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state_region: string | null;
          postal_code: string | null;
          country_code: string;
          business_hours: Json | null;
          social_instagram: string | null;
          social_facebook: string | null;
          social_tiktok: string | null;
          social_snapchat: string | null;
          social_x: string | null;
          social_youtube: string | null;
        }[];
      };
      adjust_variant_inventory: {
        Args: {
          p_variant_id: string;
          p_type: Database["public"]["Enums"]["inventory_adjustment_type"];
          p_quantity: number;
          p_reason: Database["public"]["Enums"]["inventory_adjustment_reason"];
          p_notes?: string | null;
          p_expected_quantity?: number | null;
        };
        Returns: Database["public"]["Tables"]["variant_inventory"]["Row"];
      };
      admin_dashboard_summary: {
        Args: {
          p_from: string;
          p_previous_from: string;
          p_today: string;
          p_time_zone?: string;
          p_top_limit?: number;
        };
        Returns: Json;
      };
      admin_get_customer: {
        Args: { p_id: string };
        Returns: Json;
      };
      admin_list_customers: {
        Args: {
          p_search?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
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
      delete_product_variants: {
        Args: { p_product_id: string; p_variant_ids: string[]; p_clear_stock?: boolean };
        Returns: Json;
      };
      generate_product_variants: {
        Args: { p_product_id: string; p_variants: Json; p_stock_variant?: number | null };
        Returns: number;
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
      inventory_variant_summary: {
        Args: { p_include_inactive?: boolean };
        Returns: {
          products_with_alerts: number;
          low_stock_variants: number;
          out_of_stock_variants: number;
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
      set_attribute_values: {
        Args: { p_attribute_id: string; p_values: Json };
        Returns: undefined;
      };
      set_product_categories: {
        Args: { p_product_id: string; p_category_ids: string[] };
        Returns: undefined;
      };
      set_product_tags: {
        Args: { p_product_id: string; p_tag_ids: string[] };
        Returns: undefined;
      };
      set_product_attributes: {
        Args: { p_product_id: string; p_product_type_id: string | null; p_values: Json };
        Returns: undefined;
      };
      set_product_type_attributes: {
        Args: { p_product_type_id: string; p_attributes: Json };
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
        | "other"
        | "variant_migration"
        | "variant_deleted"
        | "sold"
        | "order_cancelled";
      inventory_adjustment_type: "increase" | "decrease" | "set";
      order_status:
        "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
      user_role: "ADMIN" | "CUSTOMER";
      shipping_method_code: "STANDARD" | "EXPRESS";
      shipping_rate_type: "FLAT" | "WEIGHT_BASED" | "ORDER_BASED";
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

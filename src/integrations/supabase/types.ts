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
      analytics_events: {
        Row: {
          business_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      business_attributes: {
        Row: {
          attribute_key: string
          business_id: string
          created_at: string
          id: string
          source: string | null
          value: Json | null
        }
        Insert: {
          attribute_key: string
          business_id: string
          created_at?: string
          id?: string
          source?: string | null
          value?: Json | null
        }
        Update: {
          attribute_key?: string
          business_id?: string
          created_at?: string
          id?: string
          source?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "business_attributes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_category_links: {
        Row: {
          business_id: string
          category_id: string
          created_at: string
          is_primary: boolean
        }
        Insert: {
          business_id: string
          category_id: string
          created_at?: string
          is_primary?: boolean
        }
        Update: {
          business_id?: string
          category_id?: string
          created_at?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_category_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      business_change_requests: {
        Row: {
          admin_notes: string | null
          approved_fields: Json | null
          business_id: string
          changes: Json
          created_at: string
          id: string
          original_values: Json | null
          rejected_fields: Json | null
          request_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
        }
        Insert: {
          admin_notes?: string | null
          approved_fields?: Json | null
          business_id: string
          changes: Json
          created_at?: string
          id?: string
          original_values?: Json | null
          rejected_fields?: Json | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
        }
        Update: {
          admin_notes?: string | null
          approved_fields?: Json | null
          business_id?: string
          changes?: Json
          created_at?: string
          id?: string
          original_values?: Json | null
          rejected_fields?: Json | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_change_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_images: {
        Row: {
          business_id: string
          content_hash: string | null
          content_type: string | null
          created_at: string
          deleted_at: string | null
          error_code: string | null
          error_message: string | null
          file_size: number | null
          google_photo_category: string | null
          google_photo_labels: Json | null
          height: number | null
          id: string
          image_type: string
          is_cover: boolean
          last_attempt_at: string | null
          next_attempt_at: string | null
          place_id: string
          r2_key: string | null
          r2_url: string | null
          retry_count: number
          sort_order: number
          source_metadata: Json
          source_provider: string
          source_title: string | null
          source_type: string
          source_url: string | null
          storage_status: string
          updated_at: string
          uploaded_at: string | null
          width: number | null
        }
        Insert: {
          business_id: string
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          error_message?: string | null
          file_size?: number | null
          google_photo_category?: string | null
          google_photo_labels?: Json | null
          height?: number | null
          id?: string
          image_type?: string
          is_cover?: boolean
          last_attempt_at?: string | null
          next_attempt_at?: string | null
          place_id: string
          r2_key?: string | null
          r2_url?: string | null
          retry_count?: number
          sort_order?: number
          source_metadata?: Json
          source_provider?: string
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          storage_status?: string
          updated_at?: string
          uploaded_at?: string | null
          width?: number | null
        }
        Update: {
          business_id?: string
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          error_message?: string | null
          file_size?: number | null
          google_photo_category?: string | null
          google_photo_labels?: Json | null
          height?: number | null
          id?: string
          image_type?: string
          is_cover?: boolean
          last_attempt_at?: string | null
          next_attempt_at?: string | null
          place_id?: string
          r2_key?: string | null
          r2_url?: string | null
          retry_count?: number
          sort_order?: number
          source_metadata?: Json
          source_provider?: string
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          storage_status?: string
          updated_at?: string
          uploaded_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "business_images_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_opening_hours: {
        Row: {
          business_id: string
          close_time: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          open_time: string | null
          raw_value: string | null
          sort_order: number
        }
        Insert: {
          business_id: string
          close_time?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          raw_value?: string | null
          sort_order?: number
        }
        Update: {
          business_id?: string
          close_time?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          raw_value?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_opening_hours_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_services: {
        Row: {
          business_id: string
          created_at: string
          id: string
          service_key: string
          sort_order: number
          value: Json | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          service_key: string
          sort_order?: number
          value?: Json | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          service_key?: string
          sort_order?: number
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "business_services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_translations: {
        Row: {
          business_id: string
          created_at: string
          id: string
          language_code: string
          source_content_hash: string | null
          translated_at: string | null
          translated_by: string | null
          translated_description: string | null
          translated_name: string | null
          translated_services: Json | null
          translation_status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          language_code: string
          source_content_hash?: string | null
          translated_at?: string | null
          translated_by?: string | null
          translated_description?: string | null
          translated_name?: string | null
          translated_services?: Json | null
          translation_status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          language_code?: string
          source_content_hash?: string | null
          translated_at?: string | null
          translated_by?: string | null
          translated_description?: string | null
          translated_name?: string | null
          translated_services?: Json | null
          translation_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_translations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          city_id: string | null
          country_id: string | null
          created_at: string
          description: string | null
          district_id: string | null
          email: string | null
          field_sources: Json
          formatted_address: string | null
          google_maps_url: string | null
          id: string
          international_phone: string | null
          is_featured: boolean
          is_verified: boolean
          latitude: number | null
          longitude: number | null
          name: string
          neighborhood: string | null
          original_language: string | null
          owner_id: string | null
          phone: string | null
          place_id: string
          popular_times: Json | null
          price_level: number | null
          primary_category_id: string | null
          rating: number | null
          raw_address: string | null
          raw_data: Json | null
          review_count: number
          slug: string
          source: string
          source_updated_at: string | null
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          city_id?: string | null
          country_id?: string | null
          created_at?: string
          description?: string | null
          district_id?: string | null
          email?: string | null
          field_sources?: Json
          formatted_address?: string | null
          google_maps_url?: string | null
          id?: string
          international_phone?: string | null
          is_featured?: boolean
          is_verified?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          neighborhood?: string | null
          original_language?: string | null
          owner_id?: string | null
          phone?: string | null
          place_id: string
          popular_times?: Json | null
          price_level?: number | null
          primary_category_id?: string | null
          rating?: number | null
          raw_address?: string | null
          raw_data?: Json | null
          review_count?: number
          slug: string
          source?: string
          source_updated_at?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          city_id?: string | null
          country_id?: string | null
          created_at?: string
          description?: string | null
          district_id?: string | null
          email?: string | null
          field_sources?: Json
          formatted_address?: string | null
          google_maps_url?: string | null
          id?: string
          international_phone?: string | null
          is_featured?: boolean
          is_verified?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          neighborhood?: string | null
          original_language?: string | null
          owner_id?: string | null
          phone?: string | null
          place_id?: string
          popular_times?: Json | null
          price_level?: number | null
          primary_category_id?: string | null
          rating?: number | null
          raw_address?: string | null
          raw_data?: Json | null
          review_count?: number
          slug?: string
          source?: string
          source_updated_at?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "businesses_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "businesses_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "businesses_primary_category_id_fkey"
            columns: ["primary_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          category_type: string | null
          created_at: string
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_type?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_type?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_mappings: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          mapping_status: string
          normalized_source_category: string
          source_category: string
          source_provider: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          mapping_status?: string
          normalized_source_category: string
          source_category: string
          source_provider?: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          mapping_status?: string
          normalized_source_category?: string
          source_category?: string
          source_provider?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_mappings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_translations: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          id: string
          language_code: string
          name: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          language_code: string
          name: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          language_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_translations_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          country_id: string
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          is_featured: boolean
          latitude: number | null
          longitude: number | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          country_id: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          latitude?: number | null
          longitude?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          country_id?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          latitude?: number | null
          longitude?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      city_translations: {
        Row: {
          city_id: string
          created_at: string
          description: string | null
          id: string
          language_code: string
          name: string
          updated_at: string
        }
        Insert: {
          city_id: string
          created_at?: string
          description?: string | null
          id?: string
          language_code: string
          name: string
          updated_at?: string
        }
        Update: {
          city_id?: string
          created_at?: string
          description?: string | null
          id?: string
          language_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_translations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      country_translations: {
        Row: {
          country_id: string
          created_at: string
          id: string
          language_code: string
          name: string
          updated_at: string
        }
        Insert: {
          country_id: string
          created_at?: string
          id?: string
          language_code: string
          name: string
          updated_at?: string
        }
        Update: {
          country_id?: string
          created_at?: string
          id?: string
          language_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_translations_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      district_translations: {
        Row: {
          created_at: string
          district_id: string
          id: string
          language_code: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          district_id: string
          id?: string
          language_code: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          district_id?: string
          id?: string
          language_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "district_translations_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
        ]
      }
      districts: {
        Row: {
          city_id: string
          created_at: string
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          slug: string
          updated_at: string
        }
        Insert: {
          city_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          slug: string
          updated_at?: string
        }
        Update: {
          city_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "districts_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          business_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      image_processing_jobs: {
        Row: {
          attempt: number
          business_image_id: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          last_error: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          next_run_at: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          business_image_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          business_image_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_processing_jobs_business_image_id_fkey"
            columns: ["business_image_id"]
            isOneToOne: false
            referencedRelation: "business_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_processing_jobs_business_image_id_fkey"
            columns: ["business_image_id"]
            isOneToOne: false
            referencedRelation: "business_images_public"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batch_items: {
        Row: {
          action: string | null
          business_id: string | null
          created_at: string
          error_message: string | null
          id: string
          import_batch_id: string
          item_index: number | null
          place_id: string | null
          processed_at: string | null
          raw_payload: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          action?: string | null
          business_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_batch_id: string
          item_index?: number | null
          place_id?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string | null
          business_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_batch_id?: string
          item_index?: number | null
          place_id?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batch_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batch_items_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_items: number
          error_message: string | null
          failed_items: number
          file_hash: string | null
          file_size: number | null
          id: string
          import_options: Json
          inserted_items: number
          invalid_items: number
          metadata: Json | null
          needs_mapping_items: number
          original_filename: string | null
          processed_items: number
          processing_lock_at: string | null
          processing_lock_by: string | null
          skipped_items: number
          source: string
          source_provider: string
          started_at: string | null
          status: string
          storage_bucket: string
          storage_object_path: string | null
          total_items: number
          updated_at: string
          updated_items: number
          valid_items: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_items?: number
          error_message?: string | null
          failed_items?: number
          file_hash?: string | null
          file_size?: number | null
          id?: string
          import_options?: Json
          inserted_items?: number
          invalid_items?: number
          metadata?: Json | null
          needs_mapping_items?: number
          original_filename?: string | null
          processed_items?: number
          processing_lock_at?: string | null
          processing_lock_by?: string | null
          skipped_items?: number
          source: string
          source_provider?: string
          started_at?: string | null
          status?: string
          storage_bucket?: string
          storage_object_path?: string | null
          total_items?: number
          updated_at?: string
          updated_items?: number
          valid_items?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_items?: number
          error_message?: string | null
          failed_items?: number
          file_hash?: string | null
          file_size?: number | null
          id?: string
          import_options?: Json
          inserted_items?: number
          invalid_items?: number
          metadata?: Json | null
          needs_mapping_items?: number
          original_filename?: string | null
          processed_items?: number
          processing_lock_at?: string | null
          processing_lock_by?: string | null
          skipped_items?: number
          source?: string
          source_provider?: string
          started_at?: string | null
          status?: string
          storage_bucket?: string
          storage_object_path?: string | null
          total_items?: number
          updated_at?: string
          updated_items?: number
          valid_items?: number
        }
        Relationships: []
      }
      owner_notifications: {
        Row: {
          business_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ownership_claims: {
        Row: {
          admin_notes: string | null
          business_email: string | null
          business_id: string
          created_at: string
          evidence_urls: Json | null
          full_name: string | null
          id: string
          message: string | null
          phone: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          business_email?: string | null
          business_id: string
          created_at?: string
          evidence_urls?: Json | null
          full_name?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          business_email?: string | null
          business_id?: string
          created_at?: string
          evidence_urls?: Json | null
          full_name?: string | null
          id?: string
          message?: string | null
          phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownership_claims_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          preferred_language: string
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          preferred_language?: string
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          preferred_language?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          admin_notes: string | null
          business_id: string | null
          created_at: string
          id: string
          image_id: string | null
          internal_notes: string | null
          message: string | null
          report_type: string
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          review_id: string | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          image_id?: string | null
          internal_notes?: string | null
          message?: string | null
          report_type: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          image_id?: string | null
          internal_notes?: string | null
          message?: string | null
          report_type?: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "business_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "business_images_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_replies: {
        Row: {
          author_id: string
          body: string
          business_id: string
          created_at: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_notes: string | null
          review_id: string
          status: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          business_id: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_notes?: string | null
          review_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          business_id?: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_notes?: string | null
          review_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_replies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          admin_notes: string | null
          author_avatar_url: string | null
          author_name: string | null
          business_id: string
          created_at: string
          external_review_id: string | null
          id: string
          owner_reply: string | null
          owner_reply_at: string | null
          rating: number
          review_date: string | null
          review_language: string | null
          review_text: string | null
          source: string
          source_fingerprint: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          author_avatar_url?: string | null
          author_name?: string | null
          business_id: string
          created_at?: string
          external_review_id?: string | null
          id?: string
          owner_reply?: string | null
          owner_reply_at?: string | null
          rating: number
          review_date?: string | null
          review_language?: string | null
          review_text?: string | null
          source: string
          source_fingerprint?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          author_avatar_url?: string | null
          author_name?: string | null
          business_id?: string
          created_at?: string
          external_review_id?: string | null
          id?: string
          owner_reply?: string | null
          owner_reply_at?: string | null
          rating?: number
          review_date?: string | null
          review_language?: string | null
          review_text?: string | null
          source?: string
          source_fingerprint?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      translation_jobs: {
        Row: {
          attempts: number
          business_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          last_error: string | null
          model: string | null
          provider: string | null
          source_content_hash: string | null
          source_field: string | null
          source_language: string | null
          started_at: string | null
          status: string
          target_language: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_error?: string | null
          model?: string | null
          provider?: string | null
          source_content_hash?: string | null
          source_field?: string | null
          source_language?: string | null
          started_at?: string | null
          status?: string
          target_language: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          last_error?: string | null
          model?: string | null
          provider?: string | null
          source_content_hash?: string | null
          source_field?: string | null
          source_language?: string | null
          started_at?: string | null
          status?: string
          target_language?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
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
      business_images_public: {
        Row: {
          business_id: string | null
          google_photo_category: string | null
          height: number | null
          id: string | null
          image_type: string | null
          is_cover: boolean | null
          r2_url: string | null
          sort_order: number | null
          source_title: string | null
          source_type: string | null
          source_url: string | null
          storage_status: string | null
          uploaded_at: string | null
          width: number | null
        }
        Insert: {
          business_id?: string | null
          google_photo_category?: string | null
          height?: number | null
          id?: string | null
          image_type?: string | null
          is_cover?: boolean | null
          r2_url?: string | null
          sort_order?: number | null
          source_title?: string | null
          source_type?: string | null
          source_url?: string | null
          storage_status?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Update: {
          business_id?: string | null
          google_photo_category?: string | null
          height?: number | null
          id?: string | null
          image_type?: string | null
          is_cover?: boolean | null
          r2_url?: string | null
          sort_order?: number | null
          source_title?: string | null
          source_type?: string | null
          source_url?: string | null
          storage_status?: string | null
          uploaded_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "business_images_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _bcr_field_allowlist: { Args: { _type: string }; Returns: string[] }
      _try_bootstrap_first_admin: {
        Args: {
          _email_confirmed_at: string
          _provider: string
          _user_id: string
        }
        Returns: boolean
      }
      apply_business_change_request: {
        Args: {
          _admin_notes: string
          _approve: Json
          _reject: Json
          _request_id: string
        }
        Returns: Json
      }
      approve_ownership_claim: { Args: { _claim_id: string }; Returns: Json }
      bootstrap_admin: { Args: { _target_user: string }; Returns: Json }
      claim_next_image_jobs: {
        Args: { _lease_seconds?: number; _limit?: number; _worker: string }
        Returns: {
          attempt: number
          business_image_id: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          id: string
          last_error: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          next_run_at: string
          requested_by: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "image_processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_suspended: { Args: { _user: string }; Returns: boolean }
      owner_authz: { Args: { _business_id: string }; Returns: Json }
      owner_has_business: { Args: { _user: string }; Returns: boolean }
      reap_stale_image_jobs: { Args: never; Returns: number }
      record_audit: {
        Args: {
          _action: string
          _after: Json
          _before: Json
          _entity_id: string
          _entity_type: string
          _metadata: Json
        }
        Returns: string
      }
      revoke_ownership: {
        Args: { _business_id: string; _reason: string }
        Returns: Json
      }
      set_user_role: {
        Args: {
          _add: boolean
          _confirm_self?: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _target_user: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "user" | "business_owner" | "moderator" | "admin"
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
      app_role: ["user", "business_owner", "moderator", "admin"],
    },
  },
} as const

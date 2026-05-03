import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://uaaswgpgtaijvkyyocok.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhYXN3Z3BndGFpanZreXlvY29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTYxNzYsImV4cCI6MjA4ODk3MjE3Nn0.Vq1kv8bGI2coR4IliCyDQEEBa_ZKAVr5HBfVlN8VWOw"

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = "https://kubkobzfnphssufkzonb.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1YmtvYnpmbnBoc3N1Zmt6b25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Njk2ODEsImV4cCI6MjA5ODI0NTY4MX0.ym68-zHl8vCAGnOzpmGgyFrZRUz8st4IB0EPiX2xFYU"

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
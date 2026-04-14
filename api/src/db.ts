import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    db: { schema: "premier" },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }
);

export default supabase;

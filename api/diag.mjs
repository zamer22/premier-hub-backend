import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: "premier" }, auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("URL:", process.env.SUPABASE_URL);

// 1. ¿Existe la tabla producto_variante y tiene datos?
console.log("\n--- Variantes en la BD ---");
const r3 = await supabase.from("producto_variante").select("id_variante, id_producto, talla, stock").order("id_producto").limit(20);
console.log("count:", r3.data?.length);
console.log("data:", r3.data);
console.log("error:", r3.error);

// 2. Endpoint /productos-v2?categoria=real (lo que el frontend pide)
console.log("\n--- Endpoint productos-v2?categoria=real ---");
const res = await fetch("http://localhost:4001/api/tienda/productos-v2?categoria=real");
const json = await res.json();
console.log("status:", res.status);
console.log("count:", json.data?.length);
console.log("primer producto:", JSON.stringify(json.data?.[0], null, 2));
console.log("primer jersey con variantes:", JSON.stringify(json.data?.find(p => p.tipo === "jersey"), null, 2));

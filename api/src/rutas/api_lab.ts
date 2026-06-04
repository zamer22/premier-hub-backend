import { Router } from "express";
import supabase from "../db";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

// ── GET /api/lab/desafios ──────────────────────────────────────────────────────

router.get("/desafios", requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data: desafios, error } = await supabase
      .from("lab_desafio")
      .select("*")
      .eq("activo", true)
      .gt("fecha_fin", now)
      .order("tipo")
      .order("puntos", { ascending: false });

    if (error) throw error;

    const ids = (desafios ?? []).map((d) => d.id);

    const { data: progreso } = await supabase
      .from("lab_usuario_desafio")
      .select("*")
      .eq("id_usuario", req.userId)
      .in("id_desafio", ids.length ? ids : [-1]);

    const progresoMap = new Map((progreso ?? []).map((p) => [p.id_desafio, p]));

    const resultado = (desafios ?? []).map((d) => ({
      ...d,
      usuario_progreso:   progresoMap.get(d.id)?.progreso    ?? 0,
      usuario_completado: progresoMap.get(d.id)?.completado  ?? false,
    }));

    res.json({ success: true, data: resultado });
  } catch (err) {
    console.error("[lab/desafios GET]", err);
    res.status(500).json({ success: false, message: "Error al obtener desafíos" });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

type ResultadoAccion = Record<string, unknown>;

function cumpleCondicionExtra(
  condicionExtra: Record<string, unknown> | undefined,
  resultado: ResultadoAccion | undefined
): boolean {
  if (!condicionExtra) return true;
  if (!resultado)      return false;

  const tipo = condicionExtra.tipo as string;

  if (tipo === "precision_minima") {
    return Number(resultado.probability ?? 0) >= Number(condicionExtra.valor);
  }

  if (tipo === "club_en_top") {
    const tabla = resultado.table as Array<{ club: string; position: number }> | undefined;
    if (!tabla) return false;
    const club = tabla.find((r) => r.club === condicionExtra.club);
    return club ? club.position <= Number(condicionExtra.top) : false;
  }

  if (tipo === "max_fichajes") {
    return Number(resultado.num_fichajes ?? 99) <= Number(condicionExtra.max);
  }

  if (tipo === "cambio_resultado") {
    return resultado.no_change === false;
  }

  return false;
}

// ── POST /api/lab/desafios/progreso ───────────────────────────────────────────
// Solo incrementa el contador. No marca completado ni da puntos.

router.post("/desafios/progreso", requireAuth, async (req, res) => {
  const { accion, resultado } = req.body as { accion?: string; resultado?: ResultadoAccion };
  if (!accion) return res.status(400).json({ success: false, message: "accion requerida" });

  try {
    const now = new Date().toISOString();

    const { data: desafios } = await supabase
      .from("lab_desafio")
      .select("*")
      .eq("activo", true)
      .gt("fecha_fin", now);

    const relevantes = (desafios ?? []).filter((d) => {
      const cond = d.condicion as { accion: string };
      return cond.accion === accion || cond.accion === "any_lab";
    });

    if (!relevantes.length) {
      return res.json({ success: true, data: [] });
    }

    const ids = relevantes.map((d) => d.id);

    const { data: progresos } = await supabase
      .from("lab_usuario_desafio")
      .select("*")
      .eq("id_usuario", req.userId)
      .in("id_desafio", ids);

    const progresoMap = new Map((progresos ?? []).map((p) => [p.id_desafio, p]));

    for (const desafio of relevantes) {
      const existing = progresoMap.get(desafio.id);
      if (existing?.completado) continue;

      const condicionExtra = (desafio.condicion as Record<string, unknown>).condicion_extra as
        | Record<string, unknown>
        | undefined;
      if (!cumpleCondicionExtra(condicionExtra, resultado)) continue;

      const nuevoProgreso = (existing?.progreso ?? 0) + 1;
      const meta          = (desafio.condicion as { cantidad: number }).cantidad;

      // Tope en la meta para no sobrepasar
      await supabase.from("lab_usuario_desafio").upsert(
        {
          id_desafio: desafio.id,
          id_usuario: req.userId,
          progreso:   Math.min(nuevoProgreso, meta),
          completado: false,
        },
        { onConflict: "id_desafio,id_usuario" }
      );
    }

    res.json({ success: true, data: [] });
  } catch {
    res.status(500).json({ success: false, message: "Error al registrar progreso" });
  }
});

// ── POST /api/lab/desafios/:id/reclamar ───────────────────────────────────────
// Valida que el usuario completó el desafío y le otorga los puntos.

router.post("/desafios/:id/reclamar", requireAuth, async (req, res) => {
  const idDesafio = Number(req.params.id);
  if (!idDesafio) return res.status(400).json({ success: false, message: "id inválido" });

  try {
    const now = new Date().toISOString();

    const { data: desafio } = await supabase
      .from("lab_desafio")
      .select("*")
      .eq("id", idDesafio)
      .eq("activo", true)
      .gt("fecha_fin", now)
      .single();

    if (!desafio) {
      return res.status(404).json({ success: false, message: "Desafío no encontrado o expirado" });
    }

    const { data: progreso } = await supabase
      .from("lab_usuario_desafio")
      .select("*")
      .eq("id_desafio", idDesafio)
      .eq("id_usuario", req.userId)
      .single();

    if (progreso?.completado) {
      return res.status(409).json({ success: false, message: "Ya reclamaste este desafío" });
    }

    const meta         = (desafio.condicion as { cantidad: number }).cantidad;
    const progresoActual = progreso?.progreso ?? 0;

    if (progresoActual < meta) {
      return res.status(400).json({ success: false, message: "El desafío aún no está completo" });
    }

    await supabase.from("lab_usuario_desafio").upsert(
      {
        id_desafio:       idDesafio,
        id_usuario:       req.userId,
        progreso:         progresoActual,
        completado:       true,
        fecha_completado: now,
        puntos_otorgados: desafio.puntos,
      },
      { onConflict: "id_desafio,id_usuario" }
    );

    const { data: usuario } = await supabase
      .from("usuario")
      .select("dinero")
      .eq("id_usuario", req.userId)
      .single();

    const nuevoDinero = Number(usuario?.dinero ?? 0) + desafio.puntos;

    await supabase
      .from("usuario")
      .update({ dinero: nuevoDinero })
      .eq("id_usuario", req.userId);

    res.json({
      success: true,
      data: { puntos_otorgados: desafio.puntos, nuevo_dinero: nuevoDinero },
    });
  } catch {
    res.status(500).json({ success: false, message: "Error al reclamar desafío" });
  }
});

export default router;

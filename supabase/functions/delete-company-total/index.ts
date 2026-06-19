import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: authErr?.message || "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const requesterId = authData.user.id;

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("global_role")
      .eq("id", requesterId)
      .single();

    if (profErr || profile?.global_role !== "supervisor") {
      return new Response(JSON.stringify({ error: "Only supervisor can perform total deletion" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { companyId } = await req.json();
    if (!companyId) {
      return new Response(JSON.stringify({ error: "companyId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: companyUsers, error: cuErr } = await admin
      .from("company_users")
      .select("user_id")
      .eq("company_id", companyId);

    if (cuErr) {
      return new Response(JSON.stringify({ error: cuErr.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userIds = [...new Set((companyUsers || []).map((r) => r.user_id).filter(Boolean))];

    const deleteByCompanyId = async (tableName: string) => {
      const { error } = await admin.from(tableName).delete().eq("company_id", companyId);
      if (error) throw new Error(`${tableName}: ${error.message}`);
    };

    await deleteByCompanyId("daily_records");
    await deleteByCompanyId("cash_state");
    await deleteByCompanyId("custom_cash_state");
    await deleteByCompanyId("cash_movements");
    await deleteByCompanyId("suppliers");
    await deleteByCompanyId("employees");
    await deleteByCompanyId("bookings");

    const { data: supplierIds } = await admin.from("suppliers").select("id").eq("company_id", companyId);
    const { data: employeeIds } = await admin.from("employees").select("id").eq("company_id", companyId);

    // Best effort deletes for movements linked by foreign ids (if not already cascaded)
    if (supplierIds?.length) {
      const ids = supplierIds.map((x) => x.id);
      await admin.from("supplier_movements").delete().in("supplier_id", ids);
    } else {
      // fallback: remove orphan-ish rows if schema also has company_id
      await admin.from("supplier_movements").delete().eq("company_id", companyId);
    }

    if (employeeIds?.length) {
      const ids = employeeIds.map((x) => x.id);
      await admin.from("employee_movements").delete().in("employee_id", ids);
    } else {
      await admin.from("employee_movements").delete().eq("company_id", companyId);
    }

    const { error: cuDelErr } = await admin.from("company_users").delete().eq("company_id", companyId);
    if (cuDelErr) throw new Error(`company_users: ${cuDelErr.message}`);

    const { error: companyErr } = await admin.from("companies").delete().eq("id", companyId);
    if (companyErr) throw new Error(`companies: ${companyErr.message}`);

    for (const userId of userIds) {
      const { count, error: countErr } = await admin
        .from("company_users")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (countErr) continue;
      if ((count || 0) > 0) continue;

      // Delete profile row if present
      await admin.from("profiles").delete().eq("id", userId);

      // Delete auth user
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (_e) {
        // best effort
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

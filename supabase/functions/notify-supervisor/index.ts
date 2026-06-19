import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPERVISOR_EMAIL = Deno.env.get("SUPERVISOR_EMAIL") || "kevindavide31@gmail.com";

serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record ?? {};
    const companyName = record.name ?? "Nuova ditta";
    const vatNumber = record.vat_number ?? "";
    const status = record.status ?? "active";
    const createdAt = record.created_at ?? "";

    if (!RESEND_API_KEY) {
      return new Response("Missing RESEND_API_KEY", { status: 500 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Gestionale <onboarding@resend.dev>",
        to: [SUPERVISOR_EMAIL],
        subject: "Nuova ditta registrata",
        html: `
          <h2>Nuova ditta registrata</h2>
          <p><strong>Nome:</strong> ${companyName}</p>
          <p><strong>P.IVA:</strong> ${vatNumber || "non inserita"}</p>
          <p><strong>Stato:</strong> ${status}</p>
          <p><strong>Creata:</strong> ${createdAt}</p>
        `,
      }),
    });

    const text = await res.text();
    return new Response(text, { status: res.status });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

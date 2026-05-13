// Helpers HTTP condivisi tra tutte le edge functions.
// Uso: const { corsHeadersFor, jsonResponse, errResponse } = makeHttpHelpers(ALLOWED_ORIGINS);

export function makeHttpHelpers(allowedOrigins: string[]) {
  function corsHeadersFor(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') || '';
    const allow = allowedOrigins.length === 0
      ? '*'
      : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
    return {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };
  }

  function jsonResponse(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req), ...extra }
    });
  }

  function errResponse(req: Request, message: string, status: number) {
    return jsonResponse(req, { ok: false, error: message }, status);
  }

  return { corsHeadersFor, jsonResponse, errResponse };
}

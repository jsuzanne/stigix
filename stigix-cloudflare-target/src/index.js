const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cf = request.cf;
    const headers = request.headers;

    const pathname = url.pathname || "/";
    const searchParams = url.searchParams;

    // Lecture des paramètres "bruts"
    let mode = searchParams.get("mode") || "info";
    let delay = parseInt(searchParams.get("delay") || "0", 10);
    let size = searchParams.get("size") || "10m";
    let code = parseInt(searchParams.get("code") || "500", 10);

    // ---------- Auth simple par clé partagée ----------
    const sharedKey = env.SHARED_KEY;
    const urlKey = searchParams.get("key");
    const headerKey = headers.get("X-Stigix-Key");
    const providedKey = urlKey || headerKey;

    const isRootInfoOnly = pathname === "/" && mode === "info";
    const isProtectedMode = !isRootInfoOnly; // tout sauf "/" info-only

    const authorized =
      !sharedKey || // si pas de clé définie, tout est ouvert
      (providedKey && providedKey === sharedKey);

    if (isProtectedMode && !authorized) {
      return new Response(
        JSON.stringify(
          {
            error: "Unauthorized",
            hint: "Provide valid key as ?key= or X-Stigix-Key",
          },
          null,
          2
        ),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // ---------- Infos de base ----------
    const ip =
      headers.get("CF-Connecting-IP") ||
      headers.get("X-Forwarded-For") ||
      "unknown";

    const info = {
      ip,
      asn: cf && cf.asn,
      asOrganization: cf && cf.asOrganization,
      country: cf && cf.country,
      city: cf && cf.city,
      continent: cf && cf.continent,
      region: cf && cf.region,
      regionCode: cf && cf.regionCode,
      postalCode: cf && cf.postalCode,
      latitude: cf && cf.latitude,
      longitude: cf && cf.longitude,
      timezone: cf && cf.timezone,
      colo: cf && cf.colo,
      httpProtocol: cf && cf.httpProtocol,
      tlsVersion: cf && cf.tlsVersion,
      tlsCipher: cf && cf.tlsCipher,
      clientTcpRtt: cf && cf.clientTcpRtt,
      clientAcceptEncoding: cf && cf.clientAcceptEncoding,
      method: request.method,
      url: request.url,
      userAgent: headers.get("User-Agent"),
      acceptLanguage: headers.get("Accept-Language"),
      cfRay: headers.get("CF-Ray"),
      forwardedProto: headers.get("X-Forwarded-Proto"),
    };

    // ---------- Router de paths vers un mode/delay/size/code ----------
    if (pathname === "/") {
      // Infos IP/GEO only, sans latence ni clé
      mode = "info";
      delay = 0;
    } else if (pathname === "/saas/info") {
      mode = "info";
      // pas de latence ajoutée par défaut
    } else if (pathname === "/saas/slow") {
      mode = "info";
      // si l'utilisateur n'a pas mis delay, on met 5000 ms par défaut
      if (!searchParams.has("delay")) {
        delay = 5000;
      }
    } else if (pathname === "/download/large") {
      mode = "large";
      // si pas de size, on met 10m par défaut
      if (!searchParams.has("size")) {
        size = "10m";
      }
    } else if (pathname === "/security/eicar") {
      mode = "eicar";
    } else if (pathname === "/saas/error/500") {
      mode = "error";
      code = 500;
    } else if (pathname === "/saas/error/503") {
      mode = "error";
      code = 503;
    } else if (pathname === "/advanced") {
      // on garde mode/delay/size/code tels que passés en query
    } else {
      // Path inconnu
      return new Response(
        JSON.stringify(
          {
            error: "Not Found",
            path: pathname,
            hint: "Use /, /saas/info, /saas/slow, /download/large, /security/eicar, /advanced",
          },
          null,
          2
        ),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // ---------- Latence optionnelle ----------
    const clampedDelay = Math.min(Math.max(delay || 0, 0), 30000);
    if (clampedDelay > 0) {
      await new Promise((r) => setTimeout(r, clampedDelay));
    }

    // ---------- Implémentation des modes ----------
    switch (mode) {
      case "eicar":
        return new Response(EICAR + "\n", {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
            "X-Stigix-Scenario": "security-eicar",
          },
        });

      case "large": {
        const sizeParam = size || "10m";
        const sizeBytes =
          typeof sizeParam === "string" && sizeParam.endsWith("m")
            ? parseInt(sizeParam) * 1024 * 1024
            : parseInt(sizeParam);

        const maxBytes = 20 * 1024 * 1024;
        const finalSize = Math.min(sizeBytes || 0, maxBytes);

        const chunk = "A".repeat(1024);
        const repeat = Math.floor(finalSize / chunk.length);
        const remainder = finalSize % chunk.length;

        const body = chunk.repeat(repeat) + chunk.slice(0, remainder);

        return new Response(body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "Content-Length": finalSize.toString(),
            "X-Stigix-Scenario": "download-large",
          },
        });
      }

      case "error": {
        const statusCode = code || 500;
        return new Response(
          JSON.stringify(
            { ...info, error: "Simulated HTTP " + statusCode },
            null,
            2
          ),
          {
            status: statusCode,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Stigix-Scenario": "saas-error",
            },
          }
        );
      }

      case "info":
      default:
        return new Response(JSON.stringify(info, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Stigix-Scenario": "saas-info",
          },
        });
    }
  },
};


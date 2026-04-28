/**
 * Lightweight router — maps (method, pathname) pairs to handler functions.
 * No dependencies. Supports exact paths and simple `:param` patterns.
 *
 * Usage:
 *   const router = createRouter();
 *   router.get("/api/health", (req, res, ctx) => ctx.json(res, 200, { ok: true }));
 *   router.post("/api/db/:collection", handler);
 *   const matched = await router.handle(req, res, ctx);
 */

function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    // Convert :param patterns to regex; exact strings are stored as-is
    if (pattern.includes(":")) {
      const paramNames = [];
      const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });
      routes.push({ method, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
    } else {
      routes.push({ method, exact: pattern, handler });
    }
  }

  async function handle(req, res, ctx) {
    const { pathname } = ctx;
    const method = req.method;
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.exact) {
        if (route.exact === pathname) {
          await route.handler(req, res, ctx);
          return true;
        }
      } else {
        const m = pathname.match(route.regex);
        if (m) {
          ctx.params = {};
          route.paramNames.forEach((name, i) => { ctx.params[name] = decodeURIComponent(m[i + 1]); });
          await route.handler(req, res, ctx);
          return true;
        }
      }
    }
    return false;
  }

  return {
    get:    (p, h) => add("GET", p, h),
    post:   (p, h) => add("POST", p, h),
    put:    (p, h) => add("PUT", p, h),
    delete: (p, h) => add("DELETE", p, h),
    handle,
    get routeCount() { return routes.length; },
  };
}

module.exports = { createRouter };

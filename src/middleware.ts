import { NextResponse, type NextRequest } from "next/server";

// Must match SESSION_COOKIE in src/lib/auth.ts. Inlined (not imported) because the
// edge middleware runtime can't pull in modules that use next/headers.
const SESSION_COOKIE = "portal_session";

// Routes reachable without a session.
function isPublic(path: string): boolean {
  return (
    path === "/" || // pre-login branded landing
    path === "/login" ||
    path === "/register" || // anyone registers before they have an account
    path.startsWith("/s/") || // public verified-supplier showcase
    path === "/rap" || // public RAP Index dashboard (upload/review are gated below)
    path.startsWith("/api/") ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico"
  );
}

// Which paths each persona may use (light guard; everything else is shared/read-only).
const COMPANY_ONLY = ["/report", "/coverage"];
const SUPPLIER_ONLY = ["/confirm", "/record", "/profile"];
// RAP submission + extraction QA are the curator's (Indigenomics) tools — the
// public sees only the /rap dashboard. (Self-serve org upload is a later mode.)
const INDIGENOMICS_ONLY = ["/verify", "/rap/upload", "/rap/review"];

const hits = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p + "/"));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // cookie value is "kind:partyId" (or just "indigenomics") — see src/lib/auth.ts
  const kind = req.cookies.get(SESSION_COOKIE)?.value?.split(":")[0];

  // not signed in → login
  if (!kind) return redirectTo(req, "/login");

  // light persona guard — wrong portal bounces to your dashboard
  if (kind !== "company" && hits(pathname, COMPANY_ONLY)) return redirectTo(req, "/home");
  if (kind !== "supplier" && hits(pathname, SUPPLIER_ONLY)) return redirectTo(req, "/home");
  if (kind !== "indigenomics" && hits(pathname, INDIGENOMICS_ONLY)) return redirectTo(req, "/home");

  return NextResponse.next();
}

function redirectTo(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

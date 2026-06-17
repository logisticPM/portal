import { redirect } from "next/navigation";
import { getSession, personaHome } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The root is just a gate now: signed in → your portal; otherwise → login.
export default function Home() {
  const session = getSession();
  redirect(session ? personaHome(session.kind) : "/login");
}

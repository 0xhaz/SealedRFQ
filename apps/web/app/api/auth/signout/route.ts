import { clearedCookie } from "@/lib/v2/session";
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedCookie());
  return res;
}

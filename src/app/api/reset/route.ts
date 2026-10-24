import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";
import { withUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export const POST = withUser(async () => { resetState(); return NextResponse.json({ ok: true }); });

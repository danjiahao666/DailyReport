import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "@/server/session";

/** 页面级访问保护：未登录跳转到登录页（接口自身另有鉴权，见 server/http.ts） */
export function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};

export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/((?!api|eve|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};

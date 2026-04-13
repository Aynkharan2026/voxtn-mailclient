import { NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Public-ish subset shipped to the browser for whitelabel rendering.
// Full record (including bridge URLs and CRM hints) is only fetched
// server-side via lib/tenant.ts.
type PublicConfig = {
  slug: string;
  name: string;
  primary_color: string;
  logo_url: string | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const tenant = await getTenantConfig(slug);
  if (!tenant) {
    return NextResponse.json(
      { error: `tenant '${slug}' not found` },
      { status: 404 },
    );
  }
  const body: PublicConfig = {
    slug: tenant.slug,
    name: tenant.name,
    primary_color: tenant.primary_color,
    logo_url: tenant.logo_url,
  };
  return NextResponse.json(body);
}

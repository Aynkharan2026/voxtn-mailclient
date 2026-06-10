/**
 * lib/dns-records.ts — Compute the 7 DNS record groups for a hosted mail domain.
 *
 * All mail host constants are non-secret and can live here.
 */

export const MAIL_HOST = "mail.voxtn.com";
export const MAIL_IP = "208.79.219.189";
export const DKIM_SELECTOR = "dkim";

export type ProxyStatus = "grey-cloud" | "n/a";

export interface DnsRecord {
  /** DNS record type (A, MX, TXT, CNAME, SRV, PTR) */
  type: string;
  /** Left-hand side / owner name */
  name: string;
  /** Right-hand side / target / value */
  value: string;
  ttl: number;
  proxy: ProxyStatus;
  /** Optional extra fields (priority for MX, note for PTR, etc.) */
  priority?: number;
  note?: string;
}

export interface DkimInfo {
  dkim_selector?: string;
  dkim_txt?: string;
  /** Raw DKIM public-key TXT value (v=DKIM1;k=rsa;p=…) */
  public_key?: string;
  /** Some MCP responses surface the value under `txt_record` */
  txt_record?: string;
}

/**
 * computeDnsRecords — Return the ordered 7-record set needed to operate a
 * domain on the shared VoxTN mail host.
 *
 * @param domain  The bare domain name, e.g. "carvia.com"
 * @param dkim    The DKIM info returned by voxmail_get_dkim
 */
export function computeDnsRecords(domain: string, dkim: DkimInfo): DnsRecord[] {
  const selector = dkim.dkim_selector ?? DKIM_SELECTOR;
  // Accept whichever field the MCP returns
  const dkimTxt =
    dkim.dkim_txt ??
    dkim.txt_record ??
    dkim.public_key ??
    `v=DKIM1; k=rsa; p=<pending>`;

  return [
    // 1. A record — shared mail host (informational; already published, no per-domain action)
    {
      type: "A",
      name: MAIL_HOST,
      value: MAIL_IP,
      ttl: 300,
      proxy: "n/a",
      note: "Shared mail host — already published, no per-domain action.",
    },

    // 2. MX record — domain → shared mail host
    {
      type: "MX",
      name: domain,
      value: MAIL_HOST,
      ttl: 300,
      proxy: "grey-cloud",
      priority: 10,
      note: "MX records must be DNS-only (grey cloud).",
    },

    // 3. SPF TXT
    {
      type: "TXT",
      name: domain,
      value: "v=spf1 mx -all",
      ttl: 300,
      proxy: "n/a",
    },

    // 4. DKIM TXT
    {
      type: "TXT",
      name: `${selector}._domainkey.${domain}`,
      value: dkimTxt,
      ttl: 300,
      proxy: "n/a",
    },

    // 5. DMARC TXT
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}; ruf=mailto:postmaster@${domain}; fo=1`,
      ttl: 300,
      proxy: "n/a",
    },

    // 6a. CNAME autodiscover → shared mail host
    {
      type: "CNAME",
      name: `autodiscover.${domain}`,
      value: MAIL_HOST,
      ttl: 300,
      proxy: "grey-cloud",
      note: "CNAME must be DNS-only (grey cloud).",
    },

    // 6b. CNAME autoconfig → shared mail host
    {
      type: "CNAME",
      name: `autoconfig.${domain}`,
      value: MAIL_HOST,
      ttl: 300,
      proxy: "grey-cloud",
      note: "CNAME must be DNS-only (grey cloud).",
    },

    // 6c. SRV autodiscover → shared mail host
    {
      type: "SRV",
      name: `_autodiscover._tcp.${domain}`,
      value: `0 1 443 ${MAIL_HOST}`,
      ttl: 300,
      proxy: "n/a",
      note: "SRV records are not proxied.",
    },

    // 7. PTR — shared host, already set at VPS; no per-domain action needed
    {
      type: "PTR",
      name: MAIL_IP,
      value: MAIL_HOST,
      ttl: 300,
      proxy: "n/a",
      note: "Shared host — already set at VPS, no per-domain action.",
    },
  ];
}

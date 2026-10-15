import type { Request } from 'express';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env';
import { safeEqual } from './crypto';

/**
 * Real client IP. When the request comes through our Cloudflare Pages proxy, the proxy sends
 * the visitor IP in `x-client-ip` together with `x-proxy-secret`; only then do we trust it.
 * Otherwise fall back to Express' `req.ip` (trust proxy = 1 hop, i.e. Render's load balancer).
 */
export function getClientIp(req: Request): string {
  const secret = req.header('x-proxy-secret');
  const forwarded = req.header('x-client-ip');
  if (env.PROXY_SECRET && secret && forwarded && safeEqual(secret, env.PROXY_SECRET)) {
    return normalizeIp(forwarded);
  }
  return normalizeIp(req.ip ?? '');
}

export function normalizeIp(ip: string): string {
  try {
    const parsed = ipaddr.parse(ip.trim());
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }
    return parsed.toString();
  } catch {
    return ip.trim();
  }
}

/** True when `ip` matches any entry (single address or CIDR) in `list`. */
export function ipMatches(ip: string, list: string[]): boolean {
  if (!ip || list.length === 0) return false;
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(normalizeIp(ip));
  } catch {
    return false;
  }
  return list.some((entry) => {
    try {
      if (entry.includes('/')) {
        const [range, bits] = ipaddr.parseCIDR(entry);
        return addr.kind() === range.kind() && addr.match([range, bits] as never);
      }
      const single = ipaddr.parse(entry);
      return single.kind() === addr.kind() && single.toString() === addr.toString();
    } catch {
      return false;
    }
  });
}

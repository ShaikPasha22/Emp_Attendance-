import { describe, expect, it } from 'vitest';
import { cacheKey, mapUrl, shortenAddress } from './geocode';

describe('geocode helpers', () => {
  it('builds a Google Maps link to the exact spot', () => {
    expect(mapUrl(12.97551234, 77.60661234)).toBe('https://www.google.com/maps/search/?api=1&query=12.975512,77.606612');
  });

  it('caches by ~11 m cells so nearby punches share one lookup', () => {
    expect(cacheKey(12.97551, 77.60661)).toBe(cacheKey(12.97549, 77.60659));
    expect(cacheKey(12.9755, 77.6066)).not.toBe(cacheKey(12.9765, 77.6066));
  });

  it('shortens long addresses and drops postcode / country noise', () => {
    const full = 'Trinity Circle, MG Road, Shanthala Nagar, Ashok Nagar, Bengaluru, Bangalore North, Karnataka, 560001, India';
    expect(shortenAddress(full)).toBe('Trinity Circle, MG Road, Shanthala Nagar, Ashok Nagar, Bengaluru');
  });
});

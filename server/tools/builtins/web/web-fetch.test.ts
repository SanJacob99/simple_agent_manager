import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebFetchTool } from './web-fetch';
import dns from 'dns';

describe('web_fetch tool', () => {
  let tool: any;

  // dns.promises.lookup is overloaded; with { all: true } it resolves to
  // LookupAddress[], but vi.spyOn picks the single-address overload. Centralize
  // the cast here so the test mocks stay type-clean.
  const mockLookup = (records: dns.LookupAddress[]) =>
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue(records as unknown as dns.LookupAddress);

  beforeEach(() => {
    tool = createWebFetchTool();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: vi.fn().mockResolvedValue('success')
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects restricted hostnames directly', async () => {
    const res = await tool.execute('id', { url: 'http://localhost:8080/data' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects URLs that resolve to restricted IPs via DNS lookup', async () => {
    mockLookup([{ address: '169.254.169.254', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://my-metadata-server.localdomain' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects wildcard domain resolving to localhost', async () => {
    mockLookup([{ address: '127.0.0.1', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://127.0.0.1.nip.io:3000' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('allows safe URLs', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]); // example.com
    const res = await tool.execute('id', { url: 'http://example.com' });
    expect(res.content[0].text).toContain('Status: 200');
    expect(res.content[0].text).toContain('success');
  });

  it('rejects IP ranges (10.0.0.0/8)', async () => {
    mockLookup([{ address: '10.5.1.2', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://internal.company.com' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects IP ranges (192.168.0.0/16)', async () => {
    mockLookup([{ address: '192.168.1.100', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://router.home' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects IP ranges (172.16.0.0/12)', async () => {
    mockLookup([{ address: '172.25.0.5', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://docker-container' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects multiple A record bypass with one safe and one unsafe IP', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://dual-record.com' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects CGNAT range (100.64.0.0/10)', async () => {
    mockLookup([{ address: '100.64.1.2', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://cgnat.example' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('allows 100.63.x (just below CGNAT range)', async () => {
    mockLookup([{ address: '100.63.255.255', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://below-cgnat.example' });
    expect(res.content[0].text).toContain('Status: 200');
  });

  it('rejects 0.0.0.0/8', async () => {
    mockLookup([{ address: '0.1.2.3', family: 4 }]);
    const res = await tool.execute('id', { url: 'http://this-network.example' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects IPv6 unique-local (fc00::/7)', async () => {
    mockLookup([{ address: 'fd12:3456::1', family: 6 }]);
    const res = await tool.execute('id', { url: 'http://ula.example' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects IPv6 link-local (fe80::/10)', async () => {
    mockLookup([{ address: 'fe80::1', family: 6 }]);
    const res = await tool.execute('id', { url: 'http://linklocal.example' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });

  it('rejects IPv4-mapped IPv6 form of a private address', async () => {
    mockLookup([{ address: '::ffff:10.0.0.1', family: 6 }]);
    const res = await tool.execute('id', { url: 'http://mapped.example' });
    expect(res.content[0].text).toContain('Error: Access to internal or restricted hosts is not permitted.');
  });
});

/**
 * comm-autodiscover.js — Multi-strategy IMAP server discovery for COBRA
 * ──────────────────────────────────────────────────────────────────────
 * Strategy chain: well-known → Mozilla Autoconfig → MX heuristic → guess
 */

self.CommAutoDiscover = {

  async discover(email, proxyUrl) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) throw new Error('Indirizzo email non valido');

    const WK = self.CommConfig.WELL_KNOWN_PROVIDERS;
    const MX = self.CommConfig.MX_TO_IMAP;

    // Strategy 1: Well-known
    if (WK[domain]) return { ...WK[domain], method: 'well-known' };

    // Strategy 2: Mozilla Autoconfig
    try {
      const ac = await this._tryAutoconfig(domain);
      if (ac) return { ...ac, method: 'autoconfig' };
    } catch {}

    // Strategy 3: MX heuristic via Google DoH
    try {
      const mx = await this._tryMxLookup(domain, MX);
      if (mx) return { ...mx, method: 'mx-heuristic' };
    } catch {}

    // Strategy 4: Common subdomain guess
    const guess = { host: `imap.${domain}`, smtp: `smtp.${domain}`, smtpPort: 587, port: 993, tls: true, label: domain, method: 'guess' };

    if (proxyUrl) {
      try {
        const ok = await this._verifyServer(proxyUrl, guess.host, guess.port, guess.tls);
        if (ok) return guess;
      } catch {}
      try {
        const fb = { ...guess, host: `mail.${domain}`, smtp: `mail.${domain}` };
        const ok = await this._verifyServer(proxyUrl, fb.host, fb.port, fb.tls);
        if (ok) return { ...fb, method: 'guess-fallback' };
      } catch {}
    }

    return guess;
  },

  async _tryAutoconfig(domain) {
    const urls = [
      `https://autoconfig.${domain}/mail/config-v1.1.xml`,
      `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
      `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const xml = await res.text();
        const parsed = this._parseXml(xml);
        if (parsed) return parsed;
      } catch { continue; }
    }
    return null;
  },

  _parseXml(xml) {
    try {
      // Service worker: no DOMParser, use regex
      const hostMatch = xml.match(/<incomingServer[^>]*type="imap"[^>]*>[\s\S]*?<hostname>([^<]+)<\/hostname>/i);
      const portMatch = xml.match(/<incomingServer[^>]*type="imap"[^>]*>[\s\S]*?<port>(\d+)<\/port>/i);
      const sslMatch = xml.match(/<incomingServer[^>]*type="imap"[^>]*>[\s\S]*?<socketType>([^<]+)<\/socketType>/i);

      if (!hostMatch) return null;
      const host = hostMatch[1].trim();
      const port = parseInt(portMatch?.[1] || '993', 10);
      const ssl = (sslMatch?.[1] || '').trim().toUpperCase();

      // Try to find SMTP too
      const smtpHost = xml.match(/<outgoingServer[^>]*>[\s\S]*?<hostname>([^<]+)<\/hostname>/i);
      const smtpPort = xml.match(/<outgoingServer[^>]*>[\s\S]*?<port>(\d+)<\/port>/i);

      return {
        host,
        port,
        tls: ssl === 'SSL' || ssl === 'TLS' || port === 993,
        smtp: smtpHost?.[1]?.trim() || host.replace('imap', 'smtp'),
        smtpPort: parseInt(smtpPort?.[1] || '587', 10),
        label: host,
      };
    } catch { return null; }
  },

  async _tryMxLookup(domain, mxMap) {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const answers = (data.Answer || []).filter(a => a.type === 15);
    if (!answers.length) return null;

    answers.sort((a, b) => {
      const pa = parseInt(a.data.split(' ')[0]) || 0;
      const pb = parseInt(b.data.split(' ')[0]) || 0;
      return pa - pb;
    });

    const topMx = answers[0]?.data?.split(' ')[1]?.toLowerCase()?.replace(/\.$/, '');
    if (!topMx) return null;

    for (const [pattern, settings] of Object.entries(mxMap)) {
      if (topMx.includes(pattern)) return { ...settings };
    }
    return null;
  },

  async _verifyServer(proxyUrl, host, port, tls) {
    const res = await fetch(`${proxyUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, tls }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.reachable === true;
  }
};

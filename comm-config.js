/**
 * comm-config.js — Communication Hub configuration for COBRA
 * ─────────────────────────────────────────────────────────────
 * Well-known IMAP/SMTP providers, MX heuristics, error codes
 */

self.CommConfig = {
  VERSION: '1.0.0',

  DEFAULTS: {
    storageMode: 'local',
    batchSize: 25,
    syncInterval: 15,
  },

  ERR: {
    NO_CREDENTIALS:    'NO_CREDENTIALS',
    AUTH_FAILED:       'AUTH_FAILED',
    PROXY_UNREACHABLE: 'PROXY_UNREACHABLE',
    SYNC_IN_PROGRESS:  'SYNC_IN_PROGRESS',
    DOWNLOAD_FAILED:   'DOWNLOAD_FAILED',
    SEND_FAILED:       'SEND_FAILED',
    TAB_NOT_FOUND:     'TAB_NOT_FOUND',
    INJECT_FAILED:     'INJECT_FAILED',
  },

  CHANNELS: ['email', 'whatsapp', 'linkedin'],

  WELL_KNOWN_PROVIDERS: {
    'gmail.com':       { host: 'imap.gmail.com',        smtp: 'smtp.gmail.com',        smtpPort: 587, port: 993, tls: true, label: 'Gmail' },
    'googlemail.com':  { host: 'imap.gmail.com',        smtp: 'smtp.gmail.com',        smtpPort: 587, port: 993, tls: true, label: 'Gmail' },
    'outlook.com':     { host: 'outlook.office365.com',  smtp: 'smtp.office365.com',    smtpPort: 587, port: 993, tls: true, label: 'Outlook' },
    'hotmail.com':     { host: 'outlook.office365.com',  smtp: 'smtp.office365.com',    smtpPort: 587, port: 993, tls: true, label: 'Hotmail' },
    'live.com':        { host: 'outlook.office365.com',  smtp: 'smtp.office365.com',    smtpPort: 587, port: 993, tls: true, label: 'Live' },
    'yahoo.com':       { host: 'imap.mail.yahoo.com',   smtp: 'smtp.mail.yahoo.com',   smtpPort: 587, port: 993, tls: true, label: 'Yahoo' },
    'yahoo.it':        { host: 'imap.mail.yahoo.com',   smtp: 'smtp.mail.yahoo.com',   smtpPort: 587, port: 993, tls: true, label: 'Yahoo' },
    'icloud.com':      { host: 'imap.mail.me.com',      smtp: 'smtp.mail.me.com',      smtpPort: 587, port: 993, tls: true, label: 'iCloud' },
    'me.com':          { host: 'imap.mail.me.com',      smtp: 'smtp.mail.me.com',      smtpPort: 587, port: 993, tls: true, label: 'iCloud' },
    'aol.com':         { host: 'imap.aol.com',          smtp: 'smtp.aol.com',          smtpPort: 587, port: 993, tls: true, label: 'AOL' },
    'zoho.com':        { host: 'imap.zoho.com',         smtp: 'smtp.zoho.com',         smtpPort: 587, port: 993, tls: true, label: 'Zoho' },
    'protonmail.com':  { host: '127.0.0.1',             smtp: '127.0.0.1',             smtpPort: 1025, port: 1143, tls: false, label: 'ProtonMail Bridge' },
    'proton.me':       { host: '127.0.0.1',             smtp: '127.0.0.1',             smtpPort: 1025, port: 1143, tls: false, label: 'ProtonMail Bridge' },
    'fastmail.com':    { host: 'imap.fastmail.com',     smtp: 'smtp.fastmail.com',     smtpPort: 587, port: 993, tls: true, label: 'Fastmail' },
    'gmx.com':         { host: 'imap.gmx.com',          smtp: 'mail.gmx.com',          smtpPort: 587, port: 993, tls: true, label: 'GMX' },
    'libero.it':       { host: 'imapmail.libero.it',    smtp: 'smtp.libero.it',        smtpPort: 587, port: 993, tls: true, label: 'Libero' },
    'virgilio.it':     { host: 'in.virgilio.it',        smtp: 'out.virgilio.it',       smtpPort: 587, port: 993, tls: true, label: 'Virgilio' },
    'tin.it':          { host: 'in.virgilio.it',        smtp: 'out.virgilio.it',       smtpPort: 587, port: 993, tls: true, label: 'TIN' },
    'alice.it':        { host: 'in.alice.it',           smtp: 'out.alice.it',          smtpPort: 587, port: 993, tls: true, label: 'Alice' },
    'tim.it':          { host: 'imap.tim.it',           smtp: 'smtp.tim.it',           smtpPort: 587, port: 993, tls: true, label: 'TIM' },
    'tiscali.it':      { host: 'imap.tiscali.it',       smtp: 'smtp.tiscali.it',       smtpPort: 587, port: 993, tls: true, label: 'Tiscali' },
    'aruba.it':        { host: 'imaps.aruba.it',        smtp: 'smtps.aruba.it',        smtpPort: 465, port: 993, tls: true, label: 'Aruba' },
    'pec.it':          { host: 'imaps.pec.aruba.it',    smtp: 'smtps.pec.aruba.it',   smtpPort: 465, port: 993, tls: true, label: 'Aruba PEC' },
    'legalmail.it':    { host: 'mbox.cert.legalmail.it',smtp: 'sendm.cert.legalmail.it',smtpPort: 465, port: 993, tls: true, label: 'Legalmail PEC' },
    'postecert.it':    { host: 'mbox.cert.postecert.it',smtp: 'relay.cert.postecert.it',smtpPort: 465, port: 993, tls: true, label: 'PosteCert PEC' },
    'register.it':     { host: 'imap.register.it',     smtp: 'smtp.register.it',     smtpPort: 587, port: 993, tls: true, label: 'Register.it' },
    'ovh.net':         { host: 'ssl0.ovh.net',          smtp: 'ssl0.ovh.net',          smtpPort: 587, port: 993, tls: true, label: 'OVH' },
  },

  MX_TO_IMAP: {
    'google':    { host: 'imap.gmail.com',        smtp: 'smtp.gmail.com',      smtpPort: 587, port: 993, tls: true, label: 'Google Workspace' },
    'outlook':   { host: 'outlook.office365.com',  smtp: 'smtp.office365.com',  smtpPort: 587, port: 993, tls: true, label: 'Microsoft 365' },
    'office365': { host: 'outlook.office365.com',  smtp: 'smtp.office365.com',  smtpPort: 587, port: 993, tls: true, label: 'Microsoft 365' },
    'yahoo':     { host: 'imap.mail.yahoo.com',   smtp: 'smtp.mail.yahoo.com', smtpPort: 587, port: 993, tls: true, label: 'Yahoo' },
    'zoho':      { host: 'imap.zoho.com',          smtp: 'smtp.zoho.com',       smtpPort: 587, port: 993, tls: true, label: 'Zoho' },
    'aruba':     { host: 'imaps.aruba.it',        smtp: 'smtps.aruba.it',      smtpPort: 465, port: 993, tls: true, label: 'Aruba' },
    'ovh':       { host: 'ssl0.ovh.net',          smtp: 'ssl0.ovh.net',        smtpPort: 587, port: 993, tls: true, label: 'OVH' },
  }
};

# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in COBRA extension, please email us at **security@cobra-extension.local** with:

1. Description of the vulnerability
2. Steps to reproduce (if applicable)
3. Potential impact
4. Your name and contact information (optional)

### Responsible Disclosure Process

1. **Initial Report**: Send vulnerability report to security email
2. **Acknowledgment**: We will acknowledge receipt within 48 hours
3. **Investigation**: Our team will investigate and work on a fix
4. **Timeline**: We aim to release a fix within 30 days of confirmed vulnerability
5. **Disclosure**: Once patched, we will:
   - Release a security update
   - Publish a security advisory
   - Credit the reporter (if desired)

Please do not disclose the vulnerability publicly until we have released a patch.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 5.2.x   | ✓ Yes              |
| 5.1.x   | ✓ Yes              |
| < 5.0   | ✗ No               |

## Security Best Practices

### For Users
- Keep the extension updated to the latest version
- Review permissions requested by the extension
- Do not share API keys or sensitive credentials
- Report suspicious behavior immediately

### For Developers
- Run `npm audit` regularly
- Enable security scanning in CI/CD
- Follow OWASP Top 10 guidelines
- Review dependencies before adding them
- Use strong authentication mechanisms
- Sanitize user inputs
- Avoid using `eval()` and similar functions

## Security Headers

- Content Security Policy (CSP) enforced
- No inline scripts or eval usage
- Secure iframe sandboxing
- CORS restrictions enforced

## Compliance

This project maintains:
- OWASP compliance
- CWE/SANS Top 25 awareness
- Regular security audits
- SBOM generation for supply chain transparency

## Updates

For security announcements and updates, monitor:
- GitHub releases page
- Security advisories
- Extension update notifications

## Questions?

For security-related questions, contact: **security@cobra-extension.local**

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.0] - 2026-04-07

### Added
- Enterprise-grade static analysis configuration
- ESLint with security and code quality plugins
- Prettier code formatting enforcement
- Pre-commit hooks with lint-staged
- Commitlint for conventional commit messages
- GitHub Actions CI/CD pipelines:
  - Linting and format checking
  - Unit test execution with coverage thresholds
  - Security scanning with npm audit and CodeQL
  - SBOM generation for supply chain transparency
  - Bundle size validation
- Comprehensive pull request and issue templates
- Security policy (SECURITY.md) with vulnerability disclosure process
- Dependabot configuration for automated dependency updates
- CODEOWNERS file for access control
- Commit message linting configuration
- Code coverage reporting with codecov integration

### Changed
- Updated ESLint configuration with stricter rules
- Enhanced package.json scripts for quality gates
- Improved Prettier configuration for consistency

### Security
- Added eslint-plugin-security for detecting security vulnerabilities
- Added eslint-plugin-sonarjs for code quality analysis
- Implemented CodeQL analysis in CI/CD pipeline
- npm audit integrated into security checks
- SBOM generation for supply chain risk assessment

## [5.1.0] - 2026-01-15

### Added
- Multi-agent orchestration improvements
- Enhanced web scraping capabilities

### Fixed
- Performance improvements in background worker

## [5.0.0] - 2025-12-01

### Added
- Initial release
- Chrome extension framework
- Basic scraping functionality
- Browser automation features

[5.2.0]: https://github.com/owner/cobra-extension/releases/tag/v5.2.0
[5.1.0]: https://github.com/owner/cobra-extension/releases/tag/v5.1.0
[5.0.0]: https://github.com/owner/cobra-extension/releases/tag/v5.0.0

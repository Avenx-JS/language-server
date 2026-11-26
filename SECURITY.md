# Security Policy

Thank you for helping keep the **Avenx Language Server** secure.

We take security seriously and appreciate responsible disclosure of potential vulnerabilities. If you discover a
security issue, please report it privately so we can investigate and resolve it before public disclosure.

---

## Supported Versions

| Version                 |   Supported    |
| ----------------------- | :------------: |
| Latest stable release   |       ✅       |
| Previous stable release |       ✅       |
| Development (`main`)    | ⚠️ Best effort |
| Older releases          |       ❌       |

Until the first stable release, only `main` receives fixes.

---

## Reporting a Vulnerability

**Please do not create a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities through:

- **GitHub Security Advisories (preferred):** Use GitHub's private vulnerability reporting feature on this repository.

Please include as much information as possible:

- A clear description of the vulnerability
- Steps to reproduce the issue
- A proof of concept (if applicable)
- The affected version(s) and editor
- Any suggested mitigation or fix

---

## What to Expect

After receiving your report, we aim to:

- Acknowledge receipt within **48 hours**
- Begin investigating the issue promptly
- Keep you informed about our progress
- Release a fix as soon as reasonably possible
- Publicly credit you for the discovery (if you would like to be credited)

---

## Responsible Disclosure

We kindly ask that you:

- Give us reasonable time to investigate and fix the issue before public disclosure.
- Avoid accessing, modifying, or deleting data that does not belong to you.
- Conduct testing only in a safe and responsible manner.

---

## Scope

This policy applies to the packages in this repository:

- `avenx-language-server` (the server)
- The Avenx VS Code extension

Vulnerabilities in the Avenx framework itself (compiler, runtime, CLI) are covered by the
[avenx-js security policy](https://github.com/Avenx-JS/avenx-js/blob/main/SECURITY.md).

### Threat model notes

The server runs with the user's permissions and reads the files of the workspace the editor opens. Of particular
interest are issues where opening an untrusted workspace or file leads to:

- code execution (for example by loading project-local modules or configuration),
- reading or writing files outside the workspace,
- the server hanging or crashing on crafted input.

---

## Hall of Thanks

Contributors who responsibly disclose valid vulnerabilities may be acknowledged in our release notes or security
advisories, unless they prefer to remain anonymous.

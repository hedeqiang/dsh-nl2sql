# Security Policy

dsh-nl2sql connects to production databases and can send data to external IM platforms, so we take security reports seriously.

## Supported versions

Security fixes are released for the latest minor version on npm. Please upgrade before reporting.

| Version | Supported |
|---|---|
| latest `0.x` | ✓ |
| older | – |

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through either:

- GitHub: [Report a vulnerability](https://github.com/hedeqiang/dsh-nl2sql/security/advisories/new) (private security advisory), or
- Email: **laravel_code@163.com**

Include the affected version, a description of the impact, and steps or a proof of concept to reproduce it. We aim to acknowledge reports within 3 working days and to ship a fix or mitigation as soon as possible, crediting you in the release notes unless you prefer otherwise.

Examples of issues we want to hear about:

- Bypassing the read-only SQL admission (any statement that modifies data or schema).
- Bypassing table / column access policies, masking, data source scopes or row-level rules.
- An IM user performing actions or reading data outside their permissions (including through bot buttons).
- Leaking secrets (database passwords, bot tokens) into logs, the model context, exports or IM messages.

## Security boundaries

- The SQL lexer is a first line of defence, not the last. **Always connect with a read-only database account**; database permissions are the real boundary.
- Access policies only restrict queries issued through this plugin.
- The local Data Q&A page has owner rights and no login. Do not expose the Harness web port to untrusted networks.
- Content pushed to IM platforms, and the query data the model is allowed to see (**Settings → Data shown to the model**), leave your machine.

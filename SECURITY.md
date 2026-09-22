# Security Policy

Report vulnerabilities privately using GitHub's **Report a vulnerability** feature for this repository. Until that channel is enabled, contact the maintainer privately rather than opening a public issue containing an exploit or private data.

The Vite server is intended for a single user on loopback (`127.0.0.1`). Do not expose port 5183 through a tunnel, reverse proxy, LAN binding, or public interface: the Board state endpoint and annotation preview are local-workstation features, not an authenticated multi-user service. Raw legacy Board state and private generated-page URLs are denied by the development server; Board content is still available to the local app through its loopback-only state endpoint. Figma pairing codes grant one read of an export and expire after five minutes; treat them as sensitive until used.

Supported security updates target the latest release. Include affected version, impact, and reproduction steps; please allow time for a coordinated fix before disclosure.

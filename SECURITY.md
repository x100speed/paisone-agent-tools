# Security

This tool can read real private messages through an authorized TEST account. Give each task only its required scopes, numbers and lifetime. Configure the key through the user's or agent's private secret mechanism. Do not submit keys, SMS bodies, verification codes, browser cookies or OAuth credentials to public GitHub issues, discussions or pull requests.

The CLI sends account credentials only to its fixed HTTPS TEST destination and does not accept an arbitrary API destination. It rejects redirects and validates the returned environment. Installation does not authorize account access or transactions. Revoke an affected key from the TEST account page if it is exposed.

For a suspected vulnerability, use GitHub private vulnerability reporting if the maintainer has enabled it. If that channel is unavailable, first ask the maintainer for a private reporting channel without attaching secrets or private messages. No dedicated security email or response deadline is announced.

Report the tool version, affected command, a minimal synthetic reproduction and expected versus actual behavior. Redact keys, full telephone numbers, personal email addresses, message bodies and signed cursors. Do not test another person's resources or weaken account controls to reproduce a report.

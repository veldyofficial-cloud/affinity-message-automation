# Shared-link mode (no email/PIN prompt)

This is an optional deployment mode. The current Cloudflare Access / instructor-login mode remains the default until you set the variables below.

## Cloudflare setup

First, deploy this code to the infohub-approval-cloudflare Worker. Then open Workers & Pages > infohub-approval-cloudflare > Settings > Runtime variables and secrets > Production.

1. Add ACCESS_MODE as Text, value shared_link.
2. Add SHARED_LINK_KEY as **Secret**, value a cryptographically random **64-character lower-case hexadecimal** string (32 random bytes).
3. Keep MONDAY_API_TOKEN as an encrypted server Secret and retain the REGISTRY Durable Object binding. Never share the Monday API token with instructors.

Only AFTER the variables have been deployed, open the Worker's **Access** tab and disable "Protect with Cloudflare Access" specifically for this Worker. Check any account-wide Access rule and bypass only this Worker if necessary; do not change other Workers.

## Link to send to instructors

https://infohub-approval-cloudflare.veldy-official.workers.dev/#key=YOUR_64_CHARACTER_SHARED_LINK_KEY

The complete URL must be shared, including the #key= fragment. The browser uses the fragment as an X-Affinity-Link-Key header on student search and approval requests. There is no email account creation or PIN prompt.

Without the key, the page itself loads but Monday lookup/approval returns HTTP 401. Without a configured strong server key or registry binding, these APIs fail closed with HTTP 503.

## Security trade-offs

- Anyone possessing the FULL link can read matched student names and create Monday Infohub records under the VELDY server token's permissions. Sharing only with internal staff is NOT a technical access control.
- Individual account revocation and /admin are unavailable in this mode because visitors have no verified identity. Rotate the SHARED_LINK_KEY secret to revoke all previously shared links.
- Basic per-IP limits are included: 120 lookups/hour and 30 approval attempts/day. This does not replace staff authentication.
- Only the bearer key is placed in the link fragment. The Monday API token must never be placed in a URL or GitHub.
- Avoid public chats, QR codes, public documents, screenshots, and browser extensions that might expose the key.

CRITICAL: The backend still targets the LIVE Infohub (board 1888467610) and Student DB (1879266175). Do not use the approve button as a test. Verify the entire workflow against an isolated test board first.

To restore individual identity verification, set ACCESS_MODE to access (or remove it), re-enable Cloudflare Access on this Worker, and resume the existing signed-JWT login flow.

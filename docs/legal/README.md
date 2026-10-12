# Legal documents (drafts for a lawyer)

| File | What |
|---|---|
| `privacy-policy.md` / `.ur.md` | what data we collect, why, who sees it, how long, how to delete |
| `terms-of-service.md` / `.ur.md` | one terms file (the old `terms.md` is gone) |
| `delete-account.md` | the public "how to delete your account and data" page (Google Play requires a web page) |

They were rewritten in doc 27 F8.3 to match what the product **does today**. The old versions promised OCR checks, escrow, card gateways and marketing messages, none of which exist.

The website (`apps/web`) turns these into pages at **/privacy**, **/terms** and **/delete-account** when it is built; the app links to them from Language & appearance.

## For counsel to decide (everything in [square brackets])

1. Company legal name, address, effective date; which text prevails if English and Urdu differ.
2. **Retention periods:** money and dispute records ([number] years); whether chats and job photos may be kept that long (D-F4); location points (30 days is the code default); backups.
3. Rights under Pakistan's data-protection law once it applies, and the regulator contact.
4. The fee wording (12 % / Rs 100 / Rs 1,500 are today's defaults in the code; they are editable by a Super Admin, so the terms should point to the app for current figures).
5. The dispute clause: Fixli decides how a cash payment is recorded and any fee correction, **not** compensation for damage (nothing is held in escrow).
6. Liability cap, governing law, venue.
7. Names of the text-message provider (D-F5) and analytics provider (D-F7) once chosen; both are described as "only if switched on" today.
8. The Urdu text is a machine draft: a native speaker and counsel must review it (O13).

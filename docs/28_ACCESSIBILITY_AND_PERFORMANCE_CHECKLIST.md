# 28. Accessibility and performance: what is automated and what needs a phone

This is the F7.5 work from doc 27. Everything a computer can check is a test that fails the build. The rest
needs a real phone and a person, so it is a checklist here. **Fill in the result column when you do each one.**

## Already checked by the build (cannot slip back)

| Rule | Where |
|---|---|
| Every sentence a person reads goes through `t()` (no English written into a screen) | `src/__tests__/i18n.test.ts` |
| Arabic and Urdu have exactly the English sentences and `{placeholders}` | same |
| Every button has a role, and a label unless it has text inside | `src/__tests__/a11y.test.ts` |
| Text is never locked to one size (`allowFontScaling={false}` is banned) | same |
| Text on every background is at least 4.5 : 1 (light and dark); white text on buttons and badges too | same |
| Screens never write text in a fill colour (`primary`, `error`…): use the `…Text` colour | same |
| Back arrows and chevrons flip in Urdu and Arabic (`DirIcon`); text is never pinned left or right | same |
| Anything that animates respects "Reduce motion" | same |
| Buttons are at least 48 pt tall, 56 pt for the large ones | same |
| No fake "AI verified" or made-up data in screens | same |
| The app bundle stays under 9 MB (7.3 MB when this was written) | CI, `scripts/bundle-size.js` |

## Needs a phone (not done yet)

| # | Check | How | Result |
|---|---|---|---|
| 1 | **VoiceOver (iPhone), customer flow**: sign up, ask for help (with a photo), choose a price, follow the job, confirm, review | Settings > Accessibility > VoiceOver. Every control is announced with a sensible name; nothing is skipped or announced twice; the order matches the screen. | |
| 2 | **TalkBack (Android), worker flow**: sign up, set up profile and ID, go online, accept, on my way, arrived, start with photo, finish, mark cash | Settings > Accessibility > TalkBack. Same questions. | |
| 3 | **Largest text, 200 %**: every screen | iPhone: Settings > Accessibility > Display & Text Size > Larger Text (max). Android: Font size and Display size at the largest. Nothing clipped, overlapping, or hidden behind a button. | |
| 4 | **Urdu and Arabic, every screen**: take a screenshot of each and read it | Switch the language in Language & appearance. Layout mirrored, no English left over, no text cut off, numbers and phone numbers still read left to right. | |
| 5 | **Reduce motion** | Turn it on; the notification banner appears without sliding, the focus ring does not animate. | |
| 6 | **Cold start under 2.5 s on a low-end Android** | A production build on a phone with 2–3 GB RAM. Force-stop the app, tap the icon, time it to the first usable screen (screen record, count frames). Do it 5 times, write down the median. | |
| 7 | **No signal, end to end** | Airplane mode: ask for help (a normal request is saved and the bar says so), turn the connection back on (it goes out once and the bar says "sent"). Worker: tap "I'm on my way" offline, reconnect, check the customer sees it. Kill the app while offline, reopen online: still sent. An emergency request offline shows the emergency numbers. | |
| 8 | **Usability round with real users in Pakistan** | Owner organises; at least 5 customers and 5 workers, Urdu first. | |

## Known limits

- Arabic and Urdu have more plural forms than the app handles (it uses "one" and "other"). The reviewers (O13) should flag any sentence with a count that reads wrong.
- The long lists (Bookings, Jobs) are not virtualised. The server caps each page at 50, so this is fine today; use `FlatList` if pages grow.
- The admin portal is English only (staff).

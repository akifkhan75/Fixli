# Store data-safety and privacy answers (doc 27 F8.3)

Filled in from what the code actually does, so the forms match the app and the Privacy Policy (`docs/legal/privacy-policy.md`). **Whoever submits the forms re-checks this table against the current code first**: a wrong answer here is a store policy violation. Anything marked ❓ needs an owner decision.

**Common answers**
- Data is **encrypted in transit** (HTTPS and secure web sockets only).
- Users **can request deletion**: in the app (Account > Security > Delete account) and on the web (`https://fixli.pk/delete-account`).
- **No data is sold. No advertising. No third-party tracking SDKs for ads.**
- The app is for people **18+**.
- Account is required. Sign-in is by mobile number and password.

## Google Play: Data safety form

| Data type (Play category) | Collected | Shared with a third party | Required or optional | Why |
|---|---|---|---|---|
| **Personal info: Name** | yes | no (shown to the other person on a job) | required | account, show who is coming |
| **Personal info: Phone number** | yes | no (revealed to the other person only once a job is booked) | required | sign-in, contact on a booked job |
| **Personal info: Email** | no for customers and professionals (staff only) | no | | |
| **Personal info: Other** (national ID number, professionals only; names and numbers of emergency contacts the user types in) | yes | no | optional for customers (contacts); required for professionals (ID number) | identity check; emergency contacts |
| **Location: Precise** | yes | no | optional (customer: only when tapping "use my current location"; professional: area setup, and while on the way to a booked job) | fill the address, find nearby jobs, live arrival tracking |
| **Photos and videos: Photos** | yes (problem photos, job before/after, chat photos, profile and portfolio photos; ID card photos and selfie for professionals) | no | optional for customers; ID photos required for professionals | describe the problem, evidence, identity check |
| **Audio: Voice or sound recordings** | yes (voice notes on a request) | yes: sent to Google (Gemini) to turn speech into text ❓ confirm the provider before launch | optional | describe the problem by voice |
| **Messages: Other in-app messages** | yes (chat between customer and professional) | no | optional | talk about a booked job |
| **Financial info: Other** | yes: cash-job amounts, the fee a professional owes, payments they report (**no card or bank details are collected**) | no | required for professionals | fee ledger |
| **App activity: App interactions** | **only if the user turns on "Help improve Fixli"** (off by default): screen names and button-level events, no content | yes, to the analytics provider ❓ once chosen (D-F7) | optional | improve the app |
| **App info and performance: Crash logs, diagnostics** | yes (personal data removed before sending) | yes: Sentry | required | fix crashes |
| **Device or other IDs** | yes: push-notification token; a random anonymous id (only if analytics is on) | yes: push delivery by Apple/Google/Expo | required (push) / optional (analytics) | notifications |
| **Contacts** (address book) | **no**: the app never reads the phone's contacts | | | |
| **Health and fitness, Calendar, Files and docs** | no | | | |

## Apple: App Privacy labels

| Apple category | Types | Linked to the user's identity | Used for tracking |
|---|---|---|---|
| Contact Info | Name, Phone Number | yes | no |
| Identifiers | User ID, Device ID (push token) | yes | no |
| Location | Precise Location | yes | no |
| User Content | Photos, Audio Data, Customer Support/Other User Content (chat, job descriptions) | yes | no |
| Sensitive Info | (professionals' national ID number) | yes | no |
| Financial Info | Other Financial Info (cash amounts, fees owed; no cards) | yes | no |
| Usage Data | Product Interaction: **only if opted in** | no (random id, no profile) | no |
| Diagnostics | Crash Data, Performance Data | no (scrubbed) | no |

"Tracking" = linking with other companies' data for ads: **none**, so no App Tracking Transparency prompt is needed.

## Permissions the app asks for, and why (also in `app.json`)

| Permission | When it is asked | Reason shown to the user |
|---|---|---|
| Camera | tapping "Take a photo" | photo of the problem, ID, or finished work |
| Photos | choosing a picture | picture of the problem or work |
| Microphone | holding the voice button | describe the problem by voice |
| Location (while using the app only) | tapping "use my current location", and a professional setting their area; while on the way to a job | fill the address and find jobs near you; show arrival |
| Notifications | after sending a first request / going online | tell you about prices and job changes |

**Not requested:** background location (blocked in the Android build), contacts, storage access, "draw over other apps".

## Listing details to prepare (not in the repo)

- Privacy policy URL: `https://fixli.pk/privacy.html` · Terms: `https://fixli.pk/terms.html` · Account deletion URL (Play): `https://fixli.pk/delete-account.html` · Support email: support@fixli.pk
- Screenshots in English and Urdu (phone sizes for both stores); short and long description in both languages (written by a native speaker, O13).
- Content rating questionnaire: no violence, no user-posted public content (chat is private between two people), contains location sharing and in-app messaging.
- Category: House & Home (Play), Lifestyle (Apple).

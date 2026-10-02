# Instructions for the parallel sessions building the native-web-app skill

We are building a reusable Claude Code skill, `.claude/skills/native-web-app/`, about making ANY web app or PWA feel
native on phones, tablets and desktops. Its readers are AI coding agents building new apps in any framework. React and
Vite are common, but keep the skill framework-agnostic: framework notes go in a short "With Vite/React" aside, and only
where it matters. Today is 2026-10-02. Research for each domain is in `_research/<key>.json`: items with
title/what/why/how/support/gotchas/priority/sources. Titles of every domain are in `_research/INDEX.md`.

Use WebSearch and WebFetch (load them with ToolSearch `select:WebSearch,WebFetch`) to verify facts against primary
sources: MDN and browser-compat-data, caniuse, webkit.org/blog release notes, developer.chrome.com and chromestatus,
Firefox release notes, and W3C/WHATWG specs.

## File map (domain key → owner file)

- install → `references/install-and-identity.md` (Install, manifest and app identity)
- sw → `references/offline-push-storage.md` (Service worker, offline, push, storage and lifecycle)
- viewport → `references/viewport-keyboard-safe-areas.md` (Viewport, keyboard, safe areas and scrolling)
- gestures → `references/touch-gestures-input.md` (Touch, gestures, haptics and text input)
- motion → `references/motion-performance.md` (Motion, transitions and perceived performance)
- os → `references/device-apis.md` (Device and OS integration APIs)
- nav → `references/navigation-ui-patterns.md` (Navigation model and native UI patterns)
- platform → `references/platform-quirks-testing.md` (Platform quirks (iOS, Android, desktop, Firefox) and testing)

## Ownership of overlapping items

When an item overlaps several files, write it in full ONLY in its owner file. The other files keep a one-line pointer,
for example "see device-apis.md#web-share".

- 16px input font (iOS focus zoom), interactive-widget, visualViewport and the keyboard, safe areas, overscroll →
  viewport
- touch-action, tap highlight, `:active`/`:hover` media queries, hit targets, haptics,
  inputmode/enterkeyhint/autocomplete, unlocking audio on a gesture → gestures
- the back button, history entries for overlays, CloseWatcher, the Navigation API → nav
- dialog, popover, select, system font, color-scheme, dark mode, accessibility parity, document.title and favicon
  badges → nav
- animating dialogs and popovers, View Transitions, reduced motion, rendering performance, Speculation Rules,
  skeletons, optimistic UI → motion
- Web Push, notifications, Background Sync and Background Fetch, storage persistence and eviction → sw
- Page Lifecycle, bfcache, reconnecting after suspension, state restoration → sw
- manifest members (including share_target, file_handlers, protocol_handlers, launch_handler, shortcuts, and declaring
  window-controls-overlay) → install
- install prompts, standalone detection, iOS meta tags and splash screens, badging, store packaging → install
- runtime capability APIs → os: share, wake lock, media session, clipboard, passkeys, OTP, file system, contacts,
  sensors, PiP, fullscreen, orientation, speech, payments, handling launchQueue, and so on
- per-platform summaries and quirk lists, and all testing and verification → platform. Each summary links to the owner
  file for the fix.

## Format of a reference file

1. Start with a 2-3 line intro.
2. Then add a `## Checklist` section. Every item is one line:
   `- [ ] **must|should|nice** — <imperative action> → [section](#anchor)`. List the must items first.
3. Then write one `## <Item title>` section per distinct technique. Each section contains:
   - 1-3 sentences on what it is and why it matters (the native feeling it gives, or the web tell it removes)
   - the minimal correct snippet in a fenced block with a language tag, keeping the feature detection
   - a `**Support:**` line covering Chromium desktop, Chrome Android, Safari macOS, Safari iOS (tab vs home-screen app)
     and Firefox, as of Oct 2026
   - a `**Gotchas:**` list
   - a `**Sources:**` line with 1-3 primary URLs
4. Keep EVERY distinct technique from the research. Merge true duplicates and never silently drop one: cut prose, not
   techniques. Aim for 25-45 KB; going over is fine when it's technique, not prose.
5. Keep it generic: no Yurt-specific file paths, names or product details. Field-tested lessons stay, rewritten as
   generic advice (a "Field-tested:" prefix is fine). Drop notes that only audit Yurt.
6. Snippets must be valid strict TypeScript (no `any`, no non-null `!`), HTML, CSS or JSON.
7. Checklist anchors must match the section headings (GitHub-style anchors).

## Write task

Read `_research/<key>.json` and write the owner file following the format above.

## Verify task (adversarial fact-check)

AI agents will trust this file blindly. Assume every version number, support claim, API name or signature, default
behaviour and "iOS does X" statement is wrong until a primary source confirms it.

Check first the claims most likely to be stale or invented:

- Safari/iOS versions and home-screen-only behaviour
- Firefox support
- APIs recently shipped or removed, and manifest members
- anything mentioning "iOS 26", "Firefox 143" or "Chrome 149"
- the iOS switch-checkbox haptic trick, interactive-widget, VirtualKeyboard, Declarative Web Push
- cross-document View Transitions, CloseWatcher, the Navigation API, Background Fetch and Sync, Document PiP,
  customizable select

Check every snippet too: correct API usage, feature detection present, valid strict TypeScript, no event-listener
leaks, and it works in the browsers it claims to.

Fix errors in place, keeping the format. If a claim can't be confirmed either way, soften it and mark it
"(unverified)". Don't shorten the file otherwise, unless the task says to trim. Add a
`<!-- verified 2026-10-02: N corrections -->` comment at the top of the file.

## Git rules (several sessions push to the same branch at once)

- The branch is `claude/funny-mayer-j67xf2`. Check it out and work on it.
- Change ONLY the files your task names. Never touch other files, and never delete `_research/`.
- Commit with a Conventional Commit message that contains your task tag, for example
  `docs(skill): gestures reference [nwa:gestures]`.
- Push with this loop: `git pull --rebase origin claude/funny-mayer-j67xf2 && git push origin HEAD:claude/funny-mayer-j67xf2`.
  If the push is rejected because someone else pushed first, run the loop again (up to 10 times). Never force-push.
- Don't open a pull request.

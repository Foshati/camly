# Maintaining Camly's discoverability

This is the maintainer guide for repository discovery and useful project presentation. Repository metadata and readable documentation help users understand Camly; they do not guarantee a search ranking or stars.

## Repository metadata

**About:** Free, open-source screen recorder, screenshot tool and webcam recorder for macOS, Windows and Linux X11. Compact recordings, local files, built with Tauri.

**Website:** [Latest release and downloads](https://github.com/Foshati/camly/releases/latest). This is the working download destination until the project has a separate public website.

**Topics (20):** `screen-recorder`, `screen-recording`, `screen-capture`, `screenshot`, `screenshot-tool`, `webcam`, `webcam-recorder`, `video-recorder`, `video-compression`, `desktop-app`, `productivity`, `macos`, `windows`, `linux`, `tauri`, `react`, `rust`, `typescript`, `swift`, `open-source`.

GitHub topics classify repositories and make them discoverable through topic browsing and search. Keep them relevant; [GitHub limits repositories to 20 topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).

## Presentation assets

- [README banner source](assets/camly-banner.svg).
- [Social preview PNG](assets/social-preview.png): 1280 × 640, solid background, under 1 MB.
- Upload the PNG through **Repository Settings → General → Social preview → Edit → Upload an image**. Committing it does not automatically change GitHub's social preview. See [GitHub's social preview instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

The banner is an illustration, not a screenshot. Real screenshots and a short demo should come from the running app with personal information removed.

## Release checklist

1. Inspect successful build jobs and actual assets before publishing download or platform claims.
2. Update the README's version-specific download URLs for the new assets. Keep the latest-release link visible.
3. Write release notes with available installers, requirements, fixes, and known limitations. Do not describe every existing feature as new.
4. Keep README, Persian guide, package metadata, and installer descriptions consistent.
5. Check documentation links, the frontend build, and platform behavior relevant to the changes.

## Highest-value next steps

| Priority | Action | Expected benefit | Evidence to collect |
|---|---|---|---|
| 1 | Record a real 20–30 second demo: shortcut → region capture → preview/library | Visitors can see the capture workflow before installing | Actual app footage and the tested OS/version |
| 2 | Add 2–3 real screenshots of toolbar, library, and webcam tools | Clarifies the product and makes sharing more useful | Sanitized screenshots from the running release |
| 3 | Verify installer signing/notarization and test clean installations | Reduces installation friction and builds trust | Platform-specific install results; accurate signing status |
| 4 | Publish a small product website with a stable URL | Provides control over titles, descriptions, canonical URLs, and indexing | Verified live URL, crawlable HTML, real downloads, Search Console verification |
| 5 | Publish practical guides such as “record a bug report” and “make smaller screen recordings” | Matches real user search intent and demonstrates value | Steps tested in Camly with screenshots/output |
| 6 | Share real use cases with relevant open-source and developer communities | Reaches users who need the workflow | Relevant posts respecting community rules and measurable feedback |

Community outreach is a separate maintainer action; this change does not post on your behalf. Do not buy stars, invent reviews or benchmarks, or promise feature parity with other tools.

## Search expectations

Use “open-source screen recorder,” “screenshot tool,” and “webcam recorder” naturally in useful text. Package keywords describe the software; adding them is not evidence of improved Google rankings. GitHub controls the repository page's HTML metadata, robots rules, and canonical URL. A repository README cannot replace those with arbitrary meta tags or JSON-LD.

Google does not use the meta-keywords tag, and excessive keyword repetition harms usability. Its [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) emphasizes useful content, clear descriptions, and understandable links. A future website should use those principles and measure actual indexing and search traffic over time.

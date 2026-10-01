---
title: "ListenBrainz lab"
description: "Every variant of the now-playing shortcode side by side. Draft-only: never built for production."
date: 2026-10-01
draft: true

showDate: false
showHero: false
showBreadcrumbs: false
showTableOfContents: false
showReadingTime: false
showWordCount: false
showPagination: false
showTaxonomies: false
showAuthor: false
showEdit: false
showComments: false
sharingLinks: false
---

Every `variant` of `{{</* listenbrainz */>}}` for the same user. `serve` builds
drafts, `hugo --minify` does not, so this page never ships. Each instance opens
its own feed socket, so this page holds five - fine for a lab, not for a real
page.

## card (default)

{{< listenbrainz user="arunoruto" >}}

## pill

{{< listenbrainz user="arunoruto" variant="pill" >}}

## inline

Somewhere in a sentence: right now that would be {{< listenbrainz user="arunoruto" variant="inline" >}} and the paragraph just flows on around it.

## backdrop

{{< listenbrainz user="arunoruto" variant="backdrop" >}}

## vinyl

{{< listenbrainz user="arunoruto" variant="vinyl" >}}

## card, centred

{{< listenbrainz user="arunoruto" center="true" >}}

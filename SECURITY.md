# Security Policy

## Reporting a problem

Please report security problems privately. Don't open a public issue.

Use GitHub's private reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, the steps to reproduce it, and the browser and device you used. You should get a reply within 14 days. This is a personal project maintained by one person, so there is no bounty.

## Supported version

Only the current `main` branch, which is what the live site serves, receives fixes.

## Scope

Kitten Play is a static web page. Knowing what it does and doesn't do helps you judge a report.

- **Accounts:** there are none. There's no login, server or database.
- **Data collected:** none. There's no analytics, tracking, cookies or advertising.
- **What it stores:** three game settings (speed, count and sound) in the browser's local storage, on that device only.
- **Outside code:** none. There are no third-party scripts, fonts or packages, and nothing to install or build.
- **Network use:** the page loads only its own files from the same site. The service worker caches those files for offline play.
- **Browser restrictions:** a Content Security Policy in `index.html` blocks scripts, styles and images from anywhere except the site itself.

## In scope

- A way to run script on the page, or to load content from another site despite the Content Security Policy.
- A way for the service worker to serve or cache content from another origin.
- A way for the page to send data off the device.

## Out of scope

- Forks or copies of this code hosted by other people.
- Problems that require a device that's already compromised.
- Missing HTTP headers that GitHub Pages doesn't let the site set.

// ponytail: same-origin guard for ?redirect= values before goto()/callbackURL.
// Allows only local absolute paths ("/x"), rejecting "//evil.com", schemes
// ("https://"), and anything not starting with a single slash. Prevents the
// open-redirect/phishing vector on the auth pages.
export function safeRedirect(value: string | null | undefined, fallback = "/dashboard"): string {
	if (typeof value !== "string") return fallback;
	// must start with "/" but not "//" or "/\" — those are protocol-relative
	// (or browser-normalized) off-site redirects.
	return /^\/(?![/\\])/.test(value) ? value : fallback;
}

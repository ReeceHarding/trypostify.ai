import posthog from "posthog-js";

// Initialize PostHog only when a public key is present to avoid 401s and placeholder requests.
const phKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (phKey && typeof window !== "undefined") {
  posthog.init(phKey, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.posthog.com",
    defaults: '2025-05-24',
    capture_exceptions: true,
  });
}

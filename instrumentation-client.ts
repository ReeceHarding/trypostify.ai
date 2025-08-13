import posthog from "posthog-js";

// Initialize PostHog only when a public key is present to avoid 401s and placeholder requests.
const phKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (phKey && typeof window !== "undefined") {
  console.log('[POSTHOG_CLIENT] Initializing PostHog with host:', process.env.NEXT_PUBLIC_POSTHOG_HOST)
  posthog.init(phKey, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
    person_profiles: 'identified_only', // Reduce header size
    capture_pageview: false, // Reduce automatic events
    capture_pageleave: false,
    disable_session_recording: true, // Reduce network traffic
    advanced_disable_decide: true, // Completely disable decide endpoint to prevent 431 errors
    autocapture: false, // Disable automatic event capture to reduce headers
    capture_exceptions: false, // We'll handle this manually to avoid bloat
    disable_external_dependency_loading: true, // Prevent loading external scripts that cause 431
    disable_compression: true, // Reduce header processing
    sanitize_properties: false, // Reduce processing overhead
    persistence: 'localStorage', // Use localStorage instead of cookies to reduce headers
  });
  console.log('[POSTHOG_CLIENT] PostHog initialized successfully')
}

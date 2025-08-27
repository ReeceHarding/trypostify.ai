import { createClient } from "jstack"
import type { AppRouter } from "@/server"
import { getBaseUrl } from "@/constants/base-url"

/**
 * Your type-safe API client
 * @see https://jstack.app/docs/backend/api-client
 */
export const client = createClient<AppRouter>({
  baseUrl: `${getBaseUrl()}/api`,
})

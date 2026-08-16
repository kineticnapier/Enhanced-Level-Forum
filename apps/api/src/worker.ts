import app from './entry'
import type { Env } from './env'
import { runScheduledTufStep } from './importers/tuf-scheduled'

type ScheduledControllerLike = {
  cron: string
  scheduledTime: number
  noRetry?: () => void
}

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledControllerLike, env: Env) {
    const scheduledAt = new Date(controller.scheduledTime).toISOString()
    console.log(`[TUF cron] starting incremental crawl step (${controller.cron}) at ${scheduledAt}`)

    const result = await runScheduledTufStep(env, {
      cron: controller.cron,
      scheduledAt,
    })

    if (result.status === 'DEFERRED' || result.status === 'RESET' || result.status === 'BUSY') {
      // Expected upstream instability should wait for the next 30-minute tick
      // instead of asking the platform to immediately retry the same weak API.
      controller.noRetry?.()
    }

    console.log('[TUF cron] step completed', result)
  },
}

import app from './entry'
import type { Env } from './env'
import { runTufImport } from './importers/tuf-run'

type ScheduledControllerLike = {
  cron: string
  scheduledTime: number
}

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledControllerLike, env: Env) {
    const scheduledAt = new Date(controller.scheduledTime).toISOString()
    console.log(`[TUF cron] starting scheduled import (${controller.cron}) at ${scheduledAt}`)

    const result = await runTufImport(env, {
      actorId: null,
      executionSource: 'SCHEDULED',
      auditMetadata: {
        cron: controller.cron,
        scheduledAt,
      },
    })

    console.log('[TUF cron] import completed', {
      snapshotId: result.snapshot.id,
      sourceVersion: result.snapshot.sourceVersion,
      summary: result.summary,
    })
  },
}

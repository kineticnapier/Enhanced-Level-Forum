import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { loadProductionConfig, persistHyperdriveId, redactDatabaseUrl, writeProductionWranglerConfigs } from './production-config.mjs'
import { ROOT_DIR } from './local-env.mjs'

function executable(command) {
  return process.platform === 'win32' && ['npm', 'npx'].includes(command) ? `${command}.cmd` : command
}

function run(command, args, options = {}) {
  const shownArgs = options.displayArgs ?? args
  console.log(`\n> ${command} ${shownArgs.join(' ')}`)
  const result = spawnSync(executable(command), args, {
    cwd: options.cwd ?? ROOT_DIR,
    env: options.env ?? process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

let config = await loadProductionConfig({ requireSecrets: true })
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required for first production setup (migration + Hyperdrive origin).')
  process.exit(1)
}

console.log('ELF Cloudflare production setup')
console.log(`Public: ${config.publicOrigin}`)
console.log(`Admin:  ${config.adminOrigin}`)
console.log(`API:    ${config.apiOrigin}`)
console.log(`DB:     ${redactDatabaseUrl(config.databaseUrl)}`)

run('npx', ['wrangler', 'whoami'])

if (!config.hyperdriveId) {
  console.log(`\nCreating Hyperdrive ${config.hyperdriveName}...`)
  const args = ['wrangler', 'hyperdrive', 'create', config.hyperdriveName, '--connection-string', config.databaseUrl]
  const output = run('npx', args, {
    capture: true,
    displayArgs: ['wrangler', 'hyperdrive', 'create', config.hyperdriveName, '--connection-string', redactDatabaseUrl(config.databaseUrl)],
  })
  const ids = output.match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27,}/ig) ?? []
  const id = ids.at(-1)
  if (!id) {
    console.error('Hyperdrive was created but its ID could not be parsed. Copy the ID from the output into ELF_HYPERDRIVE_ID in .env.production, then rerun this command.')
    process.exit(1)
  }
  await persistHyperdriveId(id)
  console.log(`Saved ELF_HYPERDRIVE_ID=${id} to .env.production`)
  config = await loadProductionConfig({ requireHyperdrive: true, requireSecrets: true })
} else {
  console.log(`Using existing Hyperdrive: ${config.hyperdriveId}`)
}

console.log('\nApplying production database migrations...')
run(process.execPath, [resolve(ROOT_DIR, 'scripts/apply-migrations.mjs')], {
  env: { ...process.env, DATABASE_URL: config.databaseUrl },
})

if (config.adminEmail && config.adminPassword) {
  console.log('\nEnsuring the initial production ADMIN exists...')
  run(process.execPath, [resolve(ROOT_DIR, 'scripts/create-admin.mjs'), '--email', config.adminEmail, '--name', config.adminName], {
    env: { ...process.env, DATABASE_URL: config.databaseUrl, ELF_ADMIN_PASSWORD: config.adminPassword },
  })
} else {
  console.log('\nInitial ADMIN skipped because ELF_ADMIN_EMAIL / ELF_ADMIN_PASSWORD is not fully configured.')
  console.log('You can create it later with npm run auth:create-admin using the production DATABASE_URL.')
}

await writeProductionWranglerConfigs(config)
console.log('\nGenerated production Wrangler configs for API/public/admin.')
console.log('Setup complete. Review .env.production, then run: npm run production:deploy')

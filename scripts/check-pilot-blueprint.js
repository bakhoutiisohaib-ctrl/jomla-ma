#!/usr/bin/env node
// Offline template consistency checks only. Never loads dotenv, starts a
// service, reads the original database, or applies any operating-system rule.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'ops/pilot')
const checks = []
const documents = new Map()
function read(name) {
  const content = fs.readFileSync(path.join(directory, name), 'utf8')
  documents.set(name, content)
  return content
}
function check(name, passed) {
  checks.push({ check: name, passed: Boolean(passed) })
}
try {
  const proxy = read('Caddyfile.example')
  const envFile = read('runtime.env.example')
  const env = Object.fromEntries(envFile.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  const api = read('jomla-pilot-api.service.example')
  const worker = read('jomla-pilot-worker.service.example')
  const mongo = read('mongod.conf.example')
  const firewall = read('nftables.example.nft')
  const vpn = read('wg0.conf.example')
  const client = read('wireguard-client.conf.example')
  const proxyOrdering = read('caddy-pilot.override.conf.example')
  const pin = JSON.parse(read('release.json.example'))
  const locks = read('jomla-pilot.tmpfiles.example')
  const roles = JSON.parse(read('mongo-roles.json.example'))
  const launch = read('launch.cjs')
  const preload = read('preload.cjs')
  read('prepare-release.cjs')
  read('README.md')
  check('proxy_vpn_bind_and_reserved_hostname', /bind\s+10\.77\.0\.1/.test(proxy) && proxy.includes('pilot.example.invalid'))
  check('proxy_no_automatic_acme_or_internal_ca', /auto_https\s+off/.test(proxy) && !/tls\s+internal/.test(proxy))
  check('proxy_manual_certificate_paths_only', proxy.includes('/etc/jomla-pilot-tls/fullchain.pem') && proxy.includes('/etc/jomla-pilot-tls/privkey.pem'))
  check('certificate_path_shared_and_denied_to_app', proxyOrdering.includes('ReadOnlyPaths=/etc/jomla-pilot-tls /srv/jomla-pilot') && [api, worker].every(unit => unit.includes('InaccessiblePaths=-/etc/jomla-pilot-tls')))
  const blockedExpression = proxy.match(/@blocked\s+path_regexp\s+unavailable\s+([^\r\n]+)/)?.[1]
  const blocked = blockedExpression ? new RegExp(blockedExpression.replace(/^\(\?i\)/, ''), 'i') : null
  check('proxy_legacy_ai_and_sensitive_intake_blocked_first', blocked && ['/uploads', '/uploads/owned.png', '/UPLOADS/owned.png', '/api/product-ai/ENHANCE', '/api/suppliers/me/verify', '/API/SUPPLIERS/ME/VERIFY', '/api-docs', '/__audit/state'].every(value => blocked.test(value)) && proxy.indexOf('respond @blocked') < proxy.indexOf('reverse_proxy'))
  check('proxy_media_manual_upload_rfq_and_sourcing_permitted', blocked && ['/api/media/owned.png', '/API/MEDIA/owned.png', '/api/products', '/api/product-ai/upload', '/api/rfq', '/api/sourcing', '/health/ready'].every(value => !blocked.test(value)))
  check('proxy_multipart_limit_explicit', /request_body\s*\{\s*max_size\s+12MiB\s*\}/.test(proxy))
  check('proxy_invited_peer_gate', proxy.includes('@notInvited not remote_ip') && /respond\s+@notInvited.*403/.test(proxy))
  check('proxy_preserves_api_prefix_without_basic_auth', /handle\s+@api\s*\{/.test(proxy) && proxy.includes('(?i)^/api/') && !/\b(?:handle_path|uri\s+strip_prefix|basic_auth|basicauth|auth_basic)\b/.test(proxy))
  check('proxy_replaces_untrusted_forwarding_identity', ['header_up X-Forwarded-For {http.request.remote.host}', 'header_up X-Forwarded-Host {http.request.host}', 'header_up X-Forwarded-Proto {http.request.scheme}', 'header_up -Forwarded', 'header_up -X-Real-IP'].every(value => proxy.includes(value)))
  check('proxy_private_cache_policy_deferred', proxy.includes('Cache-Control "private, no-store"') && proxy.includes('Pragma "no-cache"') && /\bdefer\b/.test(proxy))
  check('proxy_static_root_is_build_only', proxy.includes('root * /srv/jomla-pilot/releases/REPLACE_WITH_REVIEWED_RELEASE_ID/frontend/build') && !/file_server[^}]*uploads|root\s+\*\s+\/var\/lib/.test(proxy))
  check('api_worker_use_same_explicit_environment_file', api.includes('EnvironmentFile=/etc/jomla-pilot/runtime.env') && worker.includes('EnvironmentFile=/etc/jomla-pilot/runtime.env'))
  check('independent_worker_with_embedded_worker_disabled', env.JOB_WORKER_MODE === 'external' && api.includes('/launcher/launch.cjs api') && worker.includes('/launcher/launch.cjs worker'))
  check('managed_writers_share_generation_and_have_exclusive_role_locks', [api, worker].every(unit => unit.includes('flock --shared --nonblock --no-fork /run/jomla-pilot/generation.lock') && unit.includes('KillMode=control-group')) && api.includes('flock --exclusive --nonblock --no-fork /run/jomla-pilot/api.lock') && worker.includes('flock --exclusive --nonblock --no-fork /run/jomla-pilot/worker.lock') && ![api, worker].some(unit => unit.includes('WorkingDirectory=/srv/jomla-pilot/current')))
  check('lock_inodes_cannot_be_replaced_by_service_user', locks.includes('d /run/jomla-pilot 0755 root root -') && ['generation', 'api', 'worker'].every(name => locks.includes(`f /run/jomla-pilot/${name}.lock 0660 root jomla-pilot -`)))
  check('release_pin_and_supported_exact_node', pin.nodeVersion === 'v24.22.1' && pin.releasePath.startsWith('/srv/jomla-pilot/releases/') && /^REPLACE_/.test(pin.manifestSha256) && launch.includes('version !== spec.nodeVersion') && launch.includes('PILOT_SOURCE_MISMATCH'))
  check('runtime_does_not_implicitly_provision_indexes', preload.includes("mongoose.set('autoIndex', false)") && preload.includes("mongoose.set('autoCreate', false)"))
  check('single_job_concurrency', env.JOB_CONCURRENCY === '1')
  check('node_heap_proposal_explicit', env.NODE_OPTIONS === '--max-old-space-size=512')
  check('persistent_media_and_logs_outside_release', env.UPLOADS_DIR === '/var/lib/jomla-pilot/uploads' && env.LOG_DIR.startsWith('/var/log/jomla-pilot/'))
  check('unit_shared_media_paths_and_write_boundaries', [api, worker].every(unit => unit.includes(env.UPLOADS_DIR) && unit.includes('ProtectSystem=strict') && unit.includes('UMask=0077')) && worker.includes('ReadOnlyPaths=' + env.UPLOADS_DIR))
  check('units_no_direct_external_egress', [api, worker].every(unit => unit.includes('IPAddressDeny=any') && unit.includes('IPAddressAllow=localhost')))
  check('database_explicit_separate_placeholder', /@127\.0\.0\.1:27017\/jomla_pilot\?authSource=jomla_pilot$/.test(env.MONGODB_URI) && env.MONGODB_URI.includes('REPLACE_'))
  check('session_secret_is_placeholder_only', /^REPLACE_/.test(env.JWT_SECRET))
  check('optional_provider_credentials_empty', ['CLAUDE_API_KEY', 'CLAUDE_MODEL', 'GOOGLE_VISION_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'BRAVE_SEARCH_API_KEY'].every(key => env[key] === ''))
  check('external_search_disabled_and_no_terms_acceptance', env.EXTERNAL_DISCOVERY_ENABLED === 'false' && env.EXTERNAL_DISCOVERY_TERMS_ACCEPTED === 'false')
  check('redis_not_required', env.DISABLE_REDIS === '1')
  check('same_origin_template_and_one_trusted_proxy', env.CORS_ORIGIN === 'https://pilot.example.invalid' && env.TRUST_PROXY === '1')
  check('mongo_loopback_authorization', /bindIp:\s*127\.0\.0\.1/.test(mongo) && /authorization:\s*enabled/.test(mongo))
  check('mongo_cache_proposal_explicit', /cacheSizeGB:\s*1(?:\s|$)/.test(mongo))
  const appRole = roles.roles.find(role => role.role === 'jomla_pilot_app')
  check('mongo_roles_separate_and_scoped_without_passwords', /^REPLACE_/.test(roles.database) && roles.applyAutomatically === false && roles.roles.length === 4 && appRole && !appRole.actions.some(action => /create|drop|admin|collMod/i.test(action)) && !JSON.stringify(roles).includes('"pwd"'))
  check('firewall_input_and_forward_default_drop', (firewall.match(/policy drop/g) || []).length >= 2 && firewall.includes('iifname "wg0"'))
  const rules = firewall.split(/\r?\n/).filter(line => !line.trim().startsWith('#')).join('\n')
  check('firewall_no_literal_public_application_allow', !/tcp dport (?:80|443|5000|27017|2019) accept/.test(rules.replace(/iifname "wg0"[^\n]*/g, '')))
  check('vpn_keys_are_placeholders', [vpn, client].every(value => /PrivateKey\s*=\s*REPLACE_/.test(value)))
  check('proxy_ordered_after_vpn', proxyOrdering.includes('wg-quick@wg0.service'))
  const model = JSON.parse(fs.readFileSync(path.join(root, 'reports/phase3-cost-model.json'), 'utf8'))
  const offsite = model.backupScenario.priceUSDperTBper30days * model.backupScenario.assumedAverageStoredTB * model.fx.USD_MAD
  check('costs_reproducible_without_network', model.options.every(option => {
    const calculated = model.calculated.options.find(value => value.id === option.id)
    const base = (option.serverMonthly + option.primaryIPv4Monthly) * model.fx[option.currency + '_MAD'] + offsite
    return calculated.baseMAD === Number(base.toFixed(2)) && calculated.withOptionalProviderBackupMAD === Number((base + option.serverMonthly * option.optionalProviderBackupFraction * model.fx[option.currency + '_MAD']).toFixed(2))
  }))
  const passed = checks.every(item => item.passed)
  process.stdout.write(JSON.stringify({
    status: passed ? 'pilot_ops_structural_checks_passed_not_deployable' : 'template_checks_failed',
    checkedAt: new Date().toISOString(), checks,
    noEnvironmentSecretsLoaded: true, noDatabaseConnection: true, noNetworkCalls: true,
    noServiceStartedOrSystemRuleApplied: true,
    nativeCaddySystemdNftWireGuardValidationPerformed: false,
    deploymentReady: false, mediaAuthorizationDelegatedToApplication: true,
    pending: ['Approved host and immutable release installation', 'Native Linux service, flock, firewall and VPN validation', 'Locked dependency installation on the selected Linux runtime', 'Trusted certificate and DNS renewal', 'Operational backup/restore drill', 'Separate index provisioning approval', 'Hosted isolation and physical-device acceptance'],
    templateHashes: [...documents].map(([file, content]) => ({ file, sha256: crypto.createHash('sha256').update(content).digest('hex') }))
  }, null, 2) + '\n')
  if (!passed) process.exitCode = 1
} catch {
  // No raw configuration or error payload is printed.
  process.stdout.write(JSON.stringify({ status: 'template_checks_failed', reason: 'Missing or invalid blueprint input', deploymentReady: false }) + '\n')
  process.exitCode = 1
}

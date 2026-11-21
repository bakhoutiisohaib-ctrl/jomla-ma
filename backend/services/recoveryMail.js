// Private test mailbox only. No email provider is configured for public use.
const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

function recoveryConfiguration() {
  const origin = new URL(process.env.RECOVERY_ORIGIN || 'https://invalid.invalid')
  const enabled = process.env.NODE_ENV === 'test' && process.env.RECOVERY_MAIL_MODE === 'private-file'
    && process.env.RECOVERY_MAIL_DIR && path.isAbsolute(process.env.RECOVERY_MAIL_DIR)
    && ['http:', 'https:'].includes(origin.protocol) && ['localhost', '127.0.0.1'].includes(origin.hostname)
    && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash
  if (!enabled) throw Object.assign(new Error('Account recovery delivery is not configured'), { status: 503, code: 'RECOVERY_UNAVAILABLE' })
  return { origin: origin.origin, directory: process.env.RECOVERY_MAIL_DIR }
}

async function deliverRecoveryMail({ to, language, resetUrl, changed = false }) {
  const { directory } = recoveryConfiguration()
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  // The mailbox must never be served by HTTP, included in logs or source control.
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Unsafe recovery mailbox')
  const messages = {
    ar: changed ? ['تم تغيير كلمة المرور', 'تغيّرت كلمة مرور حساب Jomla وأُلغيت جلساته السابقة.'] : ['استرجاع حساب Jomla', 'الرابط صالح لمدة 15 دقيقة ولمرة واحدة. إذا لم تطلبه فتجاهل هذه الرسالة.'],
    fr: changed ? ['Mot de passe modifié', 'Le mot de passe Jomla a été modifié et les anciennes sessions ont été révoquées.'] : ['Récupérer votre compte Jomla', 'Ce lien est valable 15 minutes et une seule fois. Ignorez ce message si vous ne l’avez pas demandé.'],
    en: changed ? ['Password changed', 'Your Jomla password was changed and previous sessions were revoked.'] : ['Recover your Jomla account', 'This link expires in 15 minutes and can be used once. Ignore this message if you did not request it.']
  }
  const [subject, text] = messages[language] || messages.ar
  await fs.writeFile(path.join(directory, crypto.randomUUID() + '.json'), JSON.stringify({
    testOnly: true, createdAt: new Date().toISOString(), to, subject, text, ...(resetUrl ? { resetUrl } : {})
  }), { flag: 'wx', mode: 0o600 })
}
module.exports = { recoveryConfiguration, deliverRecoveryMail }

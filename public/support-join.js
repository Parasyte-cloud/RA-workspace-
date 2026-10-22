// Support join page logic. Kept in its own file because the support and intranet hosts
// enforce script-src 'self': an inline <script> is blocked there, which left the form
// with no handler and let the browser submit it as a GET that put the email and the
// one-time invitation code in the address bar and the history.
(function () {
  var base = (document.querySelector('meta[name="support-functions-url"]') || {}).content || ''
  var $ = function (id) { return document.getElementById(id) }
  var passwordStage = false
  var params = new URLSearchParams(location.search)
  var emailParam = params.get('email')
  var codeParam = params.get('code')

  if (emailParam) $('join-email').value = emailParam
  if (codeParam) $('join-code').value = codeParam
  if (location.search) history.replaceState(null, '', location.pathname)

  function showMessage(text) {
    var message = $('join-message')
    message.textContent = text
    message.hidden = false
  }

  function clearMessage() {
    var message = $('join-message')
    message.textContent = ''
    message.hidden = true
  }

  function setSubmitting(value) {
    var button = $('join-submit')
    button.disabled = value
    if (value) button.textContent = passwordStage ? 'Creating access…' : 'Verifying invitation…'
    else button.textContent = passwordStage ? 'Create my access' : 'Verify invitation'
  }

  function showPasswordStage(body) {
    passwordStage = true
    $('join-password-stage').hidden = false
    $('join-email').readOnly = true
    $('join-code').readOnly = true
    $('join-submit').textContent = 'Create my access'
    if (body && body.name) {
      showMessage('Invitation verified for ' + body.name + '. Create a password to finish setting up Support access.')
    }
    $('join-password').focus()
  }

  function showSuccess(body) {
    $('join-ready').hidden = true
    $('join-success').hidden = false
    $('join-success-text').textContent = body.existingAccount
      ? 'Support access has been added to your existing account. Sign in with your existing password.'
      : 'Welcome' + (body.name ? ', ' + body.name.split(' ')[0] : '') + '. Your Support account is ready to use.'
  }

  $('join-form').addEventListener('submit', function (event) {
    event.preventDefault()
    clearMessage()

    var email = $('join-email').value.trim().toLowerCase()
    var code = $('join-code').value.trim()
    var password = $('join-password').value

    if (!base || base.indexOf('__') === 0) {
      showMessage('Support activation is temporarily unavailable. Contact RideArrivo Administration.')
      return
    }
    if (!email || !code) {
      showMessage('Enter your email address and the one-time code from your invitation.')
      return
    }
    if (passwordStage) {
      if (password.length < 10) {
        showMessage('Use at least 10 characters for your password.')
        return
      }
      if (password !== $('join-confirm').value) {
        showMessage('The two passwords do not match.')
        return
      }
    }

    setSubmitting(true)

    var payload = passwordStage
      ? JSON.stringify({ action: 'redeem', email: email, code: code, password: password })
      : JSON.stringify({ action: 'redeem', email: email, code: code })

    fetch(base.replace(/\/+$/, '') + '/support-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
      .then(function (response) {
        return response.json().catch(function () { return {} }).then(function (body) {
          return { ok: response.ok, body: body }
        })
      })
      .then(function (result) {
        if (!result.ok || result.body.error) {
          showMessage(result.body.error || 'Something went wrong. Check your invitation details and try again.')
          return
        }
        if (!passwordStage && result.body.needsPassword) {
          showPasswordStage(result.body)
          return
        }
        showSuccess(result.body)
      })
      .catch(function () {
        showMessage('Could not reach the server. Check your connection and try again.')
      })
      .finally(function () {
        setSubmitting(false)
      })
  })

  $('join-signin').addEventListener('click', function () { location.href = '/' })
  $('join-continue').addEventListener('click', function () { location.href = '/' })
  $('join-message').hidden = true
  $('join-password-stage').hidden = true
  $('join-ready').hidden = false
  $('join-success').hidden = true
})()

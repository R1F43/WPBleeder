const browser = globalThis.browser || globalThis.chrome;

export async function scanAdmin(origin, passiveData, onEndpointProgress, signal = null) {
  const result = {
    endpoints: [],
    loginUrl: null,
    loginAccessible: false,
    loginStatus: null,
    registrationEnabled: false,
    registrationUrl: null,
    passwordResetEnabled: false,
    passwordResetUrl: null,
    isHiddenLogin: false,
    adminAjaxStatus: null,
    adminAjaxAccessible: false,
    passiveSignals: passiveData?.adminSignals || null
  };

  const checks = [
    { name: 'Standard Login', path: '/wp-login.php', key: 'login' },
    { name: 'Admin Dashboard', path: '/wp-admin/', key: 'admin' },
    { name: 'Registration Endpoint', path: '/wp-login.php?action=register', key: 'register' },
    { name: 'Password Reset', path: '/wp-login.php?action=lostpassword', key: 'lostpassword' },
    { name: 'Multisite Signup', path: '/wp-signup.php', key: 'signup' },
    { name: 'Admin AJAX', path: '/wp-admin/admin-ajax.php', key: 'ajax' },
    { name: 'Custom /login', path: '/login', key: 'custom-login' },
    { name: 'Custom /admin', path: '/admin', key: 'custom-admin' },
    { name: 'Custom /dashboard', path: '/dashboard', key: 'custom-dashboard' },
    { name: 'WooCommerce Account', path: '/my-account', key: 'my-account' }
  ];

  for (const check of checks) {
    if (signal?.aborted) return result;
    const url = `${origin}${check.path}`;
    const endpointResult = {
      name: check.name,
      path: check.path,
      url,
      status: null,
      accessible: false,
      redirectUrl: null,
      detail: null
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal
      });

      endpointResult.status = response.status;
      endpointResult.accessible = response.status >= 200 && response.status < 400;

      if (response.redirected) {
        endpointResult.redirectUrl = response.url;
      }

      if (response.ok) {
        const body = await response.text();

        // Check Login page characteristics
        if (check.key === 'login') {
          result.loginStatus = response.status;
          result.loginUrl = url;
          if (body.includes('name="log"') || body.includes('id="loginform"') || body.includes('wp-login.php')) {
            result.loginAccessible = true;
            endpointResult.detail = 'Standard WordPress login form detected';
          }
        }

        // Check Registration enabled
        if (check.key === 'register' || check.key === 'signup') {
          if (body.includes('name="user_login"') || body.includes('name="user_email"') || body.includes('id="registerform"')) {
            result.registrationEnabled = true;
            result.registrationUrl = url;
            endpointResult.detail = 'User registration is OPEN';
          }
        }

        // Check Password Reset
        if (check.key === 'lostpassword') {
          if (body.includes('name="user_login"') && body.includes('lostpassword')) {
            result.passwordResetEnabled = true;
            result.passwordResetUrl = url;
            endpointResult.detail = 'Password reset active';
          }
        }

        // Check Admin AJAX
        if (check.key === 'ajax') {
          result.adminAjaxStatus = response.status;
          result.adminAjaxAccessible = true;
          endpointResult.detail = 'Admin AJAX reachable';
        }

        // Check Custom Login endpoints
        if (check.key.startsWith('custom-') || check.key === 'my-account') {
          if (body.includes('type="password"') && (body.includes('login') || body.includes('signin') || body.includes('username') || body.includes('account'))) {
            endpointResult.detail = 'Active login/account portal found';
          }
        }
      } else if (check.key === 'login' && (response.status === 404 || response.status === 403)) {
        result.isHiddenLogin = true;
        endpointResult.detail = 'Hidden or protected by security plugin';
      }

    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') return result;
      endpointResult.status = 0;
      endpointResult.detail = `Error: ${err.message}`;
    }

    result.endpoints.push(endpointResult);
    if (onEndpointProgress) {
      onEndpointProgress(endpointResult, result);
    }
  }

  return result;
}

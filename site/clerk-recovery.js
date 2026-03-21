/**
 * Clerk session recovery — clears stale cookies and auto-retries once.
 * Include AFTER the Clerk SDK script tag, BEFORE page scripts.
 */
function clearClerkCookies() {
  document.cookie.split(';').forEach(function (c) {
    var k = c.split('=')[0].trim();
    if (k.startsWith('__clerk') || k.startsWith('__session')) {
      var expiry = '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
      document.cookie = k + expiry;
      document.cookie = k + expiry + ';domain=' + location.hostname;
      document.cookie = k + expiry + ';domain=.' + location.hostname;
    }
  });
}

/**
 * Safe Clerk loader with one automatic retry.
 * On first failure: clears cookies and reloads page.
 * On second failure: returns false (page should degrade gracefully).
 */
async function loadClerkSafe() {
  try {
    await window.Clerk.load();
    sessionStorage.removeItem('clerk_retry');
    return true;
  } catch (e) {
    if (!sessionStorage.getItem('clerk_retry')) {
      sessionStorage.setItem('clerk_retry', '1');
      clearClerkCookies();
      location.reload();
      return false;
    }
    sessionStorage.removeItem('clerk_retry');
    clearClerkCookies();
    return false;
  }
}

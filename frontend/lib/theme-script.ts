/**
 * Light is the default. Dark applies only when the reader chose it with the
 * toggle; runs before first paint so a stored choice never flashes.
 *
 * Kept in its own module because middleware.ts allows this exact script by its
 * SHA-256 hash in the /analytics Content-Security-Policy: any edit here is
 * picked up there automatically.
 */
export const THEME_SCRIPT = `(function(){try{if(localStorage.getItem("sg-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}})();`;

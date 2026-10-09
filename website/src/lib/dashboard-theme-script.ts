/** Shared by the theme hook and the root layout (a server component), so no 'use client' here. */

export const DASHBOARD_THEME_KEY = 'kairo.dashboardTheme'

/**
 * Where the app theme applies: the signed-in dashboard and admin console, and
 * the account pages leading into them. The marketing site keeps its own look.
 */
export const THEMED_PATH_SOURCE = '^/(dashboard|admin|login|signup|verify-email|reset-password|onboarding|activate)(/|$)'

/** Light until the person picks something else in the dashboard. */
export const DEFAULT_THEME = 'light'

/**
 * Runs in <head> before first paint on themed routes, so nobody sees the wrong
 * theme flash in. Kept as a string because it is inlined.
 */
export const DASHBOARD_THEME_BOOT_SCRIPT = `(function(){try{
if(!new RegExp(${JSON.stringify(THEMED_PATH_SOURCE)}).test(location.pathname))return;
var v=localStorage.getItem('${DASHBOARD_THEME_KEY}')||'${DEFAULT_THEME}';
var light=v==='light'||(v==='system'&&matchMedia('(prefers-color-scheme: light)').matches);
document.documentElement.setAttribute('data-dash-theme',light?'light':'dark');
}catch(e){}})();`

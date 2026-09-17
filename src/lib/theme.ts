/**
 * Light / dark preference for the consumer surfaces.
 *
 * Deliberately NOT inside the toggle component: the root layout is a server
 * component and needs the bootstrap string, and importing it from a
 * "use client" module would drag that whole client module into the layout
 * for the sake of one constant.
 */
export const THEME_KEY = "wd-theme";

/**
 * Runs before the first paint, from <head>.
 *
 * Applying the stored preference in a React effect would mean the page paints
 * light and then snaps to dark a frame later — the flash every theme switcher
 * is judged by. Tiny and synchronous on purpose.
 *
 * It only ever writes the attribute for "dark", because light is the default
 * that needs no help: no attribute means light, so a first-time reader and a
 * page rendered with JavaScript disabled both land on the warm off-white the
 * brief specifies, and dark is strictly something a reader opts into.
 */
export const THEME_BOOTSTRAP = `try{if(localStorage.getItem('${THEME_KEY}')==='dark'){document.documentElement.dataset.wdTheme='dark'}}catch(e){}`;

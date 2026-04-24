// COPIA questo file in `config.js` e metti il tuo Page access token qui sotto.
// `config.js` è nel .gitignore — il token non finisce mai su GitHub.
//
// Come ottenere il Page access token (non scade se derivato da user long-lived):
//   1. Graph API Explorer → app "The Pulp" → Generate Access Token con scope:
//      pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights
//   2. Scambia lo user token short-lived → long-lived (60gg):
//      GET /v21.0/oauth/access_token?grant_type=fb_exchange_token
//          &client_id={APP_ID}&client_secret={APP_SECRET}
//          &fb_exchange_token={SHORT_LIVED_USER_TOKEN}
//   3. Dal long-lived user token ricava il Page token non-expiring:
//      GET /v21.0/me/accounts?access_token={LONG_LIVED_USER_TOKEN}
//      → data[0].access_token è il valore da mettere in TOKEN qui sotto.
//
// Lascia TOKEN = "" per lavorare in demo mode (dati fake, niente fetch reali).

export const TOKEN = "";

export const PAGE_ID = "111507393712812"; // The Pulp - Soave Sia il Vento

export const API = "https://graph.facebook.com/v21.0";

// FoodiSpots – Einstiegspunkt
// Prüft, ob Leaflet und Supabase geladen sind, lädt dann alle Module und startet die App.
const MODULES = ['core', 'ui', 'auth', 'start', 'groups', 'sync', 'photos', 'map', 'list', 'views', 'lookup', 'spots', 'ratings', 'settings', 'admin', 'invites', 'conflicts', 'trash'];

if (!window.supabase || !window.L) {
  document.body.innerHTML = '<div style="padding:24px;font-family:system-ui">' +
    '<h2>🍽️ FoodiSpots</h2><p>Die App konnte nicht geladen werden. Bitte beim ersten Start ' +
    'eine Internetverbindung herstellen und die Seite neu laden.</p></div>';
} else {
  // Alle Module laden (registrieren ihre Knöpfe), danach erst starten
  Promise.all(MODULES.map((m) => import(`./${m}.js`)))
    .then((mods) => mods[MODULES.indexOf('start')].boot())
    .catch((e) => {
      console.error(e);
      document.body.innerHTML = '<div style="padding:24px;font-family:system-ui"><h2>🍽️ FoodiSpots</h2>' +
        '<p>Beim Start ist ein Fehler aufgetreten. Bitte die Seite neu laden.</p></div>';
    });
}

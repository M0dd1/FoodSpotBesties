// Verbindung zu Supabase. Der Publishable Key darf öffentlich sein – geschützt wird über Row Level Security.
window.FOODI_CONFIG = {
  SUPABASE_URL: 'https://bnhagdnfaekhyjbokggp.supabase.co',
  SUPABASE_KEY: 'sb_publishable_x5mw-eSLGVGe2KrGtN8IAg_OsXpuTRj',
  // Startansicht der Karte, solange es noch keine Spots gibt (Koblenz)
  START: { lat: 50.3569, lng: 7.5890, zoom: 13 },
};

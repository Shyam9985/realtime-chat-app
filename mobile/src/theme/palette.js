// Colour sets as specified for the app (light and dark), then the token map the screens read
// through useTheme(). Change a colour here, never in a screen.
export const lightColors = {
  background: '#FFFFFF',
  surface: '#F7F8FA',
  header: '#FFFFFF',

  primary: '#128C5E',
  primaryPressed: '#0B7049',

  sentMessage: '#D9FDD3',
  receivedMessage: '#FFFFFF',

  text: '#111B21',
  textSecondary: '#667781',

  border: '#E9EDEF',
  online: '#25D366',
  unreadBadge: '#25D366',

  error: '#DC2626',
  chatBackground: '#EFEAE2',
};

export const darkColors = {
  background: '#0B141A',
  surface: '#111B21',
  header: '#202C33',

  primary: '#00A884',
  primaryPressed: '#008F72',

  sentMessage: '#005C4B',
  receivedMessage: '#202C33',

  text: '#E9EDEF',
  textSecondary: '#8696A0',

  border: '#2A3942',
  online: '#25D366',
  unreadBadge: '#00A884',

  error: '#F87171',
  chatBackground: '#0B141A',
};

const shared = {
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: { xs: 11, sm: 13, md: 15, lg: 17, xl: 22, xxl: 28 },
};

// the light header is white, so its text is the normal text colour; the dark header is a dark bar
const toTheme = (p, isDark) => ({
  ...shared,
  isDark,
  colors: {
    background: p.background,
    surface: isDark ? p.surface : p.background,     // list rows sit on the page background
    surfaceAlt: p.surface,                           // inputs, pressed rows, search bars
    border: p.border,
    text: p.text,
    textMuted: p.textSecondary,
    textOnAccent: '#FFFFFF',
    accent: p.primary,
    accentPressed: p.primaryPressed,
    accentBright: p.unreadBadge,
    accentSoft: isDark ? p.sentMessage : p.sentMessage,
    online: p.online,
    headerBackground: p.header,
    headerText: isDark ? p.text : p.text,
    tabBarBackground: p.header,
    chatBackground: p.chatBackground,
    bubbleMine: p.sentMessage,
    bubbleMineText: p.text,
    bubbleMineMeta: p.textSecondary,
    bubbleTheirs: p.receivedMessage,
    bubbleTheirsText: p.text,
    success: p.online,
    danger: p.error,
    dangerSoft: isDark ? '#3B1D22' : '#FDE8EC',
    warning: isDark ? '#FBBF24' : '#D97706',
    warningSoft: isDark ? '#3A2E0A' : '#FEF3C7',
    seen: '#53BDEB',         // read ticks are blue, as in whatsapp: the one blue the user asked for
    selection: isDark ? 'rgba(0,168,132,0.22)' : 'rgba(37,211,102,0.16)',   // a long-pressed message
    highlight: isDark ? 'rgba(0,168,132,0.55)' : 'rgba(37,211,102,0.35)',   // search matches inside a bubble
    overlaySoft: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',    // quoted message inside a reply
    overlay: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(17, 27, 33, 0.45)',
    inputBackground: p.surface,
    placeholder: p.textSecondary,
  },
});

export const light = toTheme(lightColors, false);
export const dark = toTheme(darkColors, true);

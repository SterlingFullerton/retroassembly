import { index, route, type RouteConfig } from '@react-router/dev/routes'

export const routes = {
  home: '/',
  libraryConsoles: '/library/consoles',
  libraryFavorites: '/library/favorites',
  libraryHistory: '/library/history',
  libraryHome: '/library',
  libraryJoin: '/library/join',
  libraryPlatform: '/library/platform/:platform',
  libraryPlatformRom: '/library/platform/:platform/rom/:fileName',
  libraryRoms: '/library/roms',
  librarySettings: '/library/settings',
  librarySettingsConsole: '/library/settings/consoles/:console',
  librarySettingsSection: '/library/settings/:section',
  login: '/login',
  loginOidc: '/login/oidc',
  loginOidcCallback: '/login/oidc/callback',
  logout: '/logout',
} as const

export default [
  route(routes.home, 'routes/home.ts'),
  // The library's pages share one layout, which checks the user is signed in and loads what every page needs
  route(routes.libraryHome, 'routes/library-layout.tsx', { id: 'library' }, [
    index('routes/library-home.tsx'),
    route('roms', 'routes/library-roms.tsx'),
    route('consoles', 'routes/library-consoles.tsx'),
    route('favorites', 'routes/library-favorites.tsx'),
    route('history', 'routes/library-history.tsx'),
    // A guest's side of a game played together: an experiment, reached only by its address
    route('join', 'routes/library-join.tsx'),
    route('platform/:platform', 'routes/library-platform.tsx'),
    route('platform/:platform/rom/:fileName', 'routes/library-platform-rom.tsx'),
    // The settings: on their own the first section, or on a phone the list of them. A console has a page of its own under
    // the consoles' section
    route('settings/:section?/:console?', 'routes/library-settings.tsx'),
  ]),
  route(routes.login, 'routes/login.tsx'),
  // Logging out and logging in with OIDC are answered by the server (server/internal/web)
  // A test-only page showing one console's on-screen controls without a game, for checking they look and press the
  // same after a change. Left out of production builds
  ...(process.env.NODE_ENV === 'production' ? [] : [route('/dev/controls/:kind', 'routes/dev-controls.tsx')]),
] satisfies RouteConfig

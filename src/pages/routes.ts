import { index, route, type RouteConfig } from '@react-router/dev/routes'

export const routes = {
  home: '/',
  libraryConsoles: '/library/consoles',
  libraryFavorites: '/library/favorites',
  libraryHistory: '/library/history',
  libraryHome: '/library',
  libraryPlatform: '/library/platform/:platform',
  libraryPlatformRom: '/library/platform/:platform/rom/:fileName',
  libraryRoms: '/library/roms',
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
    route('platform/:platform', 'routes/library-platform.tsx'),
    route('platform/:platform/rom/:fileName', 'routes/library-platform-rom.tsx'),
  ]),
  route(routes.login, 'routes/login.tsx'),
  // Logging out and logging in with OIDC are answered by the server (src/server/redirect-routes.ts)
  // A test-only page showing one console's on-screen controls without a game, for checking they look and press the
  // same after a change. Left out of production builds
  ...(process.env.NODE_ENV === 'production' ? [] : [route('/dev/controls/:kind', 'routes/dev-controls.tsx')]),
] satisfies RouteConfig

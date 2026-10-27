# Shared admin interface

`@pkgs/admin-ui` owns the visual foundation for custom administration tools:
React/Mantine provider, application shell, navigation, page headings, notices,
copy controls, and Light/Dark/System appearance. Relay and Fleet import these
components directly so changes reach both consoles. Portfolio and vendor-owned
consoles do not use this package.

The default appearance follows the operating system. An early, same-origin
script applies the saved `workspace-admin-color-scheme` preference before CSS
paints. Preferences synchronize between tabs on the same origin. Storage failure
falls back to System. Applications provide the CSP nonce in `meta[name=csp-nonce]`;
`prepareAdminUi` passes it to the scroll-lock helper and the provider passes it
to Mantine's generated styles.

Fleet maintains its own UI library and installer snapshots in its standalone repository.

Checks: `bun run --cwd packages/admin-ui tc`, `lint`, and `test`.

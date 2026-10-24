import { AdminBrand } from '@pkgs/admin-ui/components';
export { CopyValue, ErrorNotice, PageHeading } from '@pkgs/admin-ui/components';
export const localIdentity =
  typeof document !== 'undefined' &&
  document
    .querySelector('meta[name="relay-development"]')
    ?.getAttribute('content') === 'true';
export function Brand() {
  return <AdminBrand name="Relay" subtitle="Identity console" />;
}
